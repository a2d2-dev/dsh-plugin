/**
 * The subagent model list's model: which children the open session has, what
 * route each is being served by, and which of them disagree with the session
 * they were delegated from.
 *
 * Pure functions over plain values, so the drift rule is testable without a
 * browser and the reading of two host-published stores stays out of the
 * component.
 *
 * Both inputs are host folds, not client arithmetic: the child list comes from
 * the `subagents` catalog the host publishes for one parent, and each route
 * comes from that session's own `a2d2Indicator` projection. A client cannot
 * derive either — a browser bundle holds no adapter registry, and a child's
 * `request/header` lives in the child's log, never in its parent's.
 *
 * @module @deepseek-ai/dsh-a2d2/client/subagent-model
 */

/** The `a2d2Indicator` fields this reading uses. */
export interface SubagentRouteSource {
  /** The route the session's newest request named, absent before its first request. */
  readonly route?: { readonly provider: string; readonly model: string }
}

/** One entry of the host-published subagent catalog for a parent session. */
export interface CatalogEntry {
  /** `child` for a session-backed subagent; `diagnostic` for an unreadable one. */
  readonly kind: string
  /** Durable child session id. */
  readonly id: string
  /** Durable creation label, absent on a one-shot child the host never labelled. */
  readonly label?: string
  /** `one-shot` or `continuable`. */
  readonly mode?: string
  /** `running` while the child is live in the session store, else `inactive`. */
  readonly activity?: string
}

/** One row the list draws. */
export interface SubagentRouteRow {
  /** Durable child session id. */
  readonly id: string
  /** Durable creation label, or the id's short prefix when the host published none. */
  readonly label: string
  /** Whether the child can be resumed after its run. */
  readonly continuable: boolean
  /** Whether the child is live in the session store. */
  readonly running: boolean
  /** The provider the child is served by, absent until its first request. */
  readonly provider?: string
  /** The model the child is served by, absent until its first request. */
  readonly model?: string
  /**
   * Whether this child's route differs from the delegating session's.
   *
   * Only a known child route compared against a known parent route can drift: a
   * row missing either one reports `false`, because "not yet known" is not a
   * difference and must not be shown as one.
   */
  readonly drifted: boolean
}

/** How many children a session has, and how many of them run on another route. */
export interface SubagentRouteTally {
  /** Direct children the catalog reports. */
  readonly total: number
  /** Children currently live in the session store. */
  readonly running: number
  /** Children whose known route differs from the parent's known route. */
  readonly drifted: number
}

/** Characters of a child id shown when the host published no label. */
const SHORT_ID_LENGTH = 8

/**
 * Project the catalog and the route projections into the list's rows.
 * @param parent - the delegating session's projection, or `undefined` when the client has none yet.
 * @param entries - the catalog entries the host published for that parent.
 * @param sources - each candidate id's projection, keyed by session id; a missing key is an unknown route.
 * @returns one row per session-backed child, in catalog order. Diagnostic entries are omitted: the list reports children, and an unreadable candidate has no route to show.
 */
export function subagentRouteRows(
  parent: SubagentRouteSource | undefined,
  entries: readonly CatalogEntry[],
  sources: Readonly<Record<string, SubagentRouteSource | undefined>>,
): SubagentRouteRow[] {
  const parentRoute = parent?.route
  const rows: SubagentRouteRow[] = []
  for (const entry of entries) {
    if (entry.kind !== 'child') continue
    const route = sources[entry.id]?.route
    rows.push({
      id: entry.id,
      label: entry.label === undefined || entry.label === '' ? entry.id.slice(0, SHORT_ID_LENGTH) : entry.label,
      continuable: entry.mode === 'continuable',
      running: entry.activity === 'running',
      ...route === undefined ? {} : { provider: route.provider, model: route.model },
      drifted: route === undefined || parentRoute === undefined ? false : route.model !== parentRoute.model,
    })
  }
  return rows
}

/**
 * Count a row set for the list's header.
 * @param rows - the rows to count.
 * @returns the totals the header reads.
 */
export function subagentRouteTally(rows: readonly SubagentRouteRow[]): SubagentRouteTally {
  let running = 0
  let drifted = 0
  for (const row of rows) {
    if (row.running) running += 1
    if (row.drifted) drifted += 1
  }
  return { total: rows.length, running, drifted }
}

/** Render the subagent list header. */
export function subagentRouteHeader(tally: SubagentRouteTally): string {
  return `${String(tally.total)} 个子代理 · ${String(tally.running)} 运行中 · ${String(tally.drifted)} 个与主会话不一致`
}

/**
 * Render one route for display.
 * @param row - the row whose route to render.
 * @returns `provider/model`, or `undefined` when the child has not been served yet.
 */
export function formatRoute(row: SubagentRouteRow): string | undefined {
  if (row.model === undefined) return undefined
  return row.provider === undefined || row.provider === '' ? row.model : `${row.provider}/${row.model}`
}
