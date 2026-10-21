import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { observeJobs } from '../src/work-execution/job-observation.ts'
import type { PublicJobObservation } from '../src/work-execution/job-observation.ts'

it('keeps a lost uncollected registry instance separate from the same id after restart', () => {
  const old: PublicJobObservation = { job: { id: 'bash-1', owner: 'owner', kind: 'bash', label: 'old checks', status: 'completed' }, registryEpoch: 'boot-old', instanceId: 'old-instance', terminalResult: 'pending' }
  const current: PublicJobObservation = { job: { ...old.job, label: 'new checks' }, registryEpoch: 'boot-new', instanceId: 'new-instance', terminalResult: 'collected' }
  const facts = observeJobs({ list: () => [current.job], observe: () => current }, SessionId('owner'), 'runtime', [old])
  expect(facts.jobs).toEqual([
    expect.objectContaining({ id: 'bash-1', registryEpoch: 'boot-old', instanceId: 'old-instance', availability: 'lost', delivery: 'unknown', result: 'unknown' }),
    expect.objectContaining({ id: 'bash-1', registryEpoch: 'boot-new', instanceId: 'new-instance', availability: 'live', delivery: 'delivered', result: 'unknown' }),
  ])
})
