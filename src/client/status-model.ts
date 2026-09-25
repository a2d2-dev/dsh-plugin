/**
 * The 现状 (status) card's model: what a session is doing right now, derived
 * from facts the client already holds.
 *
 * Nothing here calls a model. Every field is read from the conversation
 * snapshot the host publishes over the session transport — whether a turn is
 * running, which tool call is in flight, what interaction is waiting on the
 * user, the newest agent error — so the card answers instantly and never
 * guesses. "Where the work stands" is the next-step consult's job, not this
 * module's.
 *
 * @module @deepseek-ai/dsh-a2d2/client/status-model
 */

/**
 * The conversation-snapshot fields this model reads.
 *
 * Declared structurally rather than imported: the bundle may not value-import
 * the runtime, and every field is optional so an older runtime that lacks one
 * degrades to a coarser status instead of a crash.
 */
export interface StatusSource {
  readonly running: boolean
  readonly removed?: boolean
  readonly openState?: string
  readonly blank?: boolean
  readonly pending?: readonly {
    readonly kind: string
    readonly payload?: { readonly toolName?: unknown; readonly reason?: unknown } | null
  }[]
  readonly runningCalls?: readonly { readonly name: string; readonly time: number }[]
  readonly partial?: unknown
  readonly queue?: readonly { readonly placement: string }[]
  readonly turnTimings?: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>
  readonly lastAgentError?: string | null
  readonly promptError?: { readonly op: string } | null
}

/** The status tiers, in the priority order the card resolves them. */
export type StatusKind =
  | 'removed'
  | 'unavailable'
  | 'waiting'
  | 'stalled'
  | 'running'
  | 'error'
  | 'blank'
  | 'idle'

/** What the card renders: one headline and supporting fact lines. */
export interface SessionStatus {
  readonly kind: StatusKind
  readonly headline: string
  readonly facts: readonly string[]
}

/**
 * Silence, in ms, after which a running session is flagged as possibly stuck.
 *
 * Measured from the newest timestamped activity the client holds (a tool call's
 * start or the turn's start). A long build is legitimately silent for a while,
 * which is why the tier says 疑似 rather than asserting a hang.
 */
export const STALL_AFTER_MS = 10 * 60_000

/**
 * Render an elapsed duration in coarse Chinese units.
 * @param ms - elapsed milliseconds; negative values read as zero.
 * @returns e.g. `刚刚`, `3 分钟`, `2 小时 5 分钟`, `3 天`.
 */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${String(minutes)} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest === 0 ? `${String(hours)} 小时` : `${String(hours)} 小时 ${String(rest)} 分钟`
  }
  return `${String(Math.floor(hours / 24))} 天`
}

function ago(ms: number): string {
  const elapsed = formatElapsed(ms)
  // Leading space separates the number from the preceding 于; 刚刚 needs none.
  return elapsed === '刚刚' ? '刚刚' : ` ${elapsed}前`
}

/** The newest turn's timing, by turn number. */
function latestTurn(
  timings: StatusSource['turnTimings'],
): { readonly startTime: number; readonly endTime?: number } | undefined {
  if (timings === undefined) return undefined
  let newest: number | undefined
  for (const turn of timings.keys()) if (newest === undefined || turn > newest) newest = turn
  return newest === undefined ? undefined : timings.get(newest)
}

function describePending(pending: NonNullable<StatusSource['pending']>[number]): string {
  const payload = pending.payload ?? undefined
  const toolName = typeof payload?.toolName === 'string' ? payload.toolName : undefined
  const reason = typeof payload?.reason === 'string' && payload.reason.trim() !== '' ? payload.reason : undefined
  if (pending.kind === 'approval') {
    const what = toolName === undefined ? '一次工具调用' : `工具 ${toolName}`
    return reason === undefined ? `待审批：${what}` : `待审批：${what}（${reason}）`
  }
  if (pending.kind === 'question') return '待回答：agent 向你提了一个问题'
  return `待处理：${pending.kind}`
}

/**
 * Resolve one session's current status.
 * @param source - the conversation snapshot fields.
 * @param now - the current epoch ms, injected so the result is deterministic.
 * @returns the headline tier plus fact lines, most important first.
 */
export function sessionStatus(source: StatusSource, now: number): SessionStatus {
  if (source.removed === true) {
    return { kind: 'removed', headline: '会话已移除', facts: [] }
  }
  if (source.openState !== undefined && source.openState !== 'open') {
    return {
      kind: 'unavailable',
      headline: source.openState === 'error' ? '会话未能打开' : '会话加载中',
      facts: [],
    }
  }

  const facts: string[] = []
  const pending = source.pending ?? []
  const calls = source.runningCalls ?? []
  const queued = (source.queue ?? []).filter(item => item.placement === 'queued').length
  const turn = latestTurn(source.turnTimings)
  const error = source.lastAgentError ?? undefined
  const promptFailed = source.promptError ?? undefined

  const activity = (): void => {
    const newestCall = calls.reduce<(typeof calls)[number] | undefined>(
      (newest, call) => (newest === undefined || call.time > newest.time ? call : newest),
      undefined,
    )
    if (newestCall !== undefined) {
      facts.push(`正在调用工具 ${newestCall.name}（已 ${formatElapsed(now - newestCall.time)}）`)
      if (calls.length > 1) facts.push(`并行中的工具调用共 ${String(calls.length)} 个`)
    } else if (source.partial !== undefined && source.partial !== null) {
      facts.push('正在生成回复')
    }
    if (turn !== undefined) facts.push(`本轮开始于${ago(now - turn.startTime)}`)
  }
  const tail = (): void => {
    if (queued > 0) facts.push(`队列中还有 ${String(queued)} 条待发消息`)
  }

  if (pending.length > 0) {
    for (const item of pending) facts.push(describePending(item))
    if (source.running) activity()
    tail()
    return { kind: 'waiting', headline: '在等你', facts }
  }

  if (source.running) {
    activity()
    tail()
    const lastActivity = Math.max(
      turn?.startTime ?? Number.NEGATIVE_INFINITY,
      ...calls.map(call => call.time),
    )
    const silent = Number.isFinite(lastActivity) ? now - lastActivity : 0
    if (silent >= STALL_AFTER_MS && source.partial == null) {
      facts.unshift(`已 ${formatElapsed(silent)}没有新的工具调用或轮次`)
      return { kind: 'stalled', headline: '疑似卡住', facts }
    }
    return { kind: 'running', headline: '运行中', facts }
  }

  if (error !== undefined || promptFailed !== undefined) {
    if (error !== undefined) facts.push(`最近错误：${error}`)
    if (promptFailed !== undefined) facts.push(promptFailed.op === 'stop' ? '停止失败' : '发送失败')
    if (turn?.endTime !== undefined) facts.push(`上一轮结束于${ago(now - turn.endTime)}`)
    tail()
    return { kind: 'error', headline: '出错了', facts }
  }

  if (source.blank === true) {
    tail()
    return { kind: 'blank', headline: '尚未开始', facts }
  }

  if (turn?.endTime !== undefined) facts.push(`上一轮结束于${ago(now - turn.endTime)}`)
  tail()
  return { kind: 'idle', headline: '空闲，等你输入', facts }
}
