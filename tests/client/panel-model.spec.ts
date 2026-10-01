import { describe, expect, it } from 'vitest'
import {
  EMPTY_SESSION_TITLE,
  createSessionTitleLoader,
  handoffForest,
  nextPanelState,
  panelLoadState,
  panelSessionTarget,
  panelTaskForest,
  panelSessionTitles,
  panelTally,
  panelTaskRows,
  parsePanelPayload,
  shortSessionId,
  stateLabel,
  type SessionTitleHistoryRead,
} from '../../src/client/panel-model.ts'
import type { PanelPayload } from '../../src/panel-types.ts'

function payload(overrides: Partial<PanelPayload> = {}): PanelPayload {
  return {
    root: '/data/project',
    tasks: [{
      id: 'ship-panel',
      name: 'Ship panel',
      goal: 'make tasks visible',
      state: 'active',
      createdAt: '2026-09-23T03:00:00.000Z',
      members: [
        { sessionId: 'session-aaaa1111' },
        { sessionId: 'session-bbbb2222', handoffFrom: 'session-aaaa1111' },
      ],
    }],
    ...overrides,
  }
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

function historyTitle(title: string | undefined): SessionTitleHistoryRead {
  return title === undefined ? { kind: 'loaded' } : { kind: 'loaded', title }
}

function historyResponse(title: string | undefined) {
  return {
    ok: true,
    value: { values: title === undefined ? {} : { title } },
  } as const
}

describe('panel task view model', () => {
  it('labels stored states and abbreviates the unique part of session ids', () => {
    expect(stateLabel('active')).toBe('进行中')
    expect(stateLabel('paused')).toBe('已暂停')
    expect(stateLabel('done')).toBe('已完成')
    expect(shortSessionId('session-0123456789abcdef')).toBe('01234567')
    expect(shortSessionId('plain-id')).toBe('plain-id')
  })

  it('folds tasks with titles, openability, handoff labels, and current-session highlighting', () => {
    const rows = panelTaskRows(
      payload(),
      { 'session-aaaa1111': 'Original session' },
      id => id === 'session-aaaa1111',
      'session-bbbb2222',
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'ship-panel',
      name: 'Ship panel',
      goal: 'make tasks visible',
      stateLabel: '进行中',
      created: '2026-09-23',
      current: true,
      handoffs: 1,
    })
    expect(rows[0]?.members[0]).toMatchObject({
      sessionId: 'session-aaaa1111',
      title: 'Original session',
      current: false,
      openable: true,
    })
    expect(rows[0]?.members[1]).toMatchObject({
      sessionId: 'session-bbbb2222',
      current: true,
      openable: false,
      handoffFromLabel: 'Original session',
    })
  })

  it('shows a task issue\'s number, its kind by parent, and its openable main session; an unbound task shows none', () => {
    const task = payload().tasks[0]!
    const rows = panelTaskRows(
      payload({
        tasks: [
          { ...task, id: 'issue-41', issue: { number: 41, mainSession: 'session-aaaa1111' } },
          { ...task, id: 'issue-45', issue: { number: 45, parent: 41, mainSession: 'session-bbbb2222' } },
          task,
        ],
      }),
      { 'session-aaaa1111': 'CEO of #41' },
      id => id === 'session-aaaa1111',
      'session-aaaa1111',
    )

    expect(rows[0]?.issue).toEqual({
      number: 41,
      kind: 'main',
      kindLabel: '主任务',
      mainSession: expect.objectContaining({ sessionId: 'session-aaaa1111', label: 'CEO of #41', openable: true, current: true }),
    })
    expect(rows[1]?.issue).toEqual({
      number: 45,
      parent: 41,
      kind: 'sub',
      kindLabel: '子任务',
      mainSession: expect.objectContaining({ sessionId: 'session-bbbb2222', label: 'bbbb2222', openable: false, current: false }),
    })
    expect(rows[2]).not.toHaveProperty('issue')
  })

  it('arranges task issue rows into a parent-child forest while leaving unbound tasks at the root', () => {
    const task = payload().tasks[0]!
    const rows = panelTaskRows(
      payload({
        tasks: [
          { ...task, id: 'issue-49', name: 'Open subtask', issue: { number: 49, parent: 41, mainSession: 'session-child' } },
          { ...task, id: 'legacy', name: 'Legacy task' },
          { ...task, id: 'issue-41', name: 'CEO carrier', issue: { number: 41, mainSession: 'session-parent' } },
          { ...task, id: 'issue-50', name: 'Complete subtask', issue: { number: 50, parent: 49, mainSession: 'session-grandchild' } },
        ],
      }),
      {},
      () => true,
      'session-child',
    )

    expect(panelTaskForest(rows).map(node => ({
      id: node.row.id,
      children: node.children.map(child => ({
        id: child.row.id,
        children: child.children.map(grandchild => grandchild.row.id),
      })),
    }))).toEqual([
      {
        id: 'issue-41',
        children: [{ id: 'issue-49', children: ['issue-50'] }],
      },
      { id: 'legacy', children: [] },
    ])
  })

  it('prefers list titles, then cold-read titles, before blank placeholders', () => {
    const rows = panelTaskRows(
      payload(),
      panelSessionTitles(
        {
          'session-aaaa1111': {
            title: '  List title  ',
            blank: true,
            projectionValues: { sessionStats: { turns: 0 } },
          },
          'session-bbbb2222': { title: null },
        },
        {
          'session-aaaa1111': historyTitle('History title'),
          'session-bbbb2222': historyTitle('Cold title'),
        },
      ),
      () => true,
      'session-bbbb2222',
    )

    expect(rows[0]?.members.map(member => member.label)).toEqual(['List title', 'Cold title'])
    expect(rows[0]?.members[1]?.handoffFromLabel).toBe('List title')
  })

  it('shows a readable placeholder for blank sessions with no title', () => {
    const task = payload().tasks[0]!
    const rows = panelTaskRows(
      payload({
        tasks: [{
          ...task,
          members: [
            { sessionId: 'session-blank' },
            { sessionId: 'session-zero' },
          ],
        }],
      }),
      panelSessionTitles(
        {
          'session-blank': { title: null, blank: true, projectionValues: { sessionStats: { turns: 0 } } },
          'session-zero': { projectionValues: { sessionStats: { turns: 0 } } },
        },
        {
          'session-blank': historyTitle(undefined),
          'session-zero': historyTitle(undefined),
        },
      ),
      () => true,
      'session-zero',
    )

    expect(rows[0]?.members.map(member => member.label)).toEqual([EMPTY_SESSION_TITLE, EMPTY_SESSION_TITLE])
  })

  it('falls back to the short id after a title cold read fails', () => {
    const [row] = panelTaskRows(
      payload(),
      panelSessionTitles(
        { 'session-aaaa1111': { title: null } },
        { 'session-aaaa1111': { kind: 'failed' } },
      ),
      () => true,
      'session-bbbb2222',
    )

    expect(row?.members[0]?.label).toBe('aaaa1111')
    expect(row?.members[0]?.title).toBeUndefined()
  })

  it('keeps a pending cold-read candidate off the short-id fallback', () => {
    const [row] = panelTaskRows(
      payload(),
      panelSessionTitles({}, {}, ['session-aaaa1111']),
      () => true,
      'session-bbbb2222',
    )

    expect(row?.members[0]?.label).toBe('读取标题中')
  })

  it('builds task members into a handoff forest and roots orphans', () => {
    const task = payload().tasks[0]!
    const [row] = panelTaskRows(
      payload({
        tasks: [{
          ...task,
          members: [
            { sessionId: 'session-root' },
            { sessionId: 'session-child', handoffFrom: 'session-root' },
            { sessionId: 'session-grandchild', handoffFrom: 'session-child' },
            { sessionId: 'session-orphan', handoffFrom: 'session-missing' },
          ],
        }],
      }),
      {},
      () => true,
      'session-grandchild',
    )

    expect(handoffForest(row?.members ?? []).map(node => ({
      id: node.row.sessionId,
      children: node.children.map(child => ({
        id: child.row.sessionId,
        children: child.children.map(grandchild => grandchild.row.sessionId),
      })),
    }))).toEqual([
      {
        id: 'session-root',
        children: [{ id: 'session-child', children: ['session-grandchild'] }],
      },
      { id: 'session-orphan', children: [] },
    ])
  })

  it('breaks handoff cycles without dropping members', () => {
    const task = payload().tasks[0]!
    const [row] = panelTaskRows(
      payload({
        tasks: [{
          ...task,
          members: [
            { sessionId: 'session-a', handoffFrom: 'session-c' },
            { sessionId: 'session-b', handoffFrom: 'session-a' },
            { sessionId: 'session-c', handoffFrom: 'session-b' },
          ],
        }],
      }),
      {},
      () => true,
      'session-b',
    )

    expect(handoffForest(row?.members ?? []).map(node => ({
      id: node.row.sessionId,
      children: node.children.map(child => ({
        id: child.row.sessionId,
        children: child.children.map(grandchild => grandchild.row.sessionId),
      })),
    }))).toEqual([
      {
        id: 'session-a',
        children: [{ id: 'session-b', children: ['session-c'] }],
      },
    ])
  })

  it('falls back to current-session and short-id labels for handoff edges', () => {
    const [currentSource] = panelTaskRows(payload(), {}, () => true, 'session-aaaa1111')
    const [unknownSource] = panelTaskRows(payload(), {}, () => true, 'session-zzzz9999')

    expect(currentSource?.members[1]?.handoffFromLabel).toBe('当前会话')
    expect(unknownSource?.members[1]?.handoffFromLabel).toBe('aaaa1111')
  })

  it('summarizes empty, failed, and loaded states distinctly', () => {
    expect(panelLoadState(undefined, undefined)).toEqual({ kind: 'loading' })
    expect(panelLoadState(payload({ tasks: [] }), undefined)).toEqual({ kind: 'empty' })
    expect(panelLoadState(undefined, 'read failed')).toEqual({ kind: 'failed', message: 'read failed' })
    expect(panelLoadState(payload(), undefined)).toEqual({ kind: 'loaded' })
  })

  it('clears stale payload when a refresh fails', () => {
    expect(nextPanelState({ payload: payload(), failure: undefined }, { kind: 'failed', message: 'read failed' }))
      .toEqual({ payload: undefined, failure: 'read failed' })
  })

  it('replaces failure with the latest successful payload', () => {
    const latest = payload({ root: '/data/latest' })

    expect(nextPanelState({ payload: undefined, failure: 'read failed' }, { kind: 'ok', payload: latest }))
      .toEqual({ payload: latest, failure: undefined })
  })

  it('counts tasks, active tasks, aggregated members, and the current task', () => {
    const rows = panelTaskRows(payload(), {}, () => true, 'session-bbbb2222')

    expect(panelTally(rows)).toEqual({
      total: 1,
      active: 1,
      members: 2,
      current: rows[0],
    })
  })

  it('omits the current task when the session belongs to none', () => {
    const rows = panelTaskRows(payload(), {}, () => true, 'session-other')

    expect(panelTally(rows)).toEqual({ total: 1, active: 1, members: 2 })
  })

  it('resolves a subagent panel to its main session task owner', () => {
    const childId = 'd12521d2-1ec2-494b-95a9-ebde5fa3db76'
    expect(panelSessionTarget({
      'session-root': { id: 'session-root', displayTitle: 'Main' },
      [childId]: {
        id: childId,
        displayTitle: 'Child',
        origin: 'subagent',
        parentId: 'session-root',
      },
    }, childId)).toEqual({
      querySessionId: 'session-root',
      currentMemberSessionId: 'session-root',
      openedSessionId: childId,
      openedAsSubagent: true,
    })
  })

  it('falls back to the opened session while a subagent parent chain is unavailable', () => {
    const childId = 'd12521d2-1ec2-494b-95a9-ebde5fa3db76'
    expect(panelSessionTarget({
      [childId]: {
        id: childId,
        displayTitle: 'Child',
        origin: 'subagent',
        parentId: 'session-missing',
      },
    }, childId)).toEqual({
      querySessionId: childId,
      currentMemberSessionId: childId,
      openedSessionId: childId,
      openedAsSubagent: false,
    })
  })
})

describe('createSessionTitleLoader', () => {
  it('keeps an in-flight title read alive and deduplicated when the same ids arrive as a new array', async () => {
    const pending = deferred<ReturnType<typeof historyResponse>>()
    const signals: AbortSignal[] = []
    const calls: unknown[] = []
    const loader = createSessionTitleLoader({
      session: {
        projections: (payload, signal) => {
          calls.push(payload)
          if (signal !== undefined) signals.push(signal)
          return pending.promise
        },
      },
    })

    loader.load(['session-aaaa1111'])
    loader.load(['session-aaaa1111'])

    expect(calls).toEqual([{ sessionId: 'session-aaaa1111' }])
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)

    pending.resolve(historyResponse('Cold title'))
    await pending.promise
    await Promise.resolve()

    expect(loader.snapshot()).toEqual({ 'session-aaaa1111': { kind: 'loaded', title: 'Cold title' } })

    loader.load(['session-aaaa1111'])
    expect(calls).toHaveLength(1)
    loader.dispose()
  })

  it('isolates failed title reads and records a fallback state', async () => {
    const loader = createSessionTitleLoader({
      session: {
        projections: async (payload) => {
          if (payload.sessionId === 'session-bad') throw new Error('projections unavailable')
          return historyResponse(`Title ${payload.sessionId}`)
        },
      },
    })

    loader.load(['session-bad', 'session-good'])
    await Promise.resolve()
    await Promise.resolve()

    expect(loader.snapshot()).toEqual({
      'session-bad': { kind: 'failed' },
      'session-good': { kind: 'loaded', title: 'Title session-good' },
    })
    loader.dispose()
  })
})

describe('panel payload parsing', () => {
  it('accepts the route shape and rejects foreign response bodies', () => {
    expect(parsePanelPayload(payload())).toEqual(payload())
    expect(parsePanelPayload({ root: '/tmp/project', tasks: [] })).toEqual({ root: '/tmp/project', tasks: [] })
    expect(parsePanelPayload(null)).toBeUndefined()
    expect(parsePanelPayload({ tasks: [] })).toBeUndefined()
    expect(parsePanelPayload({ root: '/tmp/project' })).toBeUndefined()
    expect(parsePanelPayload({ ...payload(), tasks: [{ ...payload().tasks[0], state: 'running' }] })).toBeUndefined()
    expect(parsePanelPayload({ ...payload(), tasks: [{ ...payload().tasks[0], members: [{ handoffFrom: 'x' }] }] })).toBeUndefined()
  })

  it('accepts a task issue and rejects a malformed one', () => {
    const task = payload().tasks[0]!
    const bound = payload({ tasks: [{ ...task, issue: { number: 45, parent: 41, mainSession: 'session-aaaa1111' } }] })
    expect(parsePanelPayload(bound)).toEqual(bound)
    expect(parsePanelPayload({ ...payload(), tasks: [{ ...task, issue: { number: '45', mainSession: 'session-a' } }] })).toBeUndefined()
    expect(parsePanelPayload({ ...payload(), tasks: [{ ...task, issue: { number: 45 } }] })).toBeUndefined()
  })
})
