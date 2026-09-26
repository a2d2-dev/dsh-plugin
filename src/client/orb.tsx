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
import {
  ORB_CARD_WIDTH_PX,
  ORB_GAP_PX,
  ORB_POSITION_KEY,
  ORB_SIZE_PX,
  ORB_STACK_GAP_PX,
  anchorRightOffset,
  clampOrbPoint,
  isClickGesture,
  isDragGesture,
  orbPlacement,
  parseOrbPoint,
  serializeOrbPoint,
} from './orb-position.ts'
import type { OrbPlacement, OrbPoint, OrbViewport } from './orb-position.ts'
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
 * The layout region the indicator is laid out in.
 *
 * The orb is fixed to the viewport, but it is still mounted inside the shell's
 * conversation column, so its ancestors' boxes say where that column ends. The
 * topmost ancestor below `<body>` is the region: a shell that pushes its content
 * aside for a right-hand panel leaves this element as wide as the space the
 * panel did not take, which is what makes the measurement independent of whose
 * panel is open and of that panel's class names.
 * @param from - the orb element, or `null` before it is mounted.
 * @returns the region element, or `null` when the orb is detached.
 */
function layoutRegion(from: Element | null): Element | null {
  let node = from
  while (node !== null && node.parentElement !== null && node.parentElement !== document.body) {
    node = node.parentElement
  }
  return node
}

/**
 * The layout viewport a `position: fixed` element is measured against.
 *
 * The document element's client box, not `innerWidth`/`innerHeight`: a classic
 * scrollbar lies outside the containing block, and counting it would place the
 * circle a scrollbar's width short of where it was put.
 * @returns the viewport size in px.
 */
function currentViewport(): OrbViewport {
  return {
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }
}

/**
 * Where the circle sits and where its card opens, re-measured as the shell moves.
 *
 * The shell is measured, not assumed: {@link anchorRightOffset} combines the
 * layout region's leftover space with the shell's own details column, so a shell
 * that pushes its content and a shell that keeps a measured column both move the
 * circle. A `ResizeObserver` follows a drag-resize and a panel opening or
 * closing, and a slow interval covers a region that is remounted (switching
 * sidebar tabs replaces it) and a viewport resized behind the observer, without
 * re-running this effect.
 * @param rootRef - the orb's own element, the anchor for the region walk.
 * @param moved - the point a drag left the circle at, or `undefined` for the corner.
 * @returns the placement to render.
 */
function useOrbPlacement(rootRef: { readonly current: Element | null }, moved: OrbPoint | undefined): OrbPlacement {
  const [room, setRoom] = useState<{ readonly viewport: OrbViewport; readonly rightOffset: number }>(
    () => ({ viewport: currentViewport(), rightOffset: ORB_GAP_PX }),
  )
  useEffect(() => {
    const details = (): Element | null => document.querySelector("[class*='detailsCol']")
    const measure = (): void => {
      const region = layoutRegion(rootRef.current)
      const rect = region === null ? undefined : region.getBoundingClientRect()
      const viewport = currentViewport()
      const column = details()
      const next = {
        viewport,
        rightOffset: anchorRightOffset({
          viewportWidth: viewport.width,
          regionRight: rect?.right,
          detailsWidth: column === null ? 0 : column.getBoundingClientRect().width,
        }),
      }
      setRoom(current => (
        current.rightOffset === next.rightOffset
        && current.viewport.width === next.viewport.width
        && current.viewport.height === next.viewport.height
          ? current
          : next
      ))
    }
    measure()
    const timer = setInterval(measure, 500)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    for (const element of [layoutRegion(rootRef.current), details()]) {
      if (observer !== null && element !== null) observer.observe(element)
    }
    return () => { observer?.disconnect(); clearInterval(timer) }
  }, [rootRef])
  return useMemo(
    () => orbPlacement({ viewport: room.viewport, rightOffset: room.rightOffset, moved }),
    [room, moved],
  )
}

/** A press that may still turn into a drag. */
interface OrbDrag {
  /** The pointer this gesture belongs to; a second pointer is ignored. */
  readonly pointerId: number
  /** Where the press started, in viewport coordinates. */
  readonly from: OrbPoint
  /** Where the circle was when the press started, in viewport coordinates. */
  readonly origin: OrbPoint
  /**
   * The point to restore if the gesture turns out to be a click.
   *
   * Captured at the press, not read at the release: the circle follows the
   * pointer in between, so by then the live point is the drifted one this is
   * meant to undo.
   */
  readonly before: OrbPoint | undefined
  /** Whether the gesture has passed the drag threshold. */
  moved: boolean
}

/** The remembered point, or `undefined` when this browser never stored one. */
function storedOrbPoint(): OrbPoint | undefined {
  try {
    return parseOrbPoint(window.localStorage.getItem(ORB_POSITION_KEY))
  } catch {
    // A browser that refuses storage (private mode, blocked cookies) leaves the
    // circle at its corner; the drag still works for this page.
    return undefined
  }
}

/** Remember a dragged point, or forget it when the circle returns to its corner. */
function rememberOrbPoint(point: OrbPoint | undefined): void {
  try {
    if (point === undefined) window.localStorage.removeItem(ORB_POSITION_KEY)
    else window.localStorage.setItem(ORB_POSITION_KEY, serializeOrbPoint(point))
  } catch {
    // Same as reading: the position is a convenience, never a precondition.
  }
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
  const rootRef = useRef<HTMLButtonElement | null>(null)
  // The point a drag left the circle at, restored from the last visit. `undefined`
  // means the user has never moved it, which is what keeps the panel-aware corner
  // the default rather than a position someone happened to drop it in once.
  const [moved, setMoved] = useState<OrbPoint | undefined>(storedOrbPoint)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<OrbDrag | null>(null)
  const draggedRef = useRef(false)
  const placement = useOrbPlacement(rootRef, moved)
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

  /**
   * Take the circle under the pointer.
   *
   * The gesture is captured so a fast drag that outruns the pointer keeps
   * following it, and the press is not yet a drag: `draggedRef` stays false
   * until the threshold is passed, so a plain click still opens the card. The
   * circle's own point is the origin rather than its measured box, which the
   * hover lift scales away from it.
   */
  const startOrbDrag = useCallback((event: { pointerId: number; button: number; clientX: number; clientY: number; currentTarget: HTMLButtonElement }): void => {
    if (event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      from: { x: event.clientX, y: event.clientY },
      origin: placement.point,
      before: moved,
      moved: false,
    }
    draggedRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [placement.point, moved])

  /** Move the circle with the pointer, once the gesture has earned it. */
  const moveOrbDrag = useCallback((event: { pointerId: number; clientX: number; clientY: number }): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const to = { x: event.clientX, y: event.clientY }
    if (!drag.moved) {
      if (!isDragGesture(drag.from, to)) return
      drag.moved = true
      setDragging(true)
    }
    setMoved(clampOrbPoint({
      x: drag.origin.x + (to.x - drag.from.x),
      y: drag.origin.y + (to.y - drag.from.y),
    }, currentViewport()))
  }, [])

  /**
   * Drop the circle where the pointer left it, and remember the point.
   *
   * A release that barely moved from the press is a click on the circle, not a
   * move: the drift it left behind is undone and the click is left to open the
   * card, which is what a trackpad click expects.
   */
  const endOrbDrag = useCallback((event: { pointerId: number; clientX: number; clientY: number; currentTarget: HTMLButtonElement }): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag === null) return
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId)
    }
    setDragging(false)
    if (!drag.moved) return
    const released = { x: event.clientX, y: event.clientY }
    if (isClickGesture(drag.from, released)) {
      setMoved(drag.before)
      return
    }
    const point = clampOrbPoint({
      x: drag.origin.x + (released.x - drag.from.x),
      y: drag.origin.y + (released.y - drag.from.y),
    }, currentViewport())
    draggedRef.current = true
    setMoved(point)
    rememberOrbPoint(point)
  }, [])

  /** Put the circle back in the corner the shell manages, and forget the drag. */
  const resetOrb = useCallback((): void => {
    setMoved(undefined)
    rememberOrbPoint(undefined)
  }, [])

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
      title: `${failure ?? detail}\n\n拖动可移动位置`,
      'aria-label': failure ?? `${tokens} tokens，${occupancy.percent}% 已用。接近 smart zone；到下个相位边界做五选一，交接只是其一`,
      'data-a2d2-orb': level,
      'data-a2d2-level': String(filled),
      onPointerDown: startOrbDrag,
      onPointerMove: moveOrbDrag,
      onPointerUp: endOrbDrag,
      onPointerCancel: endOrbDrag,
      onClick: () => {
        // A drag ends with a click on the element the pointer went down on, which
        // would otherwise open the card every time the circle is moved.
        if (draggedRef.current) {
          draggedRef.current = false
          return
        }
        consultNext()
      },
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

  // The boundary action yields the surface to an open card, and to a drag: the
  // pointer is on the circle to move it, not to ask what comes next.
  const showAction = hovering && !cardOpen && !dragging
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
    createElement('div', { className: css.cardActions },
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
    // Everything from the chips down is pinned to the card's bottom: the card is
    // capped by the room beside the circle, and a small window leaves the status
    // and the highway map more than the whole cap — so the reference scrolls and
    // the moves stay where the hand already is.
    createElement('div', { className: css.cardActions },
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
        moved === undefined
          ? null
          : createElement('button', {
            type: 'button',
            className: `${css.cardButton} ${css.cancel} ${css.cardReset}`,
            title: '把指示球放回原来的角落',
            onClick: resetOrb,
          }, '复位'),
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
    ),
  ) : null

  return createElement(
    'div',
    {
      className: dragging ? `${css.anchor} ${css.dragging}` : css.anchor,
      style: {
        left: `${String(placement.point.x)}px`,
        top: `${String(placement.point.y)}px`,
        // The sheet geometry the stylesheet draws, published from the model the
        // clamps are computed with, so the two cannot drift apart.
        '--a2d2-orb-size': `${String(ORB_SIZE_PX)}px`,
        '--a2d2-card-width': `${String(ORB_CARD_WIDTH_PX)}px`,
        '--a2d2-stack-gap': `${String(ORB_STACK_GAP_PX)}px`,
      } as never,
      onMouseEnter: () => { setHovering(true) },
      onMouseLeave: () => { setHovering(false) },
    },
    createElement(
      'div',
      {
        className: css.stack,
        style: {
          left: `${String(placement.card.left)}px`,
          ...(placement.card.above
            ? { bottom: `calc(100% + ${String(ORB_STACK_GAP_PX)}px)` }
            : { top: `calc(100% + ${String(ORB_STACK_GAP_PX)}px)` }),
          '--a2d2-card-max': `${String(placement.card.maxHeight)}px`,
        } as never,
      },
      handoffCard,
      consultCard,
      action,
    ),
    orb,
  )
}

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
