import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ExecutionFixtures } from './work-execution-fixture.ts'
let fixtures: ExecutionFixtures
const operator = { operator: true }
const resource = { ref: { runtimeId: 'runtime', workspaceId: 'workspace' }, title: 'Actual resource' }
const host = { resources: async () => [resource], sessions: async () => [] }
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())
async function setup() {
  const directory = await fixtures.root()
  const h = await fixtures.mount(directory)
  const app = h.app
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const p = await app.execute({ type: 'project.create', commandId: 'project', name: 'Coordination', resource }, operator)
  if (p.status !== 'completed' || !p.project) throw new Error('Missing project')
  const t = await app.execute({ type: 'task.create', commandId: 'task', projectId: p.project.id, title: 'First', goal: 'One owner', specification: 'Persist execution before host effects', acceptance: ['No double owner'] }, operator)
  if (t.status !== 'completed' || !t.task) throw new Error('Missing task')
  return { ...h, directory: app.directory, app, resource, ref: { projectId: p.project.id, taskId: t.task.id }, agentId: p.project.defaultAgentId }
}
it('durably accepts one execution for competing starts and command replay without claiming it has run', async () => {
  const { directory, app, ref, agentId, resource, host } = await setup()
  const command = { type: 'task.start', commandId: 'start-one', ref, expectedVersion: 1, resource,
    agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }
  const results = await Promise.all([app.execute(command, operator), fixtures.application(directory, host).execute({ ...command, commandId: 'start-two' }, operator)])
  expect(results).toEqual([expect.objectContaining({ status: 'completed', execution: expect.objectContaining({ state: 'ready', epoch: 1, agentId, ref }) }), expect.objectContaining({ status: 'completed', execution: expect.objectContaining({ state: 'ready', epoch: 1, agentId, ref }) })])
  const one = results[0] as any
  expect((results[1] as any).execution.id).toBe(one.execution.id)
  expect(await fixtures.application(directory, host).execute(command, operator)).toEqual(one)
  expect(await app.query({ type: 'task.execution', ref }, operator)).toMatchObject({ status: 'completed', execution: { id: one.execution.id, state: 'ready', owner: one.execution.owner } })
})

it('runs on the selected local model, waits without empty turns, and separates consumption from acceptance', async () => {
  const h = await setup()
  const before = h.ctx.agentDefaultModel.currentSelection()
  const started = await h.app.execute({ type: 'task.start', commandId: 'run', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  expect(started).toMatchObject({ status: 'completed', execution: { state: 'ready' } })
  if (started.status !== 'completed' || !started.execution) throw new Error('No execution')
  const execution = started.execution
  const fence = { ref: h.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }
  expect(await h.app.execute({ type: 'task.input', commandId: 'input', ...fence, text: 'Resolve accepted local work', kind: 'input' }, operator)).toMatchObject({ status: 'completed', execution: { events: [{ delivery: expect.stringMatching(/delivered|consumed/), acceptance: 'unassessed' }] } })
  const agent = await fixtures.run(() => h.ctx.sessionController.resolveAgent(execution.session.sessionId as never))
  if ('error' in agent) throw new Error('No Agent')
  await fixtures.run(() => agent.agent.whenIdle())
  expect(h.model.requests).toHaveLength(1)
  expect(h.model.requests[0]).toMatchObject({ provider: 'contract', model: 'selected' })
  expect(agent.agent.session.requestHeader()?.config).toMatchObject({ provider: 'contract', model: 'selected' })
  expect(h.ctx.agentDefaultModel.currentSelection()).toEqual(before)
  const waited = await h.app.execute({ type: 'task.control', commandId: 'wait', ...fence, action: 'wait', text: 'Need a decision' }, operator)
  expect(waited, JSON.stringify(waited)).toMatchObject({ status: 'completed', execution: { state: 'waiting', control: { status: 'applied' } } })
  expect(await h.app.execute({ type: 'task.reconcile', commandId: 'observe', ...fence }, operator)).toMatchObject({ status: 'completed', execution: { state: 'waiting', events: [{ delivery: 'consumed', acceptance: 'unassessed' }] } })
  expect(h.model.requests).toHaveLength(1)
  const waitingInput = { type: 'task.input', commandId: 'waiting-result', ...fence, text: 'Decision arrived', kind: 'result' }
  expect(await h.app.execute(waitingInput, operator)).toMatchObject({ status: 'completed', execution: { state: 'waiting', events: [expect.anything(), { delivery: 'accepted', acceptance: 'unassessed' }] } })
  expect(h.model.requests).toHaveLength(1)
  expect(await h.app.execute({ type: 'task.control', commandId: 'foreign-actor', ...fence, action: 'progress', text: 'Forged' }, { operator: false, session: { ...execution.session, sessionId: 'other' }, agentId: h.agentId })).toMatchObject({ status: 'failed', error: { code: 'forbidden' } })
  expect(await h.app.execute({ type: 'task.control', commandId: 'own-progress', ...fence, action: 'progress', text: 'Waiting for decision' }, { operator: false, session: execution.session, agentId: h.agentId })).toMatchObject({ status: 'completed', execution: { progress: 'Waiting for decision' } })
  expect(await h.app.execute({ type: 'task.control', commandId: 'stale', ...fence, epoch: 2, action: 'resume', text: 'Invalid epoch' }, operator)).toMatchObject({ status: 'failed', error: { code: 'stale-execution-authority' } })
  expect(await h.app.execute({ type: 'task.control', commandId: 'resume', ...fence, action: 'resume', text: 'Process the accepted decision' }, operator)).toMatchObject({ status: 'completed', execution: { control: { status: 'applied' } } })
  await fixtures.run(() => agent.agent.whenIdle())
  expect(h.model.requests).toHaveLength(2)
  await h.app.execute(waitingInput, operator)
  expect(h.model.requests).toHaveLength(2)
  expect(await h.app.execute({ type: 'task.control', commandId: 'pause', ...fence, action: 'pause', text: 'User paused work' }, operator)).toMatchObject({ status: 'completed', execution: { state: 'paused', control: { status: 'applied' } } })
})

it.each(['header', 'selection', 'controller'] as const)('recovers fixed execution after the real %s checkpoint receipt is lost', async checkpoint => {
  let h = await setup()
  const path = h.workspace.path
  const command = { type: 'task.start', commandId: 'lost-receipt', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }
  if (checkpoint === 'controller') {
    const create = h.ctx.sessionController.create.bind(h.ctx.sessionController)
    vi.spyOn(h.ctx.sessionController, 'create').mockImplementationOnce(async request => {
      const result = await create(request)
      await h.ctx.sessions.flush(h.ctx.agents.get(result.sessionId)!.session)
      throw new Error('Actual host created and flushed; client receipt lost')
    })
  } else {
    const create = h.ctx.sessionPersistence.create.bind(h.ctx.sessionPersistence)
    vi.spyOn(h.ctx.sessionPersistence, 'create').mockImplementationOnce(async header => {
      const handle = await create(header)
      if (checkpoint === 'header') { await handle.flush(); await handle.close(); throw new Error('Durable header receipt lost') }
      const append = handle.append.bind(handle)
      vi.spyOn(handle, 'append').mockImplementationOnce(async events => { await append(events); await handle.flush(); throw new Error('Durable model selection receipt lost') })
      return handle
    })
  }
  const lost = await h.app.execute(command, operator)
  expect(lost).toMatchObject({ status: 'completed', execution: { state: 'failed', error: { code: 'host-create-unknown' } } })
  if (lost.status !== 'completed' || !lost.execution) throw new Error('No retained execution')
  const id = lost.execution.id
  const session = lost.execution.session
  expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(1)
  expect(h.model.requests).toHaveLength(0)
  await fixtures.dispose(h.ctx)
  const restored = await fixtures.mount(path)
  const result = await restored.app.execute(command, operator)
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'completed', execution: { id, session, state: 'ready', owner: lost.execution.owner, epoch: 1 } })
  expect(await fixtures.run(() => restored.ctx.sessionPersistence.list())).toHaveLength(1)
  expect(restored.model.requests).toHaveLength(0)
  if (result.status !== 'completed' || !result.execution) throw new Error('No restored execution')
  await restored.app.execute({ type: 'task.input', commandId: 'after-recovery', ref: h.ref, executionId: id,
    owner: result.execution.owner, epoch: 1, text: 'Continue the same accepted work', kind: 'input' }, operator)
  const agent = restored.ctx.agents.get(session.sessionId as never)!
  await fixtures.run(() => agent.whenIdle())
  expect(restored.model.requests).toHaveLength(1)
  expect(restored.model.requests[0]).toMatchObject({ model: 'selected' })
  expect(restored.ctx.agentDefaultModel.currentSelection()).toMatchObject({ model: 'default' })
})

it('allows one Task to coordinate a compatible reused Session while rejecting the competing Task atomically', async () => {
  const h = await setup()
  const session = await fixtures.run(() => h.ctx.sessionController.create({ sessionId: 'reused-coordinator' as never, workspaceId: h.workspace.id, agentPreset: 'contract' }))
  const second = await h.app.execute({ type: 'task.create', commandId: 'second', projectId: h.ref.projectId,
    title: 'Second', goal: 'Never mix tasks', specification: 'One Session one execution', acceptance: ['Only one owner'] }, operator)
  if (second.status !== 'completed' || !second.task) throw new Error('Missing second task')
  const command = { type: 'task.start', commandId: 'reuse-one', ref: h.ref, expectedVersion: 1, resource: h.resource,
    session: { runtimeId: 'runtime', sessionId: session.sessionId }, agentId: h.agentId,
    agentPreset: 'contract', model: { provider: 'contract', model: 'default' }, permissionPreset: 'workspace-write' }
  const results = await Promise.all([h.app.execute(command, operator), fixtures.application(h.directory, h.host).execute({ ...command, commandId: 'reuse-two', ref: { ...h.ref, taskId: second.task.id } }, operator)])
  expect(results.filter(value => value.status === 'completed')).toHaveLength(1)
  expect(results.filter(value => value.status === 'failed')).toMatchObject([{ error: { code: 'session-in-use' } }])
  expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(1)
})
