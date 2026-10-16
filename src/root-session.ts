import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'

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
  constructor(readonly sessionId: SessionId, readonly agentPreset: string) {
    super(`Legacy successor ${sessionId} cannot safely change its missing or different preset. Its history was preserved. Run /task-runtime recover from the current main session to reserve a fresh successor with preset ${agentPreset}.`)
  }
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
    list(): { id: string; sessionIds: readonly SessionId[] }[]
  } | undefined
  const workspaceId = request.workspaceId ?? workspaces?.list().find(item => item.sessionIds.includes(request.source))?.id
  if (workspaces && !workspaceId) throw new Error(`Source session ${request.source} has no workspace`)
  const location = workspaceId ? { workspaceId } : { cwd: request.cwd }
  const agents = ctx.get('agents') as AgentRegistry
  const persistence = ctx.get('sessionPersistence') as unknown as { stat(id: SessionId): Promise<unknown | undefined> } | undefined
  const existing = request.repairLegacy && (agents.get(request.sessionId) || await persistence?.stat(request.sessionId))
  await controller(ctx).create({
    sessionId: request.sessionId,
    ...location,
    ...(!existing && profile.agentPreset ? { agentPreset: profile.agentPreset } : {}),
  })
  const agent = await agentOf(ctx, request.sessionId)
  const projections = ctx.get('sessionProjections') as unknown as { stateOf(session: Session, key: string): unknown } | undefined
  const boundary = projections?.stateOf(agent.session, 'turnBoundary') as { lastTurn: number; openTurnStartSeq: number | null } | undefined
  const started = boundary !== undefined && (boundary.lastTurn > 0 || boundary.openTurnStartSeq !== null)
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
  // A started successor can contain deliberate later permission changes.
  if (existing && started) return agent
  if (profile.permission) {
    const permissions = sourceService(ctx, agent, 'permissionPresets') as Permissions | undefined
    if (!permissions) throw new Error('a2d2: successor preset did not compose the source permission service')
    if (profile.permission.preset !== 'custom') permissions.set(agent.session, profile.permission.preset)
    const { sandbox, approval } = profile.permission
    if (!sandbox || !approval) throw new Error('a2d2: inherited permission configuration is incomplete')
    const approvalService = sourceService(ctx, agent, 'approval') as { overrideOf(session: Session): string | undefined }
    if (projections?.stateOf(agent.session, 'sandboxMode') !== sandbox) setSandboxMode(agent.session, sandbox)
    if (approvalService.overrideOf(agent.session) !== approval) setApprovalPolicy(agent.session, approval)
  }
  return agent
}
