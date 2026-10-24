import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { createRootSession } from '../src/root-session.ts'
import { DshWorkExecutionHost } from '../src/work-execution/dsh-host.ts'
import type { WorkExecution } from '../src/work-types.ts'

let fixtures: ExecutionFixtures
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())

it('recovers the exact root identity after its creation receipt is lost without running create again', async () => {
  const h = await fixtures.mount(await fixtures.root(), 'read-only')
  const source = await h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' })
  const id = SessionId('reserved-root-receipt')
  const create = h.ctx.sessionController.create.bind(h.ctx.sessionController)
  const calls = vi.spyOn(h.ctx.sessionController, 'create').mockImplementation(async request => {
    const result = await create(request)
    throw new Error(`Lost receipt for ${result.sessionId}`)
  })
  const request = { source: source.sessionId, sessionId: id, cwd: h.workspace.path, workspaceId: h.workspace.id }
  await expect(createRootSession(h.ctx, request)).rejects.toThrow('Lost receipt')
  calls.mockImplementation(create)
  const recovered = await createRootSession(h.ctx, request)
  expect(recovered.id).toBe(id)
  expect(calls).toHaveBeenCalledTimes(1)
  expect(h.workspace.sessionIds).toContain(id)
  expect(h.ctx.permissionPresets.current(recovered.session)).toBe('read-only')
  expect(await h.ctx.sessionPersistence.list()).toHaveLength(2)
  expect(h.model.requests).toHaveLength(0)
})

it('preserves a started root with different permissions and requires a fresh successor', async () => {
  const h = await fixtures.mount(await fixtures.root(), 'workspace-write')
  const source = await h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' })
  const target = await h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' })
  const parent = h.ctx.agents.get(source.sessionId)!
  h.ctx.permissionPresets.set(parent.session, 'read-only')
  const existing = h.ctx.agents.get(target.sessionId)!
  existing.followup(createUserMessage({ content: [{ type: 'text', text: 'Existing user work' }], source: { kind: 'user' } }))
  await existing.whenIdle()
  await h.ctx.sessions.flush(existing.session)
  const before = await h.ctx.sessionController.inspect(target.sessionId)
  await expect(createRootSession(h.ctx, { source: source.sessionId, sessionId: target.sessionId, cwd: h.workspace.path, workspaceId: h.workspace.id, repairLegacy: true })).rejects.toThrow('already started with different permissions')
  expect((await h.ctx.sessionController.inspect(target.sessionId)).events).toEqual(before.events)
  expect(h.ctx.permissionPresets.current(existing.session)).toBe('workspace-write')
  expect(h.ctx.sandboxPolicy.resolve({ session: existing.session }).mode).toBe('workspace-write')
})

it('rejects a different target workspace before creating a successor', async () => {
  const h = await fixtures.mount(await fixtures.root(), 'read-only')
  const source = await h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' })
  const other = await h.ctx.workspaceRegistry.create(await fixtures.root())
  const create = vi.spyOn(h.ctx.sessionController, 'create')
  await expect(createRootSession(h.ctx, { source: source.sessionId, sessionId: SessionId('wrong-workspace'), cwd: other.path, workspaceId: other.id })).rejects.toThrow('source workspace')
  expect(create).not.toHaveBeenCalled()
  expect(await h.ctx.sessionPersistence.list()).toHaveLength(1)
})

it('resumes a precreated execution at its reserved identity without using blank-session create', async () => {
  const h = await fixtures.mount(await fixtures.root(), 'read-only')
  const id = SessionId('reserved-execution')
  const execution: WorkExecution = { id: 'execution', ref: { projectId: 'project', taskId: 'task' }, agentId: 'agent', owner: 'owner', epoch: 1,
    resource: { runtimeId: 'runtime', workspaceId: h.workspace.id }, session: { runtimeId: 'runtime', sessionId: id }, sessionMode: 'create',
    agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'read-only',
    policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] }, state: 'ready', history: [], events: [] }
  const create = vi.spyOn(h.ctx.sessionController, 'create')
  const host = new DshWorkExecutionHost(h.ctx, 'runtime')
  await host.ensure(execution)
  await host.ensure(execution)
  expect(create).not.toHaveBeenCalled()
  expect((await h.ctx.sessionController.inspect(id)).events.findLast(event => event.type === 'model/selection')?.data).toEqual(execution.model)
  expect(h.workspace.sessionIds).toContain(id)
  expect(await h.ctx.sessionPersistence.list()).toHaveLength(1)
  expect(h.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'contract', model: 'default' })
  expect(h.model.requests).toHaveLength(0)
})
