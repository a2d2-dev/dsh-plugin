/**
 * Where the floating indicator sits: the corner it starts in, the point a drag
 * leaves it at, and the box its card opens in.
 *
 * Pure functions over plain values, so the placement is testable without a
 * browser: the component measures the shell and the stored point, this module
 * decides what follows from them.
 *
 * The indicator is fixed to the viewport, so the shell's layout can never move
 * it: the default point is derived from measurements instead, and a drag writes
 * an explicit point that survives reloads. Either way the card opens beside the
 * circle and is clamped into the viewport, because a card that follows a dragged
 * circle off the screen edge would be a worse surface than no drag at all.
 *
 * @module @deepseek-ai/dsh-a2d2/client/orb-position
 */

/** Distance kept between the indicator and a shell panel or a viewport edge, in px. */
export const ORB_GAP_PX = 12

/** Distance between the circle and its card or hover action, in px. */
export const ORB_STACK_GAP_PX = 8

/** The circle's diameter in px; the stylesheet reads it back as `--a2d2-orb-size`. */
export const ORB_SIZE_PX = 64

/**
 * The card's width in px; the stylesheet reads it back as `--a2d2-card-width`.
 *
 * The clamps need the number, and a stylesheet cannot be read from here, so the
 * component publishes it as a custom property instead of leaving the two copies
 * to drift.
 */
export const ORB_CARD_WIDTH_PX = 288

/** The default point's distance from the viewport bottom, in px: clear of the composer. */
export const ORB_BOTTOM_PX = 108

/**
 * How far the pointer must travel before a press counts as a drag, in px.
 *
 * A press that moves less than this is the click that opens the card; without a
 * threshold every click would nudge the circle by a pixel or two.
 */
export const ORB_DRAG_THRESHOLD_PX = 4

/** Where a dragged point is remembered. Versioned, so a changed shape can be retired. */
export const ORB_POSITION_KEY = 'dsh-a2d2:v1:orb-position'

/** The layout viewport, as `position: fixed` measures it. */
export interface OrbViewport {
  /** Viewport width in px. */
  readonly width: number
  /** Viewport height in px. */
  readonly height: number
}

/** A point in viewport coordinates, for the circle's top-left corner. */
export interface OrbPoint {
  /** Distance from the viewport's left edge, in px. */
  readonly x: number
  /** Distance from the viewport's top edge, in px. */
  readonly y: number
}

/** What the shell currently occupies at the right of the viewport. */
export interface AnchorRoom {
  /**
   * The layout viewport width in px; the containing block a `position: fixed`
   * anchor is measured against, so this is the document element's client width
   * (scrollbar excluded), not `innerWidth`.
   */
  readonly viewportWidth: number
  /**
   * The right edge of the layout region the indicator is laid out in, or
   * `undefined` before that region is mounted. A shell that pushes its
   * conversation column left for a right-hand panel reports the squeezed edge,
   * so the space beyond it is exactly that panel.
   */
  readonly regionRight: number | undefined
  /** Width of the shell's details column in px; zero when it has none or is closed. */
  readonly detailsWidth: number
}

/** Where the card opens, in the anchor's own coordinates. */
export interface OrbCardBox {
  /** The card's left edge relative to the circle's left edge, in px; negative when it overhangs. */
  readonly left: number
  /** Whether the card opens above the circle rather than below it. */
  readonly above: boolean
  /** The tallest the card may be on that side, in px. */
  readonly maxHeight: number
}

/** The circle's point and the box its card opens in. */
export interface OrbPlacement {
  /** The circle's top-left corner in viewport coordinates. */
  readonly point: OrbPoint
  /** Where the card opens from that point. */
  readonly card: OrbCardBox
}

/**
 * The `right` offset that puts the indicator next to the shell's right panel
 * rather than underneath it.
 *
 * The indicator is fixed to the viewport, so the shell's layout cannot move it
 * out of a panel's way; the anchor is shifted left by the panel's width instead.
 * Two ways of measuring that width are combined by taking the larger: the space
 * left over to the right of the region the indicator is laid out in (works for a
 * shell that pushes its content aside, and survives the panel's class names
 * changing), and the shell's own details column width (works for a shell that
 * keeps one). Both are zero when no panel is open, which leaves the circle at
 * its viewport corner.
 * @param room - the measured shell geometry.
 * @returns the distance from the viewport's right edge, in whole px.
 */
export function anchorRightOffset(room: AnchorRoom): number {
  const used = room.regionRight === undefined ? 0 : room.viewportWidth - room.regionRight
  const panel = Math.max(0, Math.round(Math.max(used, room.detailsWidth)))
  return ORB_GAP_PX + panel
}

/**
 * The point the indicator sits at when the user has never moved it.
 *
 * Bottom-right, `ORB_BOTTOM_PX` above the bottom edge so the circle clears the
 * composer, and shifted left by whatever a right panel takes.
 * @param viewport - the layout viewport.
 * @param rightOffset - the panel-aware offset from {@link anchorRightOffset}.
 * @returns the default point, before clamping.
 */
export function defaultOrbPoint(viewport: OrbViewport, rightOffset: number): OrbPoint {
  return {
    x: viewport.width - rightOffset - ORB_SIZE_PX,
    y: viewport.height - ORB_BOTTOM_PX - ORB_SIZE_PX,
  }
}

/**
 * Keep the whole circle inside the viewport.
 *
 * A point is clamped rather than rejected because both of its sources can be
 * stale: a remembered point was valid in the window it was dragged in, and the
 * default point is derived from a viewport that may have shrunk. A viewport too
 * small to hold the circle and its margins still gets a point, pinned to the
 * margin, so the circle stays reachable.
 * @param point - the wanted point, in viewport coordinates.
 * @param viewport - the layout viewport.
 * @returns the nearest point that keeps the circle inside.
 */
export function clampOrbPoint(point: OrbPoint, viewport: OrbViewport): OrbPoint {
  const rightmost = viewport.width - ORB_SIZE_PX - ORB_GAP_PX
  const lowest = viewport.height - ORB_SIZE_PX - ORB_GAP_PX
  return {
    x: Math.round(clamp(point.x, Math.min(ORB_GAP_PX, rightmost), Math.max(ORB_GAP_PX, rightmost))),
    y: Math.round(clamp(point.y, Math.min(ORB_GAP_PX, lowest), Math.max(ORB_GAP_PX, lowest))),
  }
}

/**
 * Whether a press has travelled far enough to be a drag.
 * @param from - where the press started, in viewport coordinates.
 * @param to - where the pointer is now.
 * @returns true once the gesture is a drag rather than a click.
 */
export function isDragGesture(from: OrbPoint, to: OrbPoint): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= ORB_DRAG_THRESHOLD_PX
}

/**
 * The circle's point and the card box that follow from it.
 *
 * The card prefers the roomier side of the circle, so a circle dragged to the
 * bottom of a window opens its card above it and one dragged to the top opens it
 * below, and its height is capped by whatever that side has: the card scrolls
 * inside itself rather than running off the viewport. Its left edge is clamped
 * into the viewport and expressed relative to the circle, which is what the
 * stylesheet positions against.
 * @param input - the viewport, the panel-aware right offset, and a dragged point if there is one.
 * @returns the placement to render.
 */
export function orbPlacement(input: {
  readonly viewport: OrbViewport
  readonly rightOffset: number
  readonly moved: OrbPoint | undefined
}): OrbPlacement {
  const point = clampOrbPoint(
    input.moved ?? defaultOrbPoint(input.viewport, input.rightOffset),
    input.viewport,
  )
  return { point, card: cardBox(point, input.viewport) }
}

/**
 * Read a remembered point.
 *
 * Anything unexpected — absent, not JSON, not a pair of finite numbers — reads as
 * "never moved", because a position the user did not choose is worse than the
 * corner they can see. A point outside the current viewport is not rejected here:
 * {@link orbPlacement} clamps it, so the same stored point survives a resize.
 * @param raw - the stored string, or `null` when nothing is stored.
 * @returns the remembered point, or `undefined`.
 */
export function parseOrbPoint(raw: string | null): OrbPoint | undefined {
  if (raw === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { x, y } = parsed as { readonly x?: unknown; readonly y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number') return undefined
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  return { x, y }
}

/**
 * The stored form of a dragged point.
 * @param point - the point to remember.
 * @returns the string to store.
 */
export function serializeOrbPoint(point: OrbPoint): string {
  return JSON.stringify({ x: Math.round(point.x), y: Math.round(point.y) })
}

/** Where the card opens from one point. */
function cardBox(point: OrbPoint, viewport: OrbViewport): OrbCardBox {
  const above = spaceAbove(point, viewport) >= spaceBelow(point, viewport)
  const space = above ? spaceAbove(point, viewport) : spaceBelow(point, viewport)
  const wanted = point.x + ORB_SIZE_PX - ORB_CARD_WIDTH_PX
  const rightmost = Math.max(ORB_GAP_PX, viewport.width - ORB_CARD_WIDTH_PX - ORB_GAP_PX)
  return {
    left: Math.round(clamp(wanted, ORB_GAP_PX, rightmost) - point.x),
    above,
    maxHeight: Math.max(0, Math.round(space)),
  }
}

/** Room above the circle, in px, once the gap and the viewport margin are reserved. */
function spaceAbove(point: OrbPoint, viewport: OrbViewport): number {
  return point.y - ORB_STACK_GAP_PX - ORB_GAP_PX
}

/** Room below the circle, in px, once the gap and the viewport margin are reserved. */
function spaceBelow(point: OrbPoint, viewport: OrbViewport): number {
  return viewport.height - (point.y + ORB_SIZE_PX) - ORB_STACK_GAP_PX - ORB_GAP_PX
}

/** Clamp a number into an inclusive range. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}
