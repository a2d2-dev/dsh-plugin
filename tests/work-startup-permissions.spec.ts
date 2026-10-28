import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { WorkPanelController } from '../src/client/work-panel-controller.ts'
import { WorkClientError, type WorkClient } from '../src/client/work-api.ts'
import { WorkApplication } from '../src/work.ts'
import type { GitHubIssue } from '../src/work-sources/types.ts'
import type { WorkResult } from '../src/work-types.ts'

it('restores confirmed settings for a second Issue in a new panel with the same actual sandbox and approval', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    const identity = { login: 'developer', nodeId: 'U_developer', name: null }
    const issues: GitHubIssue[] = [1971, 1972].map(number => ({ nodeId: `I_${number}`, number, title: `Settings probe ${number}`, body: 'Verify execution settings only.', url: `https://github.com/example/settings/issues/${number}`, repository: { owner: 'example', repository: 'settings' }, assignees: [], labels: [], state: 'open', updatedAt: '2026-10-28T00:00:00Z', observedAt: '2026-10-28T00:00:00Z' }))
    const app = new WorkApplication(h.app.directory, h.host, { list: async () => ({ identity, items: issues, observedAt: issues[0]!.observedAt }), detail: async (_source, number) => ({ identity, issue: issues.find(issue => issue.number === number)! }) })
    const completed = (result: WorkResult) => { if (result.status !== 'completed') throw new WorkClientError(result); return result }
    const client: WorkClient = { query: async query => completed(await fixtures.run(() => app.query(query, { operator: true }))), command: vi.fn(async command => completed(await fixtures.run(() => app.execute(command, { operator: true })))) }
    const navigation = { selectPanel: vi.fn(), openSession: vi.fn() }
    const first = new WorkPanelController(client, navigation)
    const resource = (await client.query({ type: 'resources.list' })).resources![0]!.ref
    const project = (await first.submit({ type: 'project.create', name: '记忆权限真实宿主', resource })).project!
    await first.load(); await first.selectProject(project.id); await first.configureSource('example', 'settings')
    await first.openIssue(1971, true, issues[0]!.nodeId); await first.prepareStart(true)
    first.selectStart({ modelIndex: first.getSnapshot().startup.options!.models.findIndex(model => model.model === 'selected'), permissionPreset: 'workspace-write' })
    await first.startPrepared()
    const initial = first.getSnapshot().detail!.execution!
    expect(initial.actual).toMatchObject({ cwd: h.workspace.path, model: 'selected', agentPreset: 'contract', permissionPreset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' })
    await fixtures.run(() => h.ctx.agents.get(SessionId(initial.session.sessionId))!.whenIdle())
    const returned = new WorkPanelController(client, navigation)
    await returned.load(); await returned.selectProject(project.id); await returned.openIssue(1972, true, issues[1]!.nodeId)
    const before = vi.mocked(client.command).mock.calls.length
    await returned.previewStart()
    expect(vi.mocked(client.command).mock.calls).toHaveLength(before)
    expect(returned.getSnapshot().startup.options).toMatchObject({ selectionSource: 'remembered', selection: { resource, model: { provider: 'contract', model: 'selected' }, agentPreset: 'contract', permissionPreset: 'workspace-write' } })
    await returned.startPrepared()
    const second = returned.getSnapshot().detail!.execution!
    expect(second.session.sessionId).not.toBe(initial.session.sessionId)
    expect(second.actual).toEqual(initial.actual)
    expect(vi.mocked(client.command).mock.calls.slice(before).map(([command]) => command.type)).toEqual(['source.import', 'task.start'])
    await fixtures.run(() => h.ctx.agents.get(SessionId(second.session.sessionId))!.whenIdle())
    expect(h.model.requests).toHaveLength(2)
  } finally { await fixtures.close() }
})
