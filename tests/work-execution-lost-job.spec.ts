import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { DshWorkExecutionHost } from '../src/work-execution/dsh-host.ts'
import { settleUncollectedJob } from '../src/work-execution/job-observation.ts'
import type { ExecutionJob, ObservedSession } from '../src/work-execution/observation.ts'
import type { WorkExecution } from '../src/work-types.ts'

const session = { runtimeId: 'runtime', sessionId: 'current' }
const execution: WorkExecution = { id: 'execution', ref: { projectId: 'project', taskId: 'task' }, agentId: 'agent', owner: 'owner', epoch: 1,
  resource: { runtimeId: 'runtime', workspaceId: 'workspace' }, session, sessionMode: 'create', agentPreset: 'agent',
  model: { provider: 'p', model: 'm' }, permissionPreset: 'read-only', policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] },
  state: 'ready', history: [], events: [] }
const job = (overrides: Partial<ExecutionJob> = {}): ExecutionJob => ({ id: 'bash-641', owner: session, kind: 'bash', label: 'cd /data && pnpm test',
  status: 'completed', result: 'unknown', delivery: 'unknown', acceptance: 'unassessed', persistence: 'session-journal', ...overrides })
const reminderOf = (overrides: Partial<ExecutionJob> = {}): string => settleUncollectedJob(job({ availability: 'lost', ...overrides })).reminder ?? ''
/** A UTF-16 half of a surrogate pair: never valid inside a notice. */
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
/** The real host loop only needs execution facts; other runtime calls stay inert for these gates. */
function hostWith(row: ObservedSession) {
  const host = new DshWorkExecutionHost({ get: () => undefined } as unknown as Context, 'runtime')
  ;(host as unknown as { runtime: unknown }).runtime = {
    executionFacts: async () => row,
    agent: async () => ({ whenIdle: async () => {}, runMaintenance: async <T>(body: () => Promise<T>) => body() }),
    flush: async () => {},
  }
  host.connectObservation(async () => [])
  return host
}
const row = (observed: ExecutionJob): ObservedSession => ({ session, role: 'current', status: 'idle', children: [], jobs: [observed], jobObservation: 'available' })

it('downgrades an unreachable registry job to a bounded reminder instead of a blocker', () => {
  const settled = settleUncollectedJob(job({ availability: 'lost' }))
  expect(settled.blocker).toBeUndefined()
  expect(settled.reminder).toContain('bash-641')
  expect(settled.reminder).toContain('bash')
  expect(settled.reminder).toContain('注册表实例已不可达')
  expect(settled.reminder).toContain('终态结果无法再收取')
  expect(settled.reminder).toContain('执行者会话 current')
  expect(Array.from(settled.reminder!).length).toBeLessThanOrEqual(320)
})

it('still demands a real collection for a reachable live or legacy job', () => {
  expect(settleUncollectedJob(job({ availability: 'live', delivery: 'pending' }))).toEqual({ blocker: 'job-unsettled' })
  expect(settleUncollectedJob(job({ availability: 'live', delivery: 'unknown' }))).toEqual({ blocker: 'job-result-unknown' })
  expect(settleUncollectedJob(job({ delivery: 'pending' }))).toEqual({ blocker: 'job-unsettled' })
})

it('settles a delivered history job with neither a blocker nor a reminder', () => {
  expect(settleUncollectedJob(job({ availability: 'history', delivery: 'delivered' }))).toEqual({})
})

it('describes a journal row left running instead of claiming a terminal result', () => {
  // A crash between registered and settled leaves terminalResult 'not-terminal';
  // the record shows a run, not a collected-or-missed terminal output.
  const running = reminderOf({ status: 'running' })
  expect(running).toContain('运行中')
  expect(running).not.toContain('终态结果无法再收取')
  expect(reminderOf({ status: 'stopping' })).toContain('运行中')
  expect(reminderOf({ status: 'failed' })).toContain('终态结果无法再收取')
})

it('cleans a multi-line, ANSI-coloured, control-laden label down to its first visible line', () => {
  const reminder = reminderOf({ label: 'cd /data\u0007\u001b[31m && pnpm test\u001b[0m\rsecond line\nthird \u009bline' })
  expect(reminder).toContain('cd /data')
  expect(reminder).toContain('&& pnpm test')
  expect(reminder).not.toContain('\u001b')
  expect(reminder).not.toContain('second line')
  expect(reminder).not.toContain('third')
  expect(reminder).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u)
})

it('truncates the label on code points so an emoji is never split into a lone surrogate', () => {
  const reminder = reminderOf({ id: 'bash-emoji', label: `${'a'.repeat(95)}😀tail` })
  expect(reminder).toContain('😀')
  expect(reminder).not.toMatch(loneSurrogate)
})

it('bounds the whole reminder to 320 code points even with oversized identity fields', () => {
  const reminder = reminderOf({ id: 'k'.repeat(130), kind: 'k'.repeat(130), label: 'l'.repeat(200) })
  expect(Array.from(reminder).length).toBeLessThanOrEqual(320)
  expect(reminder.endsWith('…')).toBe(true)
})

it('reports only a reminder and a settled observation for a lost job, never a pending settlement', async () => {
  const facts = await hostWith(row(job({ availability: 'lost' }))).observation(execution, [])
  expect(facts.settlement).toBe('settled')
  expect(facts.blockers).toEqual([])
  expect(facts.reminders).toHaveLength(1)
  expect(facts.reminders[0]).toContain('bash-641')
})

it('keeps a live uncollected job blocking observation and continuation maintenance', async () => {
  const pending = job({ availability: 'live', delivery: 'pending' })
  const facts = await hostWith(row(pending)).observation(execution, [])
  expect(facts).toMatchObject({ settlement: 'pending', reminders: [], blockers: [{ code: 'job-unsettled', session, jobId: 'bash-641' }] })
  await expect(hostWith(row(pending)).maintain(execution, async () => 'unsafe')).rejects.toMatchObject({ code: 'continuation-waiting-executions' })
})

it('lets continuation maintenance proceed when the only outstanding job is unreachable', async () => {
  let entered = false
  await hostWith(row(job({ availability: 'lost' }))).maintain(execution, async () => { entered = true })
  expect(entered).toBe(true)
})

it('never repeats an unreachable remark when the host has list but no observe', async () => {
  // A list-only host cannot prove terminal delivery: it already raises
  // job-observation-unavailable, so a parallel "registry unreachable" notice
  // would contradict that blocker.
  const facts = await hostWith({ ...row(job({ availability: 'lost' })), jobObservation: 'unavailable' }).observation(execution, [])
  expect(facts.reminders).toEqual([])
  expect(facts.blockers.map(blocker => blocker.code)).toContain('job-observation-unavailable')
})

it('records a jobs-service limitation and still reminds when the host has no jobs service at all', async () => {
  const facts = await hostWith({ ...row(job({ availability: 'lost' })), jobObservation: 'disabled' }).observation(execution, [])
  expect(facts.blockers).toEqual([])
  expect(facts.reminders).toHaveLength(1)
  expect(facts.limitations.join('\n')).toContain('宿主未提供 jobs 服务')
})
