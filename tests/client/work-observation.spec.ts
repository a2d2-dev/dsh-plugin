import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import type { WorkClient } from '../../src/client/work-api.ts'
import type { WorkCompleted, WorkExecution, WorkTask } from '../../src/work-types.ts'
import { buildExecutionGraph } from '../../src/work-execution/observation.ts'

const ref = { projectId: 'p1', taskId: 't1' }
const task: WorkTask = { id: 't1', projectId: 'p1', title: '持续工作', goal: '观察变化', version: 1, agentId: 'a1', specification: { version: 1, text: '保存目标', acceptance: ['可观察'] }, specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [] }
const historySession = { runtimeId: 'host', sessionId: 'retired' }
const execution: WorkExecution = { id: 'e1', ref, agentId: 'a1', owner: 'owner', epoch: 2, resource: { runtimeId: 'host', workspaceId: 'ws' }, session: { runtimeId: 'host', sessionId: 'current' }, sessionMode: 'create', agentPreset: 'standard', model: { provider: 'real', model: 'model' }, permissionPreset: 'read-only', policy: { version: 1, instructions: '', capabilities: [], modelCandidates: [] }, state: 'ready', history: [], events: [], retired: [{ session: historySession, epoch: 1, operationId: 'op1' }] }
const issue = { nodeId: 'I1', number: 1, title: '来源工作', body: '正文', repository: { owner: 'acme', repository: 'repo' }, url: 'https://github.com/acme/repo/issues/1', assignees: [], labels: [], state: 'open' as const, updatedAt: '2026-10-22', observedAt: '2026-10-22' }
const source = { id: 's1', projectId: 'p1', provider: 'github' as const, githubProject:{owner:'acme',type:'org' as const,number:9}, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] }
function setup() {
  let saved = task
  const navigation = { selectPanel: vi.fn(), openSession: vi.fn() }
  const client: WorkClient = {
    command: vi.fn(async (): Promise<WorkCompleted> => ({ status: 'completed' })),
    query: vi.fn(async (query): Promise<WorkCompleted> => {
      if (query.type === 'projects.list') return { status: 'completed', projects: ['p1', 'p2'].map(id => ({ id, name: id, version: 1, defaultAgentId: 'a1', resources: [] })) }
      if (query.type === 'project.detail') return { status: 'completed', tasks: query.projectId === 'p1' ? [saved] : [] }
      if (query.type === 'task.detail') return { status: 'completed', task: saved, execution, executionGraph: buildExecutionGraph({ task: saved, execution }) }
      if (query.type === 'task.history') return { status: 'completed', transcript: { session: historySession, events: ['已加载的旧上下文'], nextCursor: 10 } }
      if (query.type === 'source.list') return { status: 'completed', sources: [source] }
      if (query.type === 'source.issues') return { status: 'completed', source, page: { identity: { login: 'viewer', nodeId: 'U1', name: null }, items: [issue], observedAt: issue.observedAt } }
      if (query.type === 'source.issue') return { status: 'completed', source, issue }
      return { status: 'completed' }
    }),
  }
  return { client, navigation, panel: new WorkPanelController(client, navigation), setTask: (value: WorkTask) => { saved = value } }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const html = (panel: WorkPanelController) => renderToStaticMarkup(createElement(WorkPanel, { controller: panel }))

describe('visible panel local observation', () => {
  it('updates task progress while preserving tab, filters and already loaded history without writes/navigation', async () => {
    const h = setup(); await h.panel.load(); await h.panel.openTask(ref); h.panel.setDetailTab('sessions'); h.panel.setSearch('持续'); h.panel.setView('associated'); await h.panel.openHistory(historySession)
    const priorHistory = h.panel.getSnapshot().history
    expect(html(h.panel)).not.toContain('等待人类确认')
    const updatedTask = { ...task, version: 2 }
    const updatedExecution = { ...execution, progress: '后端新进展', state: 'waiting' as const }
    const executionGraph = buildExecutionGraph({ task: updatedTask, execution: updatedExecution, observation: { settlement: 'pending', sessions: [{ session: execution.session, role: 'current', status: 'idle', waitingHuman: true, children: [], jobs: [] }], blockers: [], reminders: [], limitations: [] } })
    vi.mocked(h.client.query).mockResolvedValueOnce({ status: 'completed', task: updatedTask, execution: updatedExecution, executionRuntime: 'idle', executionGraph })
    await h.panel.observeCurrent()
    expect(h.panel.getSnapshot()).toMatchObject({ detailTab: 'sessions', search: '持续', view: 'associated', detail: { task: { version: 2 }, execution: { progress: '后端新进展' } } })
    expect(h.panel.getSnapshot().history).toBe(priorHistory)
    expect(h.panel.getSnapshot().detail?.executionGraph).toBe(executionGraph)
    expect(html(h.panel)).toContain('等待人类确认')
    expect(html(h.panel)).toContain('已加载的旧上下文')
    expect(h.client.command).not.toHaveBeenCalled()
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(h.navigation.selectPanel).not.toHaveBeenCalled()
  })
  it('updates project task rows without changing the selected local filter', async () => {
    const h = setup(); await h.panel.load(); h.panel.setSearch('新工作')
    h.setTask({ ...task, title: '新工作', version: 2 })
    await h.panel.observeCurrent()
    expect(h.panel.getSnapshot()).toMatchObject({ projectId: 'p1', detail: null, search: '新工作' })
    expect(h.panel.visibleTasks()[0]?.title).toBe('新工作')
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it('reads only cached source data and keeps selected Issue and listing filters', async () => {
    const h = setup(); await h.panel.load(); await h.panel.showSources(); await h.panel.browseIssues({ assignee: '*', state: 'all', page: 3 }, false); await h.panel.openIssue(1, false)
    vi.mocked(h.client.query).mockClear()
    await h.panel.observeCurrent()
    const calls = vi.mocked(h.client.query).mock.calls.map(([query]) => query)
    expect(calls).toEqual([
      { type: 'project.detail', projectId: 'p1' }, { type: 'source.list', projectId: 'p1' },
      { type: 'source.issue', projectId: 'p1', sourceId: 's1', number: 1, nodeId: 'I1', refresh: false },
    ])
    expect(h.panel.getSnapshot().source).toMatchObject({ issue: { nodeId: 'I1' }, assignee: '*', state: 'all', page: 3 })
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it('coalesces in-flight observations and ignores a response after navigation', async () => {
    const h = setup(); await h.panel.load()
    const pending = deferred<WorkCompleted>(), query = vi.mocked(h.client.query)
    query.mockReturnValueOnce(pending.promise)
    const reading = h.panel.observeCurrent(); await h.panel.observeCurrent()
    const observedCalls = query.mock.calls.filter(([value]) => value.type === 'project.detail' && value.projectId === 'p1')
    expect(observedCalls).toHaveLength(2) // initial project read and one observation
    await h.panel.selectProject('p2')
    pending.resolve({ status: 'completed', tasks: [{ ...task, title: '迟到内容' }] }); await reading
    expect(h.panel.getSnapshot()).toMatchObject({ projectId: 'p2', tasks: [], detail: null })
  })
  it('skips an active editor and discards its earlier response if editing starts mid-read', async () => {
    const h = setup(); await h.panel.openTask(ref)
    const query = vi.mocked(h.client.query); query.mockClear()
    await h.panel.observeCurrent(() => false)
    expect(query).not.toHaveBeenCalled()
    let allowed = true
    const pending = deferred<WorkCompleted>(); query.mockReturnValueOnce(pending.promise)
    const reading = h.panel.observeCurrent(() => allowed); allowed = false
    pending.resolve({ status: 'completed', task: { ...task, version: 99 }, execution }); await reading
    expect(h.panel.getSnapshot().detail?.task?.version).toBe(1)
  })
  it('does not observe during history loading and retains content after a passive read failure', async () => {
    const h = setup(); await h.panel.openTask(ref)
    const query = vi.mocked(h.client.query), pending = deferred<WorkCompleted>()
    query.mockReturnValueOnce(pending.promise)
    const reading = h.panel.openHistory(historySession), before = query.mock.calls.length
    await h.panel.observeCurrent()
    expect(query.mock.calls.length).toBe(before)
    pending.resolve({ status: 'completed', transcript: { session: historySession, events: ['旧上下文'] } }); await reading
    query.mockRejectedValueOnce(Error('暂时断线'))
    await h.panel.observeCurrent()
    expect(h.panel.getSnapshot()).toMatchObject({ observationError: '暂时断线', detail: { task: { id: 't1' } }, history: { events: ['旧上下文'] } })
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it('refreshes Issue-row local progress without imports and never matches another repository by number', async () => {
    const h = setup(); await h.panel.load(); await h.panel.showSources(); await h.panel.selectSourceTab('issues')
    expect(h.panel.getSnapshot().source.tab).toBe('issues')
    expect(html(h.panel)).toContain('未开始')
    const progress = { processingState:'waiting' as const, ref, title: task.title, children: [], stage: 'in-progress' as const, summary: '正在实现已确认需求', next: '', blockers: ['等待评审'], criteria: { passed: 0, total: 1, assessed: 0, current: false }, breakdown: [], execution: { id: 'e1', session: execution.session, state: 'waiting' as const, runtime: 'idle' as const, reason: '请确认设计' }, source: { number: 1, url: 'https://github.com/ACME/REPO/issues/1/', state: 'closed' as const, observedAt: issue.observedAt } }
    const original = h.client.query
    h.client.query = async query => query.type === 'project.detail' ? { status: 'completed', tasks: [task], progressItems: [progress] } : query.type === 'source.issues' ? { status: 'completed', source, page: { identity: { login: 'viewer', nodeId: 'U1', name: null }, items: [{ ...issue, state: 'closed' }, { ...issue, nodeId: 'foreign', title: '另一个仓库', repository: { owner: 'acme', repository: 'other' }, url: 'https://github.com/acme/other/issues/1' }], observedAt: issue.observedAt } } : original(query)
    await h.panel.observeCurrent()
    const rendered = html(h.panel)
    const rows = rendered.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? []
    const ownRow = rows.find(row => row.includes('#1 来源工作'))
    const foreignRow = rows.find(row => row.includes('#1 另一个仓库'))
    for (const text of ['正在实现已确认需求', '等待评审', '等待', 'session-current']) expect(ownRow).toContain(text)
    expect(foreignRow).toContain('未开始')
    for (const text of ['正在实现已确认需求', '等待评审', 'session-current']) expect(foreignRow).not.toContain(text)
    expect(rendered).not.toContain('已验收完成')
    expect(h.panel.progressForIssue({ ...issue, url: 'https://github.com/acme/other/issues/1' })).toBeUndefined()
    expect(h.client.command).not.toHaveBeenCalled()
    const completed = { ...progress, processingState:'completed' as const, stage: 'done' as const, summary: '已按当前规格验收' }
    h.client.query = async query => query.type === 'project.detail' ? { status: 'completed', tasks: [task], progressItems: [completed] } : original(query)
    await h.panel.observeCurrent()
    expect(html(h.panel)).toContain('已完成')
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it('displays native source parent/sub-Issue links and partial results without importing them', async () => {
    const h = setup(); await h.panel.load(); await h.panel.showSources()
    const parent = { ...issue, nodeId: 'parent', number: 9, title: '父 Issue', url: 'https://github.com/acme/repo/issues/9', state: 'closed' as const }
    const child = { ...issue, nodeId: 'child', number: 10, title: '<img src=x onerror=alert(1)>', url: 'https://github.com/acme/repo/issues/10' }
    const observed = { ...issue, parent, subIssues: { items: [child], totalCount: 4, hasNextPage: true } }
    vi.mocked(h.client.query).mockResolvedValueOnce({ status: 'completed', source, issue: observed })
    await h.panel.openIssue(1, false)
    const sourceHtml = html(h.panel)
    for (const text of ['原生 Issue 父子关系', '父 Issue', '已显示 1 / 4 项', '还有更多条目', '远端 closed', '&lt;img']) expect(sourceHtml).toContain(text)
    expect(sourceHtml).toContain('href="https://github.com/acme/repo/issues/9"')
    expect(sourceHtml).not.toContain('<img')
    vi.mocked(h.client.query).mockResolvedValueOnce({ status: 'completed', task, execution, bindings: [{ provider: 'github', nodeId: 'I1', urls: [issue.url], sourceIds: ['s1'], ref, accepted: issue, lastObserved: observed }] })
    await h.panel.openTask(ref); h.panel.setDetailTab('related')
    expect(html(h.panel)).toContain('原生 Issue 父子关系')
    expect(html(h.panel)).not.toContain('已验收完成')
    expect(h.client.command).not.toHaveBeenCalled()
  })
})
