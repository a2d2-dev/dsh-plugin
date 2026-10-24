import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-fs-local'
import type {} from '@deepseek-ai/dsh-bash-local'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { createUserMessage, MessageId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { WorkEvent, WorkExecution } from '../work-types.ts'
import { RuntimeHost } from '../task-runtime/host.ts'
import { rootSessionProfile } from '../root-session.ts'
import { resolveSessionAgent } from '../official-session.ts'
import { WorkExecutionError } from './host.ts'
import type { WorkExecutionHost } from './host.ts'
import { settleUncollectedJob } from './job-observation.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'a2d2-work-input-seal': { kind: 'a2d2-work-input-seal'; operationId: string }
    'a2d2-work-dispatch': { kind: 'a2d2-work-dispatch' }
    'a2d2-work-context': { kind: 'a2d2-work-context'; form: 'notice'; summary: string }
  }
}

const installed = new WeakMap<Agent, { executionId: string }>()
/** Public DSH create, preset, local model, maintenance and persisted delivery APIs. */
export class DshWorkExecutionHost implements WorkExecutionHost {
  readonly runtime: RuntimeHost
  constructor(private readonly ctx: Context, readonly runtimeId: string) { this.runtime = new RuntimeHost(ctx) }
  /** The production plugin also serves local browsing without execution services. */
  private service<K extends keyof Context>(name: K, ...methods: string[]): NonNullable<Context[K]> {
    const service = (this.ctx.get as (key: string) => unknown).call(this.ctx, name as string)
    if (!service) throw new WorkExecutionError('host-capability-unavailable', `DSH ${String(name)} is required for managed execution`)
    for (const method of methods) {
      if (typeof (service as Record<string, unknown>)[method] !== 'function') throw new WorkExecutionError('host-capability-unavailable', `DSH ${String(name)}.${method} is required for managed execution`)
    }
    return service as NonNullable<Context[K]>
  }
  private authorize?: (sessionId: string, messages?: readonly import('../work-types.ts').NativeWorkMessage[]) => Promise<boolean>
  private conversation?: (sessionId: string) => Promise<string | undefined>
  private pendingHumanInput?: (sessionId: string) => Promise<readonly import('../work-types.ts').NativeWorkMessage[]>
  private readonly admittedTurns = new WeakMap<Agent, number>()
  private readonly conversationSnapshots = new WeakMap<Agent, string>()
  private readonly activeTools = new Map<import('@deepseek-ai/dsh-tools').ToolExecutionToken, import('@deepseek-ai/dsh-tools').ToolExecution>()
  private connected = false
  connect(authorize: (sessionId: string, messages?: readonly import('../work-types.ts').NativeWorkMessage[]) => Promise<boolean>, conversation?: (sessionId: string) => Promise<string | undefined>, pendingHumanInput?: (sessionId: string) => Promise<readonly import('../work-types.ts').NativeWorkMessage[]>): void {
    this.authorize = authorize
    this.conversation = conversation
    this.pendingHumanInput = pendingHumanInput
    if (this.connected) return
    this.connected = true
    this.ctx.on('agent/pre-step', async ({ agent, messages, turn }, next) => {
      // Task scheduling controls automatic turns, never the native human conversation.
      // An admitted turn can finish its tool results and final answer after wait/done.
      const human = messages.some(message => message.source?.kind === 'user')
      if (!human && this.admittedTurns.get(agent) !== turn && !await this.authorize!(agent.id, messages)) return { kind: 'reject' }
      const decision = await next()
      if (decision.kind === 'reject') return decision
      this.admittedTurns.set(agent, turn)
      if (human && this.pendingHumanInput) {
        const pending = await this.pendingHumanInput(agent.id)
        if (pending.length) {
          const seen = new Set<string>(decision.messages.map(message => message.id))
          for (const event of await this.runtime.events(agent.id)) if (event.type === 'user/message') seen.add(event.data.id)
          const recovered = pending.filter(message => !seen.has(message.id)) as UserMessage[]
          decision.messages.unshift(...structuredClone(recovered))
        }
      }
      const context = await this.conversation?.(agent.id)
      if (context && context !== this.conversationSnapshots.get(agent)) {
        this.conversationSnapshots.set(agent, context)
        decision.messages.push(createUserMessage({
          content: [{ type: 'text', text: context }],
          source: { kind: 'a2d2-work-context', form: 'notice', summary: context.split('\n')[0]! },
        }))
      }
      return decision
    }, { prepend: true })
    this.ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') this.admittedTurns.delete(agent) })
    this.ctx.on('tools/result', exec => { this.activeTools.delete(exec.token) })
    this.ctx.on('tools/pre-execute', async (exec, next) => {
      // Observation includes admission still in flight. Task writes authorize in WorkApplication.
      this.activeTools.set(exec.token, exec)
      return next()
    }, { prepend: true })
  }
  async failure(execution: WorkExecution): Promise<{ id: string; message: string; userCancelled: boolean } | undefined> {
    if (!execution.actual) return undefined
    const events = await this.runtime.events(SessionId(execution.session.sessionId))
    const last = events.findLast(event => event.type === 'turn/end')
    const kind = last?.data.reason?.kind
    // Controlled admission blocks are already described by control/handoff state.
    if (!['error', 'aborted', 'interrupted', 'max-tokens'].includes(kind)) return undefined
    return { id: `${execution.session.sessionId}:${last!.seq}`, message: `Last model turn ended ${kind}: ${last!.data.reason?.error?.message ?? ''}`.slice(0, 100_000), userCancelled: kind === 'aborted' && last!.data.reason?.reason?.kind === 'user' }
  }
  async profile(execution: WorkExecution): Promise<NonNullable<WorkExecution['actual']>> {
    const id = SessionId(execution.session.sessionId)
    const agent = await this.runtime.agent(id)
    const profile = await rootSessionProfile(this.ctx, id)
    await this.runtime.flush(agent)
    const events = await this.runtime.events(id)
    const selection = events.findLast(event => event.type === 'model/selection')
    const header = events.findLast(event => event.type === 'request/header')
    const route = selection && (!header || selection.seq > header.seq) ? selection.data : header?.data.header?.config
    const workspace = this.service('workspaceRegistry').list().find(item => item.id === execution.resource.workspaceId)
    if (!workspace?.sessionIds.includes(id) || agent.session.header.cwd !== workspace.path || !profile.agentPreset || !profile.permission?.sandbox || !profile.permission.approval || !route?.provider || !route.model) {
      throw new WorkExecutionError('continuation-profile-unknown', 'Actual source workspace, model, preset and effective permissions must be known')
    }
    if (!this.service('permissionPresets').names.includes(profile.permission.preset)) throw new WorkExecutionError('continuation-permission-unknown', 'Custom source permission cannot be safely recreated by this host adapter')
    return { runtimeId: this.runtimeId, cwd: workspace.path, agentPreset: profile.agentPreset,
      provider: route.provider, model: route.model, ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}), permissionPreset: profile.permission.preset, sandbox: profile.permission.sandbox, approval: profile.permission.approval }
  }
  async measure(execution: WorkExecution): Promise<import('../work-types.ts').ContinuationObservation> {
    const profile = await this.profile(execution)
    const agent = await this.runtime.agent(SessionId(execution.session.sessionId))
    const meter = (this.ctx.get as (name: string) => unknown).call(this.ctx, 'tokenMeter') as {
      measure(session: typeof agent.session): { totalTokens: number; logRevision: number; baseline: { kind: 'usage' | 'estimated' | 'none' } }
    } | undefined
    if (!meter?.measure) throw new WorkExecutionError('continuation-meter-unavailable', 'Public tokenMeter.measure is unavailable; automatic continuation is blocked')
    const info = await this.service('llm', 'resolveModelInfo').resolveModelInfo(profile.provider, profile.model)
    const header = agent.session.requestHeader()?.config
    if (header && (header.provider !== profile.provider || header.model !== profile.model || header.reasoningEffort !== profile.reasoningEffort)) throw new WorkExecutionError('continuation-route-changed', 'Source model selection differs from its measured request route; reconfigure after the route is established')
    const capacity = info.context?.contextWindow
    const outputReserve = Math.max(header?.maxTokens ?? 0, info.defaultMaxTokens ?? 0)
    if (!Number.isSafeInteger(capacity) || !capacity || !Number.isSafeInteger(outputReserve) || !outputReserve || outputReserve >= capacity) throw new WorkExecutionError('continuation-metadata-unknown', 'Exact model context capacity and output reserve must both be known')
    const measured = meter.measure(agent.session)
    if (measured.logRevision !== agent.session.seq || !Number.isFinite(measured.totalTokens) || measured.totalTokens < 0 || !['usage', 'estimated', 'none'].includes(measured.baseline.kind)) throw new WorkExecutionError('continuation-meter-stale', 'Token measurement is invalid or does not cover the current source log')
    return { totalTokens: measured.totalTokens, logRevision: measured.logRevision, baseline: measured.baseline.kind,
      capacity, outputReserve, routeKey: JSON.stringify([profile.provider, profile.model, profile.reasoningEffort ?? null, capacity, outputReserve]), observedAt: new Date().toISOString() }
  }
  private observationScope?: import('./observation.ts').ObservationScope
  connectObservation(scope: import('./observation.ts').ObservationScope): void { this.observationScope = scope }
  async observation(execution: WorkExecution, associations?: readonly import('../work-types.ts').SessionAssociation[], reporter?: import('@deepseek-ai/dsh-tools').ToolExecutionToken): Promise<import('./observation.ts').ExecutionObservation> {
    const { sessionKey } = await import('./observation.ts')
    const roots = new Map<string, { session: import('../work-types.ts').SessionRef; role: import('./observation.ts').ObservedSession['role']; parent?: import('../work-types.ts').SessionRef }>()
    const blockers: import('./observation.ts').ExecutionBlocker[] = []
    const reminders = new Set<string>()
    const limitations = new Set<string>()
    let bindings: readonly import('../work-types.ts').SessionAssociation[] = associations ?? []
    if (associations === undefined) {
      try {
        if (!this.observationScope) throw new Error('Authority scope resolver is unavailable')
        bindings = await this.observationScope(execution)
      } catch { blockers.push({ code: 'execution-scope-unavailable', session: execution.session }); limitations.add('无法从权威 Task 记录证明完整关联范围，结算状态未知。') }
    }
    for (const binding of bindings) roots.set(sessionKey(binding.session), { session: binding.session, role: binding.purpose })
    for (const old of execution.retired ?? []) roots.set(sessionKey(old.session), { session: old.session, role: 'retired' })
    roots.set(sessionKey(execution.session), { session: execution.session, role: 'current' })
    const reporting = reporter && this.activeTools.get(reporter)
    const trustedReport = reporting?.name === 'work_report' && !reporting.parent && reporting.agent?.id === execution.session.sessionId ? reporting : undefined
    const sessions: import('./observation.ts').ObservedSession[] = []
    const seen = new Set<string>()
    for (const root of roots.values()) {
      const key = sessionKey(root.session)
      if (seen.has(key)) continue
      seen.add(key)
      if (root.session.runtimeId !== this.runtimeId) {
        blockers.push({ code: 'executor-runtime-unavailable', session: root.session }); limitations.add('关联执行者属于其他宿主，未读取其会话。'); continue
      }
      try {
        const row = await this.runtime.executionFacts(SessionId(root.session.sessionId), this.runtimeId, root.role, root.parent)
        sessions.push(row)
        const active = [...this.activeTools.values()].filter(call => call.agent?.id === row.session.sessionId)
        const ownReport = row.role === 'current' && trustedReport && active.length === 1 && active[0]?.token === trustedReport.token
        const outstanding = (row.tools ?? []).filter(call => !(ownReport && call.callId === trustedReport?.callId && call.name === 'work_report'))
        if (outstanding.length || active.some(call => call.token !== (ownReport && trustedReport.token))) blockers.push({ code: 'tool-result-pending', session: row.session })
        if ((row.status === 'running' && !ownReport) || row.status === 'unknown') blockers.push({ code: row.status === 'unknown' ? 'executor-state-unknown' : 'executor-unsettled', session: row.session })
        if (row.waitingHuman) blockers.push({ code: 'executor-waiting-human', session: row.session })
        for (const child of row.children) {
          if (!child.returned || (child.mode === 'continuable' && child.result !== 'consumed') || child.mode === 'unknown') blockers.push({ code: 'native-result-pending', session: row.session })
          if (!roots.has(sessionKey(child.session))) roots.set(sessionKey(child.session), { session: child.session, role: 'native-child', parent: row.session })
        }
        if (row.jobObservation === 'unavailable') { blockers.push({ code: 'job-observation-unavailable', session: row.session }); limitations.add('当前宿主缺少正式 jobs.observe 非消费接口，无法证明终态结果已交付。') }
        // A host without any jobs service has no registry to prove reachability:
        // job facts come from the journal alone, which is a bounded limitation.
        if (row.jobObservation === 'disabled' && row.jobs.length) limitations.add('宿主未提供 jobs 服务：作业结果只能依据会话日志判断，不可达作业只提醒不阻断。')
        for (const job of row.jobs) {
          // A reachable result must be collected before completion; a job whose
          // registry instance is gone only leaves a bounded reminder (#201).
          const settled = settleUncollectedJob(job)
          if (settled.blocker) blockers.push({ code: settled.blocker, session: row.session, jobId: job.id })
          // A list-only host cannot prove delivery and already raises
          // job-observation-unavailable; a parallel "registry unreachable"
          // reminder for the same job would contradict that blocker.
          if (settled.reminder && row.jobObservation !== 'unavailable') reminders.add(settled.reminder)
          if (job.result === 'unknown') limitations.add('作业输出交付与模型消费、业务验收分别呈现；公开观察不会调用 jobs.read。')
        }
      } catch {
        blockers.push({ code: 'executor-observation-unavailable', session: root.session }); limitations.add('相关执行者观察失败，接续安全状态未知。')
      }
    }
    const unknown = blockers.some(blocker => /unknown|unavailable/.test(blocker.code))
    return { settlement: unknown ? 'unknown' : blockers.length ? 'pending' : 'settled', sessions, blockers, reminders: [...reminders], limitations: [...limitations] }
  }
  async maintain<T>(execution: WorkExecution, body: () => Promise<T>): Promise<T> {
    if (!this.observationScope) throw new WorkExecutionError('execution-scope-unavailable', 'Safe maintenance requires the authority-owned Task observation scope resolver')
    const id = SessionId(execution.session.sessionId)
    const agent = await this.runtime.agent(id)
    await agent.whenIdle()
    return agent.runMaintenance(async () => {
      await this.runtime.flush(agent)
      const scope = await this.observation(execution)
      const related = scope.sessions.map(row => this.ctx.get('agents')?.get(SessionId(row.session.sessionId)))
        .filter((candidate): candidate is Agent => !!candidate && candidate.id !== id)
      const held = new Set<string>([id])
      const lock = async (index: number): Promise<T> => {
        const candidate = related[index]
        if (candidate) {
          if (candidate.status !== 'idle') throw new WorkExecutionError('continuation-waiting-executions', 'A related executor is still running')
          held.add(candidate.id)
          return candidate.runMaintenance(async () => { await this.runtime.flush(candidate); return lock(index + 1) })
        }
        // The graph was read once to identify locks. Read again while every live
        // executor is fenced: no related tool can start a job between check/take.
        const observation = await this.observation(execution)
        if (observation.settlement !== 'settled') throw new WorkExecutionError('continuation-waiting-executions', `Continuation is waiting for related execution facts: ${observation.blockers.map(blocker => `${blocker.code}:${blocker.session.sessionId}${blocker.jobId ? `:${blocker.jobId}` : ''}`).join(', ')}`)
        const added = observation.sessions.map(row => this.ctx.get('agents')?.get(SessionId(row.session.sessionId)))
          .filter((candidate): candidate is Agent => !!candidate && !held.has(candidate.id))
        if (added.length) { related.push(...added); return lock(index) }
        return body()
      }
      return lock(0)
    })
  }
  /** Called in source maintenance after take. The log marker is the intake boundary, including a take/save crash gap. */
  async sealInput(execution: WorkExecution, operationId: string): Promise<{ seq: number; messages: readonly import('../work-types.ts').NativeWorkMessage[] }> {
    const id = SessionId(execution.session.sessionId)
    const agent = await this.runtime.agent(id)
    let events = await this.runtime.events(id)
    const markerId = MessageId(`intake-seal:${operationId}`)
    const findMarker = () => events.find(event => event.type === 'agent/inbox/spliced' && event.data.inserted?.some((message: UserMessage) => message.id === markerId))
    let marker = findMarker()
    if (!marker) {
      // Session.append cannot mark external event types ignorable. Use the
      // published durable inbox splice vocabulary and remove this inert notice
      // synchronously under maintenance, before it can enter a model request.
      agent.followup({ id: markerId, role: 'user', content: [], source: { kind: 'a2d2-work-input-seal', operationId } })
      if (!agent.inbox.remove(markerId)) throw new WorkExecutionError('continuation-seal-failed', 'The source intake marker escaped maintenance')
      await this.runtime.flush(agent)
      events = await this.runtime.events(id)
      marker = findMarker()
      if (!marker) throw new WorkExecutionError('continuation-seal-missing', 'Durable intake marker could not be read back')
    } else await this.runtime.flush(agent)
    const lanes: Record<string, import('../work-types.ts').NativeWorkMessage[]> = { 'next-turn': [], 'next-step': [] }
    const unconsumed = new Map<string, import('../work-types.ts').NativeWorkMessage>()
    const consumed = new Set<string>()
    for (const event of events) {
      if (event.seq >= marker.seq) break
      if (event.type === 'agent/inbox/spliced') {
        const data = event.data as { target: string; start: number; removedCount?: number; inserted: import('../work-types.ts').NativeWorkMessage[]; outcome?: string }
        const lane = lanes[data.target]
        if (!lane) throw new WorkExecutionError('continuation-inbox-invalid', 'Source inbox log uses an unknown target')
        const removed = lane.splice(data.start, data.removedCount ?? 0, ...data.inserted)
        if (data.outcome === 'canceled') for (const message of removed) unconsumed.delete(message.id)
        // A claimed message remains recoverable until user/message admission;
        // rejected cold pre-steps must not erase its original full payload.
        for (const message of data.inserted) unconsumed.set(message.id, message)
      } else if (event.type === 'user/message') consumed.add(event.data.id as string)
    }
    for (const id of consumed) unconsumed.delete(id)
    return { seq: marker.seq, messages: structuredClone([...unconsumed.values()]) }
  }
  pending(execution: WorkExecution): readonly import('../work-types.ts').NativeWorkMessage[] {
    const agent = this.service('agents').get(SessionId(execution.session.sessionId))
    return agent ? structuredClone([...agent.inbox.nextTurn, ...agent.inbox.nextStep]) : []
  }
  async history(execution: WorkExecution, session: import('../work-types.ts').SessionRef, cursor = 0, limit = 100): Promise<{ events: unknown[]; nextCursor?: number }> {
    if (session.runtimeId !== this.runtimeId || execution.resource.runtimeId !== this.runtimeId) throw new WorkExecutionError('incompatible-session', 'History belongs to another runtime')
    const id = SessionId(session.sessionId)
    const workspace = this.service('workspaceRegistry').list().find(item => item.id === execution.resource.workspaceId)
    if (!workspace?.sessionIds.includes(id)) throw new WorkExecutionError('incompatible-session', 'History does not belong to the execution workspace')
    using observation = await this.service('sessionQuery').observeSession(id)
    let bytes = 0
    const events: unknown[] = []
    for (const event of observation.events.slice(cursor, cursor + limit)) {
      const encoded = JSON.stringify(event)
      if (events.length && bytes + encoded.length > 200_000) break
      events.push(encoded.length > 200_000 ? { type: event.type, seq: event.seq, truncated: true, preview: encoded.slice(0, 200_000) } : structuredClone(event))
      bytes += encoded.length
    }
    const nextCursor = cursor + events.length
    return { events, ...(nextCursor < observation.events.length ? { nextCursor } : {}) }
  }
  async wake(execution: WorkExecution): Promise<void> { await this.runtime.wakePending(await this.runtime.agent(SessionId(execution.session.sessionId))) }
  status(execution: WorkExecution): 'running' | 'idle' | 'inactive' {
    return this.ctx.get('agents')?.get(SessionId(execution.session.sessionId))?.status ?? 'inactive'
  }
  async choices(): Promise<import('../work-types.ts').HostExecutionChoices> {
    if (!this.ctx.get('sessionController') || !this.ctx.get('agentPresets') || !this.ctx.get('permissionPresets')) throw new WorkExecutionError('host-capability-unavailable', 'Host execution catalogs are unavailable')
    // A peer resolved from this plugin can be its development dependency rather
    // than the serving Host. Admission checks the actual public services below;
    // package engines declare the verified rc.2 / official rc.3 releases.
    const catalog = await this.service('sessionController', 'modelCatalog', 'resolveAgent').modelCatalog()
    // The host's own catalogs are the authority, like a normal new Session: a
    // managed execution may use any activated Agent preset and any configured
    // permission preset (the derived auto mode is not a fixed sandbox).
    const declared = (await this.service('agentPresets').list()).filter(preset => preset.broken === undefined).map(preset => preset.id)
    const defaultAgentPreset = this.service('agentPresets').defaultId
    const agentPresets = declared.length ? declared : [defaultAgentPreset]
    const agentPreset = agentPresets.includes(defaultAgentPreset) ? defaultAgentPreset : agentPresets[0]!
    const declaredPermissions = this.service('permissionPresets').names.filter(name => name !== 'auto')
    const defaultPermissionPreset = this.service('permissionPresets').defaultPreset
    const permissionPresets = declaredPermissions.length ? [...declaredPermissions] : [defaultPermissionPreset]
    const permissionPreset = permissionPresets.includes(defaultPermissionPreset) ? defaultPermissionPreset : permissionPresets[0]!
    return { agentPresets, permissionPresets,
      models: catalog.groups.flatMap(group => group.models.map(model => ({ provider: group.id, model: model.id }))),
      defaults: { agentPreset, permissionPreset, model: { provider: catalog.default.provider, model: catalog.default.model } } }
  }
  async check(request: Pick<WorkExecution, 'resource' | 'session' | 'sessionMode' | 'agentPreset' | 'model' | 'permissionPreset'>): Promise<import('../work-types.ts').HostExecutionChoices> {
    for (const name of ['sessionController', 'sessionPersistence', 'sessionQuery', 'agents', 'sessions', 'agentPresets', 'permissionPresets', 'sandboxPolicy', 'approval', 'llm', 'workspaceRegistry', 'agentDefaultModel']) {
      if (!(this.ctx.get as (key: string) => unknown).call(this.ctx, name)) throw new WorkExecutionError('host-capability-unavailable', `DSH ${name} is required for managed execution`)
    }
    this.service('sessionController', 'modelCatalog', 'resolveAgent')
    this.service('sessionQuery', 'observeSession')
    this.service('sessionPersistence', 'stat', 'create', 'open')
    this.service('sessions', 'prepare', 'flush')
    this.service('llm', 'resolveCallConfig', 'resolveModelInfo')
    if (this.ctx.get('fs')?.sandboxMode === undefined || this.ctx.get('shell')?.sandboxMode === undefined) throw new WorkExecutionError('host-permission-unenforced', 'Managed execution requires real sandbox-aware filesystem and shell providers')
    if (request.resource.runtimeId !== this.runtimeId) throw new WorkExecutionError('incompatible-resource', 'Execution belongs to another runtime')
    const workspace = this.service('workspaceRegistry').list().find(item => item.id === request.resource.workspaceId)
    if (!workspace || await workspace.status() !== 'ok') throw new WorkExecutionError('unavailable-resource', 'Execution workspace is unavailable')
    if (request.sessionMode === 'reuse') {
      const legacy = this.ctx.get('a2d2')
      if (!legacy) throw new WorkExecutionError('legacy-authority-unavailable', 'Existing Session reuse requires the legacy authority to rule out active old ownership')
      if (await legacy.taskOfMainSession(workspace.path, SessionId(request.session.sessionId))) throw new WorkExecutionError('legacy-authority-retained', 'Legacy Session authority must be safely migrated before v3 reuse')
    }
    const choices = await this.choices()
    if (!choices.models.some(item => item.provider === request.model.provider && item.model === request.model.model)) throw new WorkExecutionError('unavailable-model', 'Model is not in the real host catalog')
    const preset = await this.service('agentPresets').resolve(request.agentPreset)
    if (preset.broken) throw new WorkExecutionError('unavailable-agent-preset', 'Requested Agent preset has an activation failure')
    if (!this.service('permissionPresets').names.includes(request.permissionPreset)) throw new WorkExecutionError('invalid-permission-preset', 'Permission preset is unavailable')
    if (request.model.reasoningEffort !== undefined) {
      const info = await this.service('llm').resolveModelInfo(request.model.provider, request.model.model)
      if (!info.reasoning?.efforts.some(effort => effort.id === request.model.reasoningEffort)) throw new WorkExecutionError('unavailable-model', 'Requested reasoning effort is unavailable')
    }
    const requested = await this.service('llm').resolveCallConfig({ ...request.model, reasoningEffort: request.model.reasoningEffort ? ReasoningEffortId(request.model.reasoningEffort) : undefined })
    const stat = await this.service('sessionPersistence').stat(SessionId(request.session.sessionId))
    if (!stat && request.sessionMode === 'reuse') throw new WorkExecutionError('incompatible-session', 'Requested Session does not exist')
    if (stat) {
      if (request.sessionMode === 'reuse' && !workspace.sessionIds.includes(SessionId(request.session.sessionId))) throw new WorkExecutionError('incompatible-session', 'Session is not a member of the selected workspace')
      using inspection = await this.service('sessionQuery').observeSession(SessionId(request.session.sessionId))
      const selectedPreset = (inspection.projections?.values as { agentPreset?: string | null } | undefined)?.agentPreset ?? inspection.header.agentPreset
      if (inspection.header.cwd !== workspace.path || selectedPreset !== request.agentPreset) throw new WorkExecutionError('incompatible-session', 'Existing Session resource or preset differs')
      const header = inspection.events.findLast(item => item.type === 'request/header')
      if (header?.type === 'request/header' && (header.data.header.config.provider !== request.model.provider || header.data.header.config.model !== request.model.model || header.data.header.config.reasoningEffort !== requested.reasoningEffort)) throw new WorkExecutionError('incompatible-session', 'Existing Session model differs; silent reconfiguration refused')
      const pending = inspection.events.findLast(item => item.type === 'model/selection')
      const selected = pending?.type === 'model/selection' && (!header || pending.seq > header.seq) ? pending.data
        : header?.type === 'request/header' ? header.data.header.config : undefined
      if (selected && (selected.provider !== request.model.provider || selected.model !== request.model.model || selected.reasoningEffort !== request.model.reasoningEffort)) throw new WorkExecutionError('incompatible-session', 'Existing Session local selection differs; silent reconfiguration refused')
      if (request.sessionMode === 'reuse') {
        const effective = selected ?? this.service('agentDefaultModel').currentSelection()
        if (effective.provider !== request.model.provider || effective.model !== request.model.model || effective.reasoningEffort !== request.model.reasoningEffort) throw new WorkExecutionError('incompatible-session', 'Existing Session local selection differs')
        using observation = await this.service('sessionQuery').observeSession(SessionId(request.session.sessionId))
        const permission = (observation.projections?.values as { permissions?: { currentValue: string } } | undefined)?.permissions
        if (permission?.currentValue !== request.permissionPreset) throw new WorkExecutionError('incompatible-session', 'Existing Session effective permission differs')
      }
    }
    return choices
  }
  private delivery(event: WorkEvent) {
    const message: UserMessage = event.nativeMessage ? event.nativeMessage as UserMessage : { id: MessageId(event.id), role: 'user', content: [{ type: 'text', text: event.text }], source: { kind: 'a2d2-work-dispatch' } }
    if (message.id !== event.id || message.role !== 'user') throw new WorkExecutionError('invalid-native-message', 'Stored native input identity is inconsistent')
    return { id: event.id, message }
  }
  async observe(execution: WorkExecution, event: WorkEvent): Promise<'accepted' | 'delivered' | 'consumed'> {
    const state = await this.runtime.deliveryState(SessionId(execution.session.sessionId), this.delivery(event))
    return state === 'missing' ? 'accepted' : state === 'queued' ? 'delivered' : 'consumed'
  }
  async settle(execution: WorkExecution): Promise<void> {
    const agent = await this.runtime.agent(SessionId(execution.session.sessionId))
    await agent.whenIdle()
    await agent.runMaintenance(async () => { await this.runtime.flush(agent) })
  }
  async deliver(execution: WorkExecution, event: WorkEvent, inMaintenance = false): Promise<'delivered' | 'consumed'> {
    const id = SessionId(execution.session.sessionId)
    const delivery = this.delivery(event)
    await this.runtime.deliver(id, delivery, inMaintenance)
    return await this.runtime.deliveryState(id, delivery) === 'consumed' ? 'consumed' : 'delivered'
  }
  async ensure(execution: WorkExecution, _allowed?: () => Promise<boolean>): Promise<NonNullable<WorkExecution['actual']>> {
    await this.check(execution)
    const id = SessionId(execution.session.sessionId)
    if (!await this.service('sessionPersistence').stat(id) && !this.service('agents').get(id)) {
      const workspace = this.service('workspaceRegistry').list().find(item => item.id === execution.resource.workspaceId)!
      const detached = this.service('sessions').prepare(id, { meta: { cwd: workspace.path, agentPreset: execution.agentPreset } })
      const handle = await this.service('sessionPersistence').create(detached.header)
      try { await handle.append([{ type: 'model/selection', seq: SessionSeq(0), time: Date.now(), data: execution.model }]) }
      finally { await handle.close() }
    } else if (execution.sessionMode === 'create' && !this.service('agents').get(id)) {
      const events = await this.runtime.events(id)
      if (events.length === 0) {
        const handle = await this.service('sessionPersistence').open(id, 'write')
        try { await handle.append([{ type: 'model/selection', seq: SessionSeq(0), time: Date.now(), data: execution.model }]); await handle.flush() }
        finally { await handle.close() }
      }
    }
    const agent = await resolveSessionAgent(this.ctx, id)
    const workspace = this.service('workspaceRegistry').list().find(item => item.id === execution.resource.workspaceId)!
    await workspace.attachSession(id)
    await agent.whenIdle()
    await agent.runMaintenance(async () => {
      const events = await this.runtime.events(id)
      const started = events.some(item => item.type === 'turn/start')
      const profile = await rootSessionProfile(this.ctx, id)
      if (started && profile.permission?.preset !== execution.permissionPreset) throw new WorkExecutionError('incompatible-session', 'Existing Session permission differs; silent reconfiguration refused')
      if (!started && profile.permission?.preset !== execution.permissionPreset) this.service('permissionPresets').set(agent.session, execution.permissionPreset)
      const prior = installed.get(agent)
      if (prior && prior.executionId !== execution.id) throw new WorkExecutionError('session-in-use', 'Agent already belongs to another execution')
      if (!prior) installed.set(agent, { executionId: execution.id })
      await this.runtime.flush(agent)
    })
    const profile = await rootSessionProfile(this.ctx, id)
    const filesystem = this.service('agentPresets').serviceFor(agent, 'fs') ?? this.ctx.get('fs')
    const shell = this.service('agentPresets').serviceFor(agent, 'shell') ?? this.ctx.get('shell')
    if (filesystem?.sandboxMode === undefined || shell?.sandboxMode === undefined) throw new WorkExecutionError('host-permission-unenforced', 'Selected preset did not compose sandbox-aware filesystem and shell providers')
    if (!profile.permission || profile.permission.preset !== execution.permissionPreset || profile.agentPreset !== execution.agentPreset || agent.session.header.cwd === undefined) throw new WorkExecutionError('host-context-mismatch', 'Host did not compose the requested execution context')
    return { runtimeId: this.runtimeId, cwd: agent.session.header.cwd, agentPreset: profile.agentPreset,
      ...execution.model, permissionPreset: profile.permission.preset, sandbox: profile.permission.sandbox!, approval: profile.permission.approval! }
  }
}
