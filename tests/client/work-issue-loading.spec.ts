import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { createWorkClient } from '../../src/client/work-api.ts'
import type { WorkCompleted, WorkRequest, WorkResult, WorkTask } from '../../src/work-types.ts'
import type { GitHubIssue, WorkSource } from '../../src/work-sources/types.ts'

const identity = { login: 'developer', nodeId: 'U1', name: null }
const issue: GitHubIssue = { nodeId: 'I1', number: 1, title: 'Selected requirement', body: 'Saved original body', url: 'https://github.com/acme/app/issues/1', repository: { owner: 'acme', repository: 'app' }, state: 'open', assignees: [], labels: [], updatedAt: '2026-10-20', observedAt: '2026-10-21' }
const other: GitHubIssue = { ...issue, nodeId: 'I2', title: 'Other repository requirement', repository: { owner: 'acme', repository: 'other' }, url: 'https://github.com/acme/other/issues/1' }
const source: WorkSource = { id: 's1', projectId: 'p1', provider: 'github', githubProject: { owner: 'acme', type: 'org', number: 1 }, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [], identity }
const task: WorkTask = { id: 't1', projectId: 'p1', title: issue.title, goal: issue.title, version: 1, agentId: 'a1', specification: { version: 1, text: issue.body!, acceptance: [] }, specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [] }
const bindingFor = (value: GitHubIssue) => ({ provider: 'github' as const, nodeId: value.nodeId, urls: [value.url], sourceIds: ['s1'], ref: { projectId: 'p1', taskId: task.id }, accepted: value, lastObserved: value })
const html = (panel: WorkPanelController) => renderToStaticMarkup(createElement(WorkPanel, { controller: panel }))
function gate<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
async function fixture() {
  const reads: { request: WorkRequest; signal?: AbortSignal | null }[] = []
  let sources = [source]
  let detailRead = async (number: number, nodeId?: string): Promise<WorkResult> => ({ status: 'completed', source, issue: { ...(nodeId === other.nodeId ? other : issue), number } })
  let taskRead = async (): Promise<WorkCompleted> => ({ status: 'completed', task })
  const command = vi.fn()
  const client = createWorkClient(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as WorkRequest
    reads.push({ request, signal: init?.signal })
    const q = request.value
    const result = q.type === 'source.issue' ? await detailRead(q.number, q.nodeId)
      : q.type === 'task.detail' ? await taskRead()
      : { status: 'completed', ...(q.type === 'projects.list' ? { projects: [{ id: 'p1', name: 'Project', version: 1, defaultAgentId: 'a1', resources: [] }] }
        : q.type === 'project.detail' ? { project: { id: 'p1' }, tasks: [] }
        : q.type === 'source.list' ? { sources }
        : q.type === 'source.issues' ? { source, page: { identity, items: [issue, other], observedAt: issue.observedAt } } : {}) }
    return Response.json(result)
  })
  client.command = command
  const panel = new WorkPanelController(client, { selectPanel: vi.fn(), openSession: vi.fn() })
  await panel.load(); await panel.selectSourceTab('issues')
  return { panel, reads, command, sources: (value: WorkSource[]) => { sources = value }, detail: (read: typeof detailRead) => { detailRead = read }, task: (read: typeof taskRead) => { taskRead = read } }
}

describe('Issue navigation before remote detail is available (#257)', () => {
  it('opens the actual detail surface immediately, then replaces cached identity with the remote result', async () => {
    const h = await fixture(), pending = gate<WorkCompleted>()
    h.detail(() => pending.promise)
    const opening = h.panel.openIssue(1, true, issue.nodeId)
    const loading = html(h.panel)
    expect(loading).toContain('返回 Issue 列表')
    expect(loading).toContain('#1 Selected requirement')
    expect(loading).toContain('正在加载 Issue 详情与进展')
    expect(loading).toContain('aria-busy="true"')
    expect(loading).not.toContain('GitHub Issue 列表')
    expect(loading).not.toContain('尚未开始处理')
    pending.resolve({ status: 'completed', source, issue: { ...issue, title: 'Fresh requirement', body: 'Fresh complete body' } })
    await opening
    expect(html(h.panel)).toContain('Fresh complete body')
    expect(html(h.panel)).toContain('#1 Fresh requirement')
    expect(html(h.panel)).not.toContain('正在加载 Issue 详情与进展')
    expect(h.command).not.toHaveBeenCalled()
  })

  it('keeps an uncached Issue detail open on failure and retries in place', async () => {
    const h = await fixture(), pending = gate<WorkCompleted>()
    h.detail(() => pending.promise)
    const opening = h.panel.openIssue(99, true, 'I99')
    expect(html(h.panel)).toContain('返回 Issue 列表')
    expect(html(h.panel)).toContain('#99')
    expect(html(h.panel)).not.toContain('Selected requirement')
    pending.reject(Error('remote unavailable'))
    await opening
    const failed = html(h.panel)
    expect(failed).toContain('remote unavailable')
    expect(failed).toContain('重试加载详情')
    expect(failed).not.toContain('GitHub Issue 列表')
    expect(failed).not.toContain('开始处理')
    h.detail(async () => ({ status: 'completed', source, issue: { ...issue, number: 99, nodeId: 'I99' } }))
    await h.panel.openIssue(99, true, 'I99')
    expect(html(h.panel)).toContain('Saved original body')
  })

  it('aborts a superseded read and ignores its result even when two repositories have the same Issue number', async () => {
    const h = await fixture(), old = gate<WorkCompleted>()
    h.detail(async (_number, nodeId) => nodeId === issue.nodeId ? old.promise : { status: 'completed', source, issue: other })
    const earlier = h.panel.openIssue(1, true, issue.nodeId)
    const read = h.reads.find(item => item.request.value.type === 'source.issue')!
    const newer = h.panel.openIssue(1, true, other.nodeId)
    expect(html(h.panel)).toContain('#1 Other repository requirement')
    expect(html(h.panel)).not.toContain('Selected requirement')
    expect(read.signal?.aborted).toBe(true)
    await newer
    old.resolve({ status: 'completed', source, issue })
    await earlier
    expect(h.panel.getSnapshot().source.issue?.nodeId).toBe(other.nodeId)
  })

  it('returns to the same list while loading and cannot be reopened by the late response', async () => {
    const h = await fixture(), pending = gate<WorkCompleted>()
    await h.panel.browseIssues({ assignee: '*', page: 2 })
    h.detail(() => pending.promise)
    const opening = h.panel.openIssue(1, true, issue.nodeId)
    const read = h.reads.find(item => item.request.value.type === 'source.issue')!
    h.panel.back()
    expect(html(h.panel)).toContain('GitHub Issue 列表')
    expect(html(h.panel)).not.toContain('返回 Issue 列表')
    expect(read.signal?.aborted).toBe(true)
    pending.resolve({ status: 'completed', source, issue })
    await opening
    expect(h.panel.getSnapshot()).toMatchObject({ detail: null, source: { issue: null, page: 2, assignee: '*', loading: false } })
    expect(html(h.panel)).not.toContain('返回 Issue 列表')
  })

  it('retains actual cached text on failure without claiming that work has not started', async () => {
    const h = await fixture()
    h.detail(async () => { throw Error('remote unavailable') })
    await h.panel.openIssue(1, true, issue.nodeId)
    expect(html(h.panel)).toContain('Saved original body')
    expect(html(h.panel)).toContain('进展状态尚未确认')
    expect(html(h.panel)).toContain('重试加载详情')
    expect(html(h.panel)).not.toContain('尚未开始处理')
    expect(html(h.panel)).not.toContain('>开始处理<')
  })

  it('rejects a remote response for a different repository Issue with the same number', async () => {
    const h = await fixture()
    h.detail(async () => ({ status: 'completed', source, issue: other }))
    await h.panel.openIssue(1, true, issue.nodeId)
    expect(html(h.panel)).toContain('Issue 身份与读取响应不一致')
    expect(html(h.panel)).not.toContain('Other repository requirement')
    expect(h.panel.getSnapshot().source.issue?.nodeId).toBe(issue.nodeId)
  })

  it('leaves a retryable detail after unmount cancels a pending read', async () => {
    const h = await fixture(), pending = gate<WorkCompleted>()
    h.detail(() => pending.promise)
    const opening = h.panel.openIssue(1, true, issue.nodeId)
    h.panel.leavePanel()
    pending.resolve({ status: 'completed', source, issue: { ...issue, title: 'Late title' } })
    await opening
    await h.panel.initialize()
    expect(html(h.panel)).toContain('详情读取已中断')
    expect(html(h.panel)).toContain('重试加载详情')
    expect(html(h.panel)).not.toContain('Late title')
    expect(html(h.panel)).not.toContain('尚未开始处理')
  })

  it('retries the failed remote read even after cached bindings resolve an existing Task', async () => {
    const h = await fixture(), binding = bindingFor(issue)
    h.detail(async () => ({ status: 'failed', error: { code: 'github-offline', message: 'Remote unavailable' }, source, issue, bindings: [binding] }))
    h.task(async () => ({ status: 'completed', task, bindings: [binding] }))
    await h.panel.openIssue(1, true, issue.nodeId)
    expect(h.panel.getSnapshot()).toMatchObject({ detail: { task: { id: task.id } }, source: { error: 'github-offline: Remote unavailable' } })
    h.detail(async () => ({ status: 'completed', source, issue: { ...issue, body: 'Retried remote body' }, bindings: [binding] }))
    const before = h.reads.length
    await h.panel.refreshDetail()
    expect(h.reads.slice(before).map(item => item.request.value.type)).toEqual(['source.issue', 'task.detail'])
    expect(h.panel.getSnapshot().source.error).toBeNull()
    expect(h.panel.getSnapshot().source.issue?.body).toBe('Retried remote body')
  })

  it('clears loading and resumes observation when changing sources during a pending progress read', async () => {
    const h = await fixture(), pending = gate<WorkCompleted>()
    h.sources([source, { ...source, id: 's2', githubProject: { owner: 'acme', type: 'org', number: 2 } }])
    await h.panel.showSources()
    h.detail(async () => ({ status: 'completed', source, issue, bindings: [bindingFor(issue)] }))
    h.task(() => pending.promise)
    const opening = h.panel.openIssue(1, true, issue.nodeId)
    await vi.waitFor(() => expect(h.reads.some(item => item.request.value.type === 'task.detail')).toBe(true))
    await h.panel.selectConnectedSource('p1', 's2')
    expect(h.panel.getSnapshot()).toMatchObject({ loading: false, source: { sourceId: 's2', loading: false } })
    pending.resolve({ status: 'completed', task })
    await opening
    expect(h.panel.getSnapshot().detail).toBeNull()
    const before = h.reads.length
    await h.panel.observeCurrent()
    expect(h.reads.length).toBeGreaterThan(before)
  })

  it('preserves the clicked Issue identity when its Task has several Issue bindings', async () => {
    const h = await fixture()
    h.detail(async () => ({ status: 'completed', source, issue: other, bindings: [bindingFor(other)] }))
    h.task(async () => ({ status: 'completed', task, bindings: [bindingFor(issue), bindingFor(other)] }))
    await h.panel.openIssue(1, true, other.nodeId)
    expect(html(h.panel).match(/<h1>(.*?)<\/h1>/)?.[1]).toBe('#1 Other repository requirement')
    expect(h.panel.getSnapshot().source.issue?.nodeId).toBe(other.nodeId)
  })

  it('continues showing a loading state while existing work progress is pending', async () => {
    const h = await fixture(), pending = gate<WorkCompleted>()
    const binding = { provider: 'github' as const, nodeId: issue.nodeId, urls: [issue.url], sourceIds: ['s1'], ref: { projectId: 'p1', taskId: task.id }, accepted: issue, lastObserved: issue }
    h.detail(async () => ({ status: 'completed', source, issue, bindings: [binding] }))
    h.task(() => pending.promise)
    const opening = h.panel.openIssue(1, true, issue.nodeId)
    await vi.waitFor(() => expect(h.reads.some(item => item.request.value.type === 'task.detail')).toBe(true))
    expect(html(h.panel)).toContain('正在加载 Issue 详情与进展')
    expect(html(h.panel)).not.toContain('尚未开始处理')
    pending.resolve({ status: 'completed', task, bindings: [binding] })
    await opening
    expect(h.panel.getSnapshot().detail?.task?.id).toBe(task.id)
    expect(html(h.panel)).not.toContain('正在加载 Issue 详情与进展')
  })
})
