import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { observeJobs, settleUncollectedJob } from '../src/work-execution/job-observation.ts'
import type { PublicJobView } from '../src/work-execution/job-observation.ts'
import { RuntimeHost } from '../src/task-runtime/host.ts'
import type { Context } from '@deepseek-ai/cordis'

interface Event { type: string; seq: number; time: number; data: Record<string, any> }
const event = (type: string, seq: number, data: Event['data']): Event => ({ type, seq, time: 1000 + seq, data })
const registered = (seq = 1, overrides: Record<string, unknown> = {}) => event('job/registered', seq, { jobId: job.id, owner, kind: 'bash', label: job.label, startedAt: 1000, ...overrides })
const settled = (seq = 2, overrides: Record<string, unknown> = {}) => event('job/settled', seq, { ...registered().data, finishedAt: 1002, status: 'completed', cause: 'producer', producerReported: true, ...overrides })
const call = (seq = 3, callId = 'read', jobId = job.id) => event('tool/call', seq, { turn: 1, step: 0, callId, name: 'job_output', arguments: JSON.stringify({ job_id: jobId }) })
const result = (seq = 4, callId = 'read', isError = false) => event('tool/result', seq, { turn: 1, step: 0, message: { toolCallId: callId, isError, content: [] } })
function runtime(events: Event[], jobs: unknown) {
  const activate = vi.fn(() => { throw Error('Observation must not activate a model') })
  const dispose = vi.fn()
  const services: Record<string, unknown> = { jobs, agents: { get: () => undefined }, sessionQuery: { observeSession: async () => ({ events, inheritedEventCount: 0, [Symbol.dispose]: dispose }) }, sessionController: { resolveAgent: activate } }
  return { host: new RuntimeHost({ get: (key: string) => services[key] } as unknown as Context), activate, dispose }
}
const registryOf = (jobs: PublicJobView[] = [job]) => ({ list: () => jobs, get: (id: string) => { const found = jobs.find(job => job.id === id); if (!found) throw Error('Unknown job'); return found }, events: { subscribe: vi.fn() } })

const owner = SessionId('owner')
const job = { id: 'bash-0123456789abcdef', owner, kind: 'bash', label: 'official checks', status: 'completed' as const }

it('observes official UUID jobs through exact-owner get/list without consuming output', () => {
  const read = vi.fn(() => { throw Error('Observation must not consume') })
  const readAt = vi.fn(() => { throw Error('Status observation must not read output') })
  const get = vi.fn(() => job)
  const registry = { list: () => [job, { ...job, id: 'bash-fedcba9876543210', owner: undefined }, { ...job, id: 'bash-1123456789abcdef', owner: 'foreign' }], get, events: { subscribe: vi.fn() }, read, readAt }
  const observed = observeJobs(registry, owner, 'runtime')
  expect(observed.capability).toBe('available')
  expect(observed.jobs).toEqual([expect.objectContaining({ id: job.id, delivery: 'pending', availability: 'live', result: 'unknown', acceptance: 'unassessed' })])
  expect(observed.jobs[0]).not.toHaveProperty('registryEpoch')
  expect(observed.jobs[0]).not.toHaveProperty('instanceId')
  expect(settleUncollectedJob(observed.jobs[0]!)).toEqual({ blocker: 'job-unsettled' })
  expect(get).toHaveBeenCalledExactlyOnceWith(job.id, owner)
  expect(read).not.toHaveBeenCalled()
  expect(readAt).not.toHaveBeenCalled()
})

it('unlocks only after a successful job_output called after durable official settlement', async () => {
  const fixture = runtime([registered(), settled(), call(), result()], registryOf())
  const row = await fixture.host.executionFacts(owner, 'runtime', 'current')
  expect(row.jobObservation).toBe('available')
  expect(row.jobs).toEqual([expect.objectContaining({ id: job.id, status: 'completed', delivery: 'delivered', result: 'unknown', acceptance: 'unassessed' })])
  expect(settleUncollectedJob(row.jobs[0]!)).toEqual({})
  expect(fixture.activate).not.toHaveBeenCalled()
  expect(fixture.dispose).toHaveBeenCalledOnce()
})

it('keeps running then terminal jobs blocked until a terminal invocation commits its result', async () => {
  const jobs = [{ ...job, status: 'running' as const }]
  const running = await runtime([registered()], registryOf(jobs)).host.executionFacts(owner, 'runtime', 'current')
  expect(running.jobs[0]).toMatchObject({ status: 'running', delivery: 'pending' })
  const ended = await runtime([registered(), settled()], registryOf()).host.executionFacts(owner, 'runtime', 'current')
  expect(settleUncollectedJob(ended.jobs[0]!)).toEqual({ blocker: 'job-unsettled' })
  expect(ended.jobs[0]!.detail).toContain('终态后再次调用 job_output')
})

it('does not mistake settlement between a running read and result commit for terminal collection', async () => {
  // Also covers wait:true: both forms started before the terminal record, so
  // the conservative journal cannot certify their read-time canonical state.
  const early = call(2)
  early.data.arguments = JSON.stringify({ job_id: job.id, wait: true })
  const events = [registered(), early, settled(3), result(4)]
  const pending = await runtime(events, registryOf()).host.executionFacts(owner, 'runtime', 'current')
  expect(pending.jobs[0]!.delivery).toBe('pending')
  expect(settleUncollectedJob(pending.jobs[0]!)).toHaveProperty('blocker')
  events.push(call(5, 'repeat'), result(6, 'repeat'))
  const recovered = await runtime(events, registryOf()).host.executionFacts(owner, 'runtime', 'current')
  expect(recovered.jobs[0]!.delivery).toBe('delivered')
})

it('recovers a missing or failed result with a repeated successful terminal read, including after registry loss', async () => {
  const events = [registered(), settled(), call()]
  expect((await runtime(events, registryOf()).host.executionFacts(owner, 'runtime', 'current')).jobs[0]!.delivery).toBe('pending')
  events.push(result(4, 'read', true))
  expect((await runtime(events, registryOf()).host.executionFacts(owner, 'runtime', 'current')).jobs[0]!.delivery).toBe('pending')
  events.push(call(5, 'repeat'), result(6, 'repeat'), call(7, 'third'), result(8, 'third'))
  const replay = await runtime(events, registryOf([])).host.executionFacts(owner, 'runtime', 'retired')
  expect(replay.jobs).toHaveLength(1)
  expect(replay.jobs[0]).toMatchObject({ delivery: 'delivered', persistence: 'session-journal', availability: 'history', result: 'unknown', acceptance: 'unassessed' })
})

it('keeps short-UUID jobs across registry restarts separate from fresh jobs and the legacy journal domain', async () => {
  const fresh = { ...job, id: 'bash-fedcba9876543210', label: 'fresh process' }
  const legacy = { job, registryEpoch: 'legacy-epoch', instanceId: 'legacy-instance', terminalResult: 'pending' }
  const events = [registered(), settled(), event('jobs/settled', 3, legacy)]
  const row = await runtime(events, registryOf([fresh])).host.executionFacts(owner, 'runtime', 'current')
  expect(row.jobObservation).toBe('available')
  expect(row.jobs).toHaveLength(3)
  expect(row.jobs).toContainEqual(expect.objectContaining({ id: job.id, registryEpoch: 'legacy-epoch', availability: 'lost', delivery: 'unknown' }))
  const old = row.jobs.find(item => item.id === job.id && !item.registryEpoch)!
  expect(old).toMatchObject({ availability: 'lost', delivery: 'unknown', status: 'completed' })
  expect(old).not.toHaveProperty('instanceId')
  expect(settleUncollectedJob(old)).toHaveProperty('reminder')
  expect(settleUncollectedJob(old)).not.toHaveProperty('blocker')
  expect(row.jobs).toContainEqual(expect.objectContaining({ id: fresh.id, availability: 'live', delivery: 'pending' }))
})

it.each(['registered', 'settled'])('does not transfer foreign official %s history into the current owner', async kind => {
  const events = [kind === 'registered' ? registered(1, { owner: 'foreign' }) : settled(1, { owner: 'foreign' }), call(2), result(3)]
  const row = await runtime(events, registryOf([])).host.executionFacts(owner, 'runtime', 'current')
  expect(row.jobs).toEqual([])
})

it.each([
  [call(3, 'read', 'bash-fedcba9876543210'), result()],
  [event('tool/call', 3, { ...call().data, arguments: `not JSON ${job.id}` }), result()],
  [event('tool/call', 3, { ...call().data, name: 'job_kill' }), result()],
  [call(), result(4, 'wrong-call')],
  [call(), event('tool/result', 4, { ...result().data, turn: 2 })],
  [call(), event('tool/result', 4, { ...result().data, step: 1 })],
  [call(), event('tool/result', 4, { ...result().data, error: { name: 'failure' } })],
])('requires exact structured arguments and a matching successful invocation', async (request, response) => {
  const row = await runtime([registered(), settled(), request, response], registryOf()).host.executionFacts(owner, 'runtime', 'current')
  expect(row.jobs[0]!.delivery).toBe('pending')
})

it('ignores inline completion text, teardown and removed foreground jobs as collection proof', async () => {
  const events = [registered(), settled(2, { cause: 'teardown' }), event('user/message', 3, { source: { kind: 'tool-jobs', form: 'notice', summary: `job ${job.id} collected successfully` }, content: [{ type: 'text', text: 'complete output' }] })]
  const row = await runtime(events, registryOf([])).host.executionFacts(owner, 'runtime', 'current')
  expect(row.jobs[0]).toMatchObject({ availability: 'lost', delivery: 'unknown' })
  expect(settleUncollectedJob(row.jobs[0]!)).toHaveProperty('reminder')
  expect(settleUncollectedJob(row.jobs[0]!)).not.toHaveProperty('blocker')
})

it('never promotes list-only or ordinal-only older hosts to official available', () => {
  expect(observeJobs({ list: () => [job] }, owner, 'runtime').capability).toBe('unavailable')
  expect(observeJobs(registryOf([{ ...job, id: 'bash-1' }]), owner, 'runtime').capability).toBe('unavailable')
})

it('rejects a get projection with a different id or owner instead of declaring capability available', () => {
  const registry = registryOf()
  expect(() => observeJobs({ ...registry, get: () => ({ ...job, id: 'bash-fedcba9876543210' }) }, owner, 'runtime')).toThrow('identity changed')
  expect(() => observeJobs({ ...registry, get: () => ({ ...job, owner: SessionId('foreign') }) }, owner, 'runtime')).toThrow('identity changed')
})
