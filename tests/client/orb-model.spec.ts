import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORB_THRESHOLDS,
  ORB_CARD_WIDTH_PX,
  ORB_GAP_PX,
  anchorRightOffset,
  costOf,
  formatCost,
  formatTokenCount,
  orbLevel,
  orbOccupancy,
  waterLevel,
} from '../../src/client/orb-model.ts'
import { indicatorProjectionDefinition, resolveModelPrice } from '../../src/indicator-projection.ts'

describe('the two faces agree on the defaults', () => {
  it('falls back to the same ratios the host applies when the projection is absent', () => {
    // The client cannot read host config, so its fallback must equal the host's
    // own default or an unconfigured deployment would colour differently from a
    // configured one for no stated reason.
    expect(DEFAULT_ORB_THRESHOLDS).toEqual({ warnAtTokens: 150_000, criticalAtTokens: 1_000_000 })
  })

  it('carries host-configured lengths through the projection rather than a constant', () => {
    const unit = indicatorProjectionDefinition({
      thresholds: { warnAtTokens: 120_000, criticalAtTokens: 600_000 },
      prices: new Map(),
      currency: '¥',
    })
    expect(unit.wire.view(unit.init()).thresholds).toEqual({ warnAtTokens: 120_000, criticalAtTokens: 600_000 })
    expect(orbLevel(150_000, unit.wire.view(unit.init()).thresholds)).toBe('warn')
    expect(orbLevel(50_000, unit.wire.view(unit.init()).thresholds)).toBe('normal')
  })

  it('leaves the unit untouched for events it does not read', () => {
    const unit = indicatorProjectionDefinition({
      thresholds: DEFAULT_ORB_THRESHOLDS, prices: new Map(), currency: '¥',
    })
    const state = unit.init()
    expect(unit.apply(state, { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } as never)).toBe(state)
  })

  it('reports occupancy for a realistic near-threshold session', () => {
    expect(orbOccupancy({ projectedTokens: 120_320, contextWindow: 128_000 })?.percent).toBe(94)
  })
})

describe('display formatting', () => {
  it('shows a token count compactly without losing the order of magnitude', () => {
    expect(formatTokenCount(820)).toBe('820')
    expect(formatTokenCount(452_898)).toBe('453K')
    expect(formatTokenCount(1_200_000)).toBe('1.2M')
    expect(formatTokenCount(128_000)).toBe('128K')
  })

  it('omits a cost entirely when the route has no configured rate', () => {
    expect(costOf(1_000_000, undefined)).toBeUndefined()
    expect(costOf(1_000_000, { inputPerMillion: 2 })).toBe(2)
    expect(costOf(453_000, { inputPerMillion: 2 })).toBeCloseTo(0.906, 3)
  })

  it('formats a cost with two decimals below a hundred and whole numbers above', () => {
    expect(formatCost(0.91)).toBe('0.91')
    expect(formatCost(7)).toBe('7.00')
    expect(formatCost(123.456)).toBe('123')
  })
})

describe('the price the host resolves', () => {
  const route = { provider: 'deepseek', model: 'deepseek-v4-flash' }

  it('prefers a provider-qualified rate over a bare model rate', () => {
    const prices = new Map([
      ['deepseek/deepseek-v4-flash', { inputPerMillion: 2, outputPerMillion: 4 }],
      ['deepseek-v4-flash', { inputPerMillion: 1, outputPerMillion: 2 }],
    ])
    expect(resolveModelPrice(prices, route)?.inputPerMillion).toBe(2)
  })

  it('falls back to a bare model rate so one model can be priced across providers', () => {
    const prices = new Map([['deepseek-v4-flash', { inputPerMillion: 1, outputPerMillion: 2 }]])
    expect(resolveModelPrice(prices, route)?.inputPerMillion).toBe(1)
  })

  it('resolves nothing for an unpriced route or an unknown route', () => {
    expect(resolveModelPrice(new Map(), route)).toBeUndefined()
    expect(resolveModelPrice(new Map([['other-model', { inputPerMillion: 1, outputPerMillion: 1 }]]), route))
      .toBeUndefined()
    expect(resolveModelPrice(new Map([['deepseek-v4-flash', { inputPerMillion: 1, outputPerMillion: 1 }]]), undefined))
      .toBeUndefined()
  })

  it('folds the route off the log and prices it', () => {
    const unit = indicatorProjectionDefinition({
      thresholds: DEFAULT_ORB_THRESHOLDS,
      prices: new Map([['deepseek/deepseek-v4-flash', { inputPerMillion: 2, outputPerMillion: 4 }]]),
      currency: '¥',
    })
    const state = unit.apply(unit.init(), {
      type: 'request/header',
      seq: 1,
      time: 1,
      data: {
        header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } },
        reason: 'initial',
      },
    } as never)
    expect(unit.wire.view(state).price?.inputPerMillion).toBe(2)
    expect(unit.wire.view(state).currency).toBe('¥')
  })
})

describe('the water level', () => {
  it('fills exactly as much as the context is occupied', () => {
    expect(waterLevel(0)).toBe(0)
    expect(waterLevel(35)).toBe(35)
    expect(waterLevel(100)).toBe(100)
  })

  it('clamps rather than overflowing a circle', () => {
    expect(waterLevel(140)).toBe(100)
    expect(waterLevel(-5)).toBe(0)
  })
})

describe('the anchor offset that clears a shell panel', () => {
  it('keeps the circle at its corner when no panel is open', () => {
    // A shell with nothing to the right leaves the region touching the viewport
    // edge, which is the case the circle was designed for.
    expect(anchorRightOffset({ viewportWidth: 1088, regionRight: 1088, detailsWidth: 0 })).toBe(ORB_GAP_PX)
  })

  it('shifts by the panel a pushed shell leaves to the right of the region', () => {
    // The live shell at 1088px with its 448px right panel: the conversation
    // column ends at 640, so the card lands just left of the panel instead of
    // over it. This is the case that was broken: the old probe looked for a
    // details column the shell no longer keeps, measured zero, and let the whole
    // 288px card cover the panel.
    expect(anchorRightOffset({ viewportWidth: 1088, regionRight: 640, detailsWidth: 0 })).toBe(460)
  })

  it('shifts by a details column a shell measures instead of pushing', () => {
    expect(anchorRightOffset({ viewportWidth: 1280, regionRight: 1280, detailsWidth: 360 })).toBe(372)
  })

  it('takes the larger of the two measurements rather than their sum', () => {
    // A shell may both push its content and keep a measured column; the panel is
    // counted once, or the circle would drift into the middle of the column.
    expect(anchorRightOffset({ viewportWidth: 1088, regionRight: 640, detailsWidth: 448 })).toBe(460)
  })

  it('measures nothing before the region is mounted', () => {
    expect(anchorRightOffset({ viewportWidth: 1088, regionRight: undefined, detailsWidth: 0 })).toBe(ORB_GAP_PX)
  })

  it('keeps the card inside the viewport when the panel leaves no room', () => {
    // A panel dragged past the card's width: dodging it exactly would push the
    // card's left edge off-screen, so the offset stops where the card still fits.
    const offset = anchorRightOffset({ viewportWidth: 1088, regionRight: 188, detailsWidth: 0 })
    expect(offset).toBe(1088 - ORB_GAP_PX - ORB_CARD_WIDTH_PX)
    expect(1088 - offset - ORB_CARD_WIDTH_PX).toBe(ORB_GAP_PX)
  })

  it('never returns a negative offset on a viewport narrower than the card', () => {
    expect(anchorRightOffset({ viewportWidth: 240, regionRight: 240, detailsWidth: 0 })).toBe(0)
  })
})
