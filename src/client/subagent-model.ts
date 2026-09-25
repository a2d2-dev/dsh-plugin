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

/** Durable child address accepted by the host's subagent history API. */
export interface SubagentRouteAddress {
  readonly parentSessionId: string
  readonly childSessionId: string
  readonly mode: 'one-shot' | 'continuable'
}

/** The narrow host API face used to cold-read a child session's projection baseline. */
export interface SubagentRouteHistoryApi {
  readonly subagents: {
    history(
      payload: SubagentRouteAddress & { readonly maxMessages: number },
      signal?: AbortSignal,
    ): Promise<{
      readonly result:
        | {
          readonly ok: true
          readonly value: {
            readonly projections?: {
              readonly values?: Readonly<Record<string, unknown>>
            }
          }
        }
        | { readonly ok: false }
    }>
  }
}

/** Subscriber called when a route source loader publishes newly-read sources. */
export type RouteSourceLoaderListener = () => void

/** React-independent lifecycle for cold-reading child route projection baselines. */
export interface RouteSourceLoader {
  /** Submit candidate addresses whose sources should be loaded. Already-finished and in-flight addresses are ignored. */
  readonly load: (addresses: readonly SubagentRouteAddress[]) => void
  /** Read every successfully loaded source, keyed by child session id. */
  readonly snapshot: () => Readonly<Record<string, SubagentRouteSource | undefined>>
  /** Subscribe to later snapshot changes. */
  readonly subscribe: (listener: RouteSourceLoaderListener) => () => void
  /** Abort in-flight reads and stop accepting work. */
  readonly dispose: () => void
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
  readonly title?: string | null
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

function routeAddressKey(address: SubagentRouteAddress): string {
  return `${address.parentSessionId}\u0000${address.childSessionId}\u0000${address.mode}`
}

function routeChanged(
  parentRoute: SubagentRouteSource['route'] | undefined,
  childRoute: SubagentRouteSource['route'] | undefined,
): boolean {
  return parentRoute !== undefined && childRoute !== undefined
    && (parentRoute.provider !== childRoute.provider || parentRoute.model !== childRoute.model)
}

function sourceOf(
  summary: SubagentSessionSummary | undefined,
  sources: Readonly<Record<string, SubagentRouteSource | undefined>> = {},
  id?: string,
  projectionKey = INDICATOR_KEY,
): SubagentRouteSource | undefined {
  return summary?.projectionValues?.[projectionKey] ?? (id === undefined ? undefined : sources[id])
}

function catalogMode(entry: CatalogEntry): 'one-shot' | 'continuable' | undefined {
  if (entry.mode === 'one-shot' || entry.mode === 'continuable') return entry.mode
  return undefined
}

function summaryLabel(summary: SubagentSessionSummary | undefined, id: string): string {
  const label = summary?.title ?? summary?.displayTitle
  return label === undefined || label === '' ? id.slice(0, SHORT_ID_LENGTH) : label
}

function routeSourceFromProjection(value: unknown): SubagentRouteSource | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const route = (value as { readonly route?: unknown }).route
  if (route === undefined) return {}
  if (route === null || typeof route !== 'object') return undefined
  const provider = (route as { readonly provider?: unknown }).provider
  const model = (route as { readonly model?: unknown }).model
  if (typeof provider !== 'string' || typeof model !== 'string') return undefined
  return { route: { provider, model } }
}

/**
 * Read the host-computed route projection for inactive catalog children.
 *
 * The tail history page is the supported non-activating read path for subagent
 * sessions; it carries the same projections block a normal session open uses to
 * seed its projection store.
 */
export async function loadSubagentRouteSources(
  api: SubagentRouteHistoryApi | undefined,
  addresses: readonly SubagentRouteAddress[],
  signal?: AbortSignal,
): Promise<Record<string, SubagentRouteSource | undefined>> {
  if (api === undefined || addresses.length === 0) return {}
  const settled = await Promise.allSettled(addresses.map(async (address) => {
    const response = await api.subagents.history({ ...address, maxMessages: 1 }, signal)
    if (!response.result.ok) return [address.childSessionId, undefined] as const
    const value = response.result.value.projections?.values?.[INDICATOR_KEY]
    return [address.childSessionId, routeSourceFromProjection(value)] as const
  }))
  const pairs = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  return Object.fromEntries(pairs)
}

/**
 * Create a deduplicating loader for inactive subagent route baselines.
 *
 * The loader owns AbortControllers for its full lifecycle so React dependency
 * churn can submit the same addresses without canceling useful in-flight reads.
 */
export function createRouteSourceLoader(api: SubagentRouteHistoryApi): RouteSourceLoader {
  const sources: Record<string, SubagentRouteSource | undefined> = {}
  const completed = new Set<string>()
  const inflight = new Map<string, AbortController>()
  const listeners = new Set<RouteSourceLoaderListener>()
  let disposed = false

  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  const loadOne = async (address: SubagentRouteAddress, key: string, controller: AbortController): Promise<void> => {
    try {
      const response = await api.subagents.history({ ...address, maxMessages: 1 }, controller.signal)
      if (disposed || controller.signal.aborted) return
      completed.add(key)
      if (!response.result.ok) return
      const source = routeSourceFromProjection(response.result.value.projections?.values?.[INDICATOR_KEY])
      if (source === undefined) return
      if (sources[address.childSessionId] === source) return
      sources[address.childSessionId] = source
      emit()
    } catch {
      // A failed address remains retryable and must not affect other reads.
    } finally {
      inflight.delete(key)
    }
  }

  return {
    load(addresses) {
      if (disposed) return
      for (const address of addresses) {
        const key = routeAddressKey(address)
        if (completed.has(key) || inflight.has(key)) continue
        const controller = new AbortController()
        inflight.set(key, controller)
        void loadOne(address, key, controller)
      }
    },
    snapshot() {
      return sources
    },
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const controller of inflight.values()) controller.abort()
      inflight.clear()
      listeners.clear()
    },
  }
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
  sources: Readonly<Record<string, SubagentRouteSource | undefined>>,
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
    const source = sourceOf(summary, sources, entry.id)
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
        ? buildChildTree(byId, catalogs, sources, entry.id, route, currentSessionId, tally, nextPath)
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
  sources: Readonly<Record<string, SubagentRouteSource | undefined>> = {},
): SubagentRouteTree {
  const rootId = rootAncestor(byId, currentSessionId)
  const rootSummary = rootId === undefined ? undefined : byId[rootId]
  const rootSource = sourceOf(rootSummary, sources, rootId)
  const rootRoute = rootSource?.route
  const tally = { total: 0, running: 0, drifted: 0 }
  const children = rootId === undefined
    ? []
    : buildChildTree(byId, catalogs, sources, rootId, rootRoute, currentSessionId, tally, new Set())
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
