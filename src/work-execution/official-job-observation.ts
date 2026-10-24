import type { SessionId } from '@deepseek-ai/dsh-session'
import type { PublicJobView } from './job-observation.ts'

/** Public Session log events, read through sessionQuery; never Session files. */
export interface OfficialJobEvent {
  type: string
  seq: number
  data: Record<string, any>
}
export interface OfficialJobRecord {
  job: PublicJobView
  settledSeq?: number
  delivered: boolean
}

/** Official LocalJobRegistry uses kind + 16 UUID hex characters, never ordinals. */
export function isOfficialJob(job: PublicJobView): boolean {
  return typeof job.kind === 'string' && job.kind.length > 0 && typeof job.id === 'string'
    && job.id.startsWith(`${job.kind}-`) && /^[0-9a-f]{16}$/u.test(job.id.slice(job.kind.length + 1))
}
const terminal = (status: unknown): status is 'completed' | 'failed' | 'killed' => ['completed', 'failed', 'killed'].includes(status as string)
function argumentJobId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return
  try {
    const args: unknown = JSON.parse(raw)
    if (args && typeof args === 'object' && !Array.isArray(args) && 'job_id' in args && typeof args.job_id === 'string') return args.job_id
  } catch { /* A malformed call is not collection evidence. */ }
}

/**
 * Conservative terminal-read proof using only committed public events. A
 * settlement must precede the invocation, not merely its result: otherwise
 * settlement can race a running read before that result reaches the log.
 * A wait that began running can recover with another job_output after terminal.
 * No content, notice summary, canonical value, or fabricated meta is consulted.
 */
export function officialJobJournal(events: readonly OfficialJobEvent[], owner: SessionId): Map<string, OfficialJobRecord> {
  const jobs = new Map<string, OfficialJobRecord>()
  const calls = new Map<string, { jobId?: string; seq: number; turn: number; step: number }>()
  for (const event of events) {
    const data = event.data
    if (event.type === 'job/registered' || event.type === 'job/settled') {
      if (data.owner !== owner || typeof data.label !== 'string') continue
      const job: PublicJobView = { id: data.jobId, owner: data.owner, kind: data.kind, label: data.label, status: 'running' }
      if (!isOfficialJob(job)) continue
      if (event.type === 'job/settled') {
        if (!terminal(data.status)) continue
        job.status = data.status
        if (typeof data.detail === 'string') job.detail = data.detail
        jobs.set(job.id, { job, settledSeq: event.seq, delivered: jobs.get(job.id)?.delivered ?? false })
      } else if (!jobs.has(job.id)) jobs.set(job.id, { job, delivered: false })
    } else if (event.type === 'tool/call') {
      if (typeof data.callId !== 'string') continue
      // A reused call id replaces the earlier invocation, including an
      // ineligible one. Pairing also checks turn/step at the committed result.
      const jobId = data.name === 'job_output' ? argumentJobId(data.arguments) : undefined
      const settledSeq = jobId === undefined ? undefined : jobs.get(jobId)?.settledSeq
      calls.set(data.callId, { jobId: settledSeq !== undefined && settledSeq < event.seq ? jobId : undefined,
        seq: event.seq, turn: data.turn, step: data.step })
    } else if (event.type === 'tool/result') {
      const callId = data.message?.toolCallId
      const call = calls.get(callId)
      calls.delete(callId)
      if (!call?.jobId || call.seq >= event.seq || call.turn !== data.turn || call.step !== data.step
        || data.message?.isError !== false || data.error !== undefined) continue
      jobs.get(call.jobId)!.delivered = true
    }
  }
  return jobs
}
