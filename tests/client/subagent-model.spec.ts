import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { indicatorProjectionDefinition, indicatorProjectionSchema } from '../../src/indicator-projection.ts'
import {
  formatRoute,
  subagentRouteRows,
  subagentRouteTally,
  type CatalogEntry,
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
