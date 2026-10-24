/**
 * The `/handoff` command's own syntax, plus the redaction pass the summary
 * passes through on its way to a successor's prompt.
 *
 * Both are pure functions of their input so the grammar's fail-loud branches and
 * the redaction patterns are testable without a live session. The command owns
 * this grammar only: text this parser does not recognize as an option or a
 * sub-command is the focus, exactly as `/goal` treats unrecognized input.
 *
 * @module @a2d2/dsh-a2d2/src/handoff
 */

import { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskId } from './brand.ts'

/** Usage line returned for every invalid invocation. */
export const HANDOFF_USAGE = [
  'Usage:',
  '  /handoff [<focus>] [--task <task-id>] [--focus <focus>]',
  '  /handoff take <session-id>',
].join('\n')

/** One parsed `/handoff` invocation. */
export type HandoffCommand =
  | { readonly kind: 'prepare'; readonly focus: string | undefined; readonly task: TaskId | undefined }
  | { readonly kind: 'take'; readonly source: SessionId }
  | { readonly kind: 'help' }
  | { readonly kind: 'invalid'; readonly message: string }

/**
 * Read a session id from command input.
 *
 * Session ids reach the filesystem as handoff document names, so this is a
 * path-safety boundary rather than a formality: an id carrying path syntax is
 * rejected instead of being resolved.
 * @param value - the candidate session id.
 * @returns the branded id, or `undefined` when it is not one.
 */
export function parseSessionId(value: string): SessionId | undefined {
  const legacy = /^session-[a-z0-9][a-z0-9-]*$/u
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu
  return legacy.test(value) || uuid.test(value) ? SessionId(value) : undefined
}

/**
 * Read a task id from command input.
 * @param value - the candidate task id.
 * @returns the branded id, or `undefined` when it is not one.
 */
export function parseTaskId(value: string): TaskId | undefined {
  try {
    return TaskId(value)
  } catch {
    // A task id that fails the brand's filename check is a syntax error here,
    // and the caller renders it as one; nothing else can throw in this window.
    return undefined
  }
}

/** The named options `/handoff` recognizes on its prepare form. */
const PREPARE_OPTIONS = ['task', 'focus'] as const

/**
 * One `--name value` option of the prepare form.
 *
 * A value is double-quoted, single-quoted, or the run of characters that follows
 * the separator and stops at the next option. A valueless option matches only its
 * name, which is how a missing value is detected rather than absorbed.
 */
const OPTION = /--([a-z-]+)(?:\s*=\s*|\s+)?(?:"([^"]*)"|'([^']*)'|(\S[\s\S]*?))?(?=\s+--|$)/gu

/**
 * Parse one `/handoff` line.
 *
 * `rawInput` is the verbatim text after the command name, separator whitespace
 * included. The first token decides the form: `take`, an option, or free text.
 *
 * `take` names only the handed-off session: the task is derived from that
 * session's membership, so the successor — which knows the session it continues
 * but nothing else about the handoff — needs no task id to take one.
 * @param rawInput - text following the command name.
 * @returns the parsed invocation.
 */
export function parseHandoffCommand(rawInput: string): HandoffCommand {
  const input = rawInput.trim()
  if (input.length === 0) return { kind: 'prepare', focus: undefined, task: undefined }

  const tokens = input.split(/\s+/u)
  const head = tokens[0]
  /* v8 ignore next -- a non-empty trimmed input always yields a first token */
  if (head === undefined) return { kind: 'prepare', focus: undefined, task: undefined }

  if (head === '--help' || head === '-h' || head === 'help') return { kind: 'help' }
  if (head === 'take') return parseTake(tokens.slice(1))
  if (head.startsWith('-')) return parseOptions(input)
  return { kind: 'prepare', focus: input, task: undefined }
}

/** Parse the single positional id of the take form. */
function parseTake(args: readonly string[]): HandoffCommand {
  if (args.length < 1) return { kind: 'invalid', message: 'take needs the handed-off session id.' }
  if (args.length > 1) return { kind: 'invalid', message: 'take takes exactly one session id.' }
  const [rawSource] = args as [string]
  const source = parseSessionId(rawSource)
  if (source === undefined) return { kind: 'invalid', message: `"${rawSource}" is not a session id.` }
  return { kind: 'take', source }
}

/**
 * Parse the prepare form's options.
 *
 * A value may be quoted, inline after `=`, or the text up to the next option, so
 * a focus reads naturally with spaces in it. An unrecognized or valueless option
 * fails loudly: silently reading `--fucos` as the focus would hand a typo to the
 * next session as its stated purpose.
 */
function parseOptions(input: string): HandoffCommand {
  const seen = new Map<string, string>()

  for (const match of input.matchAll(OPTION)) {
    const [, name, doubleQuoted, singleQuoted, bare] = match
    /* v8 ignore next -- OPTION cannot match without its name group */
    if (name === undefined) break
    if (!PREPARE_OPTIONS.includes(name as (typeof PREPARE_OPTIONS)[number])) {
      return { kind: 'invalid', message: `Unknown option "--${name}".` }
    }
    if (seen.has(name)) return { kind: 'invalid', message: `Option "--${name}" was given twice.` }
    const value = (doubleQuoted ?? singleQuoted ?? bare ?? '').trim()
    if (value.length === 0) return { kind: 'invalid', message: `Option "--${name}" needs a value.` }
    seen.set(name, value)
  }

  const rawTask = seen.get('task')
  const task = rawTask === undefined ? undefined : parseTaskId(rawTask)
  if (rawTask !== undefined && task === undefined) {
    return { kind: 'invalid', message: `"${rawTask}" is not a task id.` }
  }
  const focus = seen.get('focus')
  return {
    kind: 'prepare',
    focus: focus === undefined || focus.length === 0 ? undefined : focus,
    task,
  }
}

/** Why a string was redacted, as the report names it. */
export type RedactionLabel =
  | 'labelled assignment'
  | 'bearer token'
  | 'URL password'
  | 'high-entropy token'

/** One redaction pass over a string. */
export interface RedactedText {
  /** The text with every matched secret replaced by a length-bearing placeholder. */
  readonly text: string
  /** Distinct reasons a replacement happened, in match order and without repeats. */
  readonly labels: readonly RedactionLabel[]
  /** Number of replacements made. */
  readonly count: number
}

/** Secret-bearing names, matched with `$` so a bare mention of a name is not a secret. */
const SECRET_NAME = String.raw`(?:[A-Za-z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY|CREDENTIALS?|TOKEN)|token|secret|password|passwd|apikey|api_key)`

interface RedactionPattern {
  readonly label: RedactionLabel
  readonly pattern: RegExp
}

/**
 * Redaction patterns, applied in order.
 *
 * Only two forms are matched: a secret-bearing name followed by an assigned
 * value, and a token whose own prefix declares it. Both require evidence beside
 * the characters, because a memorable project identifier is indistinguishable
 * from a generated secret and a false positive silently corrupts the handoff.
 * This is best-effort by construction and the README says so.
 */
const REDACTION_PATTERNS: readonly RedactionPattern[] = [
  {
    // A separator word (`KEY in the header`) is not an assignment, so the value
    // may hold spaces only after a colon; `NAME = value` still matches through
    // the optional whitespace before a non-space separator.
    label: 'labelled assignment',
    pattern: new RegExp(String.raw`(${SECRET_NAME}\s*(?::\s+|=)\s*)(\S+)`, 'giu'),
  },
  {
    label: 'bearer token',
    pattern: /(\bBearer\s+)(\S+)/gu,
  },
  {
    label: 'URL password',
    pattern: /(\/\/[^/\s:@]+:)([^/\s:@]+)(?=@)/gu,
  },
  {
    label: 'high-entropy token',
    // Every rule captures (preserved prefix, secret). A single capture would
    // pass replace's numeric offset as `secret`. Do not match inside identifiers.
    pattern: /(?<![A-Za-z0-9_-])()(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/gu,
  },
]

/** Test whether a value is a bare secret name rather than a name with a value. */
function isBareName(secret: string): boolean {
  return new RegExp(`^${SECRET_NAME}$`, 'iu').test(secret)
}

/**
 * The opening of every placeholder this pass writes.
 *
 * A second pass over already-redacted text has to leave it alone. A placeholder
 * follows the same `NAME=value` form a labelled assignment does, so without this
 * guard the pass redacts its own output: a retried take would rewrite the
 * document on every attempt, growing the placeholder each time.
 */
const REDACTION_PLACEHOLDER_PREFIX = '[redacted'

/** Build the placeholder standing in for one removed secret. */
function redactionPlaceholder(secret: string): string {
  return `${REDACTION_PLACEHOLDER_PREFIX} ${secret.length} chars]`
}

/**
 * Replace every recognized secret in a string.
 *
 * Idempotent: text this pass already redacted is returned unchanged, so a
 * document rewritten after redaction is stable under a repeated take.
 * @param value - the string to redact.
 * @returns the redacted text and what was removed.
 */
export function redactText(value: string): RedactedText {
  let text = value
  const labels: RedactionLabel[] = []
  let count = 0

  for (const { label, pattern } of REDACTION_PATTERNS) {
    text = text.replace(pattern, (match: string, prefix: string, secret: string) => {
      if (isBareName(secret) || secret.startsWith(REDACTION_PLACEHOLDER_PREFIX)) return match
      count += 1
      if (!labels.includes(label)) labels.push(label)
      return prefix + redactionPlaceholder(secret)
    })
  }

  return { text, labels, count }
}
