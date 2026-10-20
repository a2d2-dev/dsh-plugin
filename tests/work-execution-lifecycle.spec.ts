import { stat } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import type { WorkResult } from '../src/work.ts'
import { ExecutionFixtures } from './work-execution-fixture.ts'

function barrier() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

it('settles a real lost-receipt command before cleanup and blocks recovery after cancellation', async () => {
  const cancellation = new AbortController()
  const fixtures = new ExecutionFixtures(cancellation.signal)
  const path = await fixtures.root()
  const h = await fixtures.mount(path)
  const operator = { operator: true }
  const project = await h.app.execute({ type: 'project.create', commandId: 'project', name: 'Lifecycle',
    resource: { runtimeId: 'runtime', workspaceId: h.workspace.id } }, operator)
  if (project.status !== 'completed' || !project.project) throw new Error('Missing project')
  const task = await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.project.id,
    title: 'Cleanup', goal: 'Keep accepted writes alive until settled', specification: 'Close after the receipt is recorded', acceptance: ['No write after removal'] }, operator)
  if (task.status !== 'completed' || !task.task) throw new Error('Missing task')
  const ref = { projectId: project.project.id, taskId: task.task.id }
  let receiptAtDisposal: WorkResult | undefined
  h.ctx.effect(() => async () => {
    receiptAtDisposal = await new WorkApplication(h.app.directory, h.host).query({ type: 'task.execution', ref }, operator)
  })
  const reached = barrier()
  const release = barrier()
  const controller = h.ctx.sessionController
  const create = controller.create.bind(controller)
  // Fault injection holds a real public Controller create+flush; it supplies no fake host result.
  controller.create = async request => {
    const result = await create(request)
    await h.ctx.sessions.flush(h.ctx.agents.get(result.sessionId)!.session)
    reached.release()
    await release.promise
    throw new Error('Actual host created and flushed; client receipt lost')
  }
  let recovered = false
  const continuation = (async () => {
    await h.app.execute({ type: 'task.start', commandId: 'lost-receipt', ref, expectedVersion: 1,
      resource: { runtimeId: 'runtime', workspaceId: h.workspace.id }, agentId: project.project.defaultAgentId,
      agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
    await fixtures.dispose(h.ctx)
    const restored = await fixtures.mount(path)
    recovered = true
    await restored.app.execute({ type: 'project.create', commandId: 'after-recovery', name: 'Late stage' }, operator)
  })().then(() => undefined, error => error as Error)
  let cleanup: Promise<unknown> | undefined
  try {
    await reached.promise
    cancellation.abort(new Error('Test cancelled'))
    cleanup = fixtures.close().then(() => 'removed', error => error)
    await expect(h.app.execute({ type: 'project.create', commandId: 'after-close', name: 'Must not start' }, operator)).rejects.toThrow('Execution fixture is closing')
    await expect(stat(path)).resolves.toBeDefined()
    release.release()
    expect(await continuation).toMatchObject({ message: 'Execution fixture is closing' })
    expect(await cleanup).toBe('removed')
    expect(receiptAtDisposal).toMatchObject({ status: 'completed', execution: { state: 'failed', error: { code: 'host-create-unknown' } } })
    expect(recovered).toBe(false)
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fixtures.mount(path)).rejects.toThrow('Execution fixture is closing')
  } finally {
    release.release()
    await continuation
    await cleanup
    await fixtures.close()
  }
})
