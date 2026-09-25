/**
 * A²D² sidebar panel: project tasks above, subagent model routes below.
 *
 * @module @deepseek-ai/dsh-a2d2/client/panel
 */

import { createElement, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { A2d2ClientContext, ClientSessionListSnapshot, ClientSessionListStore, ClientSessionsService } from './context.ts'
import { fetchPanel } from './panel-api.ts'
import { handoffForest, nextPanelState, panelLoadState, panelTally, panelTaskRows } from './panel-model.ts'
import type { PanelClientState, PanelMemberRow, PanelMemberTreeNode, PanelTaskRow } from './panel-model.ts'
import { SubagentModelTab } from './subagent-tab.tsx'
import css from './panel.module.css'

const PANEL_REFRESH_MS = 5_000

const NO_LIST: ClientSessionListSnapshot = { byId: {}, subagentsByParent: {} }

export interface A2d2PanelProps {
  readonly ctx: A2d2ClientContext
  readonly sessionId: string
  readonly visible?: boolean
}

function stateClass(state: PanelTaskRow['state']): string {
  if (state === 'active') return css.stateActive
  if (state === 'paused') return css.statePaused
  return css.stateDone
}

function MemberLine({ row, ctx }: { readonly row: PanelMemberRow; readonly ctx: A2d2ClientContext }): ReturnType<typeof createElement> {
  const sessions = ctx.get('sessions') as ClientSessionsService | undefined
  const label = row.title ?? row.shortId
  const open = (): void => {
    if (!row.openable) return
    try {
      sessions?.open(row.sessionId)
    } catch {
      // The list may have changed between render and click; the next list
      // snapshot makes the stale row non-openable.
    }
  }
  return createElement(
    'div',
    { className: row.current ? `${css.member} ${css.memberCurrent}` : css.member, title: row.sessionId },
    createElement(
      'button',
      {
        type: 'button',
        className: row.openable ? css.memberButton : css.memberStatic,
        disabled: !row.openable,
        onClick: open,
      },
      label,
    ),
    row.current ? createElement('span', { className: css.current }, '当前') : null,
    row.handoffFromLabel === undefined
      ? null
      : createElement('span', { className: css.edge }, `← 交接自 ${row.handoffFromLabel}`),
  )
}

function MemberNode({ node, ctx }: { readonly node: PanelMemberTreeNode; readonly ctx: A2d2ClientContext }): ReturnType<typeof createElement> {
  return createElement(
    'div',
    { className: css.memberNode },
    createElement(MemberLine, { row: node.row, ctx }),
    node.children.length === 0
      ? null
      : createElement(
        'div',
        { className: css.memberChildren },
        node.children.map(child => createElement(MemberNode, { key: child.row.sessionId, node: child, ctx })),
      ),
  )
}

function TaskCard({ row, ctx }: { readonly row: PanelTaskRow; readonly ctx: A2d2ClientContext }): ReturnType<typeof createElement> {
  const memberForest = handoffForest(row.members)
  return createElement(
    'div',
    { className: row.current ? css.cardCurrent : css.card },
    createElement(
      'div',
      { className: css.cardHead },
      createElement('div', { className: css.name, title: row.id }, row.name),
      createElement('span', { className: `${css.state} ${stateClass(row.state)}` }, row.stateLabel),
    ),
    row.goal === undefined ? null : createElement('div', { className: css.goal }, row.goal),
    createElement(
      'div',
      { className: css.meta },
      `${String(row.members.length)} 个会话`,
      row.handoffs === 0 ? '' : ` · ${String(row.handoffs)} 次交接`,
      ` · ${row.created}`,
    ),
    createElement(
      'div',
      { className: css.members },
      row.members.length === 0
        ? createElement('div', { className: css.memberEmpty }, '还没有会话加入')
        : memberForest.map(node => createElement(MemberNode, { key: node.row.sessionId, node, ctx })),
    ),
  )
}

export function A2d2Panel({ ctx, sessionId, visible }: A2d2PanelProps): ReturnType<typeof createElement> {
  const sessions = ctx.get('sessions') as ClientSessionsService | undefined
  const fallback = useMemo<ClientSessionListStore>(() => ({
    getSnapshot: () => NO_LIST,
    subscribe: () => () => {},
  }), [])
  const list = sessions?.list ?? fallback
  const getSnapshot = useCallback(() => list.getSnapshot(), [list])
  const subscribe = useCallback((listener: () => void) => list.subscribe(listener), [list])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const [panel, setPanel] = useState<PanelClientState>({ payload: undefined, failure: undefined })

  useEffect(() => {
    if (visible === false) return undefined
    const controller = new AbortController()
    let live = true
    const read = async (): Promise<void> => {
      const result = await fetchPanel(sessionId, controller.signal)
      if (!live || result === undefined) return
      setPanel(state => nextPanelState(state, result))
    }
    void read()
    const timer = window.setInterval(() => { void read() }, PANEL_REFRESH_MS)
    return () => {
      live = false
      controller.abort()
      window.clearInterval(timer)
    }
  }, [sessionId, visible])

  const titles = useMemo(() => {
    const map: Record<string, string | undefined> = {}
    for (const [id, row] of Object.entries(state.byId)) map[id] = row?.title
    return map
  }, [state])
  const openable = useCallback((id: string) => state.byId[id] !== undefined, [state])
  const { payload, failure } = panel
  const rows = payload === undefined ? [] : panelTaskRows(payload, titles, openable, sessionId)
  const tally = panelTally(rows)
  const load = panelLoadState(payload, failure)
  const taskHeader = load.kind === 'failed'
    ? '任务读取失败'
    : load.kind === 'loading'
      ? '正在读取任务'
      : tally.total === 0
        ? '本项目还没有任务'
        : `${String(tally.total)} 个任务 · ${String(tally.active)} 个进行中 · ${String(tally.members)} 个会话`

  return createElement(
    'div',
    { className: css.root },
    createElement(
      'section',
      { className: css.section },
      createElement(
        'div',
        { className: css.header },
        taskHeader,
      ),
      load.kind === 'failed' && payload === undefined ? null : createElement(
        'div',
        { className: css.own },
        tally.current === undefined ? '当前会话不属于任何任务' : `当前会话在「${tally.current.name}」`,
      ),
      payload === undefined ? null : createElement('div', { className: css.rootPath, title: payload.root }, `项目 ${payload.root}`),
      load.kind === 'failed' ? createElement('div', { className: css.failure }, load.message) : null,
      load.kind === 'loading' ? createElement('div', { className: css.loading }, '正在读取任务') : null,
      load.kind === 'empty' ? createElement('div', { className: css.empty }, '这个项目没有任务') : null,
      rows.length === 0
        ? null
        : createElement(
          'div',
          { className: css.list },
          rows.map(row => createElement(TaskCard, { key: row.id, row, ctx })),
        ),
    ),
    createElement('div', { className: css.divider }, '子代理模型'),
    createElement(SubagentModelTab, { ctx, sessionId, ...(visible === undefined ? {} : { visible }) }),
  )
}
