import { SessionId } from '@deepseek-ai/dsh-session'
import SessionTitle, { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { WorkApplication } from '../src/work.ts'
import { workSessionTitles, taskTitleText } from '../src/work-session-titles.ts'
import type { WorkSnapshot } from '../src/work-schema.ts'
import type { WorkTask, WorkResult } from '../src/work-types.ts'

let fixtures: ExecutionFixtures
const operator = { operator: true }
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())
function completed(result: WorkResult) {
  expect(result.status, JSON.stringify(result)).toBe('completed')
  if (result.status !== 'completed') throw new Error(JSON.stringify(result))
  return result
}
async function setup() {
  const h = await fixtures.mount(await fixtures.root())
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const project = completed(await h.app.execute({ type: 'project.create', commandId: 'project', name: 'Naming', resource }, operator)).project!
  const task = completed(await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.id,
    title: '修复会话名称', goal: '显示任务与接续序号', specification: '关联任务命名', acceptance: ['可读且可定位'] }, operator)).task!
  const ref = { projectId: project.id, taskId: task.id }
  const start = async () => {
    const execution = completed(await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: 1,
      resource, agentId: project.defaultAgentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)).execution!
    await fixtures.run(() => h.ctx.agents.get(SessionId(execution.session.sessionId))!.whenIdle())
    return execution
  }
  return { ...h, resource, project, task, ref, start }
}
it('gives a newly created task Session its readable Task title and a real sequence before any automatic naming', async () => {
  const h = await setup()
  const execution = await h.start()
  const inspected = await fixtures.run(() => h.ctx.sessionController.inspect(SessionId(execution.session.sessionId)))
  const title = inspected.events.findLast(event => event.type === 'session/title')
  expect(title?.data).toMatchObject({ title: `T:${h.task.id.replaceAll('-', '').slice(0, 8)} · 会话 1 · 修复会话名称`, source: { kind: 'user' } })
  expect(title!.seq).toBeLessThan(inspected.events.find(event => event.type === 'user/message')!.seq)
  await fixtures.run(() => h.app.reconcileControls())
  await fixtures.run(() => h.app.reconcileControls())
  const replayed = await fixtures.run(() => h.ctx.sessionController.inspect(SessionId(execution.session.sessionId)))
  expect(replayed.events.filter(event => event.type === 'session/title')).toHaveLength(1)
  expect(h.model.requests).toHaveLength(1)
})

it.each(['empty', 'throw', 'unrelated'] as const)('keeps task naming independent of an automatic provider that would return %s', async outcome => {
  const h = await setup()
  await h.ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 80, maxTitleBytes: 80 })
  const generate = vi.fn(async () => {
    if (outcome === 'throw') throw new Error('Automatic model unavailable')
    return { title: outcome === 'empty' ? '  \u200b ' : 'Coordinate accepted work', messageSeqs: [] }
  })
  h.ctx.sessionTitle.register({ id: SessionTitleProviderId('failing-title'), automatic: 'all-prompts', generate })
  const execution = await h.start()
  expect(await h.ctx.sessionQuery.readTitle(SessionId(execution.session.sessionId))).toMatchObject({
    title: `T:${h.task.id.replaceAll('-', '').slice(0, 8)} · 会话 1 · 修复会话名称`, source: { kind: 'user' },
  })
  expect(generate).not.toHaveBeenCalled()
})

it('names and repairs a bound cold Session without resuming it, and leaves unrelated Sessions alone', async () => {
  const h = await setup()
  const id = SessionId('existing-cold')
  const unrelated = SessionId('unrelated-cold')
  for (const sessionId of [id, unrelated]) {
    const handle = await h.ctx.sessionPersistence.create({ version: 4, isSeeded: false, delegationDepth: 0, id: sessionId, createdAt: 1234, cwd: h.workspace.path, agentPreset: 'contract' })
    await handle.flush()
    await handle.close()
    await h.workspace.attachSession(sessionId)
  }
  const command = { type: 'task.associate-session', commandId: 'bind', ref: h.ref, expectedVersion: 1,
    session: { runtimeId: 'runtime', sessionId: id }, purpose: 'related' }
  completed(await h.app.execute(command, operator))
  const expected = `T:${h.task.id.replaceAll('-', '').slice(0, 8)} · 关联 1 · 修复会话名称`
  const log = await h.ctx.sessionController.inspect(id)
  expect(log.events.findLast(event => event.type === 'session/title')?.data.title).toBe(expected)
  // Simulate an older automatic title, then restart the application and repair from persisted relations.
  const handle = await h.ctx.sessionPersistence.open(id, 'write')
  try { await handle.append([{ type: 'session/title', seq: log.events.length as never, time: Date.now(), data: { title: 'strange old name', messageSeqs: [], source: { kind: 'user' } } }]) }
  finally { await handle.close() }
  const restored = new WorkApplication(h.app.directory, h.host)
  await fixtures.run(() => restored.reconcileControls())
  const repaired = await h.ctx.sessionController.inspect(id)
  expect(repaired.events.findLast(event => event.type === 'session/title')?.data.title).toBe(expected)
  completed(await restored.execute(command, operator))
  expect((await h.ctx.sessionController.inspect(id)).events).toEqual(repaired.events)
  expect((await h.ctx.sessionController.inspect(unrelated)).events).toEqual([])
  expect(h.ctx.sessions.list()).toHaveLength(0)
  expect(h.model.requests).toHaveLength(0)
})

it('names a reused control Session from the Task instead of retaining its unrelated title', async () => {
  const h = await setup()
  await h.ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 80, maxTitleBytes: 80 })
  const existing = await h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' })
  await h.ctx.sessionController.rename({ sessionId: existing.sessionId, title: 'Unrelated former topic' })
  await h.ctx.sessionController.selectModel({ sessionId: existing.sessionId, provider: 'contract', model: 'selected' })
  h.ctx.permissionPresets.set(h.ctx.agents.get(existing.sessionId)!.session, 'workspace-write')
  const execution = completed(await h.app.execute({ type: 'task.start', commandId: 'reuse', ref: h.ref, expectedVersion: 1,
    resource: h.resource, session: { runtimeId: 'runtime', sessionId: existing.sessionId }, agentId: h.project.defaultAgentId,
    agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)).execution!
  await fixtures.run(() => h.ctx.agents.get(existing.sessionId)!.whenIdle())
  expect(execution.session.sessionId).toBe(existing.sessionId)
  expect(await h.ctx.sessionQuery.readTitle(existing.sessionId)).toMatchObject({ title: `T:${h.task.id.replaceAll('-', '').slice(0, 8)} · 会话 1 · 修复会话名称` })
})

it('uses the accepted Issue identity as soon as it is linked to an already associated Session', async () => {
  const h = await setup()
  const execution = await h.start()
  const repository = { owner: 'a2d2-dev', repository: 'dsh-plugin' }
  const issue = { nodeId: 'I_211', url: 'https://github.com/a2d2-dev/dsh-plugin/issues/211', number: 211, title: h.task.title,
    body: 'Accepted source', repository, state: 'open' as const, labels: [], assignees: [], updatedAt: '2026-10-23T00:00:00Z', observedAt: '2026-10-23T00:00:00Z' }
  const identity = { login: 'operator', nodeId: 'U_1', name: 'Operator' }
  const app = new WorkApplication(h.app.directory, h.host, { list: async () => ({ identity, items: [issue], observedAt: issue.observedAt }), detail: async () => ({ identity, issue }) })
  const source = completed(await app.execute({ type: 'source.configure', commandId: 'source', projectId: h.project.id, repository }, operator)).source!
  await app.query({ type: 'source.issue', projectId: h.project.id, sourceId: source.id, number: 211, refresh: true }, operator)
  completed(await app.execute({ type: 'source.link', commandId: 'link', ref: h.ref, expectedVersion: 2, sourceId: source.id, nodeId: issue.nodeId }, operator))
  expect(await h.ctx.sessionQuery.readTitle(SessionId(execution.session.sessionId))).toMatchObject({ title: '#211 · 会话 1 · 修复会话名称' })
})

it('derives task hierarchy, historical generations and independent review sequences without inventing numbers', () => {
  const parent = { id: 'parent', projectId: 'project', title: 'Parent', goal: '', sessions: [], children: [] } as unknown as WorkTask
  const child = { ...parent, id: 'child', title: 'Child', parent: { projectId: 'project', taskId: 'parent' }, sessions: [
    { session: { runtimeId: 'runtime', sessionId: 'review-a' }, purpose: 'review' },
    { session: { runtimeId: 'runtime', sessionId: 'related-a' }, purpose: 'related' },
    { session: { runtimeId: 'runtime', sessionId: 'review-b' }, purpose: 'review' },
  ] } as WorkTask
  const state = { tasks: [parent, child], externalBindings: [parent, child].map((task, i) => ({
    ref: { projectId: 'project', taskId: task.id }, lastObserved: { number: i ? 211 : 200, repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' } },
  })), executions: [{ id: 'run', ref: { projectId: 'project', taskId: 'child' }, session: { runtimeId: 'runtime', sessionId: 'current' }, epoch: 3,
    retired: [{ session: { runtimeId: 'runtime', sessionId: 'first' }, epoch: 1 }, { session: { runtimeId: 'runtime', sessionId: 'second' }, epoch: 2 }] }] } as unknown as WorkSnapshot
  const rows = workSessionTitles(state)
  const names = Object.fromEntries(rows.map(row => [row.session.sessionId, row.title]))
  expect(names.current).toBe('#200/#211 · 会话 3 · Child')
  expect(names.first).toContain(' · 会话 1 · ')
  expect(names.second).toContain(' · 会话 2 · ')
  expect(names['review-a']).toContain(' · 评审 1 · ')
  expect(names['review-b']).toContain(' · 评审 2 · ')
  expect(names['related-a']).toContain(' · 关联 1 · ')
  expect(workSessionTitles(structuredClone(state))).toEqual(rows)
})

it('retains task identity, hierarchy, generation and readable text under the production 80-byte limit', async () => {
  const h = await setup()
  await h.ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 80, maxTitleBytes: 80 })
  const created = await h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' })
  const parent = { ...h.task, id: 'parent', title: 'Parent' }
  const child = { ...h.task, parent: { projectId: h.project.id, taskId: parent.id }, title: '修复会话名称'.repeat(10) }
  const state = { tasks: [parent, child], externalBindings: [parent, child].map((task, i) => ({ ref: { projectId: h.project.id, taskId: task.id }, lastObserved: { number: i ? 211 : 200, repository: { owner: 'deepseek-ai', repository: 'deepseek-harness' } } })),
    executions: [{ id: 'run', ref: h.ref, session: { runtimeId: 'runtime', sessionId: created.sessionId }, epoch: 2 }] } as unknown as WorkSnapshot
  const row = workSessionTitles(state)[0]!
  await h.host.nameSession(row.session, row.title)
  const title = (await h.ctx.sessionQuery.readTitle(created.sessionId))!.title
  expect(Buffer.byteLength(title)).toBeLessThanOrEqual(80)
  expect(title).toContain('#211')
  expect(title).toContain('#200')
  expect(title).toContain('会话 2')
  expect(title).toContain('修复会话名称')
})

it('disambiguates duplicate Issue numbers and colliding Task prefixes using real task identities', () => {
  const tasks = ['12345678-1000-4000-8000-000000000001', '12345678-2000-4000-8000-000000000002'].map((id, index) => ({
    id, projectId: 'project', title: `任务${index}`, goal: '', children: [], sessions: [{ session: { runtimeId: 'runtime', sessionId: `s${index}` }, purpose: 'related' }],
  })) as unknown as WorkTask[]
  const local = { tasks, externalBindings: [], executions: [] } as unknown as WorkSnapshot
  expect(workSessionTitles(local).map(row => row.title)).toEqual(['T:123456781 · 关联 1 · 任务0', 'T:123456782 · 关联 1 · 任务1'])
  const linked = { ...local, externalBindings: tasks.map((task, i) => ({ ref: { projectId: 'project', taskId: task.id }, lastObserved: { number: 211, repository: { owner: 'owner', repository: `repo${i}` } } })) } as unknown as WorkSnapshot
  expect(workSessionTitles(linked).map(row => row.title)).toEqual(['#211@123456781 · 关联 1 · 任务0', '#211@123456782 · 关联 1 · 任务1'])
})

it('reserves space for a shared Session controlling task and exposes additional associations', () => {
  const session = { runtimeId: 'runtime', sessionId: 'shared' }
  const tasks = ['first', 'second'].map(id => ({ id, projectId: 'project', title: '很长的任务标题'.repeat(20), goal: '', children: [], sessions: [{ session, purpose: 'related' }] })) as unknown as WorkTask[]
  const state = { tasks, externalBindings: [], executions: [{ id: 'run', ref: { projectId: 'project', taskId: 'second' }, session, epoch: 2 }] } as unknown as WorkSnapshot
  const row = workSessionTitles(state)[0]!
  expect(row.title).toMatch(/^T:second · 会话 2 · 很长的任务标题/)
  expect(row.title).toMatch(/ \+1任务$/)
  expect(Buffer.byteLength(row.title)).toBeLessThanOrEqual(80)
})

it('cleans unusable task titles and retains a readable task-based fallback and Unicode boundary', () => {
  expect(taskTitleText(' \u200b\u001b[31m\u001b[0m ', '修复\n\t名称')).toBe('修复 名称')
  expect(taskTitleText(' \u200b ', '\u0000')).toBe('任务会话')
  expect(taskTitleText('界'.repeat(100))).toBe('界'.repeat(40))
})
