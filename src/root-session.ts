import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { resolveSessionAgent } from './official-session.ts'

/** Only durable session configuration is inherited; one-off approvals are not. */
export interface RootSessionProfile {
  agentPreset?: string
  permission?: {
    preset: string
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
    approval?: 'ask' | 'never'
  }
}
interface Controller {
  create(request: { sessionId: SessionId; workspaceId?: string; cwd?: string; agentPreset?: string }): Promise<{ sessionId: SessionId; agentPreset?: string }>
  resolveAgent(id: SessionId): Promise<{ agent: Agent } | { error: { message?: string; code?: string } }>
}
interface Permissions {
  current(session: Session): string
  set(session: Session, name: string): void
}
export class LegacyRootSessionError extends Error {
  constructor(readonly sessionId: SessionId, readonly agentPreset?: string, reason = 'cannot safely change its missing or different preset') {
    super(`Legacy successor ${sessionId} ${reason}. Its history was preserved. Run /task-runtime recover from the current main session to reserve a fresh successor${agentPreset ? ` with preset ${agentPreset}` : ' using the recorded source configuration'}.`)
  }
}
/** The permission service seeds exactly this triplet before the first turn. */
async function permissionOrigin(ctx: Context, agent: Agent): Promise<'initial' | 'changed' | 'unknown'> {
  interface Event { type: string; seq: number; data: Readonly<Record<string, unknown>> }
  const query = ctx.get('sessionQuery') as unknown as {
    observeSession(id: SessionId): Promise<Disposable & { events: readonly Event[]; inheritedEventCount: number }>
  } | undefined
  if (!query) return 'unknown'
  using observation = await query.observeSession(agent.id)
  if (observation.inheritedEventCount !== 0) return 'unknown'
  const firstTurn = observation.events.find(event => event.type === 'turn/start')
  if (!firstTurn) return 'unknown'
  const types = ['permission/preset', 'sandbox/mode', 'approval/policy']
  const events = observation.events.filter(event => types.includes(event.type))
  if (events.length < 3 || events.slice(0, 3).some((event, index) => event.type !== types[index] || event.seq >= firstTurn.seq)) return 'unknown'
  for (const event of events) {
    // Delegation and incomplete/imported initializations are not proof of a
    // later explicit configuration change on this root session.
    if (event.data.source !== undefined) return 'unknown'
    if (event.type === 'permission/preset' && (typeof event.data.preset !== 'string' || event.data.preset === 'custom' || event.data.preset === '')) return 'unknown'
    if (event.type === 'sandbox/mode' && !['read-only', 'workspace-write', 'danger-full-access'].includes(String(event.data.mode))) return 'unknown'
    if (event.type === 'approval/policy' && !['ask', 'never'].includes(String(event.data.policy))) return 'unknown'
  }
  return events.length === 3 ? 'initial' : 'changed'
}
function sourceService(ctx: Context, agent: Agent, name: string): unknown {
  const presets = ctx.get('agentPresets') as unknown as { serviceFor(agent: Agent, name: string): unknown } | undefined
  return presets?.serviceFor(agent, name) ?? (ctx.get as (name: string) => unknown).call(ctx, name)
}
function controller(ctx: Context): Controller {
  const service = ctx.get('sessionController') as unknown as Controller | undefined
  if (!service?.create || !service.resolveAgent) throw new Error('a2d2: sessionController.create and resolveAgent are required to compose a root session')
  return service
}
async function agentOf(ctx: Context, id: SessionId): Promise<Agent> {
  const live = (ctx.get('agents') as AgentRegistry | undefined)?.get(id)
  if (live) return live
  const resolved = await controller(ctx).resolveAgent(id)
  if ('error' in resolved) throw new Error(resolved.error.message ?? resolved.error.code ?? 'Source session unavailable')
  return resolved.agent
}
/** Read the effective preset, including a preset chosen after the creation header. */
export async function rootSessionProfile(ctx: Context, source: SessionId): Promise<RootSessionProfile> {
  const agent = await agentOf(ctx, source)
  const projections = ctx.get('sessionProjections') as unknown as { stateOf(session: Session, key: string): unknown } | undefined
  const registry = ctx.get('agentPresets') as unknown as { composedPreset(ctx: Context): string | undefined } | undefined
  const selected = projections?.stateOf(agent.session, 'agentPreset')
  const agentPreset = typeof selected === 'string' ? selected
    : (agent.ctx && registry?.composedPreset(agent.ctx)) ?? agent.session.header.agentPreset
  const profile: RootSessionProfile = { ...(agentPreset ? { agentPreset } : {}) }
  const permissions = sourceService(ctx, agent, 'permissionPresets') as Permissions | undefined
  if (permissions) {
    const preset = permissions.current(agent.session)
    profile.permission = { preset }
    const sandbox = sourceService(ctx, agent, 'sandboxPolicy') as { resolve(request: { session: Session }): { mode: NonNullable<RootSessionProfile['permission']>['sandbox'] } } | undefined
    const approval = sourceService(ctx, agent, 'approval') as { overrideOf(session: Session): 'ask' | 'never' | undefined; config: { policy: 'ask' | 'never' } } | undefined
    if (!sandbox || !approval) throw new Error('a2d2: permission inheritance requires the source sandbox and approval services')
    profile.permission.sandbox = sandbox.resolve({ session: agent.session }).mode
    profile.permission.approval = approval.overrideOf(agent.session) ?? approval.config.policy
  }
  return profile
}
/** The same public create/adopt path as the web UI, including preset setup before publication. */
export async function createRootSession(ctx: Context, request: {
  source: SessionId
  sessionId: SessionId
  cwd: string
  workspaceId?: string
  profile?: RootSessionProfile
  repairLegacy?: boolean
}): Promise<Agent> {
  const profile = request.profile ?? await rootSessionProfile(ctx, request.source)
  const workspaces = ctx.get('workspaceRegistry') as unknown as {
    list(): { id: string; path: string; sessionIds: readonly SessionId[]; attachSession(id: SessionId): Promise<void> }[]
  } | undefined
  const sourceWorkspace = workspaces?.list().find(item => item.sessionIds.includes(request.source))
  const workspaceId = request.workspaceId ?? sourceWorkspace?.id
  const workspace = workspaces?.list().find(item => item.id === workspaceId)
  if (workspaces && (!sourceWorkspace || !workspace || workspace.id !== sourceWorkspace.id || workspace.path !== request.cwd)) throw new Error('a2d2: source and successor must use the recorded source workspace and cwd')
  const location = workspaceId ? { workspaceId } : { cwd: request.cwd }
  const agents = ctx.get('agents') as AgentRegistry
  const persistence = ctx.get('sessionPersistence') as unknown as { stat(id: SessionId): Promise<{ header: Session['header'] } | undefined> } | undefined
  const live = agents.get(request.sessionId)
  const persisted = live ? undefined : await persistence?.stat(request.sessionId)
  const existing = live || persisted
  const header = live?.session.header ?? persisted?.header
  if (header && header.cwd !== request.cwd) throw new Error('a2d2: successor belongs to another cwd')
  if (!existing) {
    const created = await controller(ctx).create({
      sessionId: request.sessionId,
      ...location,
      ...(profile.agentPreset ? { agentPreset: profile.agentPreset } : {}),
    })
    if (created.sessionId !== request.sessionId) throw new Error('a2d2: Host did not preserve the reserved Session identity')
  }
  const agent = existing ? await resolveSessionAgent(ctx, request.sessionId) : await agentOf(ctx, request.sessionId)
  if (agent.session.header.cwd !== request.cwd) throw new Error('a2d2: successor belongs to another cwd')
  await workspace?.attachSession(agent.id)
  const projections = ctx.get('sessionProjections') as unknown as { stateOf(session: Session, key: string): unknown } | undefined
  const boundary = projections?.stateOf(agent.session, 'turnBoundary') as { lastTurn: number; openTurnStartSeq: number | null } | undefined
  const started = boundary !== undefined && (boundary.lastTurn > 0 || boundary.openTurnStartSeq !== null)
  if (existing && !boundary) throw new LegacyRootSessionError(agent.id, profile.agentPreset, 'has an unknown turn boundary; refusing to overwrite its configuration')
  if (existing && profile.agentPreset) {
    const presets = ctx.get('agentPresets') as unknown as {
      composedPreset(ctx: Context): string | undefined
      select(agent: Agent, preset: string): Promise<string>
    } | undefined
    if (!presets) throw new Error('a2d2: agentPresets service is required to recover this legacy successor')
    const selected = projections?.stateOf(agent.session, 'agentPreset')
    const composed = presets.composedPreset(agent.ctx)
    if (selected !== profile.agentPreset || composed !== profile.agentPreset) {
      if (started) {
        // A cold legacy session may already have the requested default mounted.
        // Accept its actual composition without rewriting a nonblank history.
        if (selected != null || composed !== profile.agentPreset) throw new LegacyRootSessionError(agent.id, profile.agentPreset)
      } else {
        if (!boundary || agent.status !== 'idle') throw new LegacyRootSessionError(agent.id, profile.agentPreset)
        await agent.runMaintenance(async () => { await presets.select(agent, profile.agentPreset!) })
      }
    }
  }
  if (existing && started) {
    if (!profile.permission) return agent
    const origin = await permissionOrigin(ctx, agent)
    if (origin === 'changed') return agent
    if (origin === 'unknown') throw new LegacyRootSessionError(agent.id, profile.agentPreset, 'has an ambiguous permission history; refusing to retain or overwrite its permissions')
    // Constructor defaults on a nonblank Session are no longer safe to repair:
    // retain its history and require a fresh reserved successor instead.
    const current = await rootSessionProfile(ctx, agent.id)
    if (current.permission?.preset !== profile.permission.preset || current.permission.sandbox !== profile.permission.sandbox || current.permission.approval !== profile.permission.approval) throw new LegacyRootSessionError(agent.id, profile.agentPreset, 'has already started with different permissions; refusing to overwrite its permissions')
    return agent
  }
  if (profile.permission) {
    const permission = profile.permission
    const apply = async () => {
      const latest = projections?.stateOf(agent.session, 'turnBoundary') as typeof boundary
      if (latest && (latest.lastTurn > 0 || latest.openTurnStartSeq !== null)) throw new LegacyRootSessionError(agent.id, profile.agentPreset, 'has already started; refusing to overwrite its permissions')
      const permissions = sourceService(ctx, agent, 'permissionPresets') as Permissions | undefined
      if (!permissions) throw new Error('a2d2: successor preset did not compose the source permission service')
      const { sandbox, approval } = permission
      if (!sandbox || !approval) throw new Error('a2d2: inherited permission configuration is incomplete')
      if (permission.preset !== 'custom') permissions.set(agent.session, permission.preset)
      const approvalService = sourceService(ctx, agent, 'approval') as { overrideOf(session: Session): string | undefined }
      if (projections?.stateOf(agent.session, 'sandboxMode') !== sandbox) setSandboxMode(agent.session, sandbox)
      if (approvalService.overrideOf(agent.session) !== approval) setApprovalPolicy(agent.session, approval)
    }
    await agent.runMaintenance(apply)
  }
  return agent
}
