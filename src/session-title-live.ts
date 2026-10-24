import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from './work-plugin.ts'
import type { WorkApplication } from './work.ts'
import type { WorkSnapshot } from './work-schema.ts'
import type { SessionRef, WorkExecution } from './work-types.ts'
import { TaskSessionTitleWriter } from './task-session-title-writer.ts'
import { workSessionTitles } from './work-session-titles.ts'

export const name = 'a2d2-session-title-live'
export const inject = ['a2d2Work', 'sessions', 'sessionPersistence']

/** Add only title metadata to a running older host. Its execution object, policy
 * callbacks and admitted human turns remain owned by the existing work runtime. */
export function installLiveSessionTitles(ctx: Context, app: WorkApplication, runtimeId: string): boolean {
  if (typeof app.host.nameSession === 'function') return false
  const writer = new TaskSessionTitleWriter(ctx, runtimeId)
  ctx.effect(() => {
    let closed = false
    let queue: Promise<void> = Promise.resolve()
    let background: Promise<void> | undefined
    const report = (error: unknown) => ctx.logger.warn(`Task title live integration: ${String(error)}`)
    const refresh = (session?: SessionRef, pending?: WorkExecution) => {
      const operation = queue.catch(() => {}).then(async () => {
        if (closed) return
        const state = JSON.parse(await readFile(join(app.directory, 'work-v3.json'), 'utf8')) as WorkSnapshot
        for (const item of workSessionTitles(state, pending)) {
          if (session && (item.session.runtimeId !== session.runtimeId || item.session.sessionId !== session.sessionId)) continue
          try { await writer.set(item.session, item.title) } catch (error) { report(error) }
        }
      })
      queue = operation
      return operation
    }
    const execution = app.host.execution
    const ensure = execution?.ensure
    const wrappedEnsure: typeof ensure = ensure && (async (...args: Parameters<NonNullable<typeof ensure>>) => {
      const actual = await ensure.apply(execution, args)
      // Runs before the original application marks creation ready or delivers input.
      await refresh(args[0].session, args[0]).catch(report)
      return actual
    })
    if (execution && wrappedEnsure) execution.ensure = wrappedEnsure
    const execute = app.execute
    const wrappedExecute: typeof execute = async (...args) => {
      const result = await execute.apply(app, args)
      const input = args[0]
      if (result.status === 'completed' && typeof input === 'object' && input !== null && 'type' in input
        && ['task.associate-session', 'task.link-child', 'source.link', 'source.import'].includes(String(input.type))) await refresh().catch(report)
      return result
    }
    app.execute = wrappedExecute
    const tick = () => {
      if (closed || background) return
      background = refresh().catch(report).finally(() => { background = undefined })
    }
    const timer = setInterval(tick, 2_000)
    timer.unref()
    tick()
    return async () => {
      closed = true
      clearInterval(timer)
      if (app.execute === wrappedExecute) app.execute = execute
      if (execution && ensure && execution.ensure === wrappedEnsure) execution.ensure = ensure
      await queue.catch(() => {})
    }
  }, 'live task session title metadata')
  return true
}

/** Optional hot-upgrade entry. A full runtime with native naming makes it a no-op. */
export async function apply(ctx: Context): Promise<void> {
  const app = ctx.get('a2d2Work')!
  if (typeof app.host.nameSession === 'function') return
  const identity = JSON.parse(await readFile(join(app.directory, 'runtime-v1.json'), 'utf8')) as { runtimeId?: unknown }
  if (typeof identity.runtimeId !== 'string' || !identity.runtimeId) throw new Error('Existing work runtime identity is unavailable')
  installLiveSessionTitles(ctx, app, identity.runtimeId)
}
