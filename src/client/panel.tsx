/**
 * A²D² sidebar panel: project tasks above, subagent model routes below.
 *
 * @module @deepseek-ai/dsh-a2d2/client/panel
 */

import { createElement, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type {
  A2d2ClientContext, ClientSessionListSnapshot, ClientSessionListStore, ClientSessionsService, ClientWorkspaceNavigation,
} from './context.ts'
import { fetchPanel } from './panel-api.ts'
import {
  createSessionTitleLoader,
  handoffForest,
  nextPanelState,
  panelLoadState,
  panelSessionTarget,
  panelSessionTitles,
  panelTally,
  panelTaskRows,
  panelTitleReadCandidates,
} from './panel-model.ts'
import type {
  PanelClientState,
  PanelMemberRow,
  PanelMemberTreeNode,
  PanelTaskIssueRow,
  PanelTaskRow,
  SessionTitleHistoryApi,
  SessionTitleHistoryRead,
  SessionTitleLoader,
} from './panel-model.ts'
import { SubagentModelTab } from './subagent-tab.tsx'
import css from './panel.module.css'

const PANEL_REFRESH_MS = 5_000

const NO_LIST: ClientSessionListSnapshot = { byId: {}, projectionsBySession: {} }

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

/** A session label that opens the session when the shell's list holds it. */
function SessionButton({ row, ctx }: { readonly row: PanelMemberRow; readonly ctx: A2d2ClientContext }): ReturnType<typeof createElement> {
  const navigation = ctx.get('uiWorkspace') as ClientWorkspaceNavigation | undefined
  const open = (): void => {
    if (!row.openable) return
    try {
      navigation?.openSession(row.sessionId)
    } catch {
      // The list may have changed between render and click; the next list
      // snapshot makes the stale row non-openable.
    }
  }
  return createElement(
    'button',
    {
      type: 'button',
      className: row.openable ? css.memberButton : css.memberStatic,
      disabled: !row.openable,
      title: row.sessionId,
      onClick: open,
    },
    row.label,
  )
}

/** The task issue line: number, main task or subtask, and the main session. */
function IssueLine({ issue, ctx }: { readonly issue: PanelTaskIssueRow; readonly ctx: A2d2ClientContext }): ReturnType<typeof createElement> {
  return createElement(
    'div',
    { className: css.issue },
    createElement('span', { className: css.issueNumber }, `#${String(issue.number)}`),
    createElement(
      'span',
      { className: css.kind },
      issue.parent === undefined ? issue.kindLabel : `${issue.kindLabel} · 父 #${String(issue.parent)}`,
    ),
    issue.handoff === undefined
      ? null
      : createElement('span', { className: css.handoff, title: `源主会话：${issue.handoff.source.label}` }, issue.handoff.label),
    createElement('span', { className: css.issueLabel }, '主会话'),
    createElement(SessionButton, { row: issue.mainSession, ctx }),
    issue.mainSession.current ? createElement('span', { className: css.current }, '当前') : null,
  )
}

function MemberLine({ row, ctx }: { readonly row: PanelMemberRow; readonly ctx: A2d2ClientContext }): ReturnType<typeof createElement> {
  return createElement(
    'div',
    { className: row.current ? `${css.member} ${css.memberCurrent}` : css.member, title: row.sessionId },
    createElement(SessionButton, { row, ctx }),
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
    row.issue === undefined ? null : createElement(IssueLine, { issue: row.issue, ctx }),
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
  // `ctx.get` returns a fresh traceable proxy per call; read the services once
  // per context so hook dependencies stay stable — an unstable `remote`
  // recreated the title loader every render and cancelled its own reads.
  const sessions = useMemo(() => ctx.get('sessions') as ClientSessionsService | undefined, [ctx])
  const remote = useMemo(() => ctx.get('remote') as SessionTitleHistoryApi | undefined, [ctx])
  const fallback = useMemo<ClientSessionListStore>(() => ({
    getSnapshot: () => NO_LIST,
    subscribe: () => () => {},
  }), [])
  const list = sessions?.list ?? fallback
  const getSnapshot = useCallback(() => list.getSnapshot(), [list])
  const subscribe = useCallback((listener: () => void) => list.subscribe(listener), [list])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const sessionTarget = useMemo(
    () => panelSessionTarget(state.byId, sessionId),
    [state.byId, sessionId],
  )

  const [panel, setPanel] = useState<PanelClientState>({ payload: undefined, failure: undefined })
  const [titleReads, setTitleReads] = useState<Readonly<Record<string, SessionTitleHistoryRead | undefined>>>({})
  const titleLoader = useMemo<SessionTitleLoader | undefined>(
    () => remote === undefined ? undefined : createSessionTitleLoader(remote),
    [remote],
  )

  useEffect(() => {
    if (visible === false) return undefined
    const controller = new AbortController()
    let live = true
    const read = async (): Promise<void> => {
      const result = await fetchPanel(sessionTarget.querySessionId, controller.signal)
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
  }, [sessionTarget.querySessionId, visible])

  useEffect(() => {
    return () => { titleLoader?.dispose() }
  }, [titleLoader])

  useEffect(() => {
    if (titleLoader === undefined) return undefined
    const publishSnapshot = (): void => {
      setTitleReads({ ...titleLoader.snapshot() })
    }
    publishSnapshot()
    return titleLoader.subscribe(publishSnapshot)
  }, [titleLoader])

  const { payload, failure } = panel
  const titleReadCandidates = useMemo(
    () => panelTitleReadCandidates(payload, state.byId, titleReads),
    [payload, state.byId, titleReads],
  )
  const effectiveTitleReads = useMemo(() => {
    if (titleLoader !== undefined) return titleReads
    const reads: Record<string, SessionTitleHistoryRead | undefined> = { ...titleReads }
    for (const id of titleReadCandidates) reads[id] = { kind: 'failed' }
    return reads
  }, [titleLoader, titleReads, titleReadCandidates])

  useEffect(() => {
    if (titleLoader === undefined) return undefined
    if (visible === false) return undefined
    titleLoader.load(titleReadCandidates)
    return undefined
  }, [titleLoader, titleReadCandidates, visible])

  const titles = useMemo(() => {
    return panelSessionTitles(state.byId, effectiveTitleReads, titleReadCandidates)
  }, [state.byId, effectiveTitleReads, titleReadCandidates])
  const openable = useCallback((id: string) => state.byId[id] !== undefined, [state])
  const rows = payload === undefined ? [] : panelTaskRows(payload, titles, openable, sessionTarget.currentMemberSessionId)
  const tally = panelTally(rows)
  const load = panelLoadState(payload, failure)
  const currentTaskText = tally.current === undefined
    ? '当前会话不属于任何任务'
    : sessionTarget.openedAsSubagent
      ? `当前会话是「${tally.current.name}」的子代理`
      : `当前会话在「${tally.current.name}」`
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
        currentTaskText,
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
