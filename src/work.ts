import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { commandSchema, querySchema, snapshotSchema } from './work-schema.ts'
import { applySourceCommand, refreshSource, sourceResult } from './work-sources/application.ts'
import type { GitHubSourcePort } from './work-sources/types.ts'
import type { WorkSnapshot } from './work-schema.ts'
import { WorkExecutionError } from './work-execution/host.ts'
import { continuationInFlight, MANAGED_WORK_INSTRUCTIONS, materialRequest, reserveContinuation, successorMessage } from './work-execution/continuation.ts'
import { applyTaskOrganization } from './work-organization.ts'
import { applyTaskReport, projectProgress, taskProgressView } from './work-progress.ts'
import { reconcileProjectSources } from './work-sources/discovery.ts'
import type { WorkExecutionHost } from './work-execution/host.ts'
export type { WorkExecutionHost } from './work-execution/host.ts'
import type { HostResource, Project, ResourceRef, SessionCandidate, TaskRef, WorkCommand, WorkResult, WorkTask } from './work-types.ts'
export type * from './work-types.ts'

/** Only trusted adapters construct authorization; browser payloads cannot supply it. */
export interface WorkActor { readonly operator: boolean; readonly session?: import('./work-types.ts').SessionRef; readonly agentId?: string }
/** Trusted resource observation with an explicit optional managed execution capability. */
export interface WorkHost {
  execution?: WorkExecutionHost
  resources(): Promise<readonly HostResource[]>
  sessions(resource: HostResource): Promise<readonly SessionCandidate[]>
}
function failed(code: string, message: string): WorkResult { return { status: 'failed', error: { code, message } } }
function conflict(currentVersion: number): WorkResult {
  return { status: 'conflict', error: { code: 'version-conflict', message: 'Expected version is stale', currentVersion } }
}
function legacyKey(address: { runtimeId: string; projectRoot: string; taskId: string }): string { return JSON.stringify([address.runtimeId, address.projectRoot, address.taskId]) }
function sameResource(a: ResourceRef, b: ResourceRef): boolean { return a.runtimeId === b.runtimeId && a.workspaceId === b.workspaceId }
function sameSession(a: { runtimeId: string; sessionId: string }, b: { runtimeId: string; sessionId: string }): boolean { return a.runtimeId === b.runtimeId && a.sessionId === b.sessionId }
function taskAt(state: WorkSnapshot, ref: TaskRef): WorkTask | undefined {
  return state.tasks.find(item => item.id === ref.taskId && item.projectId === ref.projectId)
}

function sourceIssuesAt(state: WorkSnapshot, ref: TaskRef): import('./work-sources/types.ts').GitHubIssueReference[] {
  return state.externalBindings.filter(binding => binding.ref.projectId === ref.projectId && binding.ref.taskId === ref.taskId)
    .map(({ lastObserved: issue }) => ({ nodeId: issue.nodeId, url: issue.url, number: issue.number, title: issue.title, repository: issue.repository, state: issue.state }))
}

/** Public local work commands and queries. One v3 snapshot is the only writer authority. */
export class WorkApplication {
  private readonly file: string
  constructor(readonly directory: string, readonly host: WorkHost, readonly source?: GitHubSourcePort) {
    if (!isAbsolute(directory)) throw new Error('Work record directory must be absolute')
    this.file = join(directory, 'work-v3.json')
    this.host.execution?.connect(async (sessionId, messages = []) => {
      const mayAdvance = (execution: import('./work-types.ts').WorkExecution | undefined) => !execution || (!['accepted', 'creating', 'failed', 'waiting', 'paused'].includes(execution.state)
        && !(execution.control?.status === 'accepted' && execution.control.action !== 'resume')
        && !execution.continuationBlocked
        && (!continuationInFlight(execution) || ['reserved', 'material-requested', 'taken'].includes(execution.continuation!.phase)))
      let state = await this.load()
      const initial = state.executions.find(item => item.session.sessionId === sessionId)
      if (initial && messages.length > 0 && initial.continuationPolicy?.enabled && !continuationInFlight(initial)) {
        await this.observeContinuation(initial.id)
        state = await this.load()
      }
      if (state.executions.some(item => item.retired?.some(old => old.session.sessionId === sessionId) || (item.continuation?.successor.sessionId === sessionId && item.session.sessionId !== sessionId))) return false
      const execution = state.executions.find(item => item.session.sessionId === sessionId)
      if (mayAdvance(execution) || messages.length === 0) return mayAdvance(execution)
      return withFileLock(this.file, async () => {
        const current = await this.load()
        const owner = current.executions.find(item => item.session.sessionId === sessionId)
        if (current.executions.some(item => item.retired?.some(old => old.session.sessionId === sessionId))) return false
        if (mayAdvance(owner)) return true
        for (const message of messages) {
          if (owner!.events.some(item => item.id === message.id)) continue
          const text = message.content.flatMap(block => typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string' ? [block.text] : []).join('\n')
          owner!.events.push({ id: message.id, text: text.trim() ? text.slice(0, 100_000) : 'Native Session input', kind: 'input', delivery: 'accepted', acceptance: 'unassessed', nativeMessage: structuredClone(message) })
        }
        await writeFileAtomic(this.file, `${JSON.stringify(current)}\n`, { mode: 0o600, dirMode: 0o700 })
        return false
      })
    })
  }
  private async load(): Promise<WorkSnapshot> {
    try { return snapshotSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 3, projects: [], agents: [], tasks: [], commands: [], legacyMappings: [], sources: [], externalBindings: [], externalIndex: {}, executions: [] }
      throw error
    }
  }
  private async sourceTransaction<T>(apply: (state: WorkSnapshot) => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    return withFileLock(this.file, async () => {
      const state = await this.load()
      const result = await apply(state)
      snapshotSchema.parse(state)
      await writeFileAtomic(this.file, `${JSON.stringify(state)}\n`, { mode: 0o600, dirMode: 0o700 })
      return result
    })
  }
  /** Trusted ToolRunContext adapter supplies only its real Session and call identity. */
  async sessionControl(session: import('./work-types.ts').SessionRef, callId: string, action: string, text?: string, expectedEpoch?: number): Promise<WorkResult> {
    const state = await this.load()
    const execution = state.executions.find(item => sameSession(item.session, session))
    if (!execution) return failed('forbidden', 'Calling Session is not a current Task coordinator')
    if (action === 'status') return { status: 'completed', task: taskAt(state, execution.ref), sourceIssues: sourceIssuesAt(state, execution.ref), execution, executionRuntime: this.host.execution?.status(execution) ?? 'inactive' }
    const commandId = `tool:${createHash('sha256').update(JSON.stringify([session.runtimeId, session.sessionId, callId])).digest('hex')}`
    return this.execute({ type: 'task.control', commandId, ref: execution.ref,
      executionId: execution.id, owner: execution.owner, epoch: expectedEpoch ?? execution.epoch, action, text },
    { operator: false, session, agentId: execution.agentId })
  }
  /** Public trusted adapter: source identity and Task references are resolved on the server. */
  async sessionContinuationMaterial(session: import('./work-types.ts').SessionRef, callId: string,
    content: import('./work-types.ts').ContinuationContent, expectedEpoch?: number): Promise<WorkResult> {
    const execution = (await this.load()).executions.find(item => sameSession(item.session, session))
    if (!execution) return failed('forbidden', 'Calling Session is not a current Task coordinator')
    const commandId = `material:${createHash('sha256').update(JSON.stringify([session.runtimeId, session.sessionId, callId])).digest('hex')}`
    return this.execute({ type: 'task.continuation-material', commandId, ref: execution.ref,
      executionId: execution.id, owner: execution.owner, epoch: expectedEpoch ?? execution.epoch, content },
    { operator: false, session, agentId: execution.agentId })
  }
  async sessionReport(session: import('./work-types.ts').SessionRef, callId: string, report: import('./work-progress.ts').TaskReport, expectedEpoch?: number): Promise<WorkResult> {
    const execution = (await this.load()).executions.find(item => sameSession(item.session, session))
    if (!execution) return failed('forbidden', 'Calling Session is not a current Task coordinator')
    const commandId = `report:${createHash('sha256').update(JSON.stringify([session.runtimeId, session.sessionId, callId])).digest('hex')}`
    return this.execute({ type: 'task.report', commandId, ref: execution.ref, executionId: execution.id, owner: execution.owner, epoch: expectedEpoch ?? execution.epoch, report }, { operator: false, session, agentId: execution.agentId })
  }
  async sessionOrganize(session: import('./work-types.ts').SessionRef, callId: string, organization: import('./work-organization.ts').TaskOrganization, expectedEpoch?: number): Promise<WorkResult> {
    const execution = (await this.load()).executions.find(item => sameSession(item.session, session))
    if (!execution) return failed('forbidden', 'Calling Session is not a current Task coordinator')
    const commandId = `organize:${createHash('sha256').update(JSON.stringify([session.runtimeId, session.sessionId, callId])).digest('hex')}`
    return this.execute({ type: 'task.organize', commandId, ref: execution.ref, executionId: execution.id, owner: execution.owner, epoch: expectedEpoch ?? execution.epoch, organization }, { operator: false, session, agentId: execution.agentId })
  }
  async reconcileSources(): Promise<void> {
    if (this.source) await reconcileProjectSources(apply => this.sourceTransaction(apply), this.source)
  }
  async execute(input: unknown, actor: WorkActor): Promise<WorkResult> {
    if (!actor.operator && !actor.session) return failed('forbidden', 'Host operator or trusted Session authorization is required')
    const parsed = commandSchema.safeParse(input)
    if (!parsed.success) return failed('invalid-command', 'Invalid work command')
    const command = parsed.data
    let admissionChoices: import('./work-types.ts').HostExecutionChoices | undefined
    if (!actor.operator && !('executionId' in command)) return failed('forbidden', 'Session actors can only control their current execution')
    if (command.type === 'task.start') {
      if (!this.host.execution) return failed('host-capability-unavailable', 'This host has no managed execution capability')
      try { admissionChoices = await this.host.execution.check({ ...command, sessionMode: command.session ? 'reuse' : 'create', session: command.session ?? { runtimeId: command.resource.runtimeId, sessionId: `session-${randomUUID()}` } }) }
      catch (error) { return failed(error instanceof WorkExecutionError ? error.code : 'host-admission-failed', error instanceof WorkExecutionError ? error.message : 'Host execution admission failed') }
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const receipt = await withFileLock<WorkResult>(this.file, async () => {
      const state = await this.load()
      if (!actor.operator) {
        const execution = 'executionId' in command ? state.executions.find(item => item.id === command.executionId) : undefined
        if (!execution || actor.agentId !== execution.agentId || !actor.session || !sameSession(actor.session, execution.session)) return failed('forbidden', 'Caller is not the responsible current Session and Project Agent')
      }
      if (actor.operator && command.type === 'task.continue') {
        const prior = state.commands.find(item => item.commandId === command.commandId)
        if (prior) return prior.fingerprint === JSON.stringify(command) ? prior.result : { status: 'conflict', error: { code: 'command-id-reused', message: 'Command ID already has different content' } }
      }
      const refusal = await this.authorize(state, command)
      if (refusal) return refusal
      const fingerprint = JSON.stringify(command)
      const previous = state.commands.find(item => item.commandId === command.commandId)
      if (previous) return previous.fingerprint === fingerprint ? previous.result : { status: 'conflict', error: { code: 'command-id-reused', message: 'Command ID already has different content' } }
      const result = await this.apply(state, command, admissionChoices)
      if (result.status !== 'completed') return result
      // Receipt owns a detached snapshot: subsequent commands must not alter retry results.
      state.commands.push({ commandId: command.commandId, fingerprint, result: structuredClone(result) })
      snapshotSchema.parse(state)
      await writeFileAtomic(this.file, `${JSON.stringify(state)}\n`, { mode: 0o600, dirMode: 0o700 })
      return result
    })
    if (command.type === 'task.continuation-material' || command.type === 'task.organize' || command.type === 'task.report' || command.type === 'task.configure-continuation') return receipt
    if (command.type === 'task.continue' && !actor.operator) return receipt
    if (command.type === 'task.control' && (!actor.operator || command.action === 'progress')) return receipt
    if ((command.type === 'task.start' || 'executionId' in command) && receipt.status === 'completed' && receipt.execution) {
      if (command.type === 'task.input' && (['accepted', 'creating'].includes(receipt.execution.state) || continuationInFlight(receipt.execution))) return receipt
      return this.ensureExecution(receipt.execution.id, command.commandId)
    }
    return receipt
  }
  /** Host lifecycle recovery includes starts, handoffs and controls. */
  async reconcileControls(): Promise<void> {
    if (!this.host.execution) return
    for (const initial of (await this.load()).executions) {
      if (this.host.execution.status(initial) === 'running') continue
      await this.observeRuntimeFailure(initial.id)
      await this.observeContinuation(initial.id)
      const execution = (await this.load()).executions.find(item => item.id === initial.id)!
      if (execution.control?.status === 'accepted' || continuationInFlight(execution) || ['accepted', 'creating', 'failed'].includes(execution.state)
        || execution.events.some(event => event.delivery !== 'consumed' && !['waiting', 'paused'].includes(execution.state))) {
        await this.ensureExecution(execution.id, execution.control?.commandId ?? execution.continuation?.commandId ?? execution.history[0]!.commandId)
      }
    }
  }
  private async observeRuntimeFailure(id: string): Promise<void> {
    if (!this.host.execution?.failure) return
    const execution = (await this.load()).executions.find(item => item.id === id)!
    const failure = await this.host.execution.failure(execution)
    if (failure?.id === execution.runtimeFailure?.id) return
    await this.sourceTransaction(async state => {
      const current = state.executions.find(item => item.id === id)!
      if (current.epoch !== execution.epoch) return
      if (failure) current.runtimeFailure = failure
      else delete current.runtimeFailure
    })
  }
  private async observeContinuation(id: string): Promise<void> {
    const execution = (await this.load()).executions.find(item => item.id === id)!
    const policy = execution.continuationPolicy
    if (!policy?.enabled || (execution.runtimeFailure && !execution.runtimeFailure.acknowledged) || execution.continuationBlocked || continuationInFlight(execution) || !['ready', 'running'].includes(execution.state)
      || (execution.control?.status === 'accepted' && execution.control.action !== 'resume')) return
    let observation: import('./work-types.ts').ContinuationObservation | undefined
    let error: { code: string; message: string } | undefined
    try {
      if (!this.host.execution?.measure) throw new WorkExecutionError('continuation-meter-unavailable', 'Automatic continuation requires public host token measurement')
      observation = await this.host.execution.measure(execution)
      if (!execution.continuationObservation && execution.continuation?.phase === 'delivered' && execution.continuation.sourceEpoch + 1 === execution.epoch && observation.totalTokens >= policy.targetTokens) throw new WorkExecutionError('continuation-target-too-small', 'The first measured successor context already reaches this soft target; increase the target or continue manually instead of repeatedly rotating the same material')
      if (policy.targetTokens + policy.reserveTokens + observation.outputReserve > observation.capacity) throw new WorkExecutionError('continuation-policy-invalid', 'Context target plus handoff reserve and model output reserve exceeds exact model capacity')
      if (execution.continuationObservation && observation.routeKey !== execution.continuationObservation.routeKey) throw new WorkExecutionError('continuation-route-changed', 'Exact model route or capacity changed; explicitly reconfigure continuation before advancing')
    } catch (cause) { error = { code: cause instanceof WorkExecutionError ? cause.code : 'continuation-observation-failed', message: cause instanceof Error ? cause.message : 'Continuation observation failed' } }
    await this.sourceTransaction(async state => {
      const current = state.executions.find(item => item.id === id)!
      if (current.epoch !== execution.epoch || current.continuationPolicy?.version !== policy.version || continuationInFlight(current)) return
      if (observation) current.continuationObservation = observation
      if (error) current.continuationBlocked = error
      else if (observation!.totalTokens >= policy.targetTokens) reserveContinuation(current, taskAt(state, current.ref)!, `auto:${current.id}:${current.epoch}:${policy.version}`, true)
    })
  }
  private async advanceContinuation(execution: import('./work-types.ts').WorkExecution): Promise<import('./work-types.ts').WorkExecution> {
    const host = this.host.execution!
    const operationId = execution.continuation!.operationId
    const save = async (change: (current: import('./work-types.ts').WorkExecution) => void) => this.sourceTransaction(async state => {
      const current = state.executions.find(item => item.id === execution.id)!
      if (current.continuation?.operationId !== operationId) throw new WorkExecutionError('stale-continuation', 'Continuation operation changed')
      change(current)
      return current
    })
    const sealInput = async () => {
      if (!host.sealInput) throw new WorkExecutionError('host-capability-unavailable', 'Durable source intake sealing is unavailable')
      const operation = execution.continuation!
      const source = { ...execution, session: operation.source, epoch: operation.sourceEpoch }
      const sealed = await host.sealInput(source, operationId)
      execution = await save(current => {
        if (current.continuation!.inputSeal !== undefined && current.continuation!.inputSeal !== sealed.seq) throw new WorkExecutionError('continuation-seal-conflict', 'Source intake seal changed')
        for (const message of sealed.messages) {
          if (message.id === operation.materialRequestId || current.events.some(item => item.id === message.id)) continue
          current.events.push({ id: message.id, text: 'Input accepted before source intake was sealed', kind: 'input', delivery: 'accepted', acceptance: 'unassessed', nativeMessage: message })
        }
        current.continuation!.inputSeal = sealed.seq
      })
    }
    if (['waiting', 'paused'].includes(execution.state) || (execution.control?.status === 'accepted' && execution.control.action !== 'resume')) return execution
    if (execution.continuation!.automatic && execution.runtimeFailure && !execution.runtimeFailure.acknowledged) return save(current => { current.continuation!.error = { code: 'continuation-source-failed', message: 'The source model turn failed or was cancelled; explicit resume, input or manual continuation is required' } })
    if (execution.continuation!.automatic && !execution.continuationPolicy?.enabled) return save(current => { current.continuation!.error = { code: 'continuation-disabled', message: 'Automatic continuation is disabled; explicit manual continuation can resume this same operation' } })
    try {
      if (!host.maintain || !host.profile) throw new WorkExecutionError('host-capability-unavailable', 'Safe continuation host boundary is unavailable')
      if (execution.continuation!.phase !== 'taken') await host.maintain(execution, async () => {
        execution = (await this.load()).executions.find(item => item.id === execution.id)!
        if (['waiting', 'paused'].includes(execution.state) || (execution.control?.status === 'accepted' && execution.control.action !== 'resume')) return
        let operation = execution.continuation!
        const actual = await host.profile!(execution)
        if (operation.automatic) {
          if (!host.measure) throw new WorkExecutionError('continuation-meter-unavailable', 'Automatic handoff requires current public token measurement')
          const observed = await host.measure(execution)
          if (execution.continuationObservation && observed.routeKey !== execution.continuationObservation.routeKey) throw new WorkExecutionError('continuation-route-changed', 'Source route metadata changed during automatic handoff')
          if (operation.phase === 'reserved' && observed.totalTokens + observed.outputReserve + execution.continuationPolicy!.reserveTokens > observed.capacity) throw new WorkExecutionError('continuation-reserve-exhausted', 'The source passed the soft target before reaching idle and lacks the configured handoff reserve')
        }
        if (operation.phase === 'reserved') {
          execution = await save(current => {
            current.continuation!.profile = actual
            current.continuation!.phase = 'material-requested'
            delete current.continuation!.error
          })
          operation = execution.continuation!
        } else if (JSON.stringify(actual) !== JSON.stringify(operation.profile)) throw new WorkExecutionError('continuation-profile-changed', 'Source model, preset, permissions or workspace changed during handoff')
        if (operation.phase === 'material-requested') {
          const request = { id: operation.materialRequestId, text: materialRequest(operation), kind: 'input' as const, delivery: operation.requestDelivery ?? 'accepted' as const, acceptance: 'unassessed' as const }
          const observed = await host.observe(execution, request)
          if (observed === 'consumed') {
            execution = await save(current => { current.continuation!.requestDelivery = observed; current.continuation!.error = { code: 'continuation-material-missing', message: 'The source consumed the material request but did not save material; no successor will be created' } })
          } else {
            const delivered = await host.deliver(execution, request, true)
            execution = await save(current => { current.continuation!.requestDelivery = delivered })
          }
          return
        }
        if (!operation.material) throw new WorkExecutionError('continuation-material-missing', 'Saved source material is required before creating a successor')
        if (operation.phase === 'material-saved' || operation.phase === 'successor-created') {
          const profile = operation.profile!
          const successor = { ...execution, session: operation.successor, sessionMode: 'create' as const, epoch: operation.sourceEpoch + 1,
            agentPreset: profile.agentPreset, model: { provider: profile.provider, model: profile.model, ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}) }, permissionPreset: profile.permissionPreset, actual: profile }
          const created = await host.ensure(successor, async () => {
            const current = (await this.load()).executions.find(item => item.id === execution.id)!
            return sameSession(current.session, successor.session) && current.epoch === successor.epoch
          })
          if (JSON.stringify(created) !== JSON.stringify(profile)) throw new WorkExecutionError('continuation-profile-mismatch', 'Successor did not inherit the saved source execution context')
          execution = await save(current => { current.continuation!.phase = 'successor-created' })
          // Read source consumption before transferring outstanding events to the successor.
          for (const event of execution.events) {
            if (event.delivery === 'consumed') continue
            const delivery = await host.observe(execution, event)
            execution = await save(current => { current.events.find(item => item.id === event.id)!.delivery = delivery === 'consumed' ? 'consumed' : 'accepted' })
          }
          execution = await this.sourceTransaction(async state => {
            const current = state.executions.find(item => item.id === execution.id)!
            const op = current.continuation!
            if (op.operationId !== operationId || current.epoch !== op.sourceEpoch || !sameSession(current.session, op.source)) throw new WorkExecutionError('stale-execution-authority', 'Source lost authority before takeover')
            const task = taskAt(state, current.ref)!
            if (task.specification.version !== op.specification.version || task.goal !== op.goal || op.material?.specificationVersion !== op.specification.version) throw new WorkExecutionError('continuation-specification-changed', 'Task specification changed during handoff; source material must be refreshed before takeover')
            if (['waiting', 'paused'].includes(current.state) || (current.control?.status === 'accepted' && current.control.action !== 'resume')) return current
            if (state.executions.some(item => item.id !== current.id && (sameSession(item.session, op.successor) || item.retired?.some(old => sameSession(old.session, op.successor))))) throw new WorkExecutionError('session-in-use', 'Reserved successor belongs to another execution')
            ;(current.retired ??= []).push({ session: op.source, epoch: op.sourceEpoch, operationId })
            current.session = op.successor
            current.sessionMode = 'create'
            current.epoch = op.sourceEpoch + 1
            current.actual = profile
            current.agentPreset = profile.agentPreset
            current.model = { provider: profile.provider, model: profile.model, ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}) }
            current.permissionPreset = profile.permissionPreset
            current.state = 'ready'
            op.phase = 'taken'
            delete op.error
            delete current.continuationObservation
            delete current.continuationBlocked
            return current
          })
        }
        if (execution.continuation!.phase === 'taken' && execution.continuation!.inputSeal === undefined) await sealInput()
      })
      if (execution.continuation!.phase === 'taken') {
        if (execution.continuation!.inputSeal === undefined) {
          const source = { ...execution, session: execution.continuation!.source, epoch: execution.continuation!.sourceEpoch }
          await host.maintain(source, sealInput)
        }
        const op = execution.continuation!
        const event = { id: op.kickoffId, text: successorMessage(op, execution.policy.instructions), kind: 'input' as const, delivery: op.kickoffDelivery ?? 'accepted' as const, acceptance: 'unassessed' as const }
        // Source authority was retired in the same transaction as the epoch change.
        const delivered = await host.deliver(execution, event)
        execution = await save(current => { current.continuation!.kickoffDelivery = delivered; current.continuation!.phase = 'delivered'; delete current.continuation!.error })
      }
    } catch (error) {
      execution = await save(current => {
        const detail = { code: error instanceof WorkExecutionError ? error.code : 'continuation-outcome-unknown', message: error instanceof Error ? error.message : 'Continuation outcome unknown; recovery retains the reserved identities' }
        current.continuation!.error = detail
        if (current.continuation!.automatic && /^continuation-(metadata|meter|route|reserve|profile|policy)/.test(detail.code)) current.continuationBlocked = detail
      })
    }
    return execution
  }
  private async ensureExecution(id: string, commandId: string): Promise<WorkResult> {
    const lease = join(this.directory, `${id}.execution`)
    return withFileLock<WorkResult>(lease, async () => {
      const save = async (change: (execution: import('./work-types.ts').WorkExecution) => void) => withFileLock(this.file, async () => {
        const state = await this.load()
        const execution = state.executions.find(item => item.id === id)!
        change(execution)
        await writeFileAtomic(this.file, `${JSON.stringify(state)}\n`, { mode: 0o600, dirMode: 0o700 })
        return execution
      })
      let execution = (await this.load()).executions.find(item => item.id === id)!
      try {
        if (continuationInFlight(execution) && execution.control?.status !== 'accepted') {
          execution = await this.advanceContinuation(execution)
          if (continuationInFlight(execution)) return { status: 'completed', execution }
        }
        if (['accepted', 'creating', 'failed'].includes(execution.state)) execution = await save(item => { item.state = 'creating'; delete item.error; item.history.push({ state: 'creating', commandId }) })
        const actual = await this.host.execution!.ensure(execution, async () => {
          const current = (await this.load()).executions.find(item => item.id === id)
          return !!current && current.owner === execution.owner && current.epoch === execution.epoch
            && !['paused', 'waiting', 'failed', 'creating', 'accepted'].includes(current.state)
            && !(current.control?.status === 'accepted' && current.control.action !== 'resume')
        })
        execution = await save(item => {
          item.actual = actual
          if (item.state === 'creating') { item.state = 'ready'; item.history.push({ state: 'ready', commandId }) }
        })
        const control = execution.control
        if (control?.status === 'accepted') {
          await this.host.execution!.settle(execution)
          execution = await save(item => {
            if (item.control?.commandId !== control.commandId) return
            item.state = control.action === 'pause' ? 'paused' : control.action === 'wait' ? 'waiting' : 'ready'
            item.control!.status = 'applied'
            item.history.push({ state: item.state, commandId })
          })
          if (control.action === 'resume' && execution.control?.commandId === control.commandId) await this.host.execution!.wake(execution)
        }
        for (const event of execution.events) {
          if (event.delivery === 'consumed') continue
          const delivery = ['waiting', 'paused'].includes(execution.state)
            ? await this.host.execution!.observe(execution, event)
            : await this.host.execution!.deliver(execution, event)
          execution = await save(item => { item.events.find(value => value.id === event.id)!.delivery = delivery })
        }
      } catch (error) {
        execution = await save(item => { item.state = 'failed'; item.error = { code: error instanceof WorkExecutionError ? error.code : 'host-create-unknown',
          message: error instanceof WorkExecutionError ? error.message : 'Host outcome is unknown; retry recovers the reserved Session and message identities' }; item.history.push({ state: 'failed', commandId }) })
      }
      return { status: 'completed', execution }
    }, { waitMs: 0 }).catch(async error => {
      // The published atomic-write API exposes contention as this named Error, not an errno.
      if (!(error instanceof Error) || error.message !== `atomic-write: timed out waiting for the writer lock at ${lease}.lock`) throw error
      const execution = (await this.load()).executions.find(item => item.id === id)!
      return { status: 'completed' as const, execution }
    })
  }
  private async candidates(project: Project): Promise<SessionCandidate[]> {
    const resources = (await this.host.resources()).filter(item => project.resources.some(ref => sameResource(ref, item.ref)))
    const candidates = (await Promise.all(resources.map(resource => this.host.sessions(resource)))).flat()
    return candidates.filter(item => resources.some(resource => sameResource(resource.ref, item.resource)
      && item.ref.runtimeId === resource.ref.runtimeId))
  }
  private async authorize(state: WorkSnapshot, command: WorkCommand): Promise<WorkResult | undefined> {
    if ('ref' in command && !taskAt(state, command.ref)) return failed('unknown-task', 'Task does not belong to this project')
    if ('child' in command && command.child.projectId !== command.ref.projectId) return failed('cross-project-reference', 'Parent and child must belong to the same project')
    if ('executionId' in command) {
      const execution = state.executions.find(item => item.id === command.executionId && item.ref.taskId === command.ref.taskId && item.ref.projectId === command.ref.projectId)
      if (!execution || execution.owner !== command.owner || execution.epoch !== command.epoch) return failed('stale-execution-authority', 'Execution identity, owner or epoch is stale')
    }
    if ('resource' in command && command.resource && !(await this.host.resources()).some(item => sameResource(item.ref, command.resource!))) {
      return failed('unavailable-resource', 'Resource is not allowed by this host')
    }
    if (command.type === 'task.associate-session') {
      const project = state.projects.find(item => item.id === command.ref.projectId)
      if (!project || !(await this.candidates(project)).some(item => sameSession(item.ref, command.session))) {
        return failed('incompatible-session', 'Session is not a compatible member of this project resource')
      }
    }
  }
  private newTask(state: WorkSnapshot, command: Extract<WorkCommand, { type: 'task.create' | 'task.create-child' }>, project: Project): WorkTask {
    const task: WorkTask = { id: randomUUID(), projectId: project.id, title: command.title, goal: command.goal, version: 1,
      specification: { version: 1, text: command.specification, acceptance: command.acceptance }, agentId: project.defaultAgentId,
      specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [{ commandId: command.commandId, type: command.type, version: 1 }] }
    state.tasks.push(task)
    return task
  }
  private changed(task: WorkTask, command: WorkCommand): void {
    task.version++
    task.activity.push({ commandId: command.commandId, type: command.type, version: task.version })
  }
  private async apply(state: WorkSnapshot, command: WorkCommand, admissionChoices?: import('./work-types.ts').HostExecutionChoices): Promise<WorkResult> {
    if (command.type === 'source.configure-project' || command.type === 'source.configure' || command.type === 'source.set-enabled' || command.type === 'source.import' || command.type === 'source.link') return applySourceCommand(state, command)
    if (command.type === 'project.create') {
      if (command.resource && state.projects.some(item => item.resources.some(ref => sameResource(ref, command.resource!)))) {
        return { status: 'conflict', error: { code: 'resource-in-use', message: 'Resource already belongs to another project' } }
      }
      const project: Project = { id: randomUUID(), name: command.name, version: 1, defaultAgentId: randomUUID(), resources: command.resource ? [command.resource] : [] }
      state.projects.push(project)
      state.agents.push({ id: project.defaultAgentId, projectId: project.id, role: 'coordinator',
        policy: { version: 1, modelCandidates: [], instructions: 'Coordinate accepted work and its acceptance criteria.', capabilities: ['coordination'] } })
      return { status: 'completed', project }
    }
    const projectId = 'projectId' in command ? command.projectId : command.ref.projectId
    const project = state.projects.find(item => item.id === projectId)
    if (!project) return failed('unknown-project', 'Project does not exist')
    if (command.type === 'project.configure-continuation') {
      if (project.version !== command.expectedVersion) return conflict(project.version)
      if (command.policy.version !== (project.continuationPolicy?.version ?? 0) + 1) return failed('continuation-policy-version', 'Policy version must advance by one')
      project.continuationPolicy = structuredClone(command.policy)
      project.version++
      return { status: 'completed', project }
    }
    if (command.type === 'project.attach-resource') {
      if (project.version !== command.expectedVersion) return conflict(project.version)
      if (state.projects.some(item => item.id !== project.id && item.resources.some(ref => sameResource(ref, command.resource)))) {
        return { status: 'conflict', error: { code: 'resource-in-use', message: 'Resource already belongs to another project' } }
      }
      if (!project.resources.some(ref => sameResource(ref, command.resource))) { project.resources.push(command.resource); project.version++ }
      return { status: 'completed', project }
    }
    if (command.type === 'task.create') return { status: 'completed', task: this.newTask(state, command, project) }
    if (!('ref' in command)) return failed('unsupported-command', 'Command is not implemented')
    const task = taskAt(state, command.ref)
    if (!task) return failed('unknown-task', 'Task does not belong to this project')
    const active = state.executions.find(item => item.ref.taskId === task.id && item.ref.projectId === task.projectId)
    if (active && continuationInFlight(active) && ['task.update-spec', 'task.replace-breakdown', 'task.create-child', 'task.link-child', 'task.report', 'task.organize'].includes(command.type)) return failed('continuation-in-progress', 'Task specifications, structure and acceptance reports are frozen until the reserved handoff completes')
    if ('executionId' in command) {
      const execution = state.executions.find(item => item.id === command.executionId && item.ref.taskId === task.id)
      if (!execution || execution.owner !== command.owner || execution.epoch !== command.epoch) return failed('stale-execution-authority', 'Execution identity, owner or epoch is stale')
      if (command.type === 'task.organize') return applyTaskOrganization(state, execution, command.organization, command.commandId, randomUUID)
      if (command.type === 'task.report') return applyTaskReport(state, execution, command.report, command.commandId)
      if (command.type === 'task.configure-continuation') {
        if (command.policy.version !== (execution.continuationPolicy?.version ?? 0) + 1) return failed('continuation-policy-version', 'Policy version must advance by one')
        execution.continuationPolicy = structuredClone(command.policy)
        delete execution.continuationObservation
        delete execution.continuationBlocked
      }
      if (command.type === 'task.continue') {
        if (['paused', 'waiting', 'accepted', 'creating', 'failed'].includes(execution.state) || (execution.control?.status === 'accepted' && execution.control.action !== 'resume')) return failed('continuation-not-ready', 'Resume or recover the current execution before requesting continuation')
        if (!this.host.execution?.maintain || !this.host.execution.profile || !this.host.execution.sealInput) return failed('host-capability-unavailable', 'Safe continuation maintenance is unavailable')
        reserveContinuation(execution, task, command.commandId, false)
        execution.continuation!.automatic = false
        delete execution.continuationBlocked
      }
      if (command.type === 'task.continuation-material') execution.continuationMaterial = { ...command.content,
        commandId: command.commandId, ref: execution.ref, executionId: execution.id, source: execution.session, epoch: execution.epoch,
        taskVersion: task.version, specificationVersion: task.specification.version }
      if (command.type === 'task.continuation-material' && execution.continuation?.phase === 'material-requested') {
        execution.continuation.material = structuredClone(execution.continuationMaterial!)
        execution.continuation.phase = 'material-saved'
        delete execution.continuation.error
      }
      if (execution.runtimeFailure && (command.type === 'task.input' || command.type === 'task.continue' || (command.type === 'task.control' && command.action === 'resume'))) execution.runtimeFailure.acknowledged = true
      if (command.type === 'task.input') execution.events.push({ id: randomUUID(), text: command.text, kind: command.kind, delivery: 'accepted', acceptance: 'unassessed' })
      if (command.type === 'task.control') {
        if (command.action === 'progress') execution.progress = command.text
        else execution.control = { commandId: command.commandId, action: command.action, status: 'accepted', reason: command.text }
      }
      return { status: 'completed', execution }
    }
    if (command.type === 'task.start') {
      const previous = state.executions.find(item => item.ref.taskId === task.id)
      if (previous) {
        if (previous.agentId !== command.agentId || !sameResource(previous.resource, command.resource)
          || (command.session && !sameSession(previous.session, command.session)) || previous.agentPreset !== command.agentPreset
          || previous.permissionPreset !== command.permissionPreset || JSON.stringify(previous.model) !== JSON.stringify(command.model)) {
          return failed('execution-conflict', 'Task already has a different execution; use its existing execution identity')
        }
        return { status: 'completed', execution: previous }
      }
      if (task.version !== command.expectedVersion) return conflict(task.version)
      if (state.legacyMappings.some(item => item.ref.taskId === task.id)) return failed('legacy-authority-retained', 'Legacy mapped work requires an explicit safe migration before v3 execution')
      const agent = state.agents.find(item => item.id === command.agentId && item.projectId === project.id)
      if (!agent || !agent.policy.capabilities.includes('coordination')) return failed('ineligible-agent', 'Project Agent has no coordination capability')
      const choices = admissionChoices!
      if (!choices.agentPresets.includes(command.agentPreset)) return failed('disallowed-agent-preset', 'Only inherited preset choices are authorized for a new execution')
      if (!choices.permissionPresets.includes(command.permissionPreset)) return failed('disallowed-permission-preset', 'Only inherited permission choices are authorized for a new execution')
      if (agent.policy.modelCandidates.length && !agent.policy.modelCandidates.includes(`${command.model.provider}/${command.model.model}`)) return failed('disallowed-model', 'Model is not authorized by the Project Agent policy')
      if (!project.resources.some(item => sameResource(item, command.resource))) return failed('incompatible-resource', 'Execution resource does not belong to this project')
      const session = command.session ?? { runtimeId: command.resource.runtimeId, sessionId: `session-${randomUUID()}` }
      if (session.runtimeId !== command.resource.runtimeId) return failed('incompatible-session', 'Session and execution resource must share a runtime')
      if (state.executions.some(item => sameSession(item.session, session) || item.retired?.some(old => sameSession(old.session, session)) || (item.continuation && sameSession(item.continuation.successor, session)))) return failed('session-in-use', 'Session already coordinates another execution')
      if (state.tasks.some(item => item.sessions.some(binding => sameSession(binding.session, session)
        && (binding.purpose === 'review' || item.projectId !== task.projectId || item.id !== task.id)))) return failed('association-only-session', 'Review or another Task association cannot grant coordination')
      const executionId = randomUUID()
      const sourceContext = sourceIssuesAt(state, command.ref).map(issue => `GitHub Issue: ${issue.url}\nRepository: ${issue.repository.owner}/${issue.repository.repository}`).join('\n')
      const kickoff = `${agent.policy.instructions}\n\n${MANAGED_WORK_INSTRUCTIONS}\n\nTask ${task.id}: ${task.title}\nGoal: ${task.goal}\n${sourceContext ? `\nSource:\n${sourceContext}\n` : ''}\nSpecification:\n${task.specification.text}\n\nAcceptance criteria:\n${task.specification.acceptance.map(item => `- ${item}`).join('\n')}`
      if (kickoff.length > 100_000) return failed('task-material-too-large', 'Task goal, specification and acceptance exceed the 100,000-character kickoff limit; organize a bounded accepted specification before starting')
      const execution = { id: executionId, ref: command.ref, agentId: agent.id, owner: randomUUID(), epoch: 1,
        resource: command.resource, session, sessionMode: command.session ? 'reuse' as const : 'create' as const, agentPreset: command.agentPreset, model: command.model, permissionPreset: command.permissionPreset,
        policy: structuredClone(agent.policy), ...(project.continuationPolicy ? { continuationPolicy: structuredClone(project.continuationPolicy) } : {}), events: [{ id: `kickoff:${executionId}`, text: kickoff, kind: 'input' as const, delivery: 'accepted' as const, acceptance: 'unassessed' as const }], state: 'accepted' as const, history: [{ state: 'accepted' as const, commandId: command.commandId }] }
      state.executions.push(execution)
      task.agentId = agent.id
      this.changed(task, command)
      return { status: 'completed', execution }
    }
    if (task.version !== command.expectedVersion) return conflict(task.version)
    if (command.type === 'legacy.map') {
      if (!isAbsolute(command.address.projectRoot) || normalize(command.address.projectRoot) !== command.address.projectRoot) {
        return failed('noncanonical-legacy-address', 'Legacy project root must be an absolute normalized address')
      }
      const previous = state.legacyMappings.find(item => legacyKey(item.address) === legacyKey(command.address))
      if (previous && (previous.ref.projectId !== projectId || previous.ref.taskId !== task.id)) {
        return { status: 'conflict', error: { code: 'legacy-address-in-use', message: 'Legacy address already maps to another TaskRef' } }
      }
      if (!previous) { state.legacyMappings.push({ address: command.address, ref: command.ref }); this.changed(task, command) }
      return { status: 'completed', ref: command.ref, task }
    }
    if (command.type === 'task.associate-session') {
      const existing = task.sessions.find(item => sameSession(item.session, command.session))
      if (existing) {
        if (existing.purpose !== command.purpose) return failed('association-purpose-conflict', 'Session is already associated with another purpose')
        return { status: 'completed', task }
      }
      if (state.tasks.some(item => item.projectId !== projectId && item.sessions.some(binding => sameSession(binding.session, command.session)))) {
        return failed('cross-project-reference', 'Session is associated with work in another project')
      }
      task.sessions.push({ session: command.session, purpose: command.purpose })
      this.changed(task, command)
      return { status: 'completed', task }
    }
    if (command.type === 'task.replace-breakdown') {
      if (new Set(command.blocks.map(block => block.id)).size !== command.blocks.length) return failed('duplicate-block', 'Breakdown block IDs must be unique')
      task.breakdown = command.blocks
      this.changed(task, command)
      return { status: 'completed', task }
    }
    if (command.type === 'task.create-child') {
      const child = this.newTask(state, command, project)
      child.parent = command.ref
      task.children.push({ projectId, taskId: child.id })
      this.changed(task, command)
      return { status: 'completed', task: child }
    }
    if (command.type === 'task.link-child') {
      if (command.child.projectId !== projectId) return failed('cross-project-reference', 'Parent and child must belong to the same project')
      const child = taskAt(state, command.child)
      if (!child) return failed('unknown-task', 'Child Task does not belong to this project')
      if (child.version !== command.childExpectedVersion) return conflict(child.version)
      let ancestor: WorkTask | undefined = task
      while (ancestor) {
        if (ancestor.id === child.id) return failed('task-cycle', 'Parent relationship would form a cycle')
        ancestor = ancestor.parent ? taskAt(state, ancestor.parent) : undefined
      }
      if (child.parent && child.parent.taskId !== task.id) return failed('child-already-linked', 'Child already has another parent')
      if (task.children.some(ref => ref.taskId === child.id)) return { status: 'completed', task }
      child.parent = command.ref
      task.children.push(command.child)
      this.changed(child, command)
      this.changed(task, command)
      return { status: 'completed', task }
    }
    if (command.type === 'task.update-spec') {
      task.specificationHistory.push(task.specification)
      task.specification = { version: task.specification.version + 1, text: command.specification, acceptance: command.acceptance }
      task.goal = command.goal
      this.changed(task, command)
      return { status: 'completed', task }
    }
    return failed('unsupported-command', 'Command is not implemented')
  }
  async query(input: unknown, actor: WorkActor): Promise<WorkResult> {
    if (!actor.operator) return failed('forbidden', 'Host operator authorization is required')
    const parsed = querySchema.safeParse(input)
    if (!parsed.success) return failed('invalid-query', 'Invalid work query')
    const query = parsed.data
    if (query.type === 'work.capabilities') {
      let taskStart = false
      try { const choices = await this.host.execution?.choices(); taskStart = !!choices?.models.length && !!choices.agentPresets.length && !!choices.permissionPresets.length } catch {}
      return { status: 'completed', capabilities: { githubRead: Boolean(this.source), githubWrite: false, taskStart, projectViews: !!this.source?.project } }
    }
    if ((query.type === 'source.issues' || query.type === 'source.issue') && query.refresh) return refreshSource(apply => this.sourceTransaction(apply), query, this.source)
    const state = await this.load()
    if (query.type === 'source.list') return state.projects.some(item => item.id === query.projectId)
      ? { status: 'completed', sources: state.sources.filter(item => item.projectId === query.projectId) } : failed('unknown-project', 'Project does not exist')
    if (query.type === 'source.issues' || query.type === 'source.issue') return sourceResult(state, query)
    if (query.type === 'task.execution-options') {
      const task = taskAt(state, query.ref)
      if (!task) return failed('unknown-task', 'Task does not belong to this project')
      const project = state.projects.find(item => item.id === query.ref.projectId)!
      const agent = state.agents.find(item => item.id === task.agentId && item.projectId === project.id)!
      if (!this.host.execution) return failed('host-capability-unavailable', 'This host has no managed execution capability')
      try {
        const choices = await this.host.execution.choices()
        const models = choices.models.filter(item => !agent.policy.modelCandidates.length || agent.policy.modelCandidates.includes(`${item.provider}/${item.model}`))
        const defaultModel = models.find(item => item.provider === choices.defaults.model.provider && item.model === choices.defaults.model.model) ?? models[0]
        if (!defaultModel) return failed('unavailable-model', 'Project Agent has no available allowed model')
        return { status: 'completed', executionOptions: { ...choices, agentId: agent.id, models,
          defaults: { ...choices.defaults, model: defaultModel }, resources: (await this.host.resources()).filter(item => project.resources.some(ref => sameResource(ref, item.ref))) } }
      } catch (error) { return failed(error instanceof WorkExecutionError ? error.code : 'host-admission-failed', error instanceof WorkExecutionError ? error.message : 'Host execution catalogs could not be read') }
    }
    if (query.type === 'task.history') {
      const execution = state.executions.find(item => item.ref.taskId === query.ref.taskId && item.ref.projectId === query.ref.projectId)
      if (!execution || !execution.retired?.some(item => sameSession(item.session, query.session))) return failed('unrelated-history', 'Session is not retired history of this Task')
      if (!this.host.execution?.history) return failed('host-capability-unavailable', 'Read-only Session history is unavailable')
      try { return { status: 'completed', transcript: { session: query.session, ...await this.host.execution.history(execution, query.session, query.cursor, query.limit) } } }
      catch (error) { return failed(error instanceof WorkExecutionError ? error.code : 'history-unavailable', error instanceof Error ? error.message : 'History unavailable') }
    }
    if (query.type === 'task.execution') {
      if (!taskAt(state, query.ref)) return failed('unknown-task', 'Task does not belong to this project')
      const execution = state.executions.find(item => item.ref.taskId === query.ref.taskId)
      return { status: 'completed', ...(execution ? { execution, executionRuntime: this.host.execution?.status(execution) ?? 'inactive' as const } : {}) }
    }
    if (query.type === 'legacy.resolve') {
      const mapping = state.legacyMappings.find(item => legacyKey(item.address) === legacyKey(query.address))
      return mapping ? { status: 'completed', ref: mapping.ref } : failed('unknown-legacy-address', 'Legacy address has no accepted TaskRef mapping')
    }
    if (query.type === 'projects.list') return { status: 'completed', projects: state.projects }
    if (query.type === 'resources.list') return { status: 'completed', resources: (await this.host.resources()).map(resource => {
      const owner = state.projects.find(project => project.resources.some(ref => sameResource(ref, resource.ref)))
      return { ref: resource.ref, title: resource.title, ...(owner ? { owner: { projectId: owner.id, projectName: owner.name } } : {}) }
    }) }
    if (query.type === 'session.work') return { status: 'completed', work: [
      ...state.tasks.flatMap(task => task.sessions.filter(binding => sameSession(binding.session, query.session)
        && !state.executions.some(item => item.ref.taskId === task.id && (sameSession(item.session, query.session) || item.retired?.some(old => sameSession(old.session, query.session))))).map(binding => ({
        ref: { projectId: task.projectId, taskId: task.id }, title: task.title,
        projectName: state.projects.find(project => project.id === task.projectId)!.name, purpose: binding.purpose,
      }))),
      ...state.executions.filter(item => item.retired?.some(old => sameSession(old.session, query.session))).map(item => ({
        ref: item.ref, title: taskAt(state, item.ref)!.title, projectName: state.projects.find(project => project.id === item.ref.projectId)!.name, purpose: 'history' as const, executionId: item.id, epoch: item.retired!.find(old => sameSession(old.session, query.session))!.epoch, currentSession: item.session,
      })),
      ...state.executions.filter(item => sameSession(item.session, query.session)).map(item => ({
        ref: item.ref, title: taskAt(state, item.ref)!.title, projectName: state.projects.find(project => project.id === item.ref.projectId)!.name,
        purpose: 'control' as const, executionId: item.id, epoch: item.epoch,
      })),
    ] }
    if (query.type === 'session.candidates') {
      const project = state.projects.find(item => item.id === query.projectId)
      return project ? { status: 'completed', candidates: await this.candidates(project) } : failed('unknown-project', 'Project does not exist')
    }
    if (query.type !== 'project.detail' && query.type !== 'task.detail') return failed('unsupported-query', 'Query is not implemented')
    const projectId = query.type === 'project.detail' ? query.projectId : query.ref.projectId
    const project = state.projects.find(item => item.id === projectId)
    if (!project) return failed('unknown-project', 'Project does not exist')
    if (query.type === 'project.detail') return { status: 'completed', project, progressItems: projectProgress(state, projectId, this.host.execution),
      agents: state.agents.filter(item => item.projectId === projectId), tasks: state.tasks.filter(item => item.projectId === projectId) }
    const task = taskAt(state, query.ref)
    const execution = state.executions.find(item => item.ref.taskId === query.ref.taskId)
    return task ? { status: 'completed', task, progress: taskProgressView(state, query.ref, this.host.execution), bindings: state.externalBindings.filter(item => item.ref.taskId === task.id && item.ref.projectId === task.projectId),
      ...(execution ? { execution, executionRuntime: this.host.execution?.status(execution) ?? 'inactive' as const } : {}),
      ...(task.parent ? { parent: taskAt(state, task.parent) } : {}),
      children: task.children.map(ref => taskAt(state, ref)!).filter(Boolean),
    } : failed('unknown-task', 'Task does not belong to this project')
  }
}
