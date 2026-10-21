import { createRequire } from 'node:module'
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
import { MessageId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { WorkEvent, WorkExecution } from '../work-types.ts'
import { RuntimeHost } from '../task-runtime/host.ts'
import { rootSessionProfile } from '../root-session.ts'
import { WorkExecutionError } from './host.ts'
import type { WorkExecutionHost } from './host.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { 'a2d2-work-input-seal': { kind: 'a2d2-work-input-seal'; operationId: string } }
}

const installed = new WeakMap<Agent, { executionId: string; dispose: () => void }>()
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
  private connected = false
  connect(authorize: (sessionId: string, messages?: readonly import('../work-types.ts').NativeWorkMessage[]) => Promise<boolean>): void {
    this.authorize = authorize
    if (this.connected) return
    this.connected = true
    this.ctx.on('agent/pre-step', async ({ agent, messages }, next) => await this.authorize!(agent.id, messages) ? next() : { kind: 'reject', reason: 'Task execution has not authorized advancement' }, { prepend: true })
    this.ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      return exec.agent && !await this.authorize!(exec.agent.id) ? { kind: 'deny', reason: 'Task execution has not authorized this Session to execute tools' } : decision
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
  async maintain<T>(execution: WorkExecution, body: () => Promise<T>): Promise<T> {
    const id = SessionId(execution.session.sessionId)
    const agent = await this.runtime.agent(id)
    await agent.whenIdle()
    return agent.runMaintenance(async () => {
      await this.runtime.flush(agent)
      if (await this.runtime.askedHuman(id)) throw new WorkExecutionError('continuation-waiting-human', 'Continuation is waiting for unresolved human questions')
      if (await this.runtime.unsettledChildren(id)) throw new WorkExecutionError('continuation-waiting-children', 'Continuation is waiting for native children and consumed result notifications')
      return body()
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
    const manifest = createRequire(import.meta.url)('@deepseek-ai/dsh-api-session-controller/package.json') as { version: string }
    if (manifest.version !== '0.2.0-rc.2') throw new WorkExecutionError('unsupported-host-controller', 'This adapter is certified for the fixed-identity SessionController 0.2.0-rc.2 contract; other create semantics require a separately verified adapter')
    const catalog = await this.service('sessionController', 'modelCatalog').modelCatalog()
    const agentPreset = this.service('agentPresets').defaultId
    const permissionPreset = this.service('permissionPresets').defaultPreset
    return { agentPresets: [agentPreset], permissionPresets: [permissionPreset],
      models: catalog.groups.flatMap(group => group.models.map(model => ({ provider: group.id, model: model.id }))),
      defaults: { agentPreset, permissionPreset, model: { provider: catalog.default.provider, model: catalog.default.model } } }
  }
  async check(request: Pick<WorkExecution, 'resource' | 'session' | 'sessionMode' | 'agentPreset' | 'model' | 'permissionPreset'>): Promise<import('../work-types.ts').HostExecutionChoices> {
    for (const name of ['sessionController', 'sessionPersistence', 'sessionQuery', 'agents', 'sessions', 'agentPresets', 'permissionPresets', 'sandboxPolicy', 'approval', 'llm', 'workspaceRegistry', 'agentDefaultModel']) {
      if (!(this.ctx.get as (key: string) => unknown).call(this.ctx, name)) throw new WorkExecutionError('host-capability-unavailable', `DSH ${name} is required for managed execution`)
    }
    this.service('sessionController', 'create', 'inspect', 'modelCatalog', 'resolveAgent')
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
    const requested = await this.service('llm').resolveCallConfig({ ...request.model, reasoningEffort: request.model.reasoningEffort ? ReasoningEffortId(request.model.reasoningEffort) : undefined })
    const stat = await this.service('sessionPersistence').stat(SessionId(request.session.sessionId))
    if (!stat && request.sessionMode === 'reuse') throw new WorkExecutionError('incompatible-session', 'Requested Session does not exist')
    if (stat) {
      if (request.sessionMode === 'reuse' && !workspace.sessionIds.includes(SessionId(request.session.sessionId))) throw new WorkExecutionError('incompatible-session', 'Session is not a member of the selected workspace')
      const inspection = await this.service('sessionController').inspect(SessionId(request.session.sessionId))
      if (inspection.meta.cwd !== workspace.path || inspection.meta.agentPreset !== request.agentPreset) throw new WorkExecutionError('incompatible-session', 'Existing Session resource or preset differs')
      const header = inspection.events.findLast(item => item.type === 'request/header')
      if (header?.type === 'request/header' && (header.data.header.config.provider !== request.model.provider || header.data.header.config.model !== request.model.model || header.data.header.config.reasoningEffort !== requested.reasoningEffort)) throw new WorkExecutionError('incompatible-session', 'Existing Session model differs; silent reconfiguration refused')
      if (request.sessionMode === 'reuse') {
        const pending = inspection.events.findLast(item => item.type === 'model/selection')
        const selected = pending?.type === 'model/selection' && (!header || pending.seq > header.seq) ? pending.data
          : header?.type === 'request/header' ? header.data.header.config : this.service('agentDefaultModel').currentSelection()
        if (selected.provider !== request.model.provider || selected.model !== request.model.model) throw new WorkExecutionError('incompatible-session', 'Existing Session local selection differs')
        using observation = await this.service('sessionQuery').observeSession(SessionId(request.session.sessionId))
        const permission = (observation.projections?.values as { permissions?: { currentValue: string } } | undefined)?.permissions
        if (permission?.currentValue !== request.permissionPreset) throw new WorkExecutionError('incompatible-session', 'Existing Session effective permission differs')
      }
    }
    return choices
  }
  private delivery(event: WorkEvent) {
    const message: UserMessage = event.nativeMessage ? event.nativeMessage as UserMessage : { id: MessageId(event.id), role: 'user', content: [{ type: 'text', text: event.text }], source: { kind: 'user' } }
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
  async ensure(execution: WorkExecution, allowed: () => Promise<boolean>): Promise<NonNullable<WorkExecution['actual']>> {
    await this.check(execution)
    const id = SessionId(execution.session.sessionId)
    if (!await this.service('sessionPersistence').stat(id) && !this.service('agents').get(id)) {
      const workspace = this.service('workspaceRegistry').list().find(item => item.id === execution.resource.workspaceId)!
      const detached = this.service('sessions').prepare(id, { meta: { cwd: workspace.path, agentPreset: execution.agentPreset } })
      const handle = await this.service('sessionPersistence').create(detached.header)
      try { await handle.append([{ type: 'model/selection', seq: SessionSeq(0), time: Date.now(), data: execution.model }]) }
      finally { await handle.close() }
    } else if (execution.sessionMode === 'create' && !this.service('agents').get(id)) {
      const inspection = await this.service('sessionController').inspect(id)
      if (inspection.events.length === 0) {
        const handle = await this.service('sessionPersistence').open(id, 'write')
        try { await handle.append([{ type: 'model/selection', seq: SessionSeq(0), time: Date.now(), data: execution.model }]); await handle.flush() }
        finally { await handle.close() }
      }
    }
    const created = await this.service('sessionController').create({ sessionId: id, workspaceId: execution.resource.workspaceId as never, agentPreset: execution.agentPreset })
    if (created.sessionId !== id) throw new WorkExecutionError('host-session-identity-changed', 'Host did not preserve the reserved Session identity')
    const agent = await this.runtime.agent(id)
    await agent.whenIdle()
    await agent.runMaintenance(async () => {
      const events = await this.runtime.events(id)
      const started = events.some(item => item.type === 'turn/start')
      const profile = await rootSessionProfile(this.ctx, id)
      if (started && profile.permission?.preset !== execution.permissionPreset) throw new WorkExecutionError('incompatible-session', 'Existing Session permission differs; silent reconfiguration refused')
      if (!started && profile.permission?.preset !== execution.permissionPreset) this.service('permissionPresets').set(agent.session, execution.permissionPreset)
      const prior = installed.get(agent)
      if (prior && prior.executionId !== execution.id) throw new WorkExecutionError('session-in-use', 'Agent already belongs to another execution')
      if (!prior) {
        // Controller restores the durable model/selection through its public Agent-scoped selector.
        const dispose = agent.ctx.on('agent/pre-step', async ({ messages }, next) => await this.authorize!(agent.id, messages) && await allowed() ? next() : { kind: 'reject', reason: 'Task execution is waiting, paused or no longer owns coordination' }, { prepend: true })
        installed.set(agent, { executionId: execution.id, dispose })
        agent.ctx.effect(() => dispose, 'a2d2 execution authority fence')
      }
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
