import { OFFICIAL_JOB_RECEIPT, jobResultDigest } from './official-job-receipts.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { PublicJobView } from './job-observation.ts'

/** Public Session log events, read through sessionQuery; never Session files. */
export interface OfficialJobEvent {
  type: string
  seq: number
  data: Record<string, any>
  ignorable?: boolean
  sourceEventSeqs?: readonly number[]
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

/** Reconstruct delivery only from plugin receipts paired with exact public commits. */
export function officialJobJournal(events: readonly OfficialJobEvent[], owner: SessionId): Map<string, OfficialJobRecord> {
  const jobs = new Map<string, OfficialJobRecord>()
  const calls = new Map<number, OfficialJobEvent>()
  const results = new Map<number, OfficialJobEvent>()
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
      calls.set(event.seq, event)
    } else if (event.type === 'tool/result') {
      results.set(event.seq, event)
    } else if (event.type === OFFICIAL_JOB_RECEIPT && event.ignorable === true) {
      const call = calls.get(data.callSeq)
      const result = results.get(data.resultSeq)
      const record = jobs.get(data.jobId)
      if (data.version !== 1 || data.owner !== owner || !record || record.settledSeq === undefined
        || data.status !== record.job.status || !terminal(data.status)
        || !Number.isSafeInteger(data.payloadBytes) || data.payloadBytes <= 0
        || !call || !result || call.seq >= result.seq || result.seq >= event.seq
        || !result.sourceEventSeqs?.includes(call.seq)
        || call.data.name !== 'job_output' || argumentJobId(call.data.arguments) !== data.jobId
        || call.data.callId !== data.callId || result.data.message?.toolCallId !== data.callId
        || call.data.turn !== data.turn || result.data.turn !== data.turn
        || call.data.step !== data.step || result.data.step !== data.step
        || result.data.message?.isError !== false || result.data.error !== undefined
        || data.contentDigest !== jobResultDigest(result.data.message.content)) continue
      record.delivered = true
    }
  }
  return jobs
}
