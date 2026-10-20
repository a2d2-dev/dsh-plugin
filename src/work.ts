import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { commandSchema, querySchema, snapshotSchema } from './work-schema.ts'
import type { WorkSnapshot } from './work-schema.ts'
import { WorkExecutionError } from './work-execution/host.ts'
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

/** Public local work commands and queries. One v3 snapshot is the only writer authority. */
export class WorkApplication {
  private readonly file: string
  constructor(readonly directory: string, readonly host: WorkHost) {
    if (!isAbsolute(directory)) throw new Error('Work record directory must be absolute')
    this.file = join(directory, 'work-v3.json')
    this.host.execution?.connect(async (sessionId, messages = []) => {
      const mayAdvance = (execution: import('./work-types.ts').WorkExecution | undefined) => !execution || (!['accepted', 'creating', 'failed', 'waiting', 'paused'].includes(execution.state)
        && !(execution.control?.status === 'accepted' && execution.control.action !== 'resume'))
      const state = await this.load()
      const execution = state.executions.find(item => item.session.sessionId === sessionId)
      if (mayAdvance(execution) || messages.length === 0) return mayAdvance(execution)
      return withFileLock(this.file, async () => {
        const current = await this.load()
        const owner = current.executions.find(item => item.session.sessionId === sessionId)
        if (mayAdvance(owner)) return true
        for (const message of messages) {
          if (owner!.events.some(item => item.id === message.id)) continue
          const text = message.content.flatMap(block => typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string' ? [block.text] : []).join('\n')
          owner!.events.push({ id: message.id, text: text.trim() ? text : 'Native Session input', kind: 'input', delivery: 'accepted', acceptance: 'unassessed', nativeMessage: structuredClone(message) })
        }
        await writeFileAtomic(this.file, `${JSON.stringify(current)}\n`, { mode: 0o600, dirMode: 0o700 })
        return false
      })
    })
  }
  private async load(): Promise<WorkSnapshot> {
    try { return snapshotSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 3, projects: [], agents: [], tasks: [], commands: [], legacyMappings: [], executions: [] }
      throw error
    }
  }
  /** Trusted ToolRunContext adapter supplies only its real Session and call identity. */
  async sessionControl(session: import('./work-types.ts').SessionRef, callId: string, action: string, text?: string, expectedEpoch?: number): Promise<WorkResult> {
    const execution = (await this.load()).executions.find(item => sameSession(item.session, session))
    if (!execution) return failed('forbidden', 'Calling Session is not a current Task coordinator')
    if (action === 'status') return { status: 'completed', execution, executionRuntime: this.host.execution?.status(execution) ?? 'inactive' }
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
      const refusal = await this.authorize(state, command)
      if (refusal) return refusal
      const fingerprint = JSON.stringify(command)
      const previous = state.commands.find(item => item.commandId === command.commandId)
      if (previous) return previous.fingerprint === fingerprint ? previous.result : { status: 'conflict', error: { code: 'command-id-reused', message: 'Command ID already has different content' } }
      const result = await this.apply(state, command, admissionChoices)
      if (result.status !== 'completed') return result
      // Receipt owns a detached snapshot: subsequent commands must not alter retry results.
      state.commands.push({ commandId: command.commandId, fingerprint, result: structuredClone(result) })
      await writeFileAtomic(this.file, `${JSON.stringify(state)}\n`, { mode: 0o600, dirMode: 0o700 })
      return result
    })
    if (command.type === 'task.continuation-material') return receipt
    if (command.type === 'task.control' && (!actor.operator || command.action === 'progress')) return receipt
    if ((command.type === 'task.start' || 'executionId' in command) && receipt.status === 'completed' && receipt.execution) {
      if (command.type === 'task.input' && ['accepted', 'creating'].includes(receipt.execution.state)) return receipt
      return this.ensureExecution(receipt.execution.id, command.commandId)
    }
    return receipt
  }
  /** Recovery drives persisted intentions only; it never creates a new control request. */
  async reconcileControls(): Promise<void> {
    if (!this.host.execution) return
    for (const execution of (await this.load()).executions) {
      if (execution.control?.status !== 'accepted' || this.host.execution.status(execution) === 'running') continue
      await this.ensureExecution(execution.id, execution.control.commandId)
    }
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
    if ('executionId' in command) {
      const execution = state.executions.find(item => item.id === command.executionId && item.ref.taskId === task.id)
      if (!execution || execution.owner !== command.owner || execution.epoch !== command.epoch) return failed('stale-execution-authority', 'Execution identity, owner or epoch is stale')
      if (command.type === 'task.continuation-material') execution.continuationMaterial = { ...command.content,
        commandId: command.commandId, ref: execution.ref, executionId: execution.id, source: execution.session, epoch: execution.epoch,
        taskVersion: task.version, specificationVersion: task.specification.version }
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
      if (state.executions.some(item => sameSession(item.session, session))) return failed('session-in-use', 'Session already coordinates another execution')
      if (state.tasks.some(item => item.sessions.some(binding => sameSession(binding.session, session)
        && (binding.purpose === 'review' || item.projectId !== task.projectId || item.id !== task.id)))) return failed('association-only-session', 'Review or another Task association cannot grant coordination')
      const executionId = randomUUID()
      const kickoff = `${agent.policy.instructions}\n\nTask ${task.id}: ${task.title}\nGoal: ${task.goal}\n\nSpecification:\n${task.specification.text}\n\nAcceptance criteria:\n${task.specification.acceptance.map(item => `- ${item}`).join('\n')}`
      const execution = { id: executionId, ref: command.ref, agentId: agent.id, owner: randomUUID(), epoch: 1,
        resource: command.resource, session, sessionMode: command.session ? 'reuse' as const : 'create' as const, agentPreset: command.agentPreset, model: command.model, permissionPreset: command.permissionPreset,
        policy: structuredClone(agent.policy), events: [{ id: `kickoff:${executionId}`, text: kickoff, kind: 'input' as const, delivery: 'accepted' as const, acceptance: 'unassessed' as const }], state: 'accepted' as const, history: [{ state: 'accepted' as const, commandId: command.commandId }] }
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
    const state = await this.load()
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
    if (query.type === 'resources.list') return { status: 'completed', resources: [...await this.host.resources()] }
    if (query.type === 'session.work') return { status: 'completed', work: [
      ...state.tasks.flatMap(task => task.sessions.filter(binding => sameSession(binding.session, query.session)
        && !state.executions.some(item => item.ref.taskId === task.id && sameSession(item.session, query.session))).map(binding => ({
        ref: { projectId: task.projectId, taskId: task.id }, title: task.title,
        projectName: state.projects.find(project => project.id === task.projectId)!.name, purpose: binding.purpose,
      }))),
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
    if (query.type === 'project.detail') return { status: 'completed', project,
      agents: state.agents.filter(item => item.projectId === projectId), tasks: state.tasks.filter(item => item.projectId === projectId) }
    const task = taskAt(state, query.ref)
    const execution = state.executions.find(item => item.ref.taskId === query.ref.taskId)
    return task ? { status: 'completed', task,
      ...(execution ? { execution, executionRuntime: this.host.execution?.status(execution) ?? 'inactive' as const } : {}),
      ...(task.parent ? { parent: taskAt(state, task.parent) } : {}),
      children: task.children.map(ref => taskAt(state, ref)!).filter(Boolean),
    } : failed('unknown-task', 'Task does not belong to this project')
  }
}
