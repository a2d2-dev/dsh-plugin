import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import type { WorkHost } from '../src/work.ts'
import { installLiveSessionTitles } from '../src/session-title-live.ts'
import { ExecutionFixtures } from './work-execution-fixture.ts'

let fixtures: ExecutionFixtures
const operator = { operator: true }
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())
async function setup() {
  const h = await fixtures.mount(await fixtures.root())
  // Real host services and authority, with the older host's missing naming capability.
  const host: WorkHost = { execution: h.host.execution, resources: () => h.host.resources(), sessions: resource => h.host.sessions(resource) }
  const app = new WorkApplication(h.app.directory, host)
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const p = await app.execute({ type: 'project.create', commandId: 'project', name: 'Live naming', resource }, operator)
  if (p.status !== 'completed' || !p.project) throw new Error(JSON.stringify(p))
  const t = await app.execute({ type: 'task.create', commandId: 'task', projectId: p.project.id, title: '在线命名接入', goal: '保留原有执行宿主', specification: '旧宿主缺少命名能力', acceptance: ['名字在首次消息前写入'] }, operator)
  if (t.status !== 'completed' || !t.task) throw new Error(JSON.stringify(t))
  return { ...h, host, app, resource, project: p.project, task: t.task, ref: { projectId: p.project.id, taskId: t.task.id } }
}
it('names before the first Task message while retaining the live execution host and its authorization state', async () => {
  const h = await setup()
  const executionHost = h.host.execution
  installLiveSessionTitles(h.ctx, h.app, 'runtime')
  const started = await h.app.execute({ type: 'task.start', commandId: 'start', ref: h.ref, expectedVersion: 1, resource: h.resource, agentId: h.project.defaultAgentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  if (started.status !== 'completed' || !started.execution) throw new Error(JSON.stringify(started))
  expect(started.execution.state).toBe('ready')
  expect(h.host.execution).toBe(executionHost)
  const id = SessionId(started.execution.session.sessionId)
  await fixtures.run(() => h.ctx.agents.get(id)!.whenIdle())
  const log = await h.ctx.sessionController.inspect(id)
  const title = log.events.find(event => event.type === 'session/title')!
  expect(title?.data.title).toBe(`T:${h.task.id.replaceAll('-', '').slice(0, 8)} · 会话 1 · 在线命名接入`)
  expect(title.seq).toBeLessThan(log.events.find(event => event.type === 'user/message')!.seq)
  expect(h.model.requests).toHaveLength(1)
})
it('names a real cold Session at association without resuming an Agent or creating model work', async () => {
  const h = await setup()
  const id = SessionId('live-title-cold')
  const handle = await h.ctx.sessionPersistence.create({ version: 4, isSeeded: false, delegationDepth: 0, id, createdAt: 1234, cwd: h.workspace.path, agentPreset: 'contract' })
  await handle.flush(); await handle.close(); await h.workspace.attachSession(id)
  installLiveSessionTitles(h.ctx, h.app, 'runtime')
  const result = await h.app.execute({ type: 'task.associate-session', commandId: 'associate', ref: h.ref, expectedVersion: 1, session: { runtimeId: 'runtime', sessionId: id }, purpose: 'related' }, operator)
  expect(result.status).toBe('completed')
  expect((await h.ctx.sessionQuery.readTitle(id))?.title).toBe(`T:${h.task.id.replaceAll('-', '').slice(0, 8)} · 关联 1 · 在线命名接入`)
  expect(h.ctx.sessions.list()).toHaveLength(0)
  expect(h.model.requests).toHaveLength(0)
})
it('does not wrap or duplicate a host that already implements task naming', async () => {
  const h = await fixtures.mount(await fixtures.root())
  const before = { execute: h.app.execute, ensure: h.host.execution.ensure }
  expect(installLiveSessionTitles(h.ctx, h.app, 'runtime')).toBe(false)
  expect(h.app.execute).toBe(before.execute)
  expect(h.host.execution.ensure).toBe(before.ensure)
})
