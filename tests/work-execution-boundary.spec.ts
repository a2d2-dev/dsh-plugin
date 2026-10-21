import { afterEach, beforeEach, expect, it } from 'vitest'
import LocalJobs from '@deepseek-ai/dsh-jobs-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { DshWorkExecutionHost } from '../src/work-execution/dsh-host.ts'
import type { WorkExecution } from '../src/work-types.ts'

const executionDefaults = { agentId: 'agent', owner: 'owner', epoch: 2, sessionMode: 'create' as const, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write', policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] }, state: 'ready' as const, history: [], events: [] }

it('flushes and holds associated executors before entering a settled maintenance body', async () => {
  const h = await fixtures.mount(await fixtures.root())
  const create = () => fixtures.run(() => h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' }))
  const current = await create(), review = await create()
  const related = h.ctx.agents.get(review.sessionId)!
  const message = createUserMessage({ content: [{ type: 'text', text: 'Durable related executor decision' }], source: { kind: 'user' } })
  related.session.append('user/message', message, { surfaceOp: 'append' })
  const host = new DshWorkExecutionHost(h.ctx, 'runtime')
  const execution: WorkExecution = { ...executionDefaults, id: 'execution', ref: { projectId: 'project', taskId: 'task' }, session: { runtimeId: 'runtime', sessionId: current.sessionId }, resource: { runtimeId: 'runtime', workspaceId: h.workspace.id } }
  expect((await host.observation(execution)).settlement).toBe('unknown')
  await expect(host.maintain(execution, async () => 'unsafe')).rejects.toMatchObject({ code: 'execution-scope-unavailable' })
  let scopeReads = 0
  host.connectObservation(async () => ++scopeReads === 1 ? [] : [{ session: { runtimeId: 'runtime', sessionId: review.sessionId }, purpose: 'review' }])
  await fixtures.run(() => host.maintain(execution, async () => {
    expect(() => related.runMaintenance(async () => {})).toThrow('active work')
    await using handle = await h.ctx.sessionPersistence.open(review.sessionId, 'read')
    const persisted = await handle.read()
    expect(persisted.events).toContainEqual(expect.objectContaining({ type: 'user/message', data: expect.objectContaining({ id: message.id }) }))
  }))
  expect(h.model.requests).toHaveLength(0)
})

let fixtures: ExecutionFixtures
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())
it('observes explicitly associated and retired roots without activating them and fences unresolved descendants', async () => {
  const root = await fixtures.root()
  const h = await fixtures.mount(root)
  const create = () => fixtures.run(() => h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' }))
  const current = await create(), old = await create(), review = await create(), child = await create(), unrelated = await create()
  const parent = h.ctx.agents.get(old.sessionId)!
  parent.session.append('subagent/catalog', { version: 1, childId: child.sessionId, childCreatedAt: 1, mode: 'continuable', label: 'same label' } as never)
  await fixtures.run(() => h.ctx.sessions.flush(parent.session))
  const host = new DshWorkExecutionHost(h.ctx, 'runtime')
  host.connectObservation(async () => [{ session: { runtimeId: 'runtime', sessionId: review.sessionId }, purpose: 'review' }])
  const execution: WorkExecution = { ...executionDefaults, id: 'execution', ref: { projectId: 'project', taskId: 'task' }, session: { runtimeId: 'runtime', sessionId: current.sessionId }, resource: { runtimeId: 'runtime', workspaceId: h.workspace.id }, retired: [{ session: { runtimeId: 'runtime', sessionId: old.sessionId }, epoch: 1, operationId: 'rotation' }] }
  const facts = await fixtures.run(() => host.observation(execution))
  expect(facts.sessions.map(row => row.session.sessionId).sort()).toEqual([current.sessionId, old.sessionId, review.sessionId, child.sessionId].sort())
  expect(facts.sessions.some(row => row.session.sessionId === unrelated.sessionId)).toBe(false)
  expect(facts.blockers).toContainEqual({ code: 'native-result-pending', session: { runtimeId: 'runtime', sessionId: old.sessionId } })
  let entered = false
  await expect(fixtures.run(() => host.maintain(execution, async () => { entered = true }))).rejects.toMatchObject({ code: 'continuation-waiting-executions' })
  expect(entered).toBe(false)
  expect(h.model.requests).toHaveLength(0)
})

it('reads real retired-owner jobs without collecting results or including unowned and foreign jobs', async () => {
  const h = await fixtures.mount(await fixtures.root())
  await h.ctx.plugin(LocalJobs)
  h.ctx.jobs.attachController('execution-observation-test')
  const create = () => fixtures.run(() => h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' }))
  const current = await create(), old = await create(), foreign = await create()
  const terminal = h.ctx.jobs.start({ kind: 'bash', label: 'owned result', owner: old.sessionId, run: () => ({ cancel() {}, done: Promise.resolve({ status: 'completed', result: 'untouched result' }) }) })
  h.ctx.jobs.start({ kind: 'bash', label: 'foreign', owner: foreign.sessionId, run: () => ({ cancel() {}, done: Promise.resolve({ status: 'completed' }) }) })
  h.ctx.jobs.start({ kind: 'bash', label: 'unowned', run: () => ({ cancel() {}, done: Promise.resolve({ status: 'completed' }) }) })
  await h.ctx.jobs.wait(terminal, 1000, old.sessionId)
  const host = new DshWorkExecutionHost(h.ctx, 'runtime')
  host.connectObservation(async () => [])
  const execution: WorkExecution = { ...executionDefaults, id: 'execution', ref: { projectId: 'project', taskId: 'task' }, session: { runtimeId: 'runtime', sessionId: current.sessionId }, resource: { runtimeId: 'runtime', workspaceId: h.workspace.id }, retired: [{ session: { runtimeId: 'runtime', sessionId: old.sessionId }, epoch: 1, operationId: 'rotation' }] }
  const facts = await fixtures.run(() => host.observation(execution))
  expect(facts.settlement).toBe('unknown')
  expect(facts.sessions.flatMap(row => row.jobs)).toEqual([expect.objectContaining({ id: terminal, owner: { runtimeId: 'runtime', sessionId: old.sessionId }, status: 'completed', result: 'unknown', delivery: 'unknown', acceptance: 'unassessed' })])
  await expect(fixtures.run(() => host.maintain(execution, async () => 'unsafe'))).rejects.toMatchObject({ code: 'continuation-waiting-executions' })
  expect(h.ctx.jobs.read(terminal, SessionId(old.sessionId)).result).toBe('untouched result')
  expect(h.model.requests).toHaveLength(0)
})
