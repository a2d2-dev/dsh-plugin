/**
 * The subagent model list: every direct child of the open session, with the
 * route each is actually being served by.
 *
 * The list exists because a child's route is otherwise invisible. The session's
 * own model is the one the user picked; a delegated child's is whatever the
 * composition in force when it was created declared, and nothing in the shipped
 * subagent UI surfaces it — so children pinned to another model spend that
 * model's budget unobserved.
 *
 * Every field is a host fold this component only reads: the child list from the
 * session list's subagent catalog, and each route from that session's own
 * `a2d2Indicator` projection. Only the catalog needs asking for, because the
 * host publishes it per selected parent rather than streaming it; projection
 * updates reach the list on their own.
 *
 * @module @deepseek-ai/dsh-a2d2/client/subagent-tab
 */

import { createElement, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type {
  A2d2ClientContext, ClientRouteSource, ClientSessionListSnapshot, ClientSessionListStore,
  ClientSessionsService,
} from './context.ts'
import { formatRoute, subagentRouteRows, subagentRouteTally, type SubagentRouteRow } from './subagent-model.ts'
import css from './subagent-tab.module.css'

/** The projection key every route below is read from. */
const INDICATOR_KEY = 'a2d2Indicator'

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
  /** The session whose direct children to list. */
  readonly sessionId: string
  /** Whether this tab is the active one; absent counts as visible, so a host that publishes no flag still refreshes. */
  readonly visible?: boolean
}

/**
 * Render the standings of a tally's drifted count.
 * @param drifted - how many children run on another route.
 * @returns the header clause to append, or `''` when nothing drifted.
 */
function driftClause(drifted: number): string {
  return drifted === 0 ? '' : ` · ${String(drifted)} 个与主会话不一致`
}

/** Render one child's route line. */
function RouteLine({ row }: { readonly row: SubagentRouteRow }): ReturnType<typeof createElement> {
  const route = formatRoute(row)
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

/** Render one child card. */
function Card({ row }: { readonly row: SubagentRouteRow }): ReturnType<typeof createElement> {
  return createElement(
    'div',
    { className: css.card },
    createElement('div', { className: css.label }, row.label),
    createElement(
      'div',
      { className: css.meta },
      row.continuable ? '可续接' : '一次性',
      ' · ',
      row.running ? '运行中' : '空闲',
    ),
    createElement(RouteLine, { row }),
  )
}

/**
 * Draw the open session's direct subagents and their routes.
 * @param props - the client context, the session to list, and its visibility.
 * @returns the rendered list.
 */
export function SubagentModelTab({ ctx, sessionId, visible }: SubagentModelTabProps): ReturnType<typeof createElement> {
  const sessions = ctx.get('sessions') as ClientSessionsService | undefined
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

  useEffect(() => {
    if (sessions === undefined) return undefined
    const refresh = (): void => { void sessions.refreshSubagents(sessionId).catch(() => undefined) }
    refresh()
    if (visible === false) return undefined
    const timer = window.setInterval(refresh, CATALOG_REFRESH_MS)
    return () => { window.clearInterval(timer) }
  }, [sessions, sessionId, visible])

  const entries = state.subagentsByParent[sessionId]?.entries ?? []
  const sources = useMemo(() => {
    const selected: Record<string, ClientRouteSource | undefined> = {}
    for (const entry of entries) selected[entry.id] = state.byId[entry.id]?.projectionValues?.[INDICATOR_KEY]
    return selected
  }, [entries, state])
  const own = state.byId[sessionId]?.projectionValues?.[INDICATOR_KEY]?.route
  const rows = subagentRouteRows(state.byId[sessionId]?.projectionValues?.[INDICATOR_KEY], entries, sources)
  const tally = subagentRouteTally(rows)

  return createElement(
    'div',
    { className: css.root },
    createElement(
      'div',
      { className: css.header },
      `${String(tally.total)} 个子代理 · ${String(tally.running)} 运行中${driftClause(tally.drifted)}`,
    ),
    createElement(
      'div',
      { className: css.own },
      '主会话 ',
      own === undefined ? '路由未知' : `${own.provider}/${own.model}`,
    ),
    rows.length === 0
      ? createElement('div', { className: css.empty }, '本会话没有子代理')
      : createElement(
        'div',
        { className: css.list },
        rows.map(row => createElement(Card, { key: row.id, row })),
      ),
  )
}
