import { describe, expect, it } from 'vitest'
import {
  ORB_BOTTOM_PX,
  ORB_CLICK_SLOP_PX,
  ORB_CARD_WIDTH_PX,
  ORB_GAP_PX,
  ORB_DRAG_THRESHOLD_PX,
  ORB_POSITION_KEY,
  ORB_SIZE_PX,
  ORB_STACK_GAP_PX,
  anchorRightOffset,
  clampOrbPoint,
  defaultOrbPoint,
  isClickGesture,
  isDragGesture,
  orbPlacement,
  parseOrbPoint,
  serializeOrbPoint,
} from '../../src/client/orb-position.ts'

/** The shell the placement was measured in: a 1088×588 viewport with a 448px panel. */
const VIEWPORT = { width: 1088, height: 588 }

/** That viewport's conversation column, which the panel pushes to 640px wide. */
const PUSHED_ROW = { viewportWidth: VIEWPORT.width, regionRight: 640, detailsWidth: 0 }

describe('the anchor offset that clears a shell panel', () => {
  it('keeps the circle at its corner when no panel is open', () => {
    // A shell with nothing to the right leaves the region touching the viewport
    // edge, which is the case the circle was designed for.
    expect(anchorRightOffset({ viewportWidth: 1088, regionRight: 1088, detailsWidth: 0 })).toBe(ORB_GAP_PX)
  })

  it('shifts by the panel a pushed shell leaves to the right of the region', () => {
    // The live shell at 1088px with its 448px right panel: the conversation
    // column ends at 640, so the circle lands just left of the panel instead of
    // over it. This is the case that was broken: the old probe looked for a
    // details column the shell no longer keeps, measured zero, and let the whole
    // card cover the panel.
    expect(anchorRightOffset(PUSHED_ROW)).toBe(460)
  })

  it('shifts by a details column a shell measures instead of pushing', () => {
    expect(anchorRightOffset({ viewportWidth: 1280, regionRight: 1280, detailsWidth: 360 })).toBe(372)
  })

  it('takes the larger of the two measurements rather than their sum', () => {
    // A shell may both push its content and keep a measured column; the panel is
    // counted once, or the circle would drift into the middle of the column.
    expect(anchorRightOffset({ ...PUSHED_ROW, detailsWidth: 448 })).toBe(460)
  })

  it('measures nothing before the region is mounted', () => {
    expect(anchorRightOffset({ viewportWidth: 1088, regionRight: undefined, detailsWidth: 0 })).toBe(ORB_GAP_PX)
  })
})

describe('the default point', () => {
  it('sits above the composer at the bottom right, clear of an open panel', () => {
    expect(defaultOrbPoint(VIEWPORT, anchorRightOffset(PUSHED_ROW))).toEqual({ x: 564, y: 416 })
    expect(VIEWPORT.height - ORB_BOTTOM_PX - ORB_SIZE_PX).toBe(416)
  })

  it('reaches into the corner a panel leaves free', () => {
    expect(defaultOrbPoint(VIEWPORT, ORB_GAP_PX)).toEqual({ x: 1012, y: 416 })
  })
})

describe('keeping the circle inside the viewport', () => {
  it('leaves a point that already fits alone', () => {
    expect(clampOrbPoint({ x: 500, y: 300 }, VIEWPORT)).toEqual({ x: 500, y: 300 })
  })

  it('pulls back a point dragged past an edge', () => {
    // Both sources of a point can be stale: a remembered one was dragged in a
    // larger window, and the default one is derived from the current viewport.
    expect(clampOrbPoint({ x: -80, y: -20 }, VIEWPORT)).toEqual({ x: ORB_GAP_PX, y: ORB_GAP_PX })
    expect(clampOrbPoint({ x: 5000, y: 5000 }, VIEWPORT)).toEqual({
      x: VIEWPORT.width - ORB_SIZE_PX - ORB_GAP_PX,
      y: VIEWPORT.height - ORB_SIZE_PX - ORB_GAP_PX,
    })
  })

  it('rounds a fractional drag to whole pixels', () => {
    expect(clampOrbPoint({ x: 300.4, y: 200.6 }, VIEWPORT)).toEqual({ x: 300, y: 201 })
  })

  it('keeps a circle on screen even in a viewport too small to hold it', () => {
    expect(clampOrbPoint({ x: 400, y: 400 }, { width: 60, height: 50 })).toEqual({ x: ORB_GAP_PX, y: ORB_GAP_PX })
  })
})

describe('telling a drag from a click', () => {
  it('ignores the stray movement a press carries', () => {
    expect(isDragGesture({ x: 100, y: 100 }, { x: 101, y: 101 })).toBe(false)
  })

  it('counts once the pointer has travelled far enough', () => {
    expect(isDragGesture({ x: 100, y: 100 }, { x: 100, y: 105 })).toBe(true)
    expect(isDragGesture({ x: 100, y: 100 }, { x: 104, y: 100 })).toBe(true)
  })

  it('reads a release near the press as a click, not a move', () => {
    // A trackpad click drifts several pixels. Following the pointer on that
    // drift must not commit a position or eat the click that opens the card.
    expect(isClickGesture({ x: 596, y: 448 }, { x: 596, y: 448 })).toBe(true)
    expect(isClickGesture({ x: 596, y: 448 }, { x: 602, y: 451 })).toBe(true)
    expect(isClickGesture({ x: 596, y: 448 }, { x: 620, y: 448 })).toBe(false)
  })

  it('covers every drift a drag threshold lets through, and then some', () => {
    // Anything below the drag threshold is a click by construction; the slop is
    // wider so a gesture that began following the pointer still counts as one.
    expect(ORB_CLICK_SLOP_PX).toBeGreaterThan(ORB_DRAG_THRESHOLD_PX)
    expect(isClickGesture({ x: 0, y: 0 }, { x: ORB_DRAG_THRESHOLD_PX, y: 0 })).toBe(true)
  })
})

describe('remembering a dragged point', () => {
  it('round-trips through the stored form', () => {
    expect(parseOrbPoint(serializeOrbPoint({ x: 320, y: 180 }))).toEqual({ x: 320, y: 180 })
    expect(ORB_POSITION_KEY).toBe('dsh-a2d2:v1:orb-position')
  })

  it('reads nothing as never having moved', () => {
    // A position the user did not choose is worse than the corner they can see.
    expect(parseOrbPoint(null)).toBeUndefined()
    expect(parseOrbPoint('')).toBeUndefined()
    expect(parseOrbPoint('not json')).toBeUndefined()
    expect(parseOrbPoint('"320"')).toBeUndefined()
    expect(parseOrbPoint('{"x":320}')).toBeUndefined()
    expect(parseOrbPoint('{"x":"320","y":180}')).toBeUndefined()
    expect(parseOrbPoint('{"x":null,"y":180}')).toBeUndefined()
  })

  it('rejects a stored point that is not a finite number', () => {
    // A padded value would otherwise place the circle at an arithmetic limit.
    expect(parseOrbPoint('{"x":1e999,"y":0}')).toBeUndefined()
    expect(parseOrbPoint(String.raw`{"x":NaN,"y":0}`)).toBeUndefined()
  })

  it('accepts a point outside the current viewport, which the clamp then fixes', () => {
    const stored = parseOrbPoint('{"x":3000,"y":2000}')
    expect(stored).toEqual({ x: 3000, y: 2000 })
    expect(orbPlacement({ viewport: VIEWPORT, rightOffset: ORB_GAP_PX, moved: stored }).point)
      .toEqual({ x: VIEWPORT.width - ORB_SIZE_PX - ORB_GAP_PX, y: VIEWPORT.height - ORB_SIZE_PX - ORB_GAP_PX })
  })
})

describe('the card box that follows the circle', () => {
  it('opens above the circle, right-aligned to it, in the default corner', () => {
    // The verified live rendering: the circle at x 564 with its 288px card at
    // x 340..628, left of the 448px panel.
    const { point, card } = orbPlacement({ viewport: VIEWPORT, rightOffset: anchorRightOffset(PUSHED_ROW), moved: undefined })
    expect(point).toEqual({ x: 564, y: 416 })
    expect(card.above).toBe(true)
    expect(point.x + card.left).toBe(340)
    expect(point.x + card.left + ORB_CARD_WIDTH_PX).toBe(628)
  })

  it('caps the card at the room on the side it opens', () => {
    const { point, card } = orbPlacement({ viewport: VIEWPORT, rightOffset: anchorRightOffset(PUSHED_ROW), moved: undefined })
    expect(card.maxHeight).toBe(point.y - ORB_STACK_GAP_PX - ORB_GAP_PX)
  })

  it('opens below a circle dragged to the top of the window', () => {
    const { card } = orbPlacement({ viewport: VIEWPORT, rightOffset: ORB_GAP_PX, moved: { x: 400, y: 20 } })
    expect(card.above).toBe(false)
    expect(card.maxHeight).toBe(VIEWPORT.height - (20 + ORB_SIZE_PX) - ORB_STACK_GAP_PX - ORB_GAP_PX)
  })

  it('prefers the roomier side once both are tight', () => {
    const { card } = orbPlacement({ viewport: VIEWPORT, rightOffset: ORB_GAP_PX, moved: { x: 400, y: 100 } })
    expect(card.above).toBe(false)
  })

  it('pulls the card back from the viewport edges a circle was dragged to', () => {
    const left = orbPlacement({ viewport: VIEWPORT, rightOffset: ORB_GAP_PX, moved: { x: ORB_GAP_PX, y: 300 } })
    expect(left.point.x + left.card.left).toBe(ORB_GAP_PX)
    const right = orbPlacement({ viewport: VIEWPORT, rightOffset: ORB_GAP_PX, moved: { x: VIEWPORT.width - ORB_SIZE_PX - ORB_GAP_PX, y: 300 } })
    expect(right.point.x + right.card.left + ORB_CARD_WIDTH_PX).toBe(VIEWPORT.width - ORB_GAP_PX)
  })

  it('keeps the card on screen when a panel leaves the circle no room', () => {
    // A panel dragged past the card's width: the circle ends up close to the left
    // edge, and the card keeps its width there rather than losing an edge of its
    // own behind the panel it could not dodge.
    const { point, card } = orbPlacement({ viewport: VIEWPORT, rightOffset: 900, moved: undefined })
    expect(point.x).toBe(VIEWPORT.width - 900 - ORB_SIZE_PX)
    expect(point.x + card.left).toBe(ORB_GAP_PX)
  })
})
