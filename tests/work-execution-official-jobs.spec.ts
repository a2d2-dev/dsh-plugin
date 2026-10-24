import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { observeJobs, settleUncollectedJob } from '../src/work-execution/job-observation.ts'

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
