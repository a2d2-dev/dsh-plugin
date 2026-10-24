import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { WorkPanelController } from '../src/client/work-panel-controller.ts'
import { WorkClientError, type WorkClient } from '../src/client/work-api.ts'
import { WorkApplication } from '../src/work.ts'
import type { GitHubIssue } from '../src/work-sources/types.ts'
import type { WorkResult } from '../src/work-types.ts'

it('starts through the panel and real execution application, preserves one Session and model request across return', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    const completed = (result: WorkResult) => { if (result.status !== 'completed') throw new WorkClientError(result); return result }
    // The public application boundary is real; only the UI transport and model output are controlled.
    const client: WorkClient = {
      query: async query => completed(await h.app.query(query, { operator: true })),
      command: async command => completed(await h.app.execute(command, { operator: true })),
    }
    const navigation = { selectPanel: vi.fn(), openSession: vi.fn() }
    const panel = new WorkPanelController(client, navigation)
    const resources = await client.query({ type: 'resources.list' })
    const project = (await panel.submit({ type: 'project.create', name: '面板真实启动', resource: resources.resources![0]!.ref })).project!
    const task = (await panel.submit({ type: 'task.create', projectId: project.id, title: '真实执行', goal: '点击后只执行一次', specification: '从面板接入真实宿主', acceptance: ['同一会话回访不增加模型调用'] })).task!
    const ref = { projectId: project.id, taskId: task.id }
    await panel.load(); await panel.openTask(ref); await panel.prepareStart()
    expect(panel.getSnapshot().startup.options?.models).toHaveLength(2)
    await Promise.all([panel.startPrepared(), panel.startPrepared()])
    const execution = panel.getSnapshot().detail?.execution
    expect(execution).toMatchObject({ state: 'ready', actual: { cwd: h.workspace.path, permissionPreset: 'read-only' } })
    expect(panel.getSnapshot().startup.error).toBeNull()
    expect(panel.getSnapshot().detail?.task?.version).toBe(2)
    expect(navigation.openSession).toHaveBeenCalledExactlyOnceWith(execution!.session.sessionId)
    await fixtures.run(() => h.ctx.agents.get(SessionId(execution!.session.sessionId))!.whenIdle())
    expect(h.model.requests).toHaveLength(1)
    const returned = new WorkPanelController(client, navigation)
    await returned.openTask(ref); await returned.prepareStart()
    expect(returned.getSnapshot().detail?.execution?.id).toBe(execution!.id)
    expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(1)
    expect(h.model.requests).toHaveLength(1)
  } finally { await fixtures.close() }
})

it('connects a GitHub Project without a directory, starts once after choosing one and reads the same Issue on return', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    const identity = { login: 'developer', nodeId: 'U_developer', name: null }
    const issue: GitHubIssue = { nodeId: 'I_start124', number: 124, title: 'GitHub Issue 直接启动', body: '线上镜像清理错误：保留 stable 标签，验证后报告。',
      url: 'https://github.com/example/repository/issues/124', repository: { owner: 'example', repository: 'repository' }, assignees: ['developer'], labels: ['bug'], state: 'open', updatedAt: '2026-10-21T00:00:00Z', observedAt: '2026-10-21T00:01:00Z' }
    const app = new WorkApplication(h.app.directory, h.host, { list: async () => ({ identity, items: [issue], observedAt: issue.observedAt }), detail: async () => ({ identity, issue }), project:async()=>({identity,project:{nodeId:'P1',title:'Execution Project',url:'https://github.com/orgs/example/projects/1',closed:false},items:[{id:'item1',kind:'issue',archived:false,issueNodeId:issue.nodeId,title:issue.title,fields:[],fieldsPartial:false}],issues:[issue],observedAt:issue.observedAt}) })
    const completed = (result: WorkResult) => { if (result.status !== 'completed') throw new WorkClientError(result); return result }
    const client: WorkClient = {
      query: async query => completed(await fixtures.run(() => app.query(query, { operator: true }))),
      command: vi.fn(async command => completed(await fixtures.run(() => app.execute(command, { operator: true })))),
    }
    const navigation = { selectPanel: vi.fn(), openSession: vi.fn() }
    const panel = new WorkPanelController(client, navigation)
    await panel.connectProject({owner:'example',type:'org',number:1})
    const project=panel.getSnapshot().projects.find(item=>item.id===panel.getSnapshot().projectId)!
    expect(project.resources).toEqual([])
    await panel.openIssue(issue.number, true, issue.nodeId)
    expect(h.model.requests).toHaveLength(0)
    expect((await client.query({ type: 'project.detail', projectId: project.id })).tasks).toHaveLength(0)
    await panel.prepareStart(true)
    const task = panel.getSnapshot().detail!.task!
    expect(task.specification).toMatchObject({ text: issue.body, acceptance: [], missing: ['acceptance'] })
    await Promise.all([panel.startPrepared(), panel.startPrepared()])
    const execution = panel.getSnapshot().detail!.execution!
    expect(execution).toMatchObject({ state: 'ready', actual: { provider: 'contract', permissionPreset: 'read-only' } })
    expect(vi.mocked(client.command).mock.calls.map(([command])=>command.type)).toEqual(['source.connect','source.import','project.attach-resource','task.start'])
    expect((await client.query({type:'project.detail',projectId:project.id})).project?.resources).toEqual([execution.resource])
    await fixtures.run(() => h.ctx.agents.get(SessionId(execution.session.sessionId))!.whenIdle())
    expect(h.model.requests).toHaveLength(1)
    expect(JSON.stringify(h.model.requests[0]!.messages)).toContain(issue.body)
    expect(JSON.stringify(h.model.requests[0]!.messages)).toContain(issue.url)
    expect(await app.sessionControl(execution.session, 'source-status', 'status')).toMatchObject({ sourceIssues: [{ nodeId: issue.nodeId, url: issue.url, repository: issue.repository }] })
    const returned = new WorkPanelController(client, navigation)
    await returned.load(); await returned.openIssue(issue.number, true, issue.nodeId)
    expect(returned.getSnapshot().detail?.task?.id).toBe(task.id)
    expect(vi.mocked(client.command).mock.calls.filter(([command])=>command.type==='source.import')).toHaveLength(1)
    await returned.prepareStart(true)
    expect(returned.getSnapshot().detail?.task?.id).toBe(task.id)
    expect(returned.getSnapshot().detail?.execution?.session).toEqual(execution.session)
    expect((await client.query({ type: 'project.detail', projectId: project.id })).tasks).toHaveLength(1)
    expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(1)
    expect(h.model.requests).toHaveLength(1)
  } finally { await fixtures.close() }
})
