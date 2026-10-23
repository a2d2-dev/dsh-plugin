/**
 * The `a2d2Indicator` session projection: everything the floating indicator
 * needs that the browser cannot work out for itself.
 *
 * The indicator runs in a browser bundle, which cannot read this plugin's host
 * configuration and does not know which model the session is routed to. Both
 * facts are folded here: the context lengths a deployment tunes, the route's
 * context capacity, and the price of that route resolved from the configured
 * price table at the moment the session's `request/header` names it.
 *
 * Price is a host-side fold rather than client arithmetic because the client has
 * no model identity to look up, and because the per-million rates are deployment
 * data that must not be compiled into a bundle.
 *
 * @module @a2d2-dev/dsh-a2d2/src/indicator-projection
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: resolves ctx.sessionProjections for the optional unit child, and
// brings the SessionProjectionMap / SessionProjectionStateMap declarations this
// module augments into the program.
import type {} from '@deepseek-ai/dsh-session-projection'

/** Context-length thresholds a deployment tunes for the indicator, in tokens. */
export interface HandoffThresholds {
  /** Context length at or above which the indicator warns. */
  readonly warnAtTokens: number
  /** Context length at or above which the indicator is critical. */
  readonly criticalAtTokens: number
}

/** What one million tokens of a route costs, in the deployment's currency. */
export interface ModelPrice {
  /** Currency per million input tokens, including cached input. */
  readonly inputPerMillion: number
  /** Currency per million output tokens; informational, since occupancy is input. */
  readonly outputPerMillion: number
}

/** The one route a session is being served by: provider plus provider-owned model id. */
export interface RouteIdentity {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
}

/** The client-visible value of the `a2d2Indicator` projection. */
export interface IndicatorProjection {
  /** The ratios this deployment configured. */
  readonly thresholds: HandoffThresholds
  /** The route's context capacity, absent until an adapter advertises one. */
  readonly contextWindow?: number
  /** The resolved price for the session's current route, absent when unpriced. */
  readonly price?: ModelPrice
  /** Currency symbol the rates are quoted in. */
  readonly currency: string
  /**
   * The route this session's newest `request/header` names, absent before its
   * first request.
   *
   * Published because no client can derive it: a browser bundle holds no adapter
   * registry, and the only client-side record of a session's route is the value
   * folded here. A reader that needs another session's route — the subagent
   * model list reads every child of the open session — has just this projection
   * to read it from, since a child session's `request/header` lives in the
   * child's own log and never in its parent's.
   */
  readonly route?: RouteIdentity
}

/** Host-side state of the unit. */
export interface IndicatorState {
  /** Configuration, fixed for the unit's lifetime. */
  readonly thresholds: HandoffThresholds
  /** Configuration, fixed for the unit's lifetime. */
  readonly currency: string
  /** The configured price table, keyed `provider/model` then bare `model`. */
  readonly prices: ReadonlyMap<string, ModelPrice>
  /** The route named by the newest `request/header`. */
  readonly route: RouteIdentity | undefined
  /** The newest advertised capacity, from `request/context`. */
  readonly contextWindow: number | undefined
}

declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionStateMap {
    /** Configuration plus route state; see {@link IndicatorState}. */
    a2d2Indicator: IndicatorState
  }

  interface SessionProjectionMap {
    /**
     * The floating indicator's inputs. Present whenever this plugin's host
     * service is composed with a projection registry; a deployment without one
     * leaves the key absent, which the client reads as "use the package
     * defaults" exactly as it treats any absent projection.
     */
    a2d2Indicator: IndicatorProjection
  }
}

const priceSchema = z.object({
  inputPerMillion: z.number().nonnegative(),
  outputPerMillion: z.number().nonnegative(),
})

/** Wire schema: the state itself is not JSON, so the wire value is shaped here. */
export const indicatorProjectionSchema = z.object({
  thresholds: z.object({
    warnAtTokens: z.number().int().positive(),
    criticalAtTokens: z.number().int().positive(),
  }),
  contextWindow: z.number().int().positive().optional(),
  price: priceSchema.optional(),
  currency: z.string(),
  route: z.object({ provider: z.string(), model: z.string() }).optional(),
})

/**
 * Resolve a route's price: the `provider/model` entry first, then a bare model
 * entry, so a deployment can price one model across every provider that serves it.
 * @param prices - the configured table.
 * @param route - the route to price.
 * @returns the price, or `undefined` when the table prices neither key.
 */
export function resolveModelPrice(
  prices: ReadonlyMap<string, ModelPrice>,
  route: RouteIdentity | undefined,
): ModelPrice | undefined {
  if (route === undefined) return undefined
  return prices.get(`${route.provider}/${route.model}`) ?? prices.get(route.model)
}

/**
 * Build the indicator unit for one deployment.
 * @param options.thresholds - validated occupancy ratios.
 * @param options.prices - the configured price table.
 * @param options.currency - currency symbol the rates are quoted in.
 * @returns a projection definition folding the route and capacity off the log.
 */
export function indicatorProjectionDefinition(options: {
  readonly thresholds: HandoffThresholds
  readonly prices: ReadonlyMap<string, ModelPrice>
  readonly currency: string
}): {
  key: 'a2d2Indicator'
  stateSchema: z.ZodType<IndicatorState>
  init: () => IndicatorState
  apply: (state: IndicatorState, event: SessionEvent) => IndicatorState
  wire: { viewSchema: typeof indicatorProjectionSchema; view: (state: IndicatorState) => IndicatorProjection }
  stateVersion: number
} {
  const base: IndicatorState = {
    thresholds: options.thresholds,
    currency: options.currency,
    prices: options.prices,
    route: undefined,
    contextWindow: undefined,
  }
  return {
    key: 'a2d2Indicator',
    // The state carries the price table and thresholds, which no persisted cache
    // row can restore; the schema therefore validates only the wire value.
    stateSchema: z.custom<IndicatorState>(() => true),
    init: () => base,
    apply: (state, event) => {
      if (event.type === 'request/header') {
        const { provider, model } = event.data.header.config
        if (state.route?.provider === provider && state.route.model === model) return state
        return { ...state, route: { provider, model } }
      }
      if (event.type === 'request/context' && event.data.contextWindow !== undefined) {
        if (state.contextWindow === event.data.contextWindow) return state
        return { ...state, contextWindow: event.data.contextWindow }
      }
      // Every other event leaves the unit untouched, by reference, so the fold
      // costs nothing for the ordinary traffic that dominates a log.
      return state
    },
    wire: {
      viewSchema: indicatorProjectionSchema,
      view: (state) => {
        const price = resolveModelPrice(state.prices, state.route)
        return {
          thresholds: state.thresholds,
          ...(state.contextWindow === undefined ? {} : { contextWindow: state.contextWindow }),
          ...(price === undefined ? {} : { price }),
          currency: state.currency,
          ...(state.route === undefined ? {} : { route: state.route }),
        }
      },
    },
    stateVersion: 1,
  }
}
