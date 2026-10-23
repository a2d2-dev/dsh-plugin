/**
 * Shared context-occupancy arithmetic for host consults and the browser orb.
 *
 * The token facts come from DSH's `contextPressure` projection. Both surfaces
 * prefer `projectedTokens` over the raw provider sample because the projection
 * carries the last sample forward across surface changes.
 *
 * @module @a2d2/dsh-a2d2/src/context-occupancy
 */

/** The subset of the host `contextPressure` projection this plugin consumes. */
export interface ContextPressureProjection {
  readonly pressureTokens?: number
  readonly projectedTokens?: number
  readonly contextWindow?: number
}

/** Context occupancy as a token numerator over the advertised context window. */
export interface ContextOccupancy {
  /** Whole percent used, clamped to 100. */
  readonly percent: number
  /** The numerator: what the next request's prompt is expected to cost. */
  readonly usedTokens: number
  /** The denominator: the newest recorded route capacity. */
  readonly contextWindow: number
}

/**
 * Occupancy from the session's `contextPressure` projection value.
 *
 * @param pressure - the `contextPressure` value, or `undefined` when absent.
 * @returns the occupancy, or `null` until both a numerator and capacity exist.
 */
export function contextOccupancy(
  pressure: ContextPressureProjection | undefined,
): ContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}
