import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import type { WorkClient } from '../../src/client/work-api.ts'
import type { SessionRef, WorkCompleted, WorkExecution, WorkTask } from '../../src/work-types.ts'

const ref = { projectId: 'p1', taskId: 't1' }
const old = { runtimeId: 'host', sessionId: 'old-session' }, older = { runtimeId: 'host', sessionId: 'older-session' }
const task: WorkTask = { id: 't1', projectId: 'p1', title: '查看历史上下文', goal: '连续处理', version: 2, agentId: 'a1', specification: { version: 1, text: '保存决定', acceptance: ['可只读查看历史'] }, specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [{ commandId: 'hierarchy', type: 'source.link-hierarchy', version: 2 }] }
const execution: WorkExecution = { id: 'e1', ref, agentId: 'a1', owner: 'owner', epoch: 3, resource: { runtimeId: 'host', workspaceId: 'workspace' }, session: { runtimeId: 'host', sessionId: 'current' }, sessionMode: 'create', agentPreset: 'standard', model: { provider: 'provider', model: 'model' }, permissionPreset: 'read-only', policy: { version: 1, instructions: '', capabilities: ['coordination'], modelCandidates: [] }, state: 'ready', history: [], events: [], retired: [{ session: older, epoch: 1, operationId: 'op1' }, { session: old, epoch: 2, operationId: 'op2' }] }
function setup() {
  const navigation = { selectPanel: vi.fn(), openSession: vi.fn() }
  const client: WorkClient = {
    command: vi.fn(async () => { throw Error('History must not write') }),
    query: vi.fn(async (query): Promise<WorkCompleted> => {
      if (query.type === 'task.detail') return { status: 'completed', task: { ...task, id: query.ref.taskId }, execution }
      return { status: 'completed', projects: [{ id: 'p1', name: '项目', version: 1, defaultAgentId: 'a1', resources: [] }], tasks: [task] }
    }),
  }
  return { client, navigation, panel: new WorkPanelController(client, navigation) }
}
const page = (session: SessionRef, events: unknown[], nextCursor?: number): WorkCompleted => ({ status: 'completed', transcript: { session, events, ...(nextCursor === undefined ? {} : { nextCursor }) } })
const html = (panel: WorkPanelController) => renderToStaticMarkup(createElement(WorkPanel, { controller: panel }))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

describe('read-only retired Session history', () => {
  it('reads Task-scoped pages, uses the returned cursor and escapes transcript markup without native navigation', async () => {
    const h = setup(); await h.panel.openTask(ref)
    const query = vi.mocked(h.client.query)
    query.mockResolvedValueOnce(page(old, [{ type: 'message', text: '<script>alert(1)</script>\naccepted decision' }], 71))
      .mockResolvedValueOnce(page(old, ['next step retained']))
    await h.panel.openHistory(old); await Promise.all([h.panel.moreHistory(), h.panel.moreHistory()])
    expect(query.mock.calls.slice(-2).map(([value]) => value)).toEqual([
      { type: 'task.history', ref, session: old, limit: 50 },
      { type: 'task.history', ref, session: old, cursor: 71, limit: 50 },
    ])
    expect(h.panel.getSnapshot().history.events).toHaveLength(2)
    expect(h.panel.getSnapshot().history.nextCursor).toBeUndefined()
    const rendered = html(h.panel)
    for (const text of ['查看记录', '历史记录 · 只读', 'accepted decision', 'next step retained', '已读到记录末尾', '&lt;script&gt;']) expect(rendered).toContain(text)
    expect(rendered).not.toContain('<script>')
    expect(h.client.command).not.toHaveBeenCalled()
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(h.panel.getSnapshot().detail?.execution?.session.sessionId).toBe('current')
    h.panel.setDetailTab('activity')
    expect(html(h.panel)).toContain('原生 Issue 父子关联')
  })
  it('aborts and discards a page when changing Tasks', async () => {
    const h = setup(); await h.panel.openTask(ref)
    const pending = deferred<WorkCompleted>(), original = h.client.query
    let signal: AbortSignal | undefined
    h.client.query = async (query, currentSignal) => query.type === 'task.history' ? (signal = currentSignal, pending.promise) : original(query)
    const reading = h.panel.openHistory(old)
    await h.panel.openTask({ projectId: 'p1', taskId: 'another-task' })
    expect(signal?.aborted).toBe(true)
    pending.resolve(page(old, ['must stay hidden'])); await reading
    expect(h.panel.getSnapshot().history).toMatchObject({ session: null, events: [], loading: false })
    expect(html(h.panel)).not.toContain('must stay hidden')
    expect(h.navigation.openSession).not.toHaveBeenCalled()
  })
  it('fences out-of-order history reads and clears history on panel exit', async () => {
    const h = setup(); await h.panel.openTask(ref)
    const first = deferred<WorkCompleted>()
    vi.mocked(h.client.query).mockReturnValueOnce(first.promise).mockResolvedValueOnce(page(older, ['older context']))
    const reading = h.panel.openHistory(old); await h.panel.openHistory(older)
    first.resolve(page(old, ['late context'])); await reading
    expect(h.panel.getSnapshot().history).toMatchObject({ session: older, events: ['older context'] })
    h.panel.leavePanel()
    expect(h.panel.getSnapshot().history.session).toBeNull()
  })
  it('retains the prior page on failure and retries the same cursor once', async () => {
    const h = setup(); await h.panel.openTask(ref)
    const query = vi.mocked(h.client.query)
    query.mockResolvedValueOnce(page(old, ['first'], 9)).mockRejectedValueOnce(Error('读取暂不可用')).mockResolvedValueOnce(page(old, ['second']))
    await h.panel.openHistory(old); await h.panel.moreHistory()
    expect(h.panel.getSnapshot().history).toMatchObject({ events: ['first'], nextCursor: 9, error: '读取暂不可用', loading: false })
    expect(html(h.panel)).toContain('重试读取')
    await h.panel.retryHistory()
    expect(query.mock.calls.slice(-2).map(([value]) => value)).toEqual([
      { type: 'task.history', ref, session: old, cursor: 9, limit: 50 },
      { type: 'task.history', ref, session: old, cursor: 9, limit: 50 },
    ])
    expect(h.panel.getSnapshot().history.events).toEqual(['first', 'second'])
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it('rejects mismatched transcript identity and non-advancing cursors without appending content', async () => {
    const h = setup(); await h.panel.openTask(ref)
    const query = vi.mocked(h.client.query)
    query.mockResolvedValueOnce(page(older, ['wrong session']))
    await h.panel.openHistory(old)
    expect(h.panel.getSnapshot().history.error).toContain('不一致')
    expect(h.panel.getSnapshot().history.events).toEqual([])
    query.mockResolvedValueOnce(page(old, ['first'], 9)).mockResolvedValueOnce(page(old, ['must not append'], 9))
    await h.panel.openHistory(old); await h.panel.moreHistory()
    expect(h.panel.getSnapshot().history.error).toContain('未向前推进')
    expect(h.panel.getSnapshot().history.events).toEqual(['first'])
  })
  it('does not query arbitrary or current Sessions as retired history', async () => {
    const h = setup(); await h.panel.openTask(ref)
    vi.mocked(h.client.query).mockClear()
    await h.panel.openHistory(execution.session)
    expect(h.panel.getSnapshot().history.error).toContain('不属于当前工作')
    expect(h.client.query).not.toHaveBeenCalled()
    expect(h.client.command).not.toHaveBeenCalled()
    expect(h.navigation.openSession).not.toHaveBeenCalled()
  })
})
