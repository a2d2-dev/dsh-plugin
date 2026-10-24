import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import { createLlmPlanner } from './work-planning/llm.ts'
import { WorkApplication } from './work.ts'
import { DshWorkHost } from './work-host.ts'
import { createWorkHandler } from './work-route.ts'
import { WORK_ROUTE_PATH } from './work-types.ts'
import { GitHubSource } from './work-sources/github.ts'
import type { GitHubSourcePort } from './work-sources/types.ts'
import { installWorkTools, installWorkControlRecovery } from './work-execution/tools.ts'
import { installWorkProgressTools } from './work-progress-tools.ts'
import { installWorkOrganizationTools } from './work-organization-tools.ts'
import { startProjectDiscovery } from './work-sources/discovery.ts'
import type { RequestRejection } from './route-auth.ts'

export const name = 'a2d2-work'
export const inject = ['webServer', 'connection']
export interface Config { directory?: string; github?: boolean }
export const Config: schema<Config> = schema.object({ directory: schema.string(), github: schema.boolean() })
declare module '@deepseek-ai/cordis' {
  interface Context { a2d2Work: WorkApplication; a2d2GitHubSource?: GitHubSourcePort }
}
const runtimeSchema = z.object({ schemaVersion: z.literal(1), runtimeId: z.string().uuid() }).strict()
/** A stable host identity scoped to this v3 record authority, never derived from cwd or browser input. */
async function runtimeIdentity(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, 'runtime-v1.json')
  return withFileLock(file, async () => {
    try { return runtimeSchema.parse(JSON.parse(await readFile(file, 'utf8'))).runtimeId }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const runtimeId = randomUUID()
    await writeFileAtomic(file, `${JSON.stringify({ schemaVersion: 1, runtimeId })}\n`, { mode: 0o600, dirMode: 0o700 })
    return runtimeId
  })
}
/** Mounted by the bundle; independent of live Session, Agent or model services. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const directory = config.directory ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'a2d2', 'work-v3')
  if (!isAbsolute(directory)) throw new Error('a2d2-work directory must be absolute')
  const runtimeId = await runtimeIdentity(directory)
  const source = config.github === false ? undefined : ctx.get('a2d2GitHubSource') ?? new GitHubSource()
  const planner = createLlmPlanner(options => {
    const llm = ctx.get('llm')
    if (!llm) throw new Error('Host LLM service is unavailable')
    return llm.stream(options)
  })
  const app = new WorkApplication(directory, new DshWorkHost(ctx, runtimeId), source, planner)
  // Migrate legacy inline history/receipts and mutable source sidecars under the DAO writer lock.
  void app.ensureSourceSplit().catch(error => ctx.logger.warn(`Work store archive migration: ${String(error)}`))
  ctx.provide('a2d2Work', app)
  ctx.inject(['tools'], toolsCtx => { installWorkTools(toolsCtx, app, runtimeId); installWorkProgressTools(toolsCtx, app, runtimeId); installWorkOrganizationTools(toolsCtx, app, runtimeId) })
  ctx.inject(['agents'], executionCtx => { installWorkControlRecovery(executionCtx, app) })
  if (source) ctx.effect(() => startProjectDiscovery({
    reconcile: () => app.reconcileSources(),
    onError: error => ctx.logger.warn(`GitHub source discovery: ${String(error)}`),
  }), 'GitHub source background discovery')
  const getService = <T>(key: string): T => (ctx.get as (key: string) => unknown).call(ctx, key) as T
  const server = getService<{ register(route: { kind: 'exact'; path: string; handler: ReturnType<typeof createWorkHandler> }): () => void }>('webServer')
  const connection = getService<{ requestRejection: RequestRejection }>('connection')
  const handler = createWorkHandler(app, request => connection.requestRejection(request))
  ctx.effect(() => server.register({ kind: 'exact', path: WORK_ROUTE_PATH, handler }), 'a2d2 v3 work route')
}
