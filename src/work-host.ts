import type { Context } from '@deepseek-ai/cordis'
import { realpath, stat } from 'node:fs/promises'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { WorkHost } from './work.ts'
import type { HostResource, SessionCandidate } from './work-types.ts'

export class WorkHostUnavailable extends Error {}

/** Reads registered resources and durable session facts; never resumes or reconfigures a Session. */
export class DshWorkHost implements WorkHost {
  constructor(private readonly ctx: Context, readonly runtimeId: string) {}
  private registry(): WorkspaceRegistry {
    const registry = this.ctx.get('workspaceRegistry') as unknown as WorkspaceRegistry | undefined
    if (!registry) throw new WorkHostUnavailable('DSH workspaceRegistry is required for host resources')
    return registry
  }
  async resources(): Promise<HostResource[]> {
    const resources: HostResource[] = []
    for (const workspace of this.registry().list()) {
      if (await workspace.status() === 'ok') resources.push({ ref: { runtimeId: this.runtimeId, workspaceId: workspace.id }, title: workspace.title })
    }
    return resources
  }
  async sessions(resource: HostResource): Promise<SessionCandidate[]> {
    if (resource.ref.runtimeId !== this.runtimeId) return []
    const workspace = this.registry().list().find(item => item.id === resource.ref.workspaceId)
    if (!workspace || await workspace.status() !== 'ok') return []
    const persistence = this.ctx.get('sessionPersistence')
    if (!persistence) throw new WorkHostUnavailable('DSH sessionPersistence is required for Session candidates')
    const candidates: SessionCandidate[] = []
    for (const sessionId of workspace.sessionIds) {
      const header: SessionHeader | undefined = this.ctx.get('sessions')?.get(SessionId(sessionId))?.header
        ?? (await persistence.stat(SessionId(sessionId)))?.header
      if (!header?.cwd) continue
      // The registry validates membership; revalidate current filesystem facts at admission.
      let canonical: string
      try {
        canonical = await realpath(header.cwd)
        if (!(await stat(canonical)).isDirectory()) continue
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) continue
        throw error
      }
      if (canonical !== workspace.path) continue
      candidates.push({ ref: { runtimeId: this.runtimeId, sessionId }, resource: resource.ref, title: sessionId })
    }
    return candidates
  }
}
