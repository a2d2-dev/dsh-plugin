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
  /** Whether the child has durable subagent children of its own. */
  readonly hasChildren?: boolean
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

/** One host-published session summary row the tree builder reads. */
export interface SubagentSessionSummary {
  readonly id: string
  readonly title?: string
  readonly displayTitle?: string
  readonly origin?: 'subagent'
  readonly parentId?: string
  readonly running?: boolean
  readonly projectionValues?: Readonly<Record<string, SubagentRouteSource | undefined>>
}

/** One host-published direct-child catalog. */
export interface SubagentCatalog {
  readonly entries: readonly CatalogEntry[]
}

/** Root node of the subagent route tree. */
export interface SubagentRouteRoot {
  readonly id: string
  readonly label: string
  readonly running: boolean
  readonly provider?: string
  readonly model?: string
  readonly current: boolean
}

/** One child node in the subagent route tree. */
export interface SubagentRouteTreeNode extends SubagentRouteRow {
  readonly parentId: string
  readonly mode?: 'one-shot' | 'continuable'
  readonly current: boolean
  readonly hasChildren: boolean
  readonly children: readonly SubagentRouteTreeNode[]
}

/** Complete route tree rooted at the main session. */
export interface SubagentRouteTree {
  readonly rootId: string | undefined
  readonly root: SubagentRouteRoot | undefined
  readonly children: readonly SubagentRouteTreeNode[]
  readonly tally: SubagentRouteTally
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
const INDICATOR_KEY = 'a2d2Indicator'

function routeChanged(
  parentRoute: SubagentRouteSource['route'] | undefined,
  childRoute: SubagentRouteSource['route'] | undefined,
): boolean {
  return parentRoute !== undefined && childRoute !== undefined
    && (parentRoute.provider !== childRoute.provider || parentRoute.model !== childRoute.model)
}

function sourceOf(
  summary: SubagentSessionSummary | undefined,
  projectionKey = INDICATOR_KEY,
): SubagentRouteSource | undefined {
  return summary?.projectionValues?.[projectionKey]
}

function catalogMode(entry: CatalogEntry): 'one-shot' | 'continuable' | undefined {
  if (entry.mode === 'one-shot' || entry.mode === 'continuable') return entry.mode
  return undefined
}

function summaryLabel(summary: SubagentSessionSummary | undefined, id: string): string {
  const label = summary?.title ?? summary?.displayTitle
  return label === undefined || label === '' ? id.slice(0, SHORT_ID_LENGTH) : label
}

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
      drifted: routeChanged(parentRoute, route),
    })
  }
  return rows
}

/**
 * Walk a durable subagent parent chain to the main session.
 *
 * Broken or cyclic chains degrade to the requested session itself.
 */
export function rootAncestor(
  byId: Readonly<Record<string, SubagentSessionSummary | undefined>>,
  sessionId: string | undefined,
): string | undefined {
  if (sessionId === undefined) return undefined
  const seen = new Set<string>()
  let current = byId[sessionId]
  while (current !== undefined && current.origin === 'subagent' && current.parentId !== undefined) {
    if (seen.has(current.id)) return sessionId
    seen.add(current.id)
    const parent = byId[current.parentId]
    if (parent === undefined) return sessionId
    current = parent
  }
  return current?.id ?? sessionId
}

function buildChildTree(
  byId: Readonly<Record<string, SubagentSessionSummary | undefined>>,
  catalogs: Readonly<Record<string, SubagentCatalog | undefined>>,
  parentId: string,
  parentRoute: SubagentRouteSource['route'] | undefined,
  currentSessionId: string,
  tally: { total: number; running: number; drifted: number },
  path: ReadonlySet<string>,
): readonly SubagentRouteTreeNode[] {
  const catalog = catalogs[parentId]
  if (catalog === undefined) return []
  const nextPath = new Set(path)
  nextPath.add(parentId)
  const nodes: SubagentRouteTreeNode[] = []
  for (const entry of catalog.entries) {
    if (entry.kind !== 'child') continue
    const summary = byId[entry.id]
    const source = sourceOf(summary)
    const route = source?.route
    const drifted = routeChanged(parentRoute, route)
    const running = entry.activity === 'running'
    tally.total += 1
    if (running) tally.running += 1
    if (drifted) tally.drifted += 1
    const canRecurse = entry.hasChildren === true && !nextPath.has(entry.id)
    const mode = catalogMode(entry)
    nodes.push({
      id: entry.id,
      parentId,
      label: entry.label === undefined || entry.label === '' ? summaryLabel(summary, entry.id) : entry.label,
      continuable: entry.mode === 'continuable',
      ...(mode === undefined ? {} : { mode }),
      running,
      ...route === undefined ? {} : { provider: route.provider, model: route.model },
      drifted,
      current: entry.id === currentSessionId,
      hasChildren: entry.hasChildren === true,
      children: canRecurse
        ? buildChildTree(byId, catalogs, entry.id, route, currentSessionId, tally, nextPath)
        : [],
    })
  }
  return nodes
}

/**
 * Build the full currently-known subagent route tree.
 *
 * Catalogs are lazy; a child marked `hasChildren` may have no children here
 * until its own parent catalog has been refreshed.
 */
export function subagentRouteTree(
  byId: Readonly<Record<string, SubagentSessionSummary | undefined>>,
  catalogs: Readonly<Record<string, SubagentCatalog | undefined>>,
  currentSessionId: string,
): SubagentRouteTree {
  const rootId = rootAncestor(byId, currentSessionId)
  const rootSummary = rootId === undefined ? undefined : byId[rootId]
  const rootSource = sourceOf(rootSummary)
  const rootRoute = rootSource?.route
  const tally = { total: 0, running: 0, drifted: 0 }
  const children = rootId === undefined
    ? []
    : buildChildTree(byId, catalogs, rootId, rootRoute, currentSessionId, tally, new Set())
  return {
    rootId,
    root: rootId === undefined
      ? undefined
      : {
        id: rootId,
        label: summaryLabel(rootSummary, rootId),
        running: rootSummary?.running === true,
        ...rootRoute === undefined ? {} : { provider: rootRoute.provider, model: rootRoute.model },
        current: rootId === currentSessionId,
      },
    children,
    tally,
  }
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
