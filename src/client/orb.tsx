/**
 * The floating handoff indicator: a resident circle over the composer showing
 * context occupancy, turning warning-colored as the context approaches the
 * configured smart-zone threshold.
 *
 * Hovering the orb reveals a "交接" action; clicking it opens a confirm card
 * where the user writes the focus and confirms. Confirming runs the one-click
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
import { runOrbHandoff } from './orb-actions.ts'
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
  const [failed, setFailed] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [phase, setPhase] = useState<CardPhase>({ kind: 'closed' })
  const [focus, setFocus] = useState('')
  const rootRef = useRef<HTMLButtonElement | null>(null)

  // The draft-fill fallback: used only when the one-click flow cannot run.
  const fillDraft = useCallback((): void => {
    const written = appendToDraft(ctx, sessionId, HANDOFF_DRAFT)
    setFailed(!written)
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
    const outcome: OrbHandoffOutcome = await runOrbHandoff(
      { sessions, workspaces },
      sessionId,
      trimmed === '' ? undefined : trimmed,
    )
    if (outcome.ok) {
      setPhase({ kind: 'closed' })
      setFocus('')
      setHovering(false)
    } else {
      setPhase({ kind: 'error', message: outcome.error })
    }
  }, [ctx, sessionId, focus, fillDraft])

  useEffect(() => {
    if (!failed) return
    const timer = setTimeout(() => { setFailed(false) }, 4000)
    return () => { clearTimeout(timer) }
  }, [failed])

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

  const cardOpen = phase.kind !== 'closed'
  const running = phase.kind === 'running'

  const orb = createElement(
    'button',
    {
      type: 'button',
      ref: rootRef,
      className: `${css.root} ${levelClassName(level)}`,
      title: failed ? INSERT_FAILED : detail,
      'aria-label': failed ? INSERT_FAILED : `${tokens} tokens，${occupancy.percent}% 已用。接近 smart zone；到下个相位边界做五选一，交接只是其一`,
      'data-a2d2-orb': level,
      'data-a2d2-level': String(filled),
      onClick: () => { setPhase(current => (current.kind === 'closed' ? { kind: 'open' } : { kind: 'closed' })) },
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

  // The hover action is shown while the pointer is over the anchor or the card
  // is open; opening the card keeps it visible while the user types.
  const showAction = (hovering || cardOpen) && !cardOpen
  const action = showAction
    ? createElement('button', {
      type: 'button',
      className: css.action,
      onClick: () => { setPhase({ kind: 'open' }) },
    }, '交接 →')
    : null

  const card = cardOpen ? createElement('div', { className: css.card },
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
        onClick: () => { setPhase({ kind: 'closed' }); setFocus('') },
      }, '取消'),
      createElement('button', {
        type: 'button',
        className: `${css.cardButton} ${css.confirm}`,
        disabled: running,
        onClick: () => { void confirm() },
      }, '创建并交接'),
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
    card,
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

/** The level's CSS-module class, resolved without a lookup table that could drift. */
function levelClassName(level: OrbLevel): string {
  switch (level) {
    case 'normal': return css.normal
    case 'warn': return css.warn
    case 'critical': return css.critical
  }
}
