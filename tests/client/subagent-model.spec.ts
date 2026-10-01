import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { indicatorProjectionDefinition, indicatorProjectionSchema } from '../../src/indicator-projection.ts'
import {
  createRouteSourceLoader,
  formatRoute,
  loadSubagentRouteSources,
  projectedSubagentCatalogs,
  rootAncestor,
  subagentRouteRows,
  subagentRouteHeader,
  subagentRouteTree,
  subagentRouteTally,
  type CatalogEntry,
  type SubagentRouteAddress,
} from '../../src/client/subagent-model.ts'

/** One `request/header` event carrying the route a session was served by. */
function headerEvent(provider: string, model: string): SessionEvent {
  return {
    type: 'request/header',
    seq: 0,
    time: 0,
    data: { header: { config: { provider, model } } },
  } as unknown as SessionEvent
}

/** One catalog entry as the host publishes it for a direct child. */
function childEntry(id: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return { kind: 'child', id, label: `label ${id}`, mode: 'continuable', activity: 'running', ...overrides }
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

function routeHistoryResponse(provider: string, model: string) {
  return {
    ok: true,
    value: { values: { a2d2Indicator: { route: { provider, model } } } },
  } as const
}

function address(childSessionId: string): SubagentRouteAddress {
  return { parentSessionId: 'root', childSessionId, mode: 'continuable' }
}

describe('the indicator projection publishes the route', () => {
  const unit = indicatorProjectionDefinition({
    thresholds: { warnAtTokens: 120_000, criticalAtTokens: 600_000 },
    prices: new Map(),
    currency: '¥',
  })

  it('omits the route before the session has issued a request', () => {
    expect(unit.wire.view(unit.init()).route).toBeUndefined()
  })

  it('carries the newest request/header route', () => {
    const folded = unit.apply(unit.init(), headerEvent('claude-bray', 'claude-fable-5'))
    expect(unit.wire.view(folded).route).toEqual({ provider: 'claude-bray', model: 'claude-fable-5' })
  })

  it('replaces the route when a later request names another one', () => {
    const first = unit.apply(unit.init(), headerEvent('claude-bray', 'claude-fable-5'))
    const second = unit.apply(first, headerEvent('claude', 'claude-opus-4-8'))
    expect(unit.wire.view(second).route).toEqual({ provider: 'claude', model: 'claude-opus-4-8' })
  })

  it('accepts its own wire value, which is what a client receives', () => {
    const folded = unit.apply(unit.init(), headerEvent('claude-bray', 'claude-fable-5'))
    expect(indicatorProjectionSchema.parse(unit.wire.view(folded)).route).toEqual({
      provider: 'claude-bray',
      model: 'claude-fable-5',
    })
  })
})

describe('subagentRouteRows', () => {
  const parent = { route: { provider: 'claude', model: 'claude-opus-4-8' } }

  it('flags a child served by another model', () => {
    const rows = subagentRouteRows(
      parent,
      [childEntry('c1')],
      { c1: { route: { provider: 'claude-bray', model: 'claude-fable-5' } } },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.drifted).toBe(true)
    expect(rows[0]?.model).toBe('claude-fable-5')
  })

  it('does not flag a child on the parent route', () => {
    const rows = subagentRouteRows(
      parent,
      [childEntry('c1')],
      { c1: { route: { provider: 'claude', model: 'claude-opus-4-8' } } },
    )
    expect(rows[0]?.drifted).toBe(false)
  })

  it('reports an unserved child as unknown rather than as a difference', () => {
    const rows = subagentRouteRows(parent, [childEntry('c1')], {})
    expect(rows[0]?.model).toBeUndefined()
    expect(rows[0]?.drifted).toBe(false)
  })

  it('reports no drift when the parent route is still unknown', () => {
    const rows = subagentRouteRows(
      undefined,
      [childEntry('c1')],
      { c1: { route: { provider: 'claude-bray', model: 'claude-fable-5' } } },
    )
    expect(rows[0]?.drifted).toBe(false)
  })

  it('omits diagnostic entries, which have no route to show', () => {
    const rows = subagentRouteRows(parent, [{ kind: 'diagnostic', id: 'd1' }, childEntry('c1')], {})
    expect(rows.map(row => row.id)).toEqual(['c1'])
  })

  it('falls back to a short id when the host published no label', () => {
    const rows = subagentRouteRows(
      parent,
      [
        childEntry('0123456789abcdef', { label: undefined }),
        childEntry('fedcba9876543210', { label: '' }),
      ],
      {},
    )
    expect(rows.map(row => row.label)).toEqual(['01234567', 'fedcba98'])
  })

  it('carries the mode and activity flags the card renders', () => {
    const rows = subagentRouteRows(
      parent,
      [childEntry('c1', { mode: 'one-shot', activity: 'inactive' })],
      {},
    )
    expect(rows[0]?.continuable).toBe(false)
    expect(rows[0]?.running).toBe(false)
  })
})

describe('subagentRouteTally', () => {
  it('counts children, running children, and drifted children separately', () => {
    const rows = subagentRouteRows(
      { route: { provider: 'claude', model: 'opus' } },
      [
        childEntry('c1', { activity: 'running' }),
        childEntry('c2', { activity: 'inactive' }),
        childEntry('c3', { activity: 'running' }),
      ],
      {
        c1: { route: { provider: 'claude-bray', model: 'fable' } },
        c2: { route: { provider: 'claude', model: 'opus' } },
      },
    )
    expect(subagentRouteTally(rows)).toEqual({ total: 3, running: 2, drifted: 1 })
  })

  it('is all zeroes for an empty list', () => {
    expect(subagentRouteTally([])).toEqual({ total: 0, running: 0, drifted: 0 })
  })
})

describe('rootAncestor', () => {
  it('walks durable subagent parent links to the main session', () => {
    expect(rootAncestor({
      root: { id: 'root', displayTitle: 'Main', running: false },
      child: { id: 'child', displayTitle: 'Child', origin: 'subagent', parentId: 'root', running: false },
      grandchild: { id: 'grandchild', displayTitle: 'Grandchild', origin: 'subagent', parentId: 'child', running: true },
    }, 'grandchild')).toBe('root')
  })

  it('falls back to the requested session for missing parents and cycles', () => {
    expect(rootAncestor({
      child: { id: 'child', displayTitle: 'Child', origin: 'subagent', parentId: 'missing', running: false },
    }, 'child')).toBe('child')
    expect(rootAncestor({
      a: { id: 'a', displayTitle: 'A', origin: 'subagent', parentId: 'b', running: false },
      b: { id: 'b', displayTitle: 'B', origin: 'subagent', parentId: 'a', running: false },
    }, 'a')).toBe('a')
  })
})

describe('subagentRouteTree', () => {
  it('can fill an inactive catalog child route from a host history projection', () => {
    const tree = subagentRouteTree(
      {
        root: {
          id: 'root',
          displayTitle: 'Main',
          running: false,
          projectionValues: { a2d2Indicator: { route: { provider: 'claude-bray', model: 'claude-opus-5-5' } } },
        },
      },
      {
        root: {
          entries: [
            childEntry('child', { label: 'Review', activity: 'inactive', mode: 'continuable' }),
          ],
        },
      },
      'root',
      { child: { route: { provider: 'claude-bray', model: 'claude-opus-5-5' } } },
    )

    expect(tree.children[0]?.model).toBe('claude-opus-5-5')
  })

  it('roots at the main session, nests recursive children, and counts whole-tree drift against each parent', () => {
    const tree = subagentRouteTree(
      {
        root: {
          id: 'root',
          displayTitle: 'Main',
          running: false,
          projectionValues: { a2d2Indicator: { route: { provider: 'claude', model: 'opus' } } },
        },
        child: {
          id: 'child',
          displayTitle: 'Child title',
          origin: 'subagent',
          parentId: 'root',
          running: true,
          projectionValues: { a2d2Indicator: { route: { provider: 'claude', model: 'opus' } } },
        },
        grandchild: {
          id: 'grandchild',
          displayTitle: 'Grandchild title',
          origin: 'subagent',
          parentId: 'child',
          running: false,
          projectionValues: { a2d2Indicator: { route: { provider: 'codex', model: 'gpt-5.5' } } },
        },
        sibling: {
          id: 'sibling',
          displayTitle: 'Sibling title',
          origin: 'subagent',
          parentId: 'root',
          running: true,
          projectionValues: { a2d2Indicator: { route: { provider: 'claude', model: 'fable' } } },
        },
      },
      {
        root: {
          entries: [
            childEntry('child', { label: 'Design', activity: 'running', hasChildren: true }),
            childEntry('sibling', { label: 'Review', activity: 'running' }),
          ],
        },
        child: {
          entries: [
            childEntry('grandchild', { label: 'Implement', activity: 'inactive' }),
          ],
        },
      },
      'grandchild',
    )

    expect(tree.root?.id).toBe('root')
    expect(tree.children.map(node => ({
      id: node.id,
      drifted: node.drifted,
      children: node.children.map(child => ({ id: child.id, drifted: child.drifted })),
    }))).toEqual([
      { id: 'child', drifted: false, children: [{ id: 'grandchild', drifted: true }] },
      { id: 'sibling', drifted: true, children: [] },
    ])
    expect(tree.tally).toEqual({ total: 3, running: 2, drifted: 2 })
  })
})

describe('projectedSubagentCatalogs', () => {
  it('derives each loaded parent catalog from its subagentCatalog projection and the list rows', () => {
    const catalogs = projectedSubagentCatalogs({
      byId: { a: { id: 'a', running: true }, b: { id: 'b', running: false } },
      projectionsBySession: {
        root: {
          values: {
            subagentCatalog: [
              { id: 'a', mode: 'continuable', label: 'worker a' },
              { id: 'b', mode: 'one-shot' },
              { id: 'c', mode: 'unknown' },
            ],
          },
          state: 'ready',
          error: null,
        },
        a: { values: { subagentCatalog: [{ id: 'a1', mode: 'one-shot' }] }, state: 'ready', error: null },
        b: { values: {}, state: 'ready', error: null },
        c: { values: {}, state: 'error', error: 'gone' },
      },
    })

    expect(catalogs.root).toEqual({
      entries: [
        { kind: 'child', id: 'a', label: 'worker a', mode: 'continuable', activity: 'running', hasChildren: true },
        { kind: 'child', id: 'b', mode: 'one-shot', activity: 'inactive', hasChildren: false },
        { kind: 'child', id: 'c', activity: 'inactive', hasChildren: false },
      ],
      state: 'ready',
      error: null,
    })
    expect(catalogs.a?.entries.map(entry => entry.id)).toEqual(['a1'])
  })

  it('treats a child whose own baseline is not loaded as possibly having children, so the reader asks', () => {
    const catalogs = projectedSubagentCatalogs({
      byId: {},
      projectionsBySession: {
        root: { values: { subagentCatalog: [{ id: 'x', mode: 'continuable', label: 'x' }] }, state: 'ready', error: null },
        x: { values: {}, state: 'loading', error: null },
      },
    })

    expect(catalogs.root?.entries[0]?.hasChildren).toBe(true)
  })

  it('carries a parent read that is still loading or failed', () => {
    const catalogs = projectedSubagentCatalogs({
      byId: {},
      projectionsBySession: { root: { values: {}, state: 'error', error: 'read failed' } },
    })

    expect(catalogs.root).toEqual({ entries: [], state: 'error', error: 'read failed' })
  })
})

describe('loadSubagentRouteSources', () => {
  it('reads child route sources from the child session projection baselines', async () => {
    const calls: unknown[] = []
    const sources = await loadSubagentRouteSources({
      session: {
        projections: async (payload: unknown) => {
          calls.push(payload)
          return {
            ok: true,
            value: {
              asOfSeq: 7,
              values: {
                a2d2Indicator: { route: { provider: 'claude-bray', model: 'claude-opus-5-5' } },
              },
            },
          }
        },
      },
    }, [{ parentSessionId: 'root', childSessionId: 'child', mode: 'continuable' }])

    expect(calls).toEqual([{ sessionId: 'child' }])
    expect(sources).toEqual({ child: { route: { provider: 'claude-bray', model: 'claude-opus-5-5' } } })
  })
})

describe('createRouteSourceLoader', () => {
  it('keeps an in-flight cold read alive and deduplicated when the same addresses arrive as a new array', async () => {
    const pending = deferred<ReturnType<typeof routeHistoryResponse>>()
    const signals: AbortSignal[] = []
    const calls: unknown[] = []
    const loader = createRouteSourceLoader({
      session: {
        projections: (payload, signal) => {
          calls.push(payload)
          if (signal !== undefined) signals.push(signal)
          return pending.promise
        },
      },
    })

    loader.load([address('child')])
    loader.load([address('child')])

    expect(calls).toEqual([{ sessionId: 'child' }])
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)

    pending.resolve(routeHistoryResponse('claude-bray', 'claude-opus-5-5'))
    await pending.promise
    await Promise.resolve()

    expect(loader.snapshot()).toEqual({ child: { route: { provider: 'claude-bray', model: 'claude-opus-5-5' } } })

    loader.load([address('child')])
    expect(calls).toHaveLength(1)
    loader.dispose()
  })

  it('publishes other address results when one cold read fails', async () => {
    const loader = createRouteSourceLoader({
      session: {
        projections: async (payload) => {
          if (payload.sessionId === 'bad') throw new Error('projections unavailable')
          return routeHistoryResponse('claude-bray', `model-${payload.sessionId}`)
        },
      },
    })

    loader.load([address('bad'), address('good')])
    await Promise.resolve()
    await Promise.resolve()

    expect(loader.snapshot()).toEqual({ good: { route: { provider: 'claude-bray', model: 'model-good' } } })
    loader.dispose()
  })

  it('aborts in-flight cold reads when disposed', () => {
    const pending = deferred<ReturnType<typeof routeHistoryResponse>>()
    let signal: AbortSignal | undefined
    const loader = createRouteSourceLoader({
      session: {
        projections: (_payload, nextSignal) => {
          signal = nextSignal
          return pending.promise
        },
      },
    })

    loader.load([address('child')])
    loader.dispose()

    expect(signal?.aborted).toBe(true)
  })
})

describe('subagentRouteHeader', () => {
  it('always includes the drift count', () => {
    expect(subagentRouteHeader({ total: 2, running: 1, drifted: 0 }))
      .toBe('2 个子代理 · 1 运行中 · 0 个与主会话不一致')
  })
})

describe('formatRoute', () => {
  const base = { id: 'c1', label: 'c1', continuable: true, running: true, drifted: false }

  it('renders provider and model', () => {
    expect(formatRoute({ ...base, provider: 'claude-bray', model: 'fable' })).toBe('claude-bray/fable')
  })

  it('renders a bare model when the provider is unknown', () => {
    expect(formatRoute({ ...base, model: 'fable' })).toBe('fable')
  })

  it('renders nothing while the route is unknown', () => {
    expect(formatRoute(base)).toBeUndefined()
  })
})
