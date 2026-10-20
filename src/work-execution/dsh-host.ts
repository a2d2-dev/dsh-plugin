import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm'
import type { WorkEvent, WorkExecution } from '../work-types.ts'
import { RuntimeHost } from '../task-runtime/host.ts'
import { rootSessionProfile } from '../root-session.ts'
import { WorkExecutionError } from './host.ts'
import type { WorkExecutionHost } from './host.ts'

const installed = new WeakMap<Agent, { executionId: string; dispose: () => void }>()
/** Public DSH create, preset, local model, maintenance and persisted delivery APIs. */
export class DshWorkExecutionHost implements WorkExecutionHost {
  readonly runtime: RuntimeHost
  constructor(private readonly ctx: Context, readonly runtimeId: string) { this.runtime = new RuntimeHost(ctx) }
  async check(request: Pick<WorkExecution, 'resource' | 'session' | 'sessionMode' | 'agentPreset' | 'model' | 'permissionPreset'>): Promise<void> {
    for (const name of ['sessionController', 'sessionPersistence', 'sessionQuery', 'agents', 'sessions', 'agentPresets', 'permissionPresets', 'sandboxPolicy', 'approval', 'llm', 'workspaceRegistry', 'agentDefaultModel']) {
      if (!(this.ctx.get as (key: string) => unknown).call(this.ctx, name)) throw new WorkExecutionError('host-capability-unavailable', `DSH ${name} is required for managed execution`)
    }
    if (request.resource.runtimeId !== this.runtimeId) throw new WorkExecutionError('incompatible-resource', 'Execution belongs to another runtime')
    const workspace = this.ctx.workspaceRegistry.list().find(item => item.id === request.resource.workspaceId)
    if (!workspace || await workspace.status() !== 'ok') throw new WorkExecutionError('unavailable-resource', 'Execution workspace is unavailable')
    await this.ctx.agentPresets.resolve(request.agentPreset)
    if (!this.ctx.permissionPresets.names.includes(request.permissionPreset)) throw new WorkExecutionError('invalid-permission-preset', 'Permission preset is unavailable')
    await this.ctx.llm.resolveCallConfig(request.model)
    const stat = await this.ctx.sessionPersistence.stat(SessionId(request.session.sessionId))
    if (!stat && request.sessionMode === 'reuse') throw new WorkExecutionError('incompatible-session', 'Requested Session does not exist')
    if (stat) {
      if (request.sessionMode === 'reuse' && !workspace.sessionIds.includes(SessionId(request.session.sessionId))) throw new WorkExecutionError('incompatible-session', 'Session is not a member of the selected workspace')
      const inspection = await this.ctx.sessionController.inspect(SessionId(request.session.sessionId))
      if (inspection.meta.cwd !== workspace.path || inspection.meta.agentPreset !== request.agentPreset) throw new WorkExecutionError('incompatible-session', 'Existing Session resource or preset differs')
      const header = inspection.events.findLast(item => item.type === 'request/header')
      if (header?.type === 'request/header' && (header.data.header.config.provider !== request.model.provider || header.data.header.config.model !== request.model.model)) throw new WorkExecutionError('incompatible-session', 'Existing Session model differs; silent reconfiguration refused')
      if (request.sessionMode === 'reuse') {
        const pending = inspection.events.findLast(item => item.type === 'model/selection')
        const selected = pending?.type === 'model/selection' && (!header || pending.seq > header.seq) ? pending.data
          : header?.type === 'request/header' ? header.data.header.config : this.ctx.agentDefaultModel.currentSelection()
        if (selected.provider !== request.model.provider || selected.model !== request.model.model) throw new WorkExecutionError('incompatible-session', 'Existing Session local selection differs')
        using observation = await this.ctx.sessionQuery.observeSession(SessionId(request.session.sessionId))
        const permission = (observation.projections?.values as { permissions?: { currentValue: string } } | undefined)?.permissions
        if (permission?.currentValue !== request.permissionPreset) throw new WorkExecutionError('incompatible-session', 'Existing Session effective permission differs')
      }
    }
  }
  async observe(execution: WorkExecution, event: WorkEvent): Promise<'accepted' | 'delivered' | 'consumed'> {
    const state = await this.runtime.deliveryState(SessionId(execution.session.sessionId), { id: event.id, message: { id: MessageId(event.id), role: 'user', content: [{ type: 'text', text: event.text }], source: { kind: 'user' } } })
    return state === 'missing' ? 'accepted' : state === 'queued' ? 'delivered' : 'consumed'
  }
  async settle(execution: WorkExecution): Promise<void> {
    const agent = await this.runtime.agent(SessionId(execution.session.sessionId))
    await agent.runMaintenance(async () => { await this.runtime.flush(agent) })
  }
  async deliver(execution: WorkExecution, event: WorkEvent): Promise<'delivered' | 'consumed'> {
    const id = SessionId(execution.session.sessionId)
    const delivery = { id: event.id, message: { id: MessageId(event.id), role: 'user' as const,
      content: [{ type: 'text' as const, text: event.text }], source: { kind: 'user' as const } } }
    await this.runtime.deliver(id, delivery)
    return await this.runtime.deliveryState(id, delivery) === 'consumed' ? 'consumed' : 'delivered'
  }
  async ensure(execution: WorkExecution, allowed: () => Promise<boolean>): Promise<NonNullable<WorkExecution['actual']>> {
    await this.check(execution)
    const id = SessionId(execution.session.sessionId)
    if (!await this.ctx.sessionPersistence.stat(id) && !this.ctx.agents.get(id)) {
      const workspace = this.ctx.workspaceRegistry.list().find(item => item.id === execution.resource.workspaceId)!
      const detached = this.ctx.sessions.prepare(id, { meta: { cwd: workspace.path, agentPreset: execution.agentPreset } })
      const handle = await this.ctx.sessionPersistence.create(detached.header)
      try { await handle.append([{ type: 'model/selection', seq: SessionSeq(0), time: Date.now(), data: execution.model }]) }
      finally { await handle.close() }
    } else if (execution.sessionMode === 'create' && !this.ctx.agents.get(id)) {
      const inspection = await this.ctx.sessionController.inspect(id)
      if (inspection.events.length === 0) {
        const handle = await this.ctx.sessionPersistence.open(id, 'write')
        try { await handle.append([{ type: 'model/selection', seq: SessionSeq(0), time: Date.now(), data: execution.model }]); await handle.flush() }
        finally { await handle.close() }
      }
    }
    const created = await this.ctx.sessionController.create({ sessionId: id, workspaceId: execution.resource.workspaceId as never, agentPreset: execution.agentPreset })
    if (created.sessionId !== id) throw new WorkExecutionError('host-session-identity-changed', 'Host did not preserve the reserved Session identity')
    const agent = await this.runtime.agent(id)
    await agent.runMaintenance(async () => {
      const events = await this.runtime.events(id)
      const started = events.some(item => item.type === 'turn/start')
      const profile = await rootSessionProfile(this.ctx, id)
      if (started && profile.permission?.preset !== execution.permissionPreset) throw new WorkExecutionError('incompatible-session', 'Existing Session permission differs; silent reconfiguration refused')
      if (!started && profile.permission?.preset !== execution.permissionPreset) this.ctx.permissionPresets.set(agent.session, execution.permissionPreset)
      const prior = installed.get(agent)
      if (prior && prior.executionId !== execution.id) throw new WorkExecutionError('session-in-use', 'Agent already belongs to another execution')
      if (!prior) {
        // Controller restores the durable model/selection through its public Agent-scoped selector.
        const dispose = agent.ctx.on('agent/pre-step', async (_payload, next) => await allowed() ? next() : { kind: 'reject', reason: 'Task execution is waiting, paused or no longer owns coordination' }, { prepend: true })
        installed.set(agent, { executionId: execution.id, dispose })
        agent.ctx.effect(() => dispose, 'a2d2 execution model selection')
      }
      await this.runtime.flush(agent)
    })
    const profile = await rootSessionProfile(this.ctx, id)
    if (!profile.permission || profile.agentPreset !== execution.agentPreset || agent.session.header.cwd === undefined) throw new WorkExecutionError('host-context-mismatch', 'Host did not compose the requested execution context')
    return { runtimeId: this.runtimeId, cwd: agent.session.header.cwd, agentPreset: profile.agentPreset,
      ...execution.model, permissionPreset: profile.permission.preset, sandbox: profile.permission.sandbox!, approval: profile.permission.approval! }
  }
}
