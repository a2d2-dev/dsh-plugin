import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { observeJobs, settleUncollectedJob } from '../src/work-execution/job-observation.ts'
import type { PublicJobView } from '../src/work-execution/job-observation.ts'
import { OFFICIAL_JOB_RECEIPT, jobResultDigest } from '../src/work-execution/official-job-receipts.ts'
import { RuntimeHost } from '../src/task-runtime/host.ts'
import type { Context } from '@deepseek-ai/cordis'

interface Event { type: string; seq: number; time: number; data: Record<string, any>; ignorable?: boolean; sourceEventSeqs?: readonly number[] }
const event = (type: string, seq: number, data: Event['data']): Event => ({ type, seq, time: 1000 + seq, data })
const registered = (seq = 1, overrides: Record<string, unknown> = {}) => event('job/registered', seq, { jobId: job.id, owner, kind: 'bash', label: job.label, startedAt: 1000, ...overrides })
const settled = (seq = 2, overrides: Record<string, unknown> = {}) => event('job/settled', seq, { ...registered().data, finishedAt: 1002, status: 'completed', cause: 'producer', producerReported: true, ...overrides })
const call = (seq = 3, callId = 'read', jobId = job.id) => event('tool/call', seq, { turn: 1, step: 0, callId, name: 'job_output', arguments: JSON.stringify({ job_id: jobId }) })
const payload = () => [{ type: 'text', text: 'evidence' }]
const result = (seq = 4, callId = 'read', isError = false, callSeq = seq - 1): Event => ({ ...event('tool/result', seq, { turn: 1, step: 0, message: { toolCallId: callId, isError, content: payload() } }), sourceEventSeqs: [callSeq] })
const receipt = (seq = 5, callSeq = 3, resultSeq = 4, callId = 'read', overrides: Record<string, unknown> = {}): Event => ({ ...event(OFFICIAL_JOB_RECEIPT, seq, { version: 2, owner, jobId: job.id, status: 'completed', payloadBytes: 8, contentDigest: jobResultDigest(payload()), callSeq, resultSeq, callId, turn: 1, step: 0, ...overrides }), ignorable: true } as Event)
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

it('unlocks only with a payload receipt bound to the successful committed job_output', async () => {
  const fixture = runtime([registered(), settled(), call(), result(), receipt()], registryOf())
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
  expect(ended.jobs[0]!.detail).toContain('无法靠重复读取恢复证明')
})

it('accepts a terminal payload receipt from a wait that began while running', async () => {
  const early = call(2)
  early.data.arguments = JSON.stringify({ job_id: job.id, wait: true })
  const events = [registered(), early, settled(3), result(4, 'read', false, 2)]
  expect((await runtime(events, registryOf()).host.executionFacts(owner, 'runtime', 'current')).jobs[0]!.delivery).toBe('pending')
  events.push(receipt(5, 2, 4))
  expect((await runtime(events, registryOf()).host.executionFacts(owner, 'runtime', 'current')).jobs[0]!.delivery).toBe('delivered')
})

it('does not recover missing or failed results by repeating a successful empty terminal read', async () => {
  const events = [registered(), settled(), call()]
  expect((await runtime(events, registryOf()).host.executionFacts(owner, 'runtime', 'current')).jobs[0]!.delivery).toBe('pending')
  events.push(result(4, 'read', true), call(5, 'repeat'), result(6, 'repeat'), call(7, 'third'), result(8, 'third'))
  const live = await runtime(events, registryOf()).host.executionFacts(owner, 'runtime', 'current')
  expect(live.jobs[0]!.delivery).toBe('pending')
  expect(settleUncollectedJob(live.jobs[0]!)).toHaveProperty('blocker')
  const cold = await runtime(events, registryOf([])).host.executionFacts(owner, 'runtime', 'retired')
  expect(cold.jobs[0]).toMatchObject({ delivery: 'unknown', availability: 'lost' })
  expect(settleUncollectedJob(cold.jobs[0]!)).toHaveProperty('reminder')
})

it.each([
  { payloadBytes: 0 }, { payloadBytes: -1 }, { payloadBytes: 1.5 },
  { contentDigest: 'different-projection' }, { callSeq: 7 }, { resultSeq: 7 },
  { owner: 'foreign' }, { jobId: 'bash-fedcba9876543210' }, { status: 'running' },
  { turn: 2 }, { step: 1 }, { callId: 'different-call' }, { version: 1 },
])('rejects an unbound or non-payload receipt %j', async overrides => {
  const events = [registered(), settled(), call(), result(), receipt(5, 3, 4, 'read', overrides)]
  expect((await runtime(events, registryOf()).host.executionFacts(owner, 'runtime', 'current')).jobs[0]!.delivery).toBe('pending')
})

it('rejects an empty committed presentation even when a v2 receipt repeats its digest', async () => {
  const response = result()
  response.data.message.content = []
  const events = [registered(), settled(), call(), response, receipt(5, 3, 4, 'read', { contentDigest: jobResultDigest([]) })]
  expect((await runtime(events, registryOf()).host.executionFacts(owner, 'runtime', 'current')).jobs[0]!.delivery).toBe('pending')
})

it('does not accept a receipt without the corresponding committed successful result', async () => {
  for (const events of [[registered(), settled(), call(), receipt()], [registered(), settled(), call(), result(4, 'read', true), receipt()]]) {
    expect((await runtime(events, registryOf()).host.executionFacts(owner, 'runtime', 'current')).jobs[0]!.delivery).toBe('pending')
  }
})

it('rejects a receipt whose result does not cite its exact source call', async () => {
  const response = result()
  response.sourceEventSeqs = [1]
  const events = [registered(), settled(), call(), response, receipt()]
  expect((await runtime(events, registryOf()).host.executionFacts(owner, 'runtime', 'current')).jobs[0]!.delivery).toBe('pending')
})

it('retains only proven payload delivery on cold journal replay', async () => {
  const events = [registered(), settled(), call(), result(), receipt()]
  const replay = await runtime(events, registryOf([])).host.executionFacts(owner, 'runtime', 'retired')
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
  expect(old.detail ?? '').not.toContain('再次调用 job_output')
  expect(settleUncollectedJob(old)).toHaveProperty('reminder')
  expect(settleUncollectedJob(old)).not.toHaveProperty('blocker')
  expect(row.jobs).toContainEqual(expect.objectContaining({ id: fresh.id, availability: 'live', delivery: 'pending' }))
})

it('reads legacy fork journal namespaced by official V3-to-V4 migration', async () => {
  const legacy = { job: { ...job, id: 'bash-7' }, registryEpoch: 'legacy-epoch', instanceId: 'legacy-instance', terminalResult: 'pending' }
  const migrated = { ...event('plugin:jobs/settled', 1, legacy), ignorable: true }
  const row = await runtime([migrated], registryOf([])).host.executionFacts(owner, 'runtime', 'retired')
  expect(row.jobs).toEqual([expect.objectContaining({ id: 'bash-7', registryEpoch: 'legacy-epoch', availability: 'lost', delivery: 'unknown' })])
  expect(settleUncollectedJob(row.jobs[0]!)).toHaveProperty('reminder')
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
  const row = await runtime([registered(), settled(), request, { ...response, sourceEventSeqs: [request.seq] }, receipt(5, request.seq, response.seq)], registryOf()).host.executionFacts(owner, 'runtime', 'current')
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
