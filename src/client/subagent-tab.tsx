/**
 * The subagent model tree: the main session for the open conversation, every
 * loaded descendant, and the route each is actually being served by.
 *
 * The list exists because a child's route is otherwise invisible. The session's
 * own model is the one the user picked; a delegated child's is whatever the
 * composition in force when it was created declared, and nothing in the shipped
 * subagent UI surfaces it — so children pinned to another model spend that
 * model's budget unobserved.
 *
 * Every field is a host fold this component only reads: child lists from the
 * session list's per-parent subagent catalogs, and each route from that
 * session's own `a2d2Indicator` projection. Catalogs are published lazily per
 * selected parent; route projections come from the list store when present and
 * otherwise from the child's non-activating history projection baseline.
 *
 * @module @deepseek-ai/dsh-a2d2/client/subagent-tab
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type {
  A2d2ClientContext, ClientSessionListSnapshot, ClientSessionListStore,
  ClientSessionsService,
} from './context.ts'
import {
  createRouteSourceLoader,
  formatRoute,
  subagentRouteHeader,
  subagentRouteTree,
  type SubagentRouteAddress,
  type SubagentRouteRoot,
  type SubagentRouteHistoryApi,
  type RouteSourceLoader,
  type SubagentRouteSource,
  type SubagentRouteTreeNode,
} from './subagent-model.ts'
import css from './subagent-tab.module.css'

/**
 * How often the visible tab re-requests the catalog, in milliseconds.
 *
 * The catalog is a request/response, not a stream, so a child delegated while
 * the tab sits open appears only on the next ask. Five seconds is shorter than
 * the time it takes to read the list and longer than one host listing.
 */
const CATALOG_REFRESH_MS = 5_000

/** The list a deployment without a sessions service reads: empty, and never updating. */
const NO_LIST: ClientSessionListSnapshot = { byId: {}, subagentsByParent: {} }

/** Full props for the subagent model list. */
export interface SubagentModelTabProps {
  /** The client context carrying the sessions service. */
  readonly ctx: A2d2ClientContext
  /** The session whose main-session subagent tree to show. */
  readonly sessionId: string
  /** Whether this tab is the active one; absent counts as visible, so a host that publishes no flag still refreshes. */
  readonly visible?: boolean
}

/** Render one node's route line. */
function RouteLine({ row }: { readonly row: Pick<SubagentRouteTreeNode | SubagentRouteRoot, 'provider' | 'model'> & { readonly drifted?: boolean } }): ReturnType<typeof createElement> {
  const route = formatRoute({
    id: '',
    label: '',
    continuable: false,
    running: false,
    drifted: row.drifted === true,
    ...(row.provider === undefined ? {} : { provider: row.provider }),
    ...(row.model === undefined ? {} : { model: row.model }),
  })
  if (route === undefined) {
    return createElement('div', { className: css.routeUnknown }, '路由未知（尚未发起请求）')
  }
  return createElement(
    'div',
    { className: row.drifted ? css.routeDrifted : css.route },
    row.drifted ? '⚠ ' : '',
    route,
  )
}

function collectCatalogParents(rootId: string | undefined, nodes: readonly SubagentRouteTreeNode[]): readonly string[] {
  if (rootId === undefined) return []
  const ids = new Set<string>([rootId])
  const visit = (node: SubagentRouteTreeNode): void => {
    if (node.hasChildren) ids.add(node.id)
    for (const child of node.children) visit(child)
  }
  for (const node of nodes) visit(node)
  return [...ids]
}

function collectRouteAddresses(nodes: readonly SubagentRouteTreeNode[]): readonly SubagentRouteAddress[] {
  const addresses: SubagentRouteAddress[] = []
  const visit = (node: SubagentRouteTreeNode): void => {
    if (node.model === undefined && node.mode !== undefined) {
      addresses.push({ parentSessionId: node.parentId, childSessionId: node.id, mode: node.mode })
    }
    for (const child of node.children) visit(child)
  }
  for (const node of nodes) visit(node)
  return addresses
}

function sourcesChanged(
  left: Readonly<Record<string, SubagentRouteSource | undefined>>,
  right: Readonly<Record<string, SubagentRouteSource | undefined>>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return true
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return true
  }
  return false
}

/** Render the root card. */
function RootCard({
  row,
  open,
}: {
  readonly row: SubagentRouteRoot
  readonly open: (id: string) => void
}): ReturnType<typeof createElement> {
  return createElement(
    'button',
    {
      type: 'button',
      className: row.current ? `${css.card} ${css.cardCurrent}` : css.card,
      title: row.id,
      onClick: () => { open(row.id) },
    },
    createElement('div', { className: css.label }, row.label),
    createElement(
      'div',
      { className: css.meta },
      '主会话 · ',
      row.running ? '运行中' : '空闲',
    ),
    createElement(RouteLine, { row }),
  )
}

/** Render one child node and its descendants. */
function NodeCard({
  row,
  open,
}: {
  readonly row: SubagentRouteTreeNode
  readonly open: (row: SubagentRouteTreeNode) => void
}): ReturnType<typeof createElement> {
  return createElement(
    'div',
    { className: css.node },
    createElement(
      'button',
      {
        type: 'button',
        className: row.current ? `${css.card} ${css.cardCurrent}` : css.card,
        title: row.id,
        onClick: () => { open(row) },
      },
      createElement('div', { className: css.label }, row.label),
      createElement(
        'div',
        { className: css.meta },
        row.continuable ? '可续接' : '一次性',
        ' · ',
        row.running ? '运行中' : '空闲',
      ),
      createElement(RouteLine, { row }),
    ),
    row.children.length === 0
      ? null
      : createElement(
        'div',
        { className: css.children },
        row.children.map(child => createElement(NodeCard, { key: child.id, row: child, open })),
      ),
  )
}

/**
 * Draw the open session's main-session subagent topology and its routes.
 * @param props - the client context, the session to list, and its visibility.
 * @returns the rendered list.
 */
export function SubagentModelTab({ ctx, sessionId, visible }: SubagentModelTabProps): ReturnType<typeof createElement> {
  const sessions = ctx.get('sessions') as ClientSessionsService | undefined
  const connection = ctx.get('connection') as { readonly api?: SubagentRouteHistoryApi } | undefined
  const inflightRef = useRef(new Set<string>())
  const [historySources, setHistorySources] = useState<Readonly<Record<string, SubagentRouteSource | undefined>>>({})
  // A stable no-op store stands in while the sessions service is absent, keeping
  // the hook count constant across a deployment that mounts no session list.
  const fallback = useMemo<ClientSessionListStore>(() => ({
    getSnapshot: () => NO_LIST,
    subscribe: () => () => {},
  }), [])
  const list = sessions?.list ?? fallback
  const getSnapshot = useCallback(() => list.getSnapshot(), [list])
  const subscribe = useCallback((listener: () => void) => list.subscribe(listener), [list])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const tree = useMemo(
    () => subagentRouteTree(state.byId, state.subagentsByParent, sessionId, historySources),
    [state, sessionId, historySources],
  )
  const catalogParents = useMemo(
    () => collectCatalogParents(tree.rootId, tree.children),
    [tree.rootId, tree.children],
  )
  const routeAddresses = useMemo(
    () => collectRouteAddresses(tree.children),
    [tree.children],
  )
  const routeLoader = useMemo<RouteSourceLoader | undefined>(
    () => connection?.api === undefined ? undefined : createRouteSourceLoader(connection.api),
    [connection?.api],
  )
  const refreshCatalog = useCallback((parentId: string): void => {
    if (sessions === undefined) return
    if (inflightRef.current.has(parentId)) return
    inflightRef.current.add(parentId)
    void sessions.refreshSubagents(parentId)
      .catch(() => undefined)
      .finally(() => { inflightRef.current.delete(parentId) })
  }, [sessions])

  useEffect(() => {
    if (sessions === undefined) return undefined
    if (visible === false) return undefined
    const refresh = (): void => {
      for (const parentId of catalogParents) refreshCatalog(parentId)
    }
    refresh()
    const timer = window.setInterval(refresh, CATALOG_REFRESH_MS)
    return () => { window.clearInterval(timer) }
  }, [sessions, visible, catalogParents, refreshCatalog])

  useEffect(() => {
    if (sessions === undefined) return undefined
    if (visible === false) return undefined
    for (const parentId of catalogParents) sessions.setSubagentCatalogOpen?.(parentId, true)
    return () => {
      for (const parentId of catalogParents) sessions.setSubagentCatalogOpen?.(parentId, false)
    }
  }, [sessions, visible, catalogParents])

  useEffect(() => {
    return () => { routeLoader?.dispose() }
  }, [routeLoader])

  useEffect(() => {
    if (routeLoader === undefined) return undefined
    const publishSnapshot = (): void => {
      const snapshot = routeLoader.snapshot()
      setHistorySources((current) => sourcesChanged(current, snapshot) ? { ...snapshot } : current)
    }
    publishSnapshot()
    return routeLoader.subscribe(publishSnapshot)
  }, [routeLoader])

  useEffect(() => {
    if (routeLoader === undefined) return undefined
    if (visible === false) return undefined
    routeLoader.load(routeAddresses)
    return undefined
  }, [routeLoader, routeAddresses, visible])

  const openRoot = useCallback((id: string): void => {
    try {
      sessions?.open(id)
    } catch {
      // The row can disappear between render and click.
    }
  }, [sessions])

  const openNode = useCallback((row: SubagentRouteTreeNode): void => {
    try {
      if (row.mode !== undefined && sessions?.openSubagent !== undefined) {
        sessions.openSubagent({ parentSessionId: row.parentId, childSessionId: row.id, mode: row.mode })
        return
      }
      sessions?.open(row.id)
    } catch {
      // The row can disappear between render and click.
    }
  }, [sessions])

  return createElement(
    'div',
    { className: css.root },
    createElement(
      'div',
      { className: css.header },
      subagentRouteHeader(tree.tally),
    ),
    tree.root === undefined
      ? null
      : createElement(RootCard, { row: tree.root, open: openRoot }),
    tree.children.length === 0
      ? createElement('div', { className: css.empty }, '本会话没有子代理')
      : createElement(
        'div',
        { className: css.list },
        tree.children.map(row => createElement(NodeCard, { key: row.id, row, open: openNode })),
      ),
  )
}
