import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import { sessionRefSchema, taskRefSchema } from './work-schema.ts'
import { compactWorkResult } from './work-model-results.ts'
import type { WorkResultKind } from './work-model-results.ts'
import type { WorkApplication } from './work.ts'
import type { SessionRef, WorkResult } from './work-types.ts'

const recordSchema = z.object({ ref: taskRefSchema, executionId: z.string().uuid(), source: sessionRefSchema,
  diagnostics: z.object({ reminders: z.array(z.string()).optional(), error: z.object({ code: z.string(), message: z.string(), currentVersion: z.number().optional() }).strict().optional() }).strict(),
}).strict()
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const failed = (code: string, message: string) => ({ status: 'failed' as const, error: { code, message } })

/** Model diagnostic sidecars do not change Task records, command receipts or gates. */
export async function modelWorkResult(app: WorkApplication, session: SessionRef, result: WorkResult, kind: WorkResultKind, knownSpecificationVersion?: number) {
  const compact = compactWorkResult(result, kind, knownSpecificationVersion)
  const truncated = 'error' in compact ? compact.error?.messageTruncated : 'remindersTruncated' in compact && compact.remindersTruncated
  if (!truncated) return compact
  const current = await app.sessionControl(session, 'diagnostic-authority', 'status')
  if (current.status !== 'completed' || !current.execution || !current.task) throw new Error('Cannot retain diagnostic details without current Task execution authority')
  const record = recordSchema.parse({ ref: current.execution.ref, executionId: current.execution.id, source: session,
    diagnostics: result.status === 'completed' ? { reminders: result.reminders } : { error: result.error } })
  const text = JSON.stringify(record), id = digest(text)
  const directory = join(app.directory, 'work-model-details')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, `${id}.json`)
  await writeFileAtomic(file, text, { mode: 0o600, dirMode: 0o700 })
  return { ...compact, details: result.status === 'completed' && result.task?.progress?.stage === 'done'
    ? { access: 'audit-only', file: `work-model-details/${id}.json`, relativeTo: 'work-store', detail_id: id }
    : { tool: 'work_read', section: 'result', detail_id: id } }
}

/** Only the current coordinator of the same Task/Execution may read a detail ID. */
export async function readModelWorkDetails(app: WorkApplication, session: SessionRef, id?: string) {
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return failed('invalid-detail-id', 'Use the exact content ID returned by the work tool')
  const current = await app.sessionControl(session, 'diagnostic-read-authority', 'status')
  if (current.status !== 'completed') return current
  if (!current.execution || !current.task) return failed('forbidden', 'Calling Session has no current Task execution')
  let text: string
  try { text = await readFile(join(app.directory, 'work-model-details', `${id}.json`), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return failed('detail-not-found', 'Diagnostic detail is not available in this work store'); throw error }
  if (digest(text) !== id) return failed('detail-integrity-failed', 'Diagnostic detail content does not match its ID')
  let decoded: unknown
  try { decoded = JSON.parse(text) } catch { return failed('detail-integrity-failed', 'Diagnostic detail record is invalid') }
  const parsed = recordSchema.safeParse(decoded)
  if (!parsed.success) return failed('detail-integrity-failed', 'Diagnostic detail record is invalid')
  const record = parsed.data
  if (record.executionId !== current.execution.id || record.ref.projectId !== current.execution.ref.projectId || record.ref.taskId !== current.execution.ref.taskId
    || ![current.execution.session, ...(current.execution.retired ?? []).map(item => item.session)].some(source => source.runtimeId === record.source.runtimeId && source.sessionId === record.source.sessionId)) return failed('forbidden', 'Diagnostic detail belongs to another Task execution')
  const latest = await app.sessionControl(session, 'diagnostic-read-recheck', 'status')
  if (latest.status !== 'completed') return latest
  if (latest.execution?.id !== current.execution.id || latest.execution?.epoch !== current.execution.epoch) return failed('stale-execution-authority', 'Coordinator changed while reading diagnostic details')
  return { status: 'completed' as const, diagnostics: record.diagnostics }
}
