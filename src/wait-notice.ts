/**
 * Wait notices (等人通知): when a task issue's main session stops for LF, push
 * one message worded in A²D² terms through the optional `notifier` service.
 *
 * ADR 0010 splits the work: A²D² decides whether a stop is a wait for LF and
 * what the message says; whichever plugin provides `notifier`
 * (a2d2-dev/dsh-feishu-connect or dsh-notifier) delivers it. Only main sessions
 * notify — subagents and unbound sessions never do.
 *
 * Three waits, v1:
 * - a turn ended: pushed after {@link WAIT_NOTICE_GRACE_MS} unless the session
 *   receives user input or starts another turn first;
 * - `ask_user_question` was called: pushed at once;
 * - `complete_task` succeeded: pushed at once, and the turn it ran in sends no
 *   turn notice — one wait, one notice.
 *
 * A push never affects the session: results are logged, and a rejected or
 * throwing provider is contained here.
 *
 * @module @a2d2-dev/dsh-a2d2/src/wait-notice
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** How long a finished turn waits before its notice is pushed. */
export const WAIT_NOTICE_GRACE_MS = 30_000

/** `sourceName` every wait notice is pushed under. */
export const WAIT_NOTICE_SOURCE = 'dsh-a2d2'

/** Longest assistant-reply excerpt a turn notice carries, in characters. */
export const WAIT_NOTICE_SUMMARY_MAX_CHARS = 300

/** The tool whose call means the main session asked LF a question. */
const ASK_USER_TOOL = 'ask_user_question'

/**
 * Turn endings after which the session waits for LF. `aborted` is left out
 * because LF (or the host) cancelled it; `interrupted` and `forked` are closers
 * written after the fact, never a live stop.
 */
const WAITING_TURN_ENDS: ReadonlySet<string> = new Set(['completed', 'error', 'blocked', 'max-tokens'])

/** Message shape of the `notifier` service, as dsh-notifier 0.7 defines it. */
export interface NotifierMessage {
  readonly title?: string
  readonly content?: string
  readonly level?: 'timeSensitive' | 'active' | 'passive'
}

/** Push options; `sessionId` lets a provider retract its own generic notice for the same wait. */
export interface NotifierPushOptions {
  readonly sourceName?: string
  readonly sessionId?: string
}

/** Push result, as dsh-notifier 0.7 defines it. */
export interface NotifierPushResult {
  readonly ok: boolean
  readonly delivered: readonly string[]
  readonly skipped: readonly string[]
  readonly failed: readonly unknown[]
}

/** The `notifier` service surface this plugin calls. */
export interface Notifier {
  push(message: NotifierMessage, options: NotifierPushOptions): Promise<NotifierPushResult>
}

/** The session facts a `session/event` carries that wait notices read. */
export interface WaitNoticeSession {
  readonly id: SessionId
  readonly header: { readonly cwd?: string }
}

/** What {@link WaitNotices} needs from the plugin around it. */
export interface WaitNoticeDependencies {
  /** The provider pushes go through. */
  readonly notifier: Notifier
  /** The task issue a session is the main session of, or `undefined`. */
  readonly mainTaskIssue: (cwd: string, sessionId: SessionId) => Promise<number | undefined>
  /** The task issue's web URL, or `undefined` when the project has no GitHub origin. */
  readonly issueUrl: (cwd: string, issue: number) => Promise<string | undefined>
  readonly log: { info(message: string): void; warn(message: string): void }
}

/** A turn notice waiting out its grace window. */
interface PendingTurnNotice {
  readonly timer: ReturnType<typeof setTimeout>
}

/** Text of an assistant message, its text blocks joined. */
function assistantText(event: SessionEvent<'assistant/message'>): string {
  return event.data.message.content
    .map(block => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()
}

/** The first `max` characters of a text, marked when cut. */
function excerpt(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

/** The question texts of an `ask_user_question` call, or `undefined` when unreadable. */
function questionsOf(argumentsText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(argumentsText)
    const questions = (parsed as { questions?: unknown }).questions
    if (!Array.isArray(questions)) return undefined
    const texts = questions
      .map(item => (item as { question?: unknown }).question)
      .filter((text): text is string => typeof text === 'string' && text.trim() !== '')
    return texts.length === 0 ? undefined : texts.join('\n')
  } catch {
    return undefined
  }
}

/** Join notice body parts, skipping absent ones. */
function body(...parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part !== '').join('\n\n')
}

/**
 * Turns session events and task completions into wait notices.
 *
 * Every session's events pass through {@link WaitNotices.observe}; whether the
 * session is a main session is decided only when a notice is due, so a turn's
 * grace window is armed and cancelled synchronously with the events that drive
 * it.
 */
export class WaitNotices {
  private readonly lastReply = new Map<SessionId, string>()
  private readonly pending = new Map<SessionId, PendingTurnNotice>()
  /** Sessions that sent "已完成" in their current turn; that turn's end sends no turn notice. */
  private readonly completedThisTurn = new Set<SessionId>()

  /**
   * @param deps - the provider, the main-session lookup, link resolution, and logging.
   */
  constructor(private readonly deps: WaitNoticeDependencies) {}

  /**
   * Feed one appended session event.
   * @param session - the session whose log grew.
   * @param event - the appended event.
   */
  observe(session: WaitNoticeSession, event: SessionEvent): void {
    const id = session.id
    if (event.type === 'turn/start' || event.type.startsWith('user/')) this.cancel(id)
    if (event.type.startsWith('user/')) this.completedThisTurn.delete(id)
    switch (event.type) {
      case 'turn/start':
        this.lastReply.delete(id)
        return
      case 'assistant/message': {
        const text = assistantText(event)
        if (text !== '') this.lastReply.set(id, text)
        return
      }
      case 'turn/end': {
        const reply = this.lastReply.get(id)
        this.lastReply.delete(id)
        if (this.completedThisTurn.delete(id)) return
        if (!WAITING_TURN_ENDS.has(event.data.reason.kind)) return
        const cwd = session.header.cwd ?? ''
        const timer = setTimeout(() => {
          this.pending.delete(id)
          this.send(cwd, id, async issue => ({
            title: `#${String(issue)} · 等你回复`,
            content: body(
              reply === undefined ? undefined : excerpt(reply, WAIT_NOTICE_SUMMARY_MAX_CHARS),
              await this.deps.issueUrl(cwd, issue),
            ),
            level: 'active',
          }))
        }, WAIT_NOTICE_GRACE_MS)
        this.pending.set(id, { timer })
        return
      }
      case 'tool/call': {
        if (event.data.name !== ASK_USER_TOOL) return
        const cwd = session.header.cwd ?? ''
        const question = questionsOf(event.data.arguments)
        this.send(cwd, id, async issue => ({
          title: `#${String(issue)} · 需要你决定`,
          content: body(question, await this.deps.issueUrl(cwd, issue)),
          level: 'timeSensitive',
        }))
        return
      }
      default:
    }
  }

  /**
   * Notify that a main session completed its task issue. The end of the
   * current turn then sends no "等你回复": "已完成" already is this wait's
   * notice. `ask_user_question` gets no such pass — LF's answer resumes the
   * turn, so its end is a new wait.
   * @param sessionId - the main session that called `complete_task`.
   * @param issue - its task issue number.
   * @param summary - the completion summary.
   */
  completed(sessionId: SessionId, issue: number, summary: string): void {
    this.completedThisTurn.add(sessionId)
    void this.push(sessionId, { title: `#${String(issue)} · 已完成`, content: summary, level: 'active' })
  }

  /** Drop every pending turn notice. */
  dispose(): void {
    for (const { timer } of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
    this.lastReply.clear()
    this.completedThisTurn.clear()
  }

  private cancel(id: SessionId): void {
    const pending = this.pending.get(id)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
  }

  /** Push a notice when the session is a task issue's main session. */
  private send(cwd: string, id: SessionId, compose: (issue: number) => Promise<NotifierMessage>): void {
    void (async () => {
      if (cwd === '') return
      const issue = await this.deps.mainTaskIssue(cwd, id)
      if (issue === undefined) return
      await this.push(id, await compose(issue))
    })().catch((error: unknown) => {
      this.deps.log.warn(`a2d2: wait notice for ${id} was not sent: ${String(error)}`)
    })
  }

  private async push(id: SessionId, message: NotifierMessage): Promise<void> {
    try {
      const result = await this.deps.notifier.push(message, { sourceName: WAIT_NOTICE_SOURCE, sessionId: id })
      this.deps.log.info(
        `a2d2: wait notice "${message.title ?? ''}" for ${id}: ok=${String(result.ok)}`
        + ` delivered=[${result.delivered.join(',')}] skipped=[${result.skipped.join(',')}] failed=${String(result.failed.length)}`,
      )
    } catch (error) {
      this.deps.log.warn(`a2d2: wait notice "${message.title ?? ''}" for ${id} failed: ${String(error)}`)
    }
  }
}
