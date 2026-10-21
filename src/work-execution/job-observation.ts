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
