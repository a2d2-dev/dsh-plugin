import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ExecutionJob } from './observation.ts'

/** Structural face of the formal host #142 contract; no private registry access. */
export interface PublicJobView {
  id: string; owner?: string; kind: string; label: string
  status: ExecutionJob['status']; detail?: string
}
export interface PublicJobObservation {
  job: PublicJobView
  registryEpoch: string
  instanceId: string
  terminalResult: 'not-terminal' | 'pending' | 'collected'
}
export interface PublicJobRegistry {
  list(owner: SessionId): PublicJobView[]
  observe?(id: string, owner: SessionId): PublicJobObservation
}
const key = (record: PublicJobObservation) => JSON.stringify([record.registryEpoch, record.instanceId, record.job.id])
const firstLine = (text: string, length = 96) => {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > length ? `${line.slice(0, length)}…` : line
}
/** One bounded, human-readable notice; raw job output never enters a reminder. */
function lostJobReminder(job: ExecutionJob): string {
  return `作业 ${job.id}（${job.kind}：${firstLine(job.label || job.kind)}）的注册表实例已不可达，终态结果无法再收取；按「不可达只提醒」约定不阻断完成，如需取证请查看该作业所属会话历史。`
}
/**
 * Completion gate for one terminal job whose result was not delivered. A
 * reachable job (the host registry can still observe it) must be settled by a
 * real collection. A job whose registry instance is gone can never be
 * collected, so it only leaves a reminder: #142 forbids an unresolvable
 * permanent block, and #201 makes that ruling explicit.
 */
export function settleUncollectedJob(job: ExecutionJob): { blocker?: 'job-unsettled' | 'job-result-unknown'; reminder?: string } {
  if (job.delivery === 'delivered') return {}
  if (job.availability === 'lost') return { reminder: lostJobReminder(job) }
  return { blocker: job.delivery === 'unknown' ? 'job-result-unknown' : 'job-unsettled' }
}
function project(record: PublicJobObservation, owner: SessionId, runtimeId: string, live: boolean): ExecutionJob {
  const running = record.job.status === 'running' || record.job.status === 'stopping'
  if (record.job.owner !== owner || !record.registryEpoch || !record.instanceId
    || running !== (record.terminalResult === 'not-terminal') || !['not-terminal', 'pending', 'collected'].includes(record.terminalResult)) throw new Error('Host job observation identity or terminal state is inconsistent')
  return { id: record.job.id, owner: { runtimeId, sessionId: owner }, kind: record.job.kind, label: record.job.label, status: record.job.status,
    ...(record.job.detail ? { detail: record.job.detail } : {}), registryEpoch: record.registryEpoch, instanceId: record.instanceId,
    result: 'unknown', delivery: record.terminalResult === 'collected' ? 'delivered' : live ? 'pending' : 'unknown', acceptance: 'unassessed',
    persistence: live ? 'process-local' : 'session-journal', availability: live ? 'live' : record.terminalResult === 'collected' ? 'history' : 'lost' }
}

/** This face intentionally has no read/readAt method: an observation cannot collect. */
export function observeJobs(registry: PublicJobRegistry | undefined, owner: SessionId, runtimeId: string, journal: readonly PublicJobObservation[] = []): { jobs: ExecutionJob[]; capability: 'available' | 'unavailable' | 'disabled' } {
  const rows = new Map<string, ExecutionJob>()
  for (const record of journal) {
    if (record.job.owner !== owner) continue
    rows.set(key(record), project(record, owner, runtimeId, false))
  }
  for (const job of registry?.list(owner).filter(job => job.owner === owner) ?? []) {
    if (!registry?.observe) {
      rows.set(JSON.stringify(['unknown', job.id]), { id: job.id, owner: { runtimeId, sessionId: owner }, kind: job.kind, label: job.label, status: job.status,
        ...(job.detail ? { detail: job.detail } : {}), result: 'unknown', delivery: 'unknown', acceptance: 'unassessed', persistence: 'process-local', availability: 'live' })
      continue
    }
    const observed = registry.observe(job.id, owner)
    if (observed.job.id !== job.id) throw new Error('Host job observation identity changed')
    rows.set(key(observed), project(observed, owner, runtimeId, true))
  }
  return { jobs: [...rows.values()], capability: !registry ? 'disabled' : registry.observe ? 'available' : 'unavailable' }
}
