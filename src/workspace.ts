import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Root-session producers share the host workspace membership API. */
export async function inheritWorkspace(ctx: Context, source: SessionId, successor: SessionId): Promise<void> {
  const registry = ctx.get('workspaceRegistry') as unknown as {
    list(): { sessionIds: readonly SessionId[]; attachSession(id: SessionId): Promise<void> }[]
  } | undefined
  // Small CLI profiles have no workspace service. Web profiles must have an owner.
  if (!registry) return
  const workspace = registry.list().find(item => item.sessionIds.includes(source))
  if (!workspace) throw new Error(`Source session ${source} has no workspace`)
  await workspace.attachSession(successor)
}
