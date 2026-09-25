import { describe, expect, it } from 'vitest'
import {
  handoffForest,
  nextPanelState,
  panelLoadState,
  panelTally,
  panelTaskRows,
  parsePanelPayload,
  shortSessionId,
  stateLabel,
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
})
