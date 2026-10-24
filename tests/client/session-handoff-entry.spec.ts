import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { SessionWorkLinks } from '../../src/client/work-panel.tsx'
import type { WorkClient } from '../../src/client/work-api.ts'
import type { AssociatedWork, WorkCompleted, WorkExecution, WorkQuery, WorkTask } from '../../src/work-types.ts'

const ref = { projectId: 'p1', taskId: 't1' }
const related: AssociatedWork = { ref, title: '连续任务', projectName: '项目', purpose: 'control', executionId: 'e1', epoch: 1 }
const task: WorkTask = { id: 't1', projectId: 'p1', title: related.title, goal: '继续工作', version: 1, agentId: 'a1', specification: { version: 1, text: '规格', acceptance: ['完成'] }, specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [] }
const execution: WorkExecution = { id: 'e1', ref, owner: 'owner', epoch: 3, agentId: 'a1', resource: { runtimeId: 'host', workspaceId: 'ws' }, session: { runtimeId: 'host', sessionId: 'latest-current' }, sessionMode: 'create', agentPreset: 'standard', model: { provider: 'real', model: 'model' }, permissionPreset: 'read-only', policy: { version: 1, instructions: '', capabilities: [], modelCandidates: [] }, state: 'ready', history: [], events: [], actual: { runtimeId: 'host', cwd: '/workspace', agentPreset: 'standard', provider: 'real', model: 'model', permissionPreset: 'read-only', sandbox: 'read-only', approval: 'ask' } }
function setup() {
  let work: AssociatedWork[] = [related]
  const navigation = { selectPanel: vi.fn(), openSession: vi.fn() }
  const client: WorkClient = { command: vi.fn(async (): Promise<WorkCompleted> => { throw Error('No commands allowed') }), query: vi.fn(async (query: WorkQuery): Promise<WorkCompleted> => {
    if (query.type === 'resources.list') return { status: 'completed', resources: [{ ref: { runtimeId: 'host', workspaceId: 'ws' }, title: '工作目录' }] }
    if (query.type === 'session.work') return { status: 'completed', work }
    if (query.type === 'task.detail') return { status: 'completed', task, execution }
    return { status: 'completed' }
  }) }
  return { client, navigation, panel: new WorkPanelController(client, navigation), setWork: (value: AssociatedWork[]) => { work = value } }
}
const stops: (() => void)[] = []
afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.useRealTimers() })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

describe('native chat takeover visibility', () => {
  it('observes control becoming history and renders an explicit takeover link without auto-navigation or commands', async () => {
    vi.useFakeTimers()
    const h = setup(), receive = vi.fn(), reportError = vi.fn(), enter = vi.fn()
    stops.push(h.panel.watchSessionWork('old-session', receive, reportError))
    await vi.advanceTimersByTimeAsync(0)
    expect(receive).toHaveBeenLastCalledWith([related])
    h.setWork([{ ...related, purpose: 'history', epoch: 2 }])
    await vi.advanceTimersByTimeAsync(5000)
    const work = receive.mock.lastCall![0] as AssociatedWork[]
    expect(work[0]?.purpose).toBe('history')
    const rendered = renderToStaticMarkup(createElement(SessionWorkLinks, { work, onReveal: vi.fn(), onEnter: enter }))
    expect(rendered).toContain('处理会话已切换')
    expect(rendered).toContain('内容投递状态')
    expect(rendered).toContain('进入当前处理会话')
    expect(enter).not.toHaveBeenCalled()
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(h.client.command).not.toHaveBeenCalled()
    expect(vi.mocked(h.client.query).mock.calls.every(([query]) => query.type === 'resources.list' || query.type === 'session.work')).toBe(true)
  })
  it('never overlaps reads and ignores aborted unmount responses and later timer ticks', async () => {
    vi.useFakeTimers()
    const h = setup(), receive = vi.fn(), errors = vi.fn(), pending = deferred<WorkCompleted>(), original = h.client.query
    let signal: AbortSignal | undefined
    h.client.query = vi.fn(async (query: WorkQuery, currentSignal?: AbortSignal): Promise<WorkCompleted> => {
      if (query.type === 'session.work') { signal = currentSignal; return pending.promise }
      return original(query, currentSignal)
    })
    const stop = h.panel.watchSessionWork('old-session', receive, errors); stops.push(stop)
    await vi.advanceTimersByTimeAsync(15000)
    expect(vi.mocked(h.client.query).mock.calls).toHaveLength(2)
    stop(); expect(signal?.aborted).toBe(true)
    pending.resolve({ status: 'completed', work: [{ ...related, purpose: 'history' }] })
    await vi.advanceTimersByTimeAsync(15000)
    expect(receive).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    expect(vi.mocked(h.client.query).mock.calls).toHaveLength(2)
    expect(h.navigation.openSession).not.toHaveBeenCalled()
  })
  it('queries fresh task authority on an explicit click and enters only its verified current native Session', async () => {
    const h = setup()
    await h.panel.openCurrentTask(ref)
    expect(h.client.query).toHaveBeenCalledWith({ type: 'task.detail', ref }, expect.any(AbortSignal))
    expect(h.navigation.openSession).toHaveBeenCalledExactlyOnceWith('latest-current')
    expect(h.client.command).not.toHaveBeenCalled()
    vi.mocked(h.navigation.openSession).mockClear()
    vi.mocked(h.client.query).mockResolvedValueOnce({ status: 'completed', task, execution: { ...execution, actual: { ...execution.actual!, runtimeId: 'foreign-host' } } })
    await expect(h.panel.openCurrentTask(ref)).rejects.toThrow('当前处理会话暂不可进入')
    expect(h.navigation.openSession).not.toHaveBeenCalled()
  })
  it('enters the real current Session of a failed execution after handoff without resuming work', async () => {
    const h = setup()
    const runtimeId = 'b921120e-e6dd-4e5d-b109-945d9d692d25'
    const session = { runtimeId, sessionId: 'session-7353477e-dcc2-4e6e-b8c3-5df486cfbe9e' }
    vi.mocked(h.client.query).mockResolvedValueOnce({ status: 'completed', task, execution: {
      ...execution, epoch: 4, state: 'failed', session,
      actual: { ...execution.actual!, runtimeId },
      retired: [{ session: { runtimeId, sessionId: 'session-9af116ad-e4ab-4a92-b9d5-6207d324983a' }, epoch: 3, operationId: 'handoff' }],
    } })
    await h.panel.openCurrentTask(ref)
    expect(h.client.query).toHaveBeenCalledExactlyOnceWith({ type: 'task.detail', ref }, expect.any(AbortSignal))
    expect(h.navigation.openSession).toHaveBeenCalledExactlyOnceWith(session.sessionId)
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it.each([
    ['missing Session', undefined],
    ['empty Session id', { runtimeId: 'host', sessionId: '' }],
    ['empty runtime', { runtimeId: '', sessionId: 'latest-current' }],
  ] as const)('rejects %s with a clear navigation error even when retired history exists', async (_label, session) => {
    const h = setup()
    // Malformed transport payload: static types alone cannot prove a Session exists.
    vi.mocked(h.client.query).mockResolvedValueOnce({ status: 'completed', task, execution: {
      ...execution, state: 'failed', session,
      actual: { ...execution.actual!, runtimeId: session?.runtimeId ?? 'host' },
      retired: [{ session: execution.session, epoch: 2, operationId: 'handoff' }],
    } as WorkExecution })
    await expect(h.panel.openCurrentTask(ref)).rejects.toThrow('当前处理会话暂不可进入')
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it.each<[string, WorkCompleted]>([
    ['no Task', { status: 'completed', execution }],
    ['wrong Task', { status: 'completed', task: { ...task, id: 'other' }, execution }],
    ['wrong Project', { status: 'completed', task: { ...task, projectId: 'other' }, execution }],
    ['no execution', { status: 'completed', task }],
    ['wrong execution Task', { status: 'completed', task, execution: { ...execution, ref: { ...ref, taskId: 'other' } } }],
    ['wrong execution Project', { status: 'completed', task, execution: { ...execution, ref: { ...ref, projectId: 'other' } } }],
    ['no actual', { status: 'completed', task, execution: { ...execution, state: 'failed', actual: undefined } }],
  ])('rejects %s without navigation or execution commands', async (_label, detail) => {
    const h = setup()
    vi.mocked(h.client.query).mockResolvedValueOnce(detail)
    await expect(h.panel.openCurrentTask(ref)).rejects.toThrow('当前处理会话暂不可进入')
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it.each(['completed', 'user-cancelled'] as const)('allows viewing a %s Task execution without restarting it', async terminal => {
    const h = setup()
    const completedTask: WorkTask = { ...task, completion: {
      operationId: 'done', commandId: 'done-command', specificationVersion: 1,
      executionId: execution.id, owner: execution.owner, epoch: execution.epoch,
      completedAt: '2026-10-24T00:00:00Z', closeout: { status: 'settled' },
    } }
    vi.mocked(h.client.query).mockResolvedValueOnce({ status: 'completed',
      task: terminal === 'completed' ? completedTask : task,
      execution: { ...execution, state: terminal === 'completed' ? 'paused' : 'failed',
        ...(terminal === 'user-cancelled' ? { runtimeFailure: { id: 'cancelled', message: '用户取消', userCancelled: true } } : {}),
      },
    })
    await h.panel.openCurrentTask(ref)
    expect(h.navigation.openSession).toHaveBeenCalledExactlyOnceWith('latest-current')
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it('uses the newest click and ignores the superseded response even if its transport ignores abort', async () => {
    const h = setup(), older = deferred<WorkCompleted>()
    vi.mocked(h.client.query).mockReturnValueOnce(older.promise)
    const first = h.panel.openCurrentTask(ref)
    const firstSignal = vi.mocked(h.client.query).mock.calls[0]![1]
    vi.mocked(h.client.query).mockResolvedValueOnce({ status: 'completed', task, execution: {
      ...execution, state: 'failed', epoch: 4, session: { ...execution.session, sessionId: 'successor-current' },
    } })
    await h.panel.openCurrentTask(ref)
    expect(firstSignal?.aborted).toBe(true)
    older.resolve({ status: 'completed', task, execution }); await first
    expect(h.navigation.openSession).toHaveBeenCalledExactlyOnceWith('successor-current')
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it.each(['panel', 'source'] as const)('ignores a late current-session response after %s navigation', async destination => {
    const h = setup(), pending = deferred<WorkCompleted>()
    vi.mocked(h.client.query).mockReturnValueOnce(pending.promise)
    const opening = h.panel.openCurrentTask(ref)
    if (destination === 'panel') h.panel.leavePanel()
    else await h.panel.selectSource('another-source')
    pending.resolve({ status: 'completed', task, execution }); await opening
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it('does not read authority when already cancelled', async () => {
    const h = setup(), scope = new AbortController()
    scope.abort(); await h.panel.openCurrentTask(ref, scope.signal)
    expect(h.client.query).not.toHaveBeenCalled()
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it('surfaces a runtime read failure to the entry without navigation or commands', async () => {
    const h = setup()
    vi.mocked(h.client.query).mockRejectedValueOnce(Error('runtime-unavailable: 宿主不可达'))
    await expect(h.panel.openCurrentTask(ref)).rejects.toThrow('runtime-unavailable: 宿主不可达')
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(h.client.command).not.toHaveBeenCalled()
  })
  it('ignores a fresh-current response when the native entry unmounts before it resolves', async () => {
    const h = setup(), pending = deferred<WorkCompleted>(), scope = new AbortController()
    vi.mocked(h.client.query).mockReturnValueOnce(pending.promise)
    const opening = h.panel.openCurrentTask(ref, scope.signal)
    scope.abort(); pending.resolve({ status: 'completed', task, execution }); await opening
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(h.client.command).not.toHaveBeenCalled()
  })
})
