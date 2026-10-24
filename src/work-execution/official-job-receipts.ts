import { createHash } from 'node:crypto'
import * as sessionModule from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type { OfficialJobEvent } from './official-job-observation.ts'

export const OFFICIAL_JOB_RECEIPT = 'plugin:a2d2/official-job-receipt'
export const jobResultDigest = (content: unknown): string => createHash('sha256').update(JSON.stringify(content) ?? '').digest('hex')
type AppendRecord = (session: any, type: typeof OFFICIAL_JOB_RECEIPT, data: Record<string, unknown>) => unknown

/**
 * Capture only final, direct public job_output outcomes. A nonempty canonical
 * text field is an opaque payload-presence check, never a rendered-text parser.
 * Empty terminal values cannot distinguish a genuinely empty job from an
 * earlier consuming read (including PTC/inline), so they do not mint receipts.
 *
 * appendRecord is the public Host export. The explicit argument lets the
 * official integration lane use its isolated, real Host module instance.
 */
export function installOfficialJobReceipts(ctx: Context, appendRecord: AppendRecord | undefined = (sessionModule as unknown as { appendPluginRecord?: AppendRecord }).appendPluginRecord): void {
  if (!appendRecord) return // Older hosts retain their native observation contract.
  const calls = new WeakMap<object, Map<string, { event: OfficialJobEvent; candidate?: Record<string, unknown> }>>()
  const on = ctx.on.bind(ctx) as (name: string, handler: (...args: any[]) => void) => unknown
  on('tools/result', (exec, result) => {
    if (exec.name !== 'job_output' || exec.parent !== undefined || !exec.agent || result.isError !== false || result.error !== undefined) return
    const value = result.value
    const job = value?.job
    if (typeof value?.text !== 'string' || value.text.length === 0 || !job
      || !['completed', 'failed', 'killed'].includes(job.status) || job.id !== exec.arguments?.job_id) return
    const call = calls.get(exec.agent.session)?.get(exec.callId)
    if (!call || call.event.data.name !== 'job_output') return
    let args: any
    try { args = JSON.parse(call.event.data.arguments) } catch { return }
    if (args?.job_id !== job.id) return
    call.candidate = { jobId: job.id, status: job.status, payloadBytes: Buffer.byteLength(value.text), contentDigest: jobResultDigest(result.content) }
  })
  on('session/event', (session, event: OfficialJobEvent) => {
    if (event.type === 'tool/call') {
      let pending = calls.get(session)
      if (!pending) calls.set(session, pending = new Map())
      pending.set(event.data.callId, { event })
    } else if (event.type === 'tool/result') {
      const pending = calls.get(session)
      const callId = event.data.message?.toolCallId
      const call = pending?.get(callId)
      pending?.delete(callId)
      if (!call?.candidate || event.data.message?.isError !== false || event.data.error !== undefined
        || !event.sourceEventSeqs?.includes(call.event.seq)
        || call.event.data.turn !== event.data.turn || call.event.data.step !== event.data.step
        || call.candidate.contentDigest !== jobResultDigest(event.data.message.content)) return
      const receipt = { version: 1, owner: session.id, ...call.candidate, callId,
        callSeq: call.event.seq, resultSeq: event.seq, turn: event.data.turn, step: event.data.step }
      // Session publication forbids reentrant appends. Receipt eligibility is
      // the accepted Session commit; persistence retains both in log order.
      queueMicrotask(() => {
        try {
          appendRecord(session, OFFICIAL_JOB_RECEIPT, receipt)
        } catch (error) { ctx.logger.warn(`Official job receipt: ${String(error)}`) }
      })
    } else if (event.type === 'turn/end') calls.delete(session)
  })
}
