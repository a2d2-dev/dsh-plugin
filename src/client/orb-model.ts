/**
 * The floating handoff indicator's model: occupancy arithmetic, the alert level
 * that decides its color, and the anchor offset that keeps the circle and its
 * card clear of the shell's own panels.
 *
 * Pure functions over plain values, so the arithmetic and the placement are
 * testable without a browser and the threshold that drives the color is data
 * rather than a constant embedded in a component.
 *
 * @module @deepseek-ai/dsh-a2d2/client/orb-model
 */

export {
  contextOccupancy as orbOccupancy,
} from '../context-occupancy.ts'
export type {
  ContextOccupancy as OrbOccupancy,
} from '../context-occupancy.ts'

/** Which pressure tier the indicator is showing. */
export type OrbLevel = 'normal' | 'warn' | 'critical'

/** The two context lengths a deployment configures, in tokens. */
export interface OrbThresholds {
  /** Context length at or above which the indicator warns. */
  readonly warnAtTokens: number
  /** Context length at or above which the indicator is critical. */
  readonly criticalAtTokens: number
}

/**
 * Default thresholds: warn near the 150k-token smart zone, critical when the
 * context is full.
 *
 * Lengths rather than ratios, because the smart-zone signal follows how much
 * context a session carries, not the share of whatever window the current model
 * happens to advertise. Reaching it cues a choice at the next phase boundary;
 * changing sessions is only one outcome. Both thresholds are overridden through
 * this plugin's `handoffWarnTokens` / `handoffCriticalTokens` config, which the
 * host publishes to the browser.
 */
export const DEFAULT_ORB_THRESHOLDS: OrbThresholds = {
  warnAtTokens: 150_000,
  criticalAtTokens: 1_000_000,
}

/**
 * Format a token count for a small circle.
 *
 * A decimal is kept only where it carries information the whole number would
 * lose: thousands are rounded to a whole `K` (nobody acts on 453K versus
 * 452.9K), while millions keep one decimal because 1.2M and 1M are different
 * contexts. The circle has room for about five characters, so this is the whole
 * budget.
 * @param tokens - the count to format.
 * @returns the compact form, e.g. `453K`, `1.2M`, `820`.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 100_000_000) return `${Math.round(tokens / 1_000_000)}M`
  if (tokens >= 1_000_000) return `${trimZero(tokens / 1_000_000)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

/** Format a value with one decimal, dropping a trailing `.0`. */
function trimZero(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/**
 * Estimated input cost for a token count at a per-million rate.
 * @param tokens - the input tokens of the next request.
 * @param price - the route's per-million input rate, or `undefined` when unpriced.
 * @returns the cost, or `undefined` when the route carries no price.
 */
export function costOf(tokens: number, price: { readonly inputPerMillion: number } | undefined): number | undefined {
  if (price === undefined) return undefined
  return tokens / 1_000_000 * price.inputPerMillion
}

/** Format a cost for the circle: two decimals below 100, whole numbers above. */
export function formatCost(cost: number): string {
  return cost >= 100 ? String(Math.round(cost)) : cost.toFixed(2)
}

/**
 * The tier one context length sits in.
 *
 * A threshold at or below zero would warn on an empty context, so a nonsensical
 * pair is rejected at the configuration boundary rather than silently honored
 * here; this function assumes an ordered, positive pair.
 * @param usedTokens - the context length the next request would carry.
 * @param thresholds - the configured lengths.
 * @returns the tier.
 */
export function orbLevel(usedTokens: number, thresholds: OrbThresholds): OrbLevel {
  if (usedTokens >= thresholds.criticalAtTokens) return 'critical'
  if (usedTokens >= thresholds.warnAtTokens) return 'warn'
  return 'normal'
}

/**
 * The share of the indicator the water fills, in whole percent.
 *
 * Occupancy can exceed the capacity (a provider sample larger than the newest
 * advertised window, or a heuristic projection that overshoots), so this is
 * clamped: a full circle means "at or past capacity", never an overflowing one.
 * @param percent - occupancy in whole percent.
 * @returns the fill share, 0 through 100.
 */
export function waterLevel(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)))
}

/** Distance kept between the indicator and a shell panel or the viewport edge, in px. */
export const ORB_GAP_PX = 12

/**
 * The confirm/consult card's width in px.
 *
 * Mirrors `.card { width }` in `orb.module.css`: the guard in
 * {@link anchorRightOffset} needs the number and the stylesheet cannot be read
 * from here, so the two carry each other's name and move together.
 */
export const ORB_CARD_WIDTH_PX = 288

/**
 * What the shell currently occupies at the right of the viewport.
 *
 * @property viewportWidth - the layout viewport width in px; the containing
 * block a `position: fixed` anchor is measured against, so this is the document
 * element's client width (scrollbar excluded), not `innerWidth`.
 * @property regionRight - the right edge of the layout region the indicator is
 * laid out in, or `undefined` before that region is mounted. A shell that pushes
 * its conversation column left for a right-hand panel reports the squeezed edge,
 * so the space beyond it is exactly that panel.
 * @property detailsWidth - the width of the shell's own details column, for
 * shells that keep a measured column instead of pushing the content aside.
 */
export interface AnchorRoom {
  /** The layout viewport width in px. */
  readonly viewportWidth: number
  /** Right edge of the region the indicator lives in, or `undefined` when unknown. */
  readonly regionRight: number | undefined
  /** Width of the shell's details column in px; zero when it has none or is closed. */
  readonly detailsWidth: number
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
 *
 * The result is capped so the card stays inside the viewport: dodging a panel
 * wider than the room left over would trade a hidden panel for a card with its
 * own left edge cut off. In that case the card keeps its width and overlaps the
 * panel instead, which is the only reading order that stays usable.
 * @param room - the measured shell geometry.
 * @returns the distance from the viewport's right edge, in whole px.
 */
export function anchorRightOffset(room: AnchorRoom): number {
  const used = room.regionRight === undefined ? 0 : room.viewportWidth - room.regionRight
  const panel = Math.max(0, Math.round(Math.max(used, room.detailsWidth)))
  const dodged = ORB_GAP_PX + panel
  const insideViewport = Math.max(0, Math.round(room.viewportWidth - ORB_GAP_PX - ORB_CARD_WIDTH_PX))
  return Math.min(dodged, insideViewport)
}
