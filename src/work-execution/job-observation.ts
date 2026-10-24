import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ExecutionJob } from './observation.ts'
import { isOfficialJob, officialJobJournal } from './official-job-observation.ts'
import type { OfficialJobEvent, OfficialJobRecord } from './official-job-observation.ts'

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
  /** Official DSH status projection; neither method consumes output. */
  get?(id: string, owner: SessionId): PublicJobView
  events?: { subscribe: (...args: never[]) => unknown }
}
const key = (record: PublicJobObservation) => JSON.stringify([record.registryEpoch, record.instanceId, record.job.id])
/** A reminder is bounded by code points, not UTF-16 units; see lostJobReminder. */
const REMINDER_CODE_POINTS = 320
const LABEL_CODE_POINTS = 96
/** Terminal colour must not leak into a notice. */
const ANSI_CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu
/** C0/C1 controls (including a bare ESC and CR) have no place in a one-line notice. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu
const firstLine = (text: string, length = LABEL_CODE_POINTS): string => {
  // Both CR and LF end the visible line. Cleaning happens before truncation so
  // the length budget counts visible text, and truncation counts code points so
  // an emoji is never split into a lone surrogate.
  const line = (text.split(/\r\n|\r|\n/u)[0] ?? '').replace(ANSI_CSI, '').replace(CONTROL_CHARACTERS, ' ').trim()
  const points = Array.from(line)
  return points.length > length ? `${points.slice(0, length).join('')}…` : line
}
/** Bound the whole notice, so "bounded" is guaranteed by code for any id/kind/label. */
const boundedReminder = (text: string): string => {
  const points = Array.from(text)
  return points.length <= REMINDER_CODE_POINTS ? text : `${points.slice(0, REMINDER_CODE_POINTS - 1).join('')}…`
}
/** One bounded, human-readable notice; raw job output never enters a reminder. */
function lostJobReminder(job: ExecutionJob): string {
  // A journal row cannot tell a crash mid-run from an uncollected terminal
  // result, so describe what the record actually shows.
  const outcome = job.status === 'running' || job.status === 'stopping'
    ? '记录停留在运行中，宿主进程已结束，结果无法再收取'
    : '终态结果无法再收取'
  return boundedReminder(`作业 ${job.id}（${job.kind}：${firstLine(job.label || job.kind)}）的注册表实例已不可达，${outcome}；执行者会话 ${job.owner.sessionId}；按「不可达只提醒」约定不阻断完成，如需取证请查看该作业所属会话历史。`)
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

function projectOfficial(record: OfficialJobRecord, owner: SessionId, runtimeId: string, live: boolean): ExecutionJob {
  const job = record.job
  const needsRead = live && !record.delivered && !['running', 'stopping'].includes(job.status)
  const detail = [job.detail, ...(needsRead ? ['终态结果尚无交付凭据；请用 job_output（可 wait）收取非空结果并成功提交。已消费后失败、空结果、PTC 或已提交 inline 通知无法靠重复读取恢复证明。可重新执行并收取新作业以补证；原作业仍阻断，须由操作者通过公开 jobs.remove 移除已结束记录，或在原注册表结束后按不可达提醒处理。'] : [])].filter(Boolean).join('；')
  return { id: job.id, owner: { runtimeId, sessionId: owner }, kind: job.kind, label: job.label, status: job.status,
    ...(detail ? { detail } : {}), result: 'unknown', delivery: record.delivered ? 'delivered' : live ? 'pending' : 'unknown', acceptance: 'unassessed',
    persistence: live ? 'process-local' : 'session-journal', availability: live ? 'live' : record.delivered ? 'history' : 'lost' }
}

/** This face intentionally has no read/readAt method: an observation cannot collect. */
export function observeJobs(registry: PublicJobRegistry | undefined, owner: SessionId, runtimeId: string, journal: readonly PublicJobObservation[] = [], officialEvents: readonly OfficialJobEvent[] = []): { jobs: ExecutionJob[]; capability: 'available' | 'unavailable' | 'disabled' } {
  const rows = new Map<string, ExecutionJob>()
  for (const record of journal) {
    if (record.job.owner !== owner) continue
    rows.set(key(record), project(record, owner, runtimeId, false))
  }
  const officialJournal = officialJobJournal(officialEvents, owner)
  for (const [id, record] of officialJournal) rows.set(JSON.stringify(['official', id]), projectOfficial(record, owner, runtimeId, false))
  const official = !registry?.observe && typeof registry?.get === 'function' && typeof registry.events?.subscribe === 'function'
  let identitiesVerified = true
  for (const job of registry?.list(owner).filter(job => job.owner === owner) ?? []) {
    if (official && isOfficialJob(job)) {
      const observed = registry!.get!(job.id, owner)
      if (observed.id !== job.id || observed.owner !== owner || !isOfficialJob(observed)) throw new Error('Host job observation identity changed')
      rows.set(JSON.stringify(['official', observed.id]), projectOfficial({ job: observed, delivered: officialJournal.get(observed.id)?.delivered ?? false }, owner, runtimeId, true))
      continue
    }
    if (!registry?.observe) {
      identitiesVerified = false
      rows.set(JSON.stringify(['unknown', job.id]), { id: job.id, owner: { runtimeId, sessionId: owner }, kind: job.kind, label: job.label, status: job.status,
        ...(job.detail ? { detail: job.detail } : {}), result: 'unknown', delivery: 'unknown', acceptance: 'unassessed', persistence: 'process-local', availability: 'live' })
      continue
    }
    const observed = registry.observe(job.id, owner)
    if (observed.job.id !== job.id) throw new Error('Host job observation identity changed')
    rows.set(key(observed), project(observed, owner, runtimeId, true))
  }
  return { jobs: [...rows.values()], capability: !registry ? 'disabled' : registry.observe || (official && identitiesVerified) ? 'available' : 'unavailable' }
}
