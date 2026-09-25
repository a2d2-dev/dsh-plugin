/**
 * The floating handoff indicator's model: occupancy arithmetic and the alert
 * level that decides its color.
 *
 * Pure functions over plain values, so the arithmetic is testable without a
 * browser and the threshold that drives the color is data rather than a
 * constant embedded in a component.
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
