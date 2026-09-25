/**
 * The floating handoff indicator: a resident circle over the composer showing
 * context occupancy, turning warning-colored as the context approaches the
 * configured smart-zone threshold.
 *
 * Hovering the orb reveals one action: "下一步" (a one-off consultation
 * proposing where to go). Handoff remains available inside that boundary card
 * as one of the "other moves". The handoff card collects focus and confirms.
 * Confirming runs the one-click
 * handoff — this session's own agent writes the summary, the browser waits for
 * that turn to finish, creates the successor session, focuses it, and has it take
 * the handoff — so the whole "fill the command, then press send" sequence
 * collapses into one confirm. A stray click on the circle no longer mutates the
 * draft; the older draft-fill behavior survives only as the fallback when the
 * confirm flow cannot run.
 *
 * Occupancy is read from the `contextPressure` projection through the sessions
 * service — not the renderer's `useProjection` prop, which exists only inside
 * session-scoped slots — and the thresholds come from the host's `a2d2Indicator`
 * projection, falling back to the same package default the host applies when
 * that key is absent.
 *
 * @module @deepseek-ai/dsh-a2d2/client/orb
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import css from './orb.module.css'
import { HANDOFF_DRAFT, appendToDraft, focusComposer } from './composer.ts'
import {
  OTHER_MOVE_OPTIONS,
  candidateModelEffect,
  consultAttributionLine,
  modelCatalogRoutes,
  requestConsult,
  selectConsultCandidate,
  selectOtherMove,
} from './consult-actions.ts'
import type {
  ClientModelDirectoryService,
  ClientModelDirectorySnapshot,
  ClientModelDirectoryStoreSnapshot,
  ConsultNewSessionModelTarget,
  ConsultCandidate,
  ConsultPhase,
} from './consult-actions.ts'
import { HighwayMap } from './highway-map.tsx'
import { highwayView } from './highway-view.ts'
import { runOrbHandoff } from './orb-actions.ts'
import { sessionStatus } from './status-model.ts'
import type { SessionStatus, StatusKind } from './status-model.ts'
import type { OrbHandoffOutcome } from './orb-actions.ts'
import type {
  A2d2ClientContext,
  ClientSessionsService,
  ClientWorkspacesService,
  HostIndicatorProjection,
} from './context.ts'
import {
  DEFAULT_ORB_THRESHOLDS,
  costOf,
  formatCost,
  formatTokenCount,
  orbLevel,
  orbOccupancy,
  waterLevel,
} from './orb-model.ts'
import type { OrbLevel, OrbOccupancy } from './orb-model.ts'


/** What the user is told when the draft could not be written. */
const INSERT_FAILED = '无法写入输入框（会话未就绪）'

/**
 * One session's occupancy, following both projections that feed it.
 *
 * A standalone bundle has no renderer-provided projection hook, so this reads
 * the two stores directly and re-renders through `useSyncExternalStore`. Either
 * projection may be absent, in which case the store's snapshot is `undefined`
 * and the indicator falls back to the package default thresholds.
 * @param ctx - the client context carrying the sessions service.
 * @param sessionId - the session to measure, or `undefined` when none is open.
 * @returns the current occupancy and thresholds.
 */
function useOccupancy(
  ctx: A2d2ClientContext,
  sessionId: string,
): { occupancy: OrbOccupancy | null; host: HostIndicatorProjection | undefined } {
  const faces = useMemo(() => {
    const sessions = ctx.get('sessions') as ClientSessionsService | undefined
    const session = sessions?.binding(sessionId)?.session
    return {
      pressure: session?.projections.faceOf('contextPressure'),
      indicator: session?.projections.faceOf('a2d2Indicator'),
    }
  }, [ctx, sessionId])

  // One store per projection; a stable no-op source stands in while a projection
  // is unknown, keeping the hook count constant across session switches.
  const empty = useMemo(() => ({ getSnapshot: (): undefined => undefined, subscribe: (): (() => void) => () => {} }), [])
  const pressure = faces.pressure ?? empty
  const indicator = faces.indicator ?? empty
  const getSnapshot = useCallback(
    () => JSON.stringify([pressure.getSnapshot(), indicator.getSnapshot()]),
    [pressure, indicator],
  )
  const subscribe = useCallback(
    (listener: () => void) => {
      const disposers = [pressure.subscribe(listener), indicator.subscribe(listener)]
      return () => { for (const dispose of disposers) dispose() }
    },
    [pressure, indicator],
  )
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return {
    occupancy: orbOccupancy(pressure.getSnapshot() as never),
    host: indicator.getSnapshot() as HostIndicatorProjection | undefined,
  }
}

/**
 * How often an open 现状 card re-reads the clock, in ms.
 *
 * The snapshot subscription already re-renders on every conversation change;
 * this tick only keeps elapsed times ("已 3 分钟") and the stall tier honest
 * while nothing is happening, which is exactly the case the card is for.
 */
const STATUS_TICK_MS = 15_000

/**
 * One session's live status while the 现状 card is open.
 *
 * Subscribes to the conversation snapshot only while `active`, so a closed card
 * costs nothing.
 * @param ctx - the client context carrying the sessions service.
 * @param sessionId - the session the orb sits on.
 * @param active - whether the card is open.
 * @returns the resolved status, or `undefined` while closed or unavailable.
 */
function useSessionStatus(ctx: A2d2ClientContext, sessionId: string, active: boolean): SessionStatus | undefined {
  const [status, setStatus] = useState<SessionStatus | undefined>(undefined)
  useEffect(() => {
    if (!active) { setStatus(undefined); return }
    const sessions = ctx.get('sessions') as ClientSessionsService | undefined
    const session = sessions?.binding(sessionId)?.session
    if (session === undefined) {
      setStatus({ kind: 'unavailable', headline: '读不到会话状态', facts: [] })
      return
    }
    const read = (): void => { setStatus(sessionStatus(session.getSnapshot(), Date.now())) }
    read()
    const dispose = session.subscribe(read)
    const timer = setInterval(read, STATUS_TICK_MS)
    return () => { dispose(); clearInterval(timer) }
  }, [ctx, sessionId, active])
  return status
}

function normalizeModelDirectory(
  snapshot: ClientModelDirectoryStoreSnapshot,
): ClientModelDirectorySnapshot | undefined {
  if (snapshot.current === null) return undefined
  return {
    current: snapshot.current,
    ...(snapshot.groups === undefined ? {} : { groups: snapshot.groups }),
    ...(snapshot.catalog === undefined ? {} : { catalog: snapshot.catalog }),
  }
}

function useModelDirectory(
  ctx: A2d2ClientContext,
  sessionId: string,
  active: boolean,
): ClientModelDirectorySnapshot | undefined {
  const [directory, setDirectory] = useState<ClientModelDirectorySnapshot | undefined>(undefined)
  useEffect(() => {
    if (!active) {
      setDirectory(undefined)
      return
    }
    const modelDirectories = ctx.get('modelDirectories') as ClientModelDirectoryService | undefined
    if (modelDirectories === undefined) {
      setDirectory(undefined)
      return
    }
    let disposed = false
    let disposeStore: (() => void) | undefined
    try {
      const face = modelDirectories.directoryFor(sessionId)
      const publish = (): void => {
        const snapshot = face.store?.getSnapshot()
        if (snapshot !== undefined) setDirectory(normalizeModelDirectory(snapshot))
      }
      publish()
      disposeStore = face.store?.subscribe(publish)
      void face.load().then(
        next => {
          if (!disposed) setDirectory(next)
        },
        () => {
          if (!disposed) setDirectory(undefined)
        },
      )
    } catch {
      setDirectory(undefined)
    }
    return () => {
      disposed = true
      disposeStore?.()
    }
  }, [ctx, sessionId, active])
  return directory
}

/**
 * How much room the shell's details panel takes at the right of the viewport.
 *
 * The indicator is fixed to the viewport so it stays out of the composer's
 * layout, which means the layout cannot move it; measuring the panel and
 * shifting the anchor left by its width is what makes the indicator get out of
 * the way when the panel opens instead of being covered by it. A
 * `ResizeObserver` follows a drag-resize, and a slow interval covers the panel
 * mounting or collapsing after this one.
 *
 * The column is found by a class fragment rather than an exact name because its
 * generated prefix is not part of any contract; a class the build renames simply
 * leaves the inset at zero, which is the panel-closed case. Only the right panel
 * needs shifting: the left sidebar sits outside the composer's column, so the
 * circle never reaches it.
 * @returns the details panel's width in px.
 */
function useDetailsInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const panel = (): Element | null => document.querySelector("[class*='detailsCol']")
    const measure = (): void => {
      const element = panel()
      const width = element === null ? 0 : Math.round(element.getBoundingClientRect().width)
      setInset(current => (current === width ? current : width))
    }
    measure()
    const timer = setInterval(measure, 500)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    const element = panel()
    if (observer !== null && element !== null) observer.observe(element)
    return () => { observer?.disconnect(); clearInterval(timer) }
  }, [])
  return inset
}

/** The confirm card's own state: what the user has typed and where the flow is. */
type CardPhase =
  | { readonly kind: 'closed' }
  | { readonly kind: 'open' }
  | { readonly kind: 'running' }
  | { readonly kind: 'error'; readonly message: string }

/**
 * The floating indicator.
 *
 * `sessionId` is required: this component renders inside a session-scoped slot,
 * which is what supplies it, so there is no session-less case to guard.
 */
export function HandoffOrb(props: { ctx: A2d2ClientContext; sessionId: string }): ReturnType<typeof createElement> | null {
  const { ctx, sessionId } = props
  const { occupancy, host } = useOccupancy(ctx, sessionId)
  const detailsInset = useDetailsInset()
  const thresholds = host?.thresholds ?? DEFAULT_ORB_THRESHOLDS
  const [failure, setFailure] = useState<string | null>(null)
  const [hovering, setHovering] = useState(false)
  const [phase, setPhase] = useState<CardPhase>({ kind: 'closed' })
  const [consult, setConsult] = useState<ConsultPhase>({ kind: 'idle' })
  // The next-step card leads with the session's status, which is instant, so
  // the card is useful while the consultation is still being generated.
  const status = useSessionStatus(ctx, sessionId, consult.kind !== 'idle')
  const modelDirectory = useModelDirectory(ctx, sessionId, consult.kind === 'ready')
  const [focus, setFocus] = useState('')
  const [handoffModelTarget, setHandoffModelTarget] = useState<ConsultNewSessionModelTarget | undefined>(undefined)
  const rootRef = useRef<HTMLButtonElement | null>(null)
  const consultRequestRef = useRef(0)

  // The draft-fill fallback: used only when the one-click flow cannot run.
  const fillDraft = useCallback((): void => {
    const written = appendToDraft(ctx, sessionId, HANDOFF_DRAFT)
    setFailure(written ? null : INSERT_FAILED)
    if (written) focusComposer(rootRef.current)
  }, [ctx, sessionId])

  const confirm = useCallback(async (): Promise<void> => {
    const sessions = ctx.get('sessions') as ClientSessionsService | undefined
    const workspaces = ctx.get('workspaces') as ClientWorkspacesService | undefined
    if (sessions === undefined || workspaces === undefined) {
      // No session/workspace service: fall back to filling the draft, which is
      // the older behavior and still lets the user hand off manually.
      setPhase({ kind: 'closed' })
      fillDraft()
      return
    }
    setPhase({ kind: 'running' })
    const trimmed = focus.trim()
    const modelDirectories = ctx.get('modelDirectories') as ClientModelDirectoryService | undefined
    const outcome: OrbHandoffOutcome = await runOrbHandoff(
      {
        sessions,
        workspaces,
        ...(handoffModelTarget === undefined ? {} : { successorModel: handoffModelTarget }),
        ...(modelDirectories === undefined ? {} : { modelDirectories }),
        notify: message => { setFailure(message) },
      },
      sessionId,
      trimmed === '' ? undefined : trimmed,
    )
    if (outcome.ok) {
      setPhase({ kind: 'closed' })
      setFocus('')
      setHandoffModelTarget(undefined)
      setHovering(false)
    } else {
      setPhase({ kind: 'error', message: outcome.error })
    }
  }, [ctx, sessionId, focus, fillDraft, handoffModelTarget])

  const closeConsult = useCallback((): void => {
    consultRequestRef.current += 1
    setConsult({ kind: 'idle' })
  }, [])

  const openHandoff = useCallback((nextFocus = '', target?: ConsultNewSessionModelTarget): void => {
    closeConsult()
    setFocus(nextFocus)
    setHandoffModelTarget(target)
    setPhase({ kind: 'open' })
  }, [closeConsult])

  const consultNext = useCallback((): void => {
    const requestId = consultRequestRef.current + 1
    consultRequestRef.current = requestId
    setPhase({ kind: 'closed' })
    setFocus('')
    setHandoffModelTarget(undefined)
    void requestConsult({
      fetch: (input, init) => fetch(input, init),
      setPhase: next => {
        if (consultRequestRef.current === requestId) setConsult(next)
      },
    }, sessionId)
  }, [sessionId])

  const selectCandidate = useCallback((candidate: ConsultCandidate): void => {
    const modelDirectories = ctx.get('modelDirectories') as ClientModelDirectoryService | undefined
    void selectConsultCandidate({
      appendToDraft: (input, targetSessionId) => appendToDraft(ctx, targetSessionId ?? sessionId, input),
      focusComposer: () => { focusComposer(rootRef.current) },
      closeConsult,
      openHandoff,
      sessions: ctx.get('sessions') as ClientSessionsService | undefined,
      workspaces: ctx.get('workspaces') as ClientWorkspacesService | undefined,
      ...(modelDirectories === undefined ? {} : { modelDirectories }),
      notify: message => { setFailure(message) },
    }, candidate, {
      sessionId,
      phase: consult,
    }).then((selected) => {
      if (!selected) setFailure(INSERT_FAILED)
    })
  }, [ctx, sessionId, closeConsult, openHandoff, consult])

  const selectOther = useCallback((move: typeof OTHER_MOVE_OPTIONS[number]['move']): void => {
    void selectOtherMove({
      appendToDraft: (input, targetSessionId) => appendToDraft(ctx, targetSessionId ?? sessionId, input),
      focusComposer: () => { focusComposer(rootRef.current) },
      closeConsult,
      openHandoff,
      sessions: ctx.get('sessions') as ClientSessionsService | undefined,
      workspaces: ctx.get('workspaces') as ClientWorkspacesService | undefined,
      modelDirectories: ctx.get('modelDirectories') as ClientModelDirectoryService | undefined,
      notify: message => { setFailure(message) },
    }, move, { sessionId, phase: consult }).then((ok) => {
      if (!ok) setFailure(INSERT_FAILED)
    })
  }, [ctx, sessionId, closeConsult, openHandoff])

  useEffect(() => {
    if (failure === null) return
    const timer = setTimeout(() => { setFailure(null) }, 4000)
    return () => { clearTimeout(timer) }
  }, [failure])

  if (occupancy === null) return null
  const level = orbLevel(occupancy.usedTokens, thresholds)
  const filled = waterLevel(occupancy.percent)
  const cost = costOf(occupancy.usedTokens, host?.price)
  const tokens = formatTokenCount(occupancy.usedTokens)
  const capacity = host?.contextWindow === undefined ? undefined : formatTokenCount(host.contextWindow)
  const detail = [
    `${formatTokenCount(occupancy.usedTokens)} tokens`,
    ...(capacity === undefined ? [] : [`容量 ${capacity}`]),
    `${occupancy.percent}% 已用`,
    ...(cost === undefined ? [] : [`按配置费率约 ${host?.currency ?? ''}${formatCost(cost)}`]),
    '',
    '接近 smart zone；到下个相位边界做五选一（交接只是其一）',
  ].join('\n')

  const handoffOpen = phase.kind !== 'closed'
  const consultOpen = consult.kind !== 'idle'
  const cardOpen = handoffOpen || consultOpen
  const running = phase.kind === 'running'

  const orb = createElement(
    'button',
    {
      type: 'button',
      ref: rootRef,
      className: `${css.root} ${levelClassName(level)}`,
      title: failure ?? detail,
      'aria-label': failure ?? `${tokens} tokens，${occupancy.percent}% 已用。接近 smart zone；到下个相位边界做五选一，交接只是其一`,
      'data-a2d2-orb': level,
      'data-a2d2-level': String(filled),
      onClick: consultNext,
    },
    createElement('span', { className: css.water, style: { '--a2d2-level': `${filled}%` } as never, 'aria-hidden': true }),
    createElement('span', {
      className: css.readout,
      style: { transform: filled >= READOUT_INVERT_AT ? 'translateY(-18px)' : 'none' },
    },
      createElement('span', { className: css.tokens }, tokens),
      cost === undefined
        ? null
        : createElement('span', { className: css.cost }, `${host?.currency ?? ''}${formatCost(cost)}`),
    ),
  )

  // The boundary action yields the surface to an open card.
  const showAction = hovering && !cardOpen
  const actionButton = (label: string, hint: string, onClick: () => void): ReturnType<typeof createElement> =>
    createElement('button', { type: 'button', className: css.action, title: hint, 'aria-label': `${label}：${hint}`, onClick }, label)
  const action = showAction
    ? createElement('div', { className: css.actions },
      actionButton('下一步', '它现在在干嘛、做到哪了、接下来去哪？', consultNext),
    )
    : null

  const handoffCard = handoffOpen ? createElement('div', { className: css.card },
    createElement('div', { className: css.cardTitle }, '交接到新会话'),
    createElement('div', { className: css.cardHint }, '为后继会话写一句「下一步重点」（可留空），确认后自动创建新会话、带入当前会话摘要并切换过去。'),
    createElement('textarea', {
      className: css.cardInput,
      value: focus,
      placeholder: '下一步重点（可选）',
      disabled: running,
      autoFocus: true,
      onChange: (event: { target: { value: string } }) => { setFocus(event.target.value) },
    }),
    phase.kind === 'error' ? createElement('div', { className: css.cardError }, phase.message) : null,
    running ? createElement('div', { className: css.cardBusy }, '本会话正在撰写交接摘要，随后自动创建并切换后继会话…') : null,
    createElement('div', { className: css.cardRow },
      createElement('button', {
        type: 'button',
        className: `${css.cardButton} ${css.cancel}`,
        disabled: running,
        onClick: () => { setPhase({ kind: 'closed' }); setFocus(''); setHandoffModelTarget(undefined) },
      }, '取消'),
      createElement('button', {
        type: 'button',
        className: `${css.cardButton} ${css.confirm}`,
        disabled: running,
        onClick: () => { void confirm() },
      }, '创建并交接'),
    ),
  ) : null

  const occupancyLine = `上下文 ${tokens}${capacity === undefined ? '' : ` / ${capacity}`}（${String(occupancy.percent)}%）`
    + (cost === undefined ? '' : ` · 约 ${host?.currency ?? ''}${formatCost(cost)}`)
  const attribution = consultAttributionLine(consult)
  const modelCatalog = modelDirectory === undefined ? undefined : modelCatalogRoutes(modelDirectory)
  const highway = consult.kind === 'ready' && consult.location !== undefined
    ? highwayView(consult, modelCatalog)
    : undefined
  const statusBlock = createElement('div', { className: css.statusBlock, role: 'status' },
    createElement('div', { className: `${css.statusHeadline} ${statusClassName(status?.kind)}` },
      createElement('span', { className: css.statusDot, 'aria-hidden': true }),
      status?.headline ?? '读取中…',
    ),
    createElement('ul', { className: css.statusFacts },
      ...(status?.facts ?? []).map((fact, index) => createElement('li', { key: String(index) }, fact)),
      createElement('li', { key: 'occupancy' }, occupancyLine),
    ),
  )

  const consultCard = consultOpen ? createElement('div', { className: css.card },
    createElement('div', { className: css.cardTitle }, '下一步'),
    statusBlock,
    consult.kind === 'loading'
      ? createElement('div', { className: css.cardBusy }, '正在咨询下一步…')
      : null,
    consult.kind === 'error'
      ? createElement('div', { className: css.cardError }, consult.message)
      : null,
    consult.kind === 'ready' && consult.degraded
      ? createElement('div', { className: css.degraded }, '未读到 ask-matt skill，以下为降级候选。')
      : null,
    consult.kind === 'ready' && highway === undefined && consult.position !== undefined
      ? createElement('div', { className: css.position }, `当前位置：${consult.position}`)
      : null,
    highway === undefined ? null : createElement(HighwayMap, { view: highway, mode: 'readonly' }),
    highway?.nextLine === undefined ? null : createElement('div', { className: css.nextLine }, highway.nextLine),
    consult.kind === 'ready'
      ? createElement('div', { className: css.chips },
        ...consult.candidates.map((candidate, index) => {
          const effect = candidateModelEffect(candidate, consult, modelDirectory)
          return createElement('button', {
            type: 'button',
            className: css.chip,
            key: `${candidate.move}-${String(index)}`,
            title: effect === undefined ? candidate.input : `${candidate.input}\n${effect}`,
            onClick: () => { selectCandidate(candidate) },
          },
            createElement('span', { className: css.chipMove }, chipMoveLabel(candidate.move)),
            createElement('span', { className: css.chipLabel }, candidate.label),
            effect === undefined ? null : createElement('span', { className: css.chipEffect }, effect),
          )
        }),
      )
      : null,
    createElement('details', { className: css.otherMoves },
      createElement('summary', { className: css.otherMovesSummary }, '其他走法'),
      createElement('div', { className: css.otherMoveGrid },
        ...OTHER_MOVE_OPTIONS.map(option => createElement('button', {
          type: 'button',
          className: css.otherMoveButton,
          key: option.move,
          title: option.hint,
          onClick: () => { selectOther(option.move) },
        },
          createElement('span', { className: css.otherMoveLabel }, option.label),
          createElement('span', { className: css.otherMoveHint }, option.hint),
        )),
      ),
    ),
    attribution === undefined ? null : createElement('div', { className: css.attribution }, attribution),
    createElement('div', { className: css.cardRow },
      consult.kind === 'error'
        ? createElement('button', {
          type: 'button',
          className: `${css.cardButton} ${css.confirm}`,
          onClick: consultNext,
        }, '重试')
        : null,
      createElement('button', {
        type: 'button',
        className: `${css.cardButton} ${css.cancel}`,
        onClick: closeConsult,
      }, '关闭'),
    ),
  ) : null

  return createElement(
    'div',
    {
      className: css.anchor,
      style: { right: `${PANEL_GAP_PX + detailsInset}px` },
      onMouseEnter: () => { setHovering(true) },
      onMouseLeave: () => { setHovering(false) },
    },
    handoffCard,
    consultCard,
    action,
    orb,
  )
}

/** Distance between the indicator and a shell panel, in px. */
const PANEL_GAP_PX = 12

/**
 * Fill share above which the readout moves up, in whole percent.
 *
 * The readout is white text over the circle; once the water covers most of it the
 * text would sit on the wave band, so it steps above the surface instead. The
 * number is a layout choice of this component, not a deployment setting.
 */
const READOUT_INVERT_AT = 55

/** The status tier's CSS-module class; the card's own colors, never the orb's smart-zone tiers. */
function statusClassName(kind: StatusKind | undefined): string {
  switch (kind) {
    case 'waiting': return css.statusWaiting
    case 'stalled':
    case 'error':
    case 'removed': return css.statusAlert
    case 'running': return css.statusRunning
    default: return css.statusQuiet
  }
}

function chipMoveLabel(move: ConsultCandidate['move']): string {
  switch (move) {
    case 'continue': return '继续'
    case 'clear': return '新会话'
    case 'handoff': return '交接'
    case 'subagent': return '子代理'
    case 'compact': return '压缩'
  }
}

/** The level's CSS-module class, resolved without a lookup table that could drift. */
function levelClassName(level: OrbLevel): string {
  switch (level) {
    case 'normal': return css.normal
    case 'warn': return css.warn
    case 'critical': return css.critical
  }
}
