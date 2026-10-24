import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installWorkTools, installWorkControlRecovery } from '../src/work-execution/tools.ts'

import { ExecutionFixtures } from './work-execution-fixture.ts'
let fixtures: ExecutionFixtures
const operator = { operator: true }
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())
async function setup(permissionPreset = 'workspace-write') {
  const directory = await fixtures.root()
  const h = await fixtures.mount(directory, permissionPreset)
  const app = h.app
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const p = await app.execute({ type: 'project.create', commandId: 'project', name: 'Coordination', resource }, operator)
  if (p.status !== 'completed' || !p.project) throw new Error('Missing project')
  const t = await app.execute({ type: 'task.create', commandId: 'task', projectId: p.project.id, title: 'First', goal: 'One owner', specification: 'Persist execution before host effects', acceptance: ['No double owner'] }, operator)
  if (t.status !== 'completed' || !t.task) throw new Error('Missing task')
  return { ...h, directory: app.directory, app, resource, ref: { projectId: p.project.id, taskId: t.task.id }, agentId: p.project.defaultAgentId }
}
it.each(['wait', 'pause'] as const)('accepts a real model self-%s before applying it at the settled maintenance boundary', async action => {
  const h = await setup()
  installWorkTools(h.ctx, h.app, 'runtime')
  installWorkControlRecovery(h.ctx, h.app)
  h.model.nextTool = { name: 'work_control', arguments: { action, text: 'Which acceptance decision should I use?' } }
  const started = await h.app.execute({ type: 'task.start', commandId: 'tool-wait', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  if (started.status !== 'completed' || !started.execution) throw new Error(JSON.stringify(started))
  const agent = h.ctx.agents.get(SessionId(started.execution.session.sessionId))!
  await fixtures.run(() => agent.whenIdle())
  await vi.waitFor(async () => expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({
    status: 'completed', execution: { state: action === 'wait' ? 'waiting' : 'paused', control: { action, status: 'applied', reason: 'Which acceptance decision should I use?' } },
  }), { timeout: 5000 })
  expect(h.model.requests).toHaveLength(2)
  const inspection = await fixtures.run(() => h.ctx.sessionController.inspect(agent.id))
  expect(JSON.stringify(inspection.events.filter(item => item.type === 'tool/result'))).toContain('accepted')
  expect(inspection.events.filter(item => item.type === 'tool/result')).toEqual([expect.objectContaining({ data: expect.objectContaining({ message: expect.objectContaining({ isError: false }) }) })])
  expect(inspection.events.filter(item => item.type === 'turn/end')).toEqual([expect.objectContaining({ data: { turn: 1, reason: { kind: 'completed' } } })])
  const native = createUserMessage({ content: [{ type: 'text', text: 'Explain the current state without resuming automatic work' }], source: { kind: 'user' } })
  agent.followup(native)
  await fixtures.run(() => agent.whenIdle())
  expect(h.model.requests).toHaveLength(3)
  expect(h.model.requests[2]!.messages).toEqual(expect.arrayContaining([expect.objectContaining({ id: native.id, content: native.content })]))
  expect(agent.session.snapshotEvents()).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'user/message', data: expect.objectContaining({ id: native.id }) })]))
  const fence = { ref: h.ref, executionId: started.execution.id, owner: started.execution.owner, epoch: started.execution.epoch }
  expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { state: action === 'wait' ? 'waiting' : 'paused', epoch: 1 } })
  expect(await h.app.execute({ type: 'task.control', commandId: 'resume-tool-wait', ...fence, action: 'resume', text: 'Use the accepted answer' }, operator)).toMatchObject({ status: 'completed', execution: { control: { action: 'resume' } } })
  await vi.waitFor(async () => expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { state: 'ready', control: { action: 'resume', status: 'applied' } } }))
  await fixtures.run(() => agent.whenIdle())
  expect(h.model.requests).toHaveLength(3)
})

it('resolves real tool identity on the server and refuses foreign or absent calling Sessions', async () => {
  const h = await setup()
  installWorkTools(h.ctx, h.app, 'runtime')
  const started = await h.app.execute({ type: 'task.start', commandId: 'tool-identity', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  if (started.status !== 'completed' || !started.execution) throw new Error(JSON.stringify(started))
  const agent = h.ctx.agents.get(SessionId(started.execution.session.sessionId))!
  await fixtures.run(() => agent.whenIdle())
  const execute = (id: string, args: Record<string, unknown>, caller?: typeof agent) => fixtures.run(() => h.ctx.tools.execute({
    callId: ToolCallId(id), name: 'work_control', arguments: args, agent: caller, signal: new AbortController().signal,
  }))
  expect(await execute('own-progress', { action: 'progress', text: 'Concrete accepted work' }, agent)).toMatchObject({ isError: false })
  expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { progress: 'Concrete accepted work' } })
  const stale = await execute('stale-progress', { action: 'progress', text: 'Stale progress', expected_epoch: 2 }, agent)
  expect(JSON.stringify(stale)).toContain('stale-execution-authority')
  expect(await execute('own-status', { action: 'status' }, agent)).toMatchObject({ isError: false, content: [expect.objectContaining({ text: expect.stringContaining('"coordinator":true') })] })
  const foreign = await fixtures.run(() => h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' }))
  const other = h.ctx.agents.get(foreign.sessionId)!
  const denied = await execute('foreign-progress', { action: 'progress', text: 'Forged work' }, other)
  expect(JSON.stringify(denied)).toContain('forbidden')
  const forged = await execute('forged-owner', { action: 'progress', text: 'Forged owner', actor: { operator: true }, owner: started.execution.owner, epoch: started.execution.epoch }, other)
  expect(JSON.stringify(forged)).not.toContain('"progress":"Forged owner"')
  expect(await execute('absent-agent', { action: 'status' })).toMatchObject({ isError: true })
  expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { progress: 'Concrete accepted work', owner: started.execution.owner, epoch: 1 } })
  expect(h.model.requests).toHaveLength(1)
})

it('recovers a real tool accepted intent after Context loss before the settled recovery consumer runs', async () => {
  const h = await setup()
  // The optional consumer is absent at this receipt window; the actual tool,
  // loop, persistence and base admission fences remain mounted.
  installWorkTools(h.ctx, h.app, 'runtime')
  h.model.nextTool = { name: 'work_control', arguments: { action: 'pause', text: 'Preserve this explicit pause across restart' } }
  const started = await h.app.execute({ type: 'task.start', commandId: 'accepted-before-restart', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  if (started.status !== 'completed' || !started.execution) throw new Error(JSON.stringify(started))
  await fixtures.run(() => h.ctx.agents.get(SessionId(started.execution!.session.sessionId))!.whenIdle())
  const accepted = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  expect(accepted).toMatchObject({ execution: { control: { action: 'pause', status: 'accepted' } } })
  if (accepted.status !== 'completed' || !accepted.execution) throw new Error('No persisted intent')
  const commandId = accepted.execution.control!.commandId
  await fixtures.dispose(h.ctx)
  const restored = await fixtures.mount(h.workspace.path)
  installWorkControlRecovery(restored.ctx, restored.app)
  await vi.waitFor(async () => expect(await restored.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: {
    id: started.execution!.id, owner: started.execution!.owner, epoch: 1, session: started.execution!.session,
    state: 'paused', control: { commandId, action: 'pause', status: 'applied' },
  } }))
  expect(await fixtures.run(() => restored.ctx.sessionPersistence.list())).toHaveLength(1)
  expect(h.model.requests).toHaveLength(2)
  expect(restored.model.requests).toHaveLength(0)
})

it('durably accepts one execution for competing starts and command replay without claiming it has run', async () => {
  const { directory, app, ref, agentId, resource, host, ctx, model } = await setup()
  const command = { type: 'task.start', commandId: 'start-one', ref, expectedVersion: 1, resource,
    agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }
  const results = await Promise.all([app.execute(command, operator), fixtures.application(directory, host).execute({ ...command, commandId: 'start-two' }, operator)])
  expect(results).toEqual([expect.objectContaining({ status: 'completed', execution: expect.objectContaining({ state: expect.stringMatching(/^(accepted|creating|ready)$/), epoch: 1, agentId, ref }) }), expect.objectContaining({ status: 'completed', execution: expect.objectContaining({ state: expect.stringMatching(/^(accepted|creating|ready)$/), epoch: 1, agentId, ref }) })])
  const one = results[0] as any
  expect((results[1] as any).execution.id).toBe(one.execution.id)
  const agent = ctx.agents.get(one.execution.session.sessionId)!
  await fixtures.run(() => agent.whenIdle())
  expect(model.requests).toHaveLength(1)
  expect(model.requests[0]!.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'user', content: expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('Persist execution before host effects') })]) })]))
  const replay = await fixtures.application(directory, host).execute(command, operator)
  expect(replay).toMatchObject({ status: 'completed', execution: { id: one.execution.id, owner: one.execution.owner, epoch: 1 } })
  await fixtures.run(() => agent.whenIdle())
  expect(model.requests).toHaveLength(1)
  expect(await app.query({ type: 'task.execution', ref }, operator)).toMatchObject({ status: 'completed', execution: { id: one.execution.id, state: 'ready', owner: one.execution.owner } })
})

it('runs on the selected local model, waits without empty turns, and separates consumption from acceptance', async () => {
  const h = await setup()
  const before = h.ctx.agentDefaultModel.currentSelection()
  const defaultSaves = vi.spyOn(h.ctx.agentDefaultModel, 'saveSelection')
  const started = await h.app.execute({ type: 'task.start', commandId: 'run', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  expect(started).toMatchObject({ status: 'completed', execution: { state: 'ready' } })
  if (started.status !== 'completed' || !started.execution) throw new Error('No execution')
  const execution = started.execution
  const fence = { ref: h.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }
  expect(started.execution.events).toMatchObject([{ id: `kickoff:${execution.id}`, delivery: expect.stringMatching(/delivered|consumed/), acceptance: 'unassessed' }])
  const agent = await fixtures.run(() => h.ctx.sessionController.resolveAgent(execution.session.sessionId as never))
  if ('error' in agent) throw new Error('No Agent')
  await fixtures.run(() => agent.agent.whenIdle())
  expect(h.model.requests).toHaveLength(1)
  expect(h.model.requests[0]).toMatchObject({ provider: 'contract', model: 'selected' })
  expect(agent.agent.session.requestHeader()?.config).toMatchObject({ provider: 'contract', model: 'selected' })
  expect(JSON.stringify(h.model.requests[0]!.messages.find(message => message.role === 'system'))).toContain('Effective route contract/selected')
  expect(await fixtures.run(() => h.ctx.sessionController.projections({ sessionId: agent.agent.id }, new AbortController().signal))).toMatchObject({ values: { modelSelection: { lastUsed: { provider: 'contract', model: 'selected' }, next: { provider: 'contract', model: 'selected' } } } })
  expect(h.ctx.agentDefaultModel.currentSelection()).toEqual(before)
  expect(defaultSaves).not.toHaveBeenCalled()
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

it.each(['header', 'selection', 'resolve', 'kickoff'] as const)('recovers fixed execution after the real %s checkpoint receipt is lost', async checkpoint => {
  let h = await setup()
  const path = h.workspace.path
  const command = { type: 'task.start', commandId: 'lost-receipt', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }
  if (checkpoint === 'kickoff') {
    const deliver = h.host.execution.deliver.bind(h.host.execution)
    vi.spyOn(h.host.execution, 'deliver').mockImplementationOnce(async (execution, event) => {
      await deliver(execution, event)
      await fixtures.run(() => h.ctx.agents.get(execution.session.sessionId as never)!.whenIdle())
      throw new Error('Real kickoff was consumed; its application receipt was lost')
    })
  } else if (checkpoint === 'resolve') {
    const resolve = h.ctx.sessionController.resolveAgent.bind(h.ctx.sessionController)
    vi.spyOn(h.ctx.sessionController, 'resolveAgent').mockImplementationOnce(async id => {
      const result = await resolve(id)
      if ('error' in result) throw new Error(result.error.message)
      await fixtures.run(() => h.ctx.sessions.flush(result.agent.session))
      throw new Error('Actual host restored and flushed; client receipt lost')
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
  expect(h.model.requests).toHaveLength(checkpoint === 'kickoff' ? 1 : 0)
  await fixtures.dispose(h.ctx)
  const restored = await fixtures.mount(path)
  const result = await restored.app.execute(command, operator)
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'completed', execution: { id, session, state: 'ready', owner: lost.execution.owner, epoch: 1 } })
  expect(await fixtures.run(() => restored.ctx.sessionPersistence.list())).toHaveLength(1)
  if (result.status !== 'completed' || !result.execution) throw new Error('No restored execution')
  expect(result.execution.events[0]!.id).toBe(`kickoff:${id}`)
  const agent = restored.ctx.agents.get(session.sessionId as never)!
  await fixtures.run(() => agent.whenIdle())
  expect([...h.model.requests, ...restored.model.requests]).toHaveLength(1)
  expect([...h.model.requests, ...restored.model.requests][0]).toMatchObject({ model: 'selected' })
  await restored.app.execute(command, operator)
  await fixtures.run(() => agent.whenIdle())
  expect([...h.model.requests, ...restored.model.requests]).toHaveLength(1)
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

it('offers allowed host execution choices and rejects arbitrary model or permission before saving an execution', async () => {
  const h = await setup()
  const choices = await h.app.query({ type: 'task.execution-options', ref: h.ref }, operator)
  expect(choices, JSON.stringify(choices)).toMatchObject({ status: 'completed', executionOptions: {
    agentId: h.agentId, resources: [expect.objectContaining({ ref: h.resource })],
    agentPresets: ['contract'], permissionPresets: expect.arrayContaining(['workspace-write', 'read-only', 'danger-full-access']),
    models: expect.arrayContaining([{ provider: 'contract', model: 'selected' }]),
    defaults: { agentPreset: 'contract', permissionPreset: 'workspace-write', model: { provider: 'contract', model: 'default' } },
  } })
  const command = { type: 'task.start', commandId: 'invalid-model', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'invented' }, permissionPreset: 'workspace-write' }
  expect(await h.app.execute(command, operator)).toMatchObject({ status: 'failed', error: { code: 'unavailable-model' } })
  expect(await h.app.execute({ ...command, commandId: 'raised-permission', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'invented-preset' }, operator)).toMatchObject({ status: 'failed', error: { code: 'invalid-permission-preset' } })
  const unstarted = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  expect(unstarted).toMatchObject({ status: 'completed', executionGraph: { ref: h.ref, settlement: 'unknown' } })
  expect(unstarted).not.toHaveProperty('execution')
  expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(0)
  expect(h.model.requests).toHaveLength(0)
})

it('composes a real preset read tool against the selected workspace rather than the host default cwd', async () => {
  const h = await setup()
  const selected = join(h.workspace.path, 'selected-resource')
  await fixtures.run(() => mkdir(selected))
  await fixtures.run(() => writeFile(join(selected, 'acceptance.txt'), 'REAL_SELECTED_RESOURCE_122'))
  await fixtures.run(() => writeFile(join(h.workspace.path, 'acceptance.txt'), 'WRONG_HOST_DEFAULT_RESOURCE'))
  const workspace = await fixtures.run(() => h.ctx.workspaceRegistry.create(selected))
  const resource = { runtimeId: 'runtime', workspaceId: workspace.id }
  await h.app.execute({ type: 'project.attach-resource', commandId: 'resource', projectId: h.ref.projectId, expectedVersion: 1, resource }, operator)
  h.model.nextTool = { name: 'read', arguments: { file_path: 'acceptance.txt' } }
  const started = await h.app.execute({ type: 'task.start', commandId: 'read-selected', ref: h.ref, expectedVersion: 1, resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  expect(started, JSON.stringify(started)).toMatchObject({ status: 'completed', execution: { actual: { cwd: selected, agentPreset: 'contract', provider: 'contract', model: 'selected', permissionPreset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' } } })
  if (started.status !== 'completed' || !started.execution) throw new Error('No execution')
  const id = SessionId(started.execution.session.sessionId)
  const agent = h.ctx.agents.get(id)!
  await fixtures.run(() => agent.whenIdle())
  expect(h.ctx.agentPresets.composedPreset(agent.ctx)).toBe('contract')
  expect(h.model.requests[0]!.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining(['read', 'write', 'edit']))
  const inspection = await fixtures.run(() => h.ctx.sessionController.inspect(id))
  const results = inspection.events.filter(event => event.type === 'tool/result')
  expect(JSON.stringify(results)).toContain('REAL_SELECTED_RESOURCE_122')
  expect(JSON.stringify(results)).not.toContain('WRONG_HOST_DEFAULT_RESOURCE')
  expect(h.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'contract', model: 'default' })
})

it('refuses legacy mapped work and a host without execution capabilities before creating any Session', async () => {
  const h = await setup()
  await h.app.execute({ type: 'legacy.map', commandId: 'legacy-address', ref: h.ref, expectedVersion: 1,
    address: { runtimeId: 'runtime', projectRoot: h.workspace.path, taskId: 'issue-122' } }, operator)
  const command = { type: 'task.start', commandId: 'legacy-start', ref: h.ref, expectedVersion: 2, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }
  expect(await h.app.execute(command, operator)).toMatchObject({ status: 'failed', error: { code: 'legacy-authority-retained' } })
  const readOnlyHost = { resources: h.host.resources.bind(h.host), sessions: h.host.sessions.bind(h.host) }
  expect(await fixtures.application(h.directory, readOnlyHost).execute(command, operator)).toMatchObject({ status: 'failed', error: { code: 'host-capability-unavailable' } })
  expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(0)
  expect(h.model.requests).toHaveLength(0)
})

it('enforces read-only through the real filesystem tool without claiming OS shell containment', async () => {
  const h = await setup('read-only')
  h.model.nextTool = { name: 'write', arguments: { file_path: 'forbidden.txt', content: 'must not be written' } }
  const started = await h.app.execute({ type: 'task.start', commandId: 'readonly', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'read-only' }, operator)
  expect(started, JSON.stringify(started)).toMatchObject({ status: 'completed', execution: { actual: { permissionPreset: 'read-only', sandbox: 'read-only', approval: 'never' } } })
  if (started.status !== 'completed' || !started.execution) throw new Error('No execution')
  const agent = h.ctx.agents.get(SessionId(started.execution.session.sessionId))!
  await fixtures.run(() => agent.whenIdle())
  const inspection = await fixtures.run(() => h.ctx.sessionController.inspect(agent.id))
  expect(inspection.events.some(event => event.type === 'tool/result' && event.data.message.isError), JSON.stringify({ requests: h.model.requests.length, events: inspection.events.filter(event => ['tool/call', 'tool/result', 'turn/end'].includes(event.type)) })).toBe(true)
  const fs = await import('node:fs/promises')
  await expect(fs.stat(join(h.workspace.path, 'forbidden.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(h.ctx.sandboxPolicy.resolve({ session: agent.session }).mode).toBe('read-only')
  expect(h.ctx.approval.overrideOf(agent.session)).toBe('never')
})

it('keeps a paused Task paused after cold restore while native conversations remain usable', async () => {
  const h = await setup()
  const started = await h.app.execute({ type: 'task.start', commandId: 'cold-control', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  if (started.status !== 'completed' || !started.execution) throw new Error('No execution')
  const execution = started.execution
  await fixtures.run(() => h.ctx.agents.get(SessionId(execution.session.sessionId))!.whenIdle())
  const fence = { ref: h.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }
  await h.app.execute({ type: 'task.control', commandId: 'cold-pause', ...fence, action: 'pause', text: 'Keep user pause across restart' }, operator)
  await fixtures.dispose(h.ctx)
  const cold = await fixtures.mount(h.workspace.path)
  const resolved = await fixtures.run(() => cold.ctx.sessionController.resolveAgent(SessionId(execution.session.sessionId)))
  if ('error' in resolved) throw new Error('No restored Agent')
  resolved.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Native input while paused' }], source: { kind: 'user' } }))
  await fixtures.run(() => resolved.agent.whenIdle())
  expect(cold.model.requests).toHaveLength(1)
  expect(await cold.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ status: 'completed', execution: { state: 'paused' }, executionRuntime: 'idle' })
  const resumed = await cold.app.execute({ type: 'task.control', commandId: 'cold-resume', ...fence, action: 'resume', text: 'Explicitly process pending native input' }, operator)
  expect(resumed, JSON.stringify(resumed)).toMatchObject({ status: 'completed', execution: { state: 'ready' } })
  await fixtures.run(() => resolved.agent.whenIdle())
  expect(cold.model.requests, JSON.stringify({ inbox: { nextTurn: resolved.agent.inbox.nextTurn, nextStep: resolved.agent.inbox.nextStep }, events: (await fixtures.run(() => cold.ctx.sessionController.inspect(resolved.agent.id))).events.slice(-8) })).toHaveLength(1)
})

it('recovers legacy buffered human content once on the next human turn without resuming the Task', async () => {
  const h = await setup()
  const started = await h.app.execute({ type: 'task.start', commandId: 'legacy-buffer', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  if (started.status !== 'completed' || !started.execution) throw new Error('No execution')
  const execution = started.execution
  await fixtures.run(() => h.ctx.agents.get(SessionId(execution.session.sessionId))!.whenIdle())
  await h.app.execute({ type: 'task.control', commandId: 'legacy-wait', ref: h.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch, action: 'wait', text: 'External dependency' }, operator)
  await fixtures.dispose(h.ctx)
  const original = createUserMessage({ content: [{ type: 'text', text: 'Saved question\nwith original whitespace' }, { type: 'image', attachment: { attachmentId: 'a'.repeat(64) as import('@deepseek-ai/dsh-llm').ImageBlock['attachment']['attachmentId'], mediaType: 'image/png', bytes: 8, width: 1, height: 1, name: 'fixture.png' } }], source: { kind: 'user' } })
  // Seed the released legacy representation reproduced in the affected Sessions.
  const file = join(h.directory, 'work-v3.json')
  const stored = JSON.parse(await readFile(file, 'utf8'))
  stored.executions[0].events.push({ id: original.id, text: 'Saved question', kind: 'input', delivery: 'accepted', acceptance: 'unassessed', nativeMessage: original })
  await writeFile(file, JSON.stringify(stored))
  const cold = await fixtures.mount(h.workspace.path)
  const resolved = await fixtures.run(() => cold.ctx.sessionController.resolveAgent(SessionId(execution.session.sessionId)))
  if ('error' in resolved) throw new Error('No restored Agent')
  expect(cold.model.requests).toHaveLength(0)
  for (const text of ['Please answer my saved question', 'Thanks']) {
    resolved.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await fixtures.run(() => resolved.agent.whenIdle())
  }
  expect(cold.model.requests).toHaveLength(2)
  expect(cold.model.requests[0]!.messages).toEqual(expect.arrayContaining([expect.objectContaining({ id: original.id, content: original.content })]))
  expect(resolved.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.id === original.id)).toHaveLength(1)
  expect(await cold.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { state: 'waiting', owner: execution.owner, epoch: execution.epoch, session: execution.session } })
})

it('explicitly reuses a compatible nonempty related Session while review association never grants coordination', async () => {
  const h = await setup()
  const id = SessionId('prior-conversation')
  await fixtures.run(() => h.ctx.sessionController.create({ sessionId: id, workspaceId: h.workspace.id, agentPreset: 'contract' }))
  const agent = h.ctx.agents.get(id)!
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Prior real conversation' }], source: { kind: 'user' } }))
  await fixtures.run(() => agent.whenIdle())
  const before = await fixtures.run(() => h.ctx.sessionController.inspect(id))
  const command = { type: 'task.start', commandId: 'reuse-existing', ref: h.ref, expectedVersion: 2, resource: h.resource,
    session: { runtimeId: 'runtime', sessionId: id }, agentId: h.agentId,
    agentPreset: 'contract', model: { provider: 'contract', model: 'default' }, permissionPreset: 'workspace-write' }
  await h.app.execute({ type: 'task.associate-session', commandId: 'related', ref: h.ref, expectedVersion: 1, session: command.session, purpose: 'related' }, operator)
  const associated = await fixtures.run(() => h.ctx.sessionController.inspect(id))
  expect(associated.meta).toEqual(before.meta)
  expect(associated.events.slice(0, before.events.length)).toEqual(before.events)
  expect(associated.events.slice(before.events.length)).toMatchObject([{ type: 'session/title', data: { title: `T:${h.ref.taskId.replaceAll('-', '').slice(0, 8)} · 关联 1 · First` } }])
  expect(await h.app.execute({ ...command, commandId: 'mismatched-model', model: { provider: 'contract', model: 'selected' } }, operator)).toMatchObject({ status: 'failed', error: { code: 'incompatible-session' } })
  expect(await fixtures.run(() => h.ctx.sessionController.inspect(id))).toEqual(associated)
  const result = await h.app.execute(command, operator)
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'completed', execution: { session: command.session, sessionMode: 'reuse', actual: { model: 'default' } } })
  await fixtures.run(() => agent.whenIdle())
  const after = await fixtures.run(() => h.ctx.sessionController.inspect(id))
  expect(after.events.slice(0, before.events.length)).toEqual(before.events)
  expect(after.meta).toEqual(before.meta)
  expect(h.model.requests).toHaveLength(2)
  const review = await fixtures.run(() => h.ctx.sessionController.create({ sessionId: SessionId('review-only'), workspaceId: h.workspace.id, agentPreset: 'contract' }))
  const task = await h.app.execute({ type: 'task.create', commandId: 'review-task', projectId: h.ref.projectId, title: 'Review', goal: 'Observe', specification: 'No coordination', acceptance: ['Never own'] }, operator)
  if (task.status !== 'completed' || !task.task) throw new Error('No task')
  const ref = { ...h.ref, taskId: task.task.id }
  const session = { runtimeId: 'runtime', sessionId: review.sessionId }
  await h.app.execute({ type: 'task.associate-session', commandId: 'review', ref, expectedVersion: 1, session, purpose: 'review' }, operator)
  expect(await h.app.execute({ ...command, commandId: 'review-start', ref, session }, operator)).toMatchObject({ status: 'failed', error: { code: 'association-only-session' } })
})

it('keeps an actual unmigrated legacy main Session under its existing writer authority', async () => {
  const h = await setup()
  const id = SessionId('legacy-active')
  await fixtures.run(() => h.ctx.sessionController.create({ sessionId: id, workspaceId: h.workspace.id, agentPreset: 'contract' }))
  await fixtures.run(() => h.ctx.a2d2.bindMainSession({ cwd: h.workspace.path, issue: 122, mainSession: id, now: new Date() }))
  expect(await h.app.execute({ type: 'task.start', commandId: 'legacy-session', ref: h.ref, expectedVersion: 1, resource: h.resource,
    session: { runtimeId: 'runtime', sessionId: id }, agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'default' }, permissionPreset: 'workspace-write' }, operator)).toMatchObject({ status: 'failed', error: { code: 'legacy-authority-retained' } })
  expect((await fixtures.run(() => h.ctx.a2d2.taskOfMainSession(h.workspace.path, id)))?.issue.number).toBe(122)
  const unstarted = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  expect(unstarted).toMatchObject({ status: 'completed', executionGraph: { ref: h.ref, settlement: 'unknown' } })
  expect(unstarted).not.toHaveProperty('execution')
  expect(h.model.requests).toHaveLength(0)
})

it('accepts repeated start and input while real Controller restore is parked without holding the snapshot writer', async () => {
  const h = await setup()
  let entered!: () => void
  let release!: () => void
  const inside = new Promise<void>(resolve => { entered = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  const resolveAgent = h.ctx.sessionController.resolveAgent.bind(h.ctx.sessionController)
  vi.spyOn(h.ctx.sessionController, 'resolveAgent').mockImplementationOnce(async id => { entered(); await held; return resolveAgent(id) })
  const command = { type: 'task.start', commandId: 'slow-start', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }
  const first = h.app.execute(command, operator)
  await inside
  let deadline: ReturnType<typeof setTimeout> | undefined
  const pending: Promise<unknown>[] = []
  try {
    const detail = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
    if (detail.status !== 'completed' || !detail.execution) throw new Error('No accepted execution')
    const execution = detail.execution
    pending.push(fixtures.application(h.directory, h.host).execute(command, operator),
      h.app.execute({ type: 'task.input', commandId: 'during-create', ref: h.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch, text: 'Input accepted during creation', kind: 'input' }, operator))
    const results = await Promise.race([
      Promise.all(pending),
      new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Accepted replay or input waited for the long host effect')), 1500) }),
    ])
    expect(results).toMatchObject([{ status: 'completed', execution: { id: execution.id, state: 'creating' } }, { status: 'completed', execution: { id: execution.id, state: 'creating' } }])
  } finally { if (deadline) clearTimeout(deadline); release(); await first; await Promise.allSettled(pending) }
  expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(1)
})


it('persists original continuation material written by the real source model with server-owned Task references across cold reload', async () => {
  const h = await setup()
  installWorkTools(h.ctx, h.app, 'runtime')
  const content = { body: 'Original source discussion\nPreserve spacing and concrete reasoning.',
    decisions: 'Use the local Task specification as authority.', evidence: 'The Session log records the source material tool call; take/deliver evidence is still missing.',
    unfinished: 'Implement take and delivery recovery.', next: 'Check the latest Task before preparing the successor.' }
  h.model.nextTool = { name: 'work_continuation_material', arguments: content }
  const started = await h.app.execute({ type: 'task.start', commandId: 'write-material', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  if (started.status !== 'completed' || !started.execution) throw new Error(JSON.stringify(started))
  const execution = started.execution
  const agent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
  await fixtures.run(() => agent.whenIdle())
  const observed = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  expect(observed).toMatchObject({ status: 'completed', execution: { continuationMaterial: {
    ...content, ref: h.ref, source: execution.session, executionId: execution.id, epoch: 1, taskVersion: 2, specificationVersion: 1,
  } } })
  const inspection = await fixtures.run(() => h.ctx.sessionController.inspect(agent.id))
  expect(inspection.events.filter(item => item.type === 'tool/result')).toEqual([expect.objectContaining({ data: expect.objectContaining({ message: expect.objectContaining({ isError: false }) }) })])
  expect(JSON.stringify(inspection.events.filter(item => item.type === 'tool/result'))).toContain('continuationMaterial')
  expect(h.model.requests).toHaveLength(2)
  await fixtures.dispose(h.ctx)
  const restored = await fixtures.mount(h.workspace.path)
  if (observed.status !== 'completed' || !observed.execution) throw new Error('No material record')
  expect(await restored.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: observed.execution, executionRuntime: 'inactive' })
  expect(restored.model.requests).toHaveLength(0)
  expect(restored.ctx.agents.get(SessionId(execution.session.sessionId))).toBeUndefined()
})


it('fences continuation material by the real caller and epoch and replays the original receipt without maintenance or another model request', async () => {
  const h = await setup()
  installWorkTools(h.ctx, h.app, 'runtime')
  const started = await h.app.execute({ type: 'task.start', commandId: 'material-authority', ref: h.ref, expectedVersion: 1, resource: h.resource,
    agentId: h.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  if (started.status !== 'completed' || !started.execution) throw new Error(JSON.stringify(started))
  const execution = started.execution
  const agent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
  await fixtures.run(() => agent.whenIdle())
  const content = { body: '  Original text\nwith exact whitespace.  ', decisions: 'Keep the same Task.', evidence: 'The accepted Task is local.', unfinished: 'Five-step recovery remains.', next: 'Prepare from latest specification.' }
  const invoke = (id: string, args: Record<string, unknown>, caller?: typeof agent) => fixtures.run(() => h.ctx.tools.execute({
    callId: ToolCallId(id), name: 'work_continuation_material', arguments: args, agent: caller, signal: new AbortController().signal,
  }))
  const accepted = await invoke('accepted-material', content, agent)
  expect(accepted).toMatchObject({ isError: false })
  expect(JSON.stringify(accepted)).toContain('continuationMaterial')
  const saved = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
  if (saved.status !== 'completed' || !saved.execution?.continuationMaterial) throw new Error('No saved material')
  expect(saved.execution.continuationMaterial).toMatchObject({ ...content, source: execution.session, epoch: 1, taskVersion: 2, specificationVersion: 1 })
  const stale = await invoke('stale-material', { ...content, body: 'Must not overwrite', expected_epoch: 2 }, agent)
  expect(JSON.stringify(stale)).toContain('stale-execution-authority')
  const foreign = await fixtures.run(() => h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' }))
  const other = h.ctx.agents.get(foreign.sessionId)!
  expect(JSON.stringify(await invoke('foreign-material', { ...content, owner: execution.owner, ref: h.ref }, other))).toContain('forbidden')
  expect(await invoke('absent-material', content)).toMatchObject({ isError: true })
  await h.app.execute({ type: 'task.update-spec', commandId: 'new-material-spec', ref: h.ref, expectedVersion: 2,
    goal: 'Latest local objective', specification: 'Read this current specification at prepare time.', acceptance: ['Current Task snapshot'] }, operator)
  expect(await invoke('accepted-material', content, agent)).toEqual(accepted)
  expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { continuationMaterial: saved.execution.continuationMaterial } })
  expect(await invoke('accepted-material', { ...content, body: 'Changed command payload' }, agent)).toMatchObject({ content: [expect.objectContaining({ text: expect.stringContaining('command-id-reused') })] })
  expect(h.model.requests).toHaveLength(1)
})
