import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { DshWorkExecutionHost } from '../src/work-execution/dsh-host.ts'
import type { ExecutionObservation, ObservedSession } from '../src/work-execution/observation.ts'
import type { WorkExecution } from '../src/work-types.ts'

it('stops exact root/native-child owners and running jobs while retaining terminal unconsumed results', async () => {
  const root = { runtimeId: 'runtime', sessionId: 'root' }, child = { ...root, sessionId: 'child' }, other = { ...root, sessionId: 'unrelated' }
  const job = { id: 'bash-1', owner: child, kind: 'bash', label: 'long work', status: 'running' as const, result: 'pending' as const, delivery: 'pending' as const, acceptance: 'unassessed' as const, persistence: 'process-local' as const, availability: 'live' as const }
  const rows: ObservedSession[] = [
    { session: root, role: 'current', status: 'running', children: [{ session: child, mode: 'continuable', status: 'running', result: 'pending', returned: false }], jobs: [] },
    { session: child, parent: root, role: 'native-child', status: 'running', children: [], jobs: [job] },
    { session: other, role: 'review', status: 'running', children: [], jobs: [] },
    { session: { ...root, sessionId: 'review-child' }, parent: other, role: 'native-child', status: 'running', children: [], jobs: [] },
  ]
  const agents = new Map(rows.map(row => [row.session.sessionId, {
    get status() { return row.status },
    cancel: vi.fn(() => { row.status = 'idle' }),
    whenIdle: vi.fn(async () => { expect(row.status).toBe('idle') }),
    runMaintenance: vi.fn(async (body: () => Promise<void>) => body()),
  }]))
  const kill = vi.fn((id, owner) => { expect(id).toBe(job.id); expect(owner).toBe(child.sessionId); rows[1]!.jobs[0] = { ...job, status: 'killed' } })
  const ctx = { get: (name: string) => name === 'agents' ? { get: (id: string) => agents.get(id) } : name === 'jobs' ? { kill } : undefined } as unknown as Context
  const host = new DshWorkExecutionHost(ctx, 'runtime')
  const flush = vi.spyOn(host.runtime, 'flush').mockResolvedValue()
  const facts: ExecutionObservation = { settlement: 'pending', sessions: rows, blockers: [{ code: 'native-result-pending', session: root }, { code: 'job-unsettled', session: child, jobId: job.id }], reminders: [], limitations: [] }
  vi.spyOn(host, 'observation').mockImplementation(async () => facts)
  await host.end({ session: root } as WorkExecution)
  expect(agents.get('root')!.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
  expect(agents.get('child')!.cancel).toHaveBeenCalledTimes(1)
  expect(agents.get('unrelated')!.cancel).not.toHaveBeenCalled()
  expect(agents.get('review-child')!.cancel).not.toHaveBeenCalled()
  expect(kill).toHaveBeenCalledTimes(1)
  expect(flush).toHaveBeenCalledTimes(2)
  expect(rows[0]!.children[0]!.result).toBe('pending')
  expect(rows[1]!.jobs[0]).toMatchObject({ status: 'killed', result: 'pending', delivery: 'pending', acceptance: 'unassessed' })
})

it('refuses terminal release when a reachable job remains stopping or activity is unknown', async () => {
  const session = { runtimeId: 'runtime', sessionId: 'root' }
  const ctx = { get: (name: string) => name === 'agents' ? { get: () => undefined } : { kill: vi.fn() } } as unknown as Context
  const host = new DshWorkExecutionHost(ctx, 'runtime')
  vi.spyOn(host, 'observation').mockResolvedValue({ settlement: 'pending', sessions: [{ session, role: 'current', status: 'idle', children: [], jobs: [{ id: 'bash-1', owner: session, kind: 'bash', label: 'still stopping', status: 'stopping', result: 'pending', delivery: 'pending', acceptance: 'unassessed', persistence: 'process-local', availability: 'live' }] }], blockers: [], reminders: [], limitations: [] })
  await expect(host.end({ session } as WorkExecution)).rejects.toMatchObject({ code: 'queue-end-unsettled' })
  vi.spyOn(host, 'observation').mockResolvedValue({ settlement: 'unknown', sessions: [], blockers: [{ code: 'executor-state-unknown', session }], reminders: [], limitations: [] })
  await expect(host.end({ session } as WorkExecution)).rejects.toMatchObject({ code: 'queue-end-unsettled' })
})
