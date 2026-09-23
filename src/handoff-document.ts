/**
 * The handoff document: the file one session leaves for its successor.
 *
 * Two writers own different halves. The plugin owns the front matter and the
 * fixed sections, because those are what `take` validates and what makes the
 * file machine-readable; the handing-off session's own agent owns the summary
 * between the markers, because it is the only writer that has the conversation
 * in context. A skeleton is written first, so the file exists — and fails
 * validation — until that agent fills the summary in.
 *
 * @module @deepseek-ai/dsh-a2d2/src/handoff-document
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskId } from './brand.ts'

/** The only handoff document schema version this build reads and writes. */
export const HANDOFF_DOCUMENT_VERSION = 2

/** Filename extension of every handoff document. */
export const HANDOFF_DOCUMENT_EXTENSION = '.md'

/**
 * The markers the writing agent replaces between. They are HTML comments so
 * they stay invisible in a rendered document, and they are the plugin's
 * contract with that agent: `take` refuses a document whose summary region is
 * still the placeholder.
 */
export const HANDOFF_SUMMARY_START = '<!-- a2d2:summary:start -->'

/** Closing marker of the summary region. */
export const HANDOFF_SUMMARY_END = '<!-- a2d2:summary:end -->'

/** What the skeleton puts between the markers, and what `take` rejects. */
export const HANDOFF_SUMMARY_PLACEHOLDER = '_Not written yet._'

/** Expected failure classes while reading a handoff document. */
export type HandoffDocumentErrorCode =
  | 'malformed'
  | 'unsupported-version'
  | 'source-mismatch'
  | 'unwritten'

/** A handoff document this build refuses to read. */
export class HandoffDocumentError extends Error {
  override readonly name = 'HandoffDocumentError'

  /** Stable class of the failure. */
  readonly code: HandoffDocumentErrorCode

  /**
   * Create one classified handoff-document failure.
   * @param code - the failure class.
   * @param message - what is wrong, naming the offending field.
   */
  constructor(code: HandoffDocumentErrorCode, message: string) {
    super(`a2d2: ${message}`)
    this.code = code
  }
}

/** The facts the front matter carries, which `take` parses back. */
export interface HandoffFacts {
  /** The session that was handed off. */
  readonly source: SessionId
  /** The task the source session belongs to. */
  readonly task: TaskId
  /** When the handoff was taken, ISO-8601. */
  readonly createdAt: string
  /** What the next session is for, absent for a generic handoff. */
  readonly focus: string | undefined
}

/** A handoff document with its summary written. */
export interface HandoffDocument extends HandoffFacts {
  /**
   * The document body: everything after the front matter, carrying the
   * successor's readable contract. The successor's first prompt is this text,
   * so the file and the prompt cannot disagree about what was handed over.
   */
  readonly body: string
}

/** Field names the front matter may carry; an unexpected one fails loudly. */
const FRONT_MATTER_FIELDS = ['version', 'source', 'task', 'createdAt', 'focus'] as const

function malformed(message: string): HandoffDocumentError {
  return new HandoffDocumentError('malformed', message)
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw malformed(`${field} must be a mapping`)
  }
  return value as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw malformed(`${field} must be a non-empty string`)
  }
  return value
}

/**
 * Read one handoff document.
 *
 * The declared source session must equal the session the caller looked the
 * document up by: a document copied under another session's name would otherwise
 * attach a successor to the wrong conversation. An unwritten summary is a
 * distinct failure from a malformed document, because it is the expected state
 * of a handoff whose writing turn has not finished yet.
 * @param text - the document's UTF-8 content.
 * @param source - the session whose document this is claimed to be.
 * @returns the validated document.
 */
export function parseHandoffDocument(text: string, source: SessionId): HandoffDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(text)
  if (match === null) {
    throw malformed('a handoff document must be YAML front matter between --- markers followed by a body')
  }
  const [, frontMatter, body] = match
  /* v8 ignore next -- a successful match always captures both groups */
  if (frontMatter === undefined || body === undefined) throw malformed('front matter is missing')

  let raw: unknown
  try {
    raw = parseYaml(frontMatter)
  } catch (error) {
    throw malformed(`front matter is not valid YAML: ${(error as Error).message}`)
  }
  const record = asRecord(raw, 'front matter')

  for (const field of Object.keys(record)) {
    if (!FRONT_MATTER_FIELDS.includes(field as (typeof FRONT_MATTER_FIELDS)[number])) {
      throw malformed(`front matter carries unknown field "${field}"`)
    }
  }

  const version = record['version']
  if (version !== HANDOFF_DOCUMENT_VERSION) {
    throw new HandoffDocumentError(
      'unsupported-version',
      `document declares version ${String(version)}; this build reads version ${HANDOFF_DOCUMENT_VERSION}`,
    )
  }

  const declaredSource = requiredString(record, 'source')
  if (declaredSource !== source) {
    throw new HandoffDocumentError(
      'source-mismatch',
      `document is named for session "${source}" but declares source "${declaredSource}"`,
    )
  }

  const rawFocus = record['focus']
  if (rawFocus !== undefined && (typeof rawFocus !== 'string' || rawFocus.trim() === '')) {
    throw malformed('focus must be a non-empty string when present')
  }

  assertSummaryWritten(body)

  return {
    source,
    task: TaskId(requiredString(record, 'task')),
    createdAt: requiredString(record, 'createdAt'),
    focus: rawFocus as string | undefined,
    body,
  }
}

/** Reject a body whose summary region is missing, empty, or still the placeholder. */
function assertSummaryWritten(body: string): void {
  const start = body.indexOf(HANDOFF_SUMMARY_START)
  const end = body.indexOf(HANDOFF_SUMMARY_END)
  if (start < 0 || end < 0 || end < start) {
    throw malformed(
      `the body carries no ${HANDOFF_SUMMARY_START} ... ${HANDOFF_SUMMARY_END} summary region, `
      + 'so this document is not one this build wrote',
    )
  }
  const summary = body.slice(start + HANDOFF_SUMMARY_START.length, end).trim()
  if (summary === '' || summary === HANDOFF_SUMMARY_PLACEHOLDER) {
    throw new HandoffDocumentError(
      'unwritten',
      'the handoff summary is not written yet; the source session\'s handoff turn has not finished',
    )
  }
}

/**
 * The filename one session's handoff document uses.
 * @param source - the handed-off session.
 * @returns the document's basename.
 */
export function handoffDocumentName(source: SessionId): string {
  return source + HANDOFF_DOCUMENT_EXTENSION
}

/**
 * Render the skeleton `prepare` writes.
 *
 * The skeleton is a complete document except for the summary, which is why it
 * parses as `unwritten` rather than as malformed: the handing-off agent is asked
 * to replace exactly the region between the markers and to leave every other
 * line alone, so the front matter it never has to author stays valid.
 *
 * The body becomes the successor's first prompt, so it carries only what that
 * session needs. The line that finishes a handoff belongs to the source side,
 * which reads it from the command's own result before a successor exists; a
 * document telling its reader to take a handoff would describe a step that has
 * already happened by the time that reader sees it.
 * @param facts - the parsed facts of the handoff.
 * @param skills - skills the successor is told to load, rendered for a person.
 * @returns the document's UTF-8 content.
 */
export function renderHandoffSkeleton(facts: HandoffFacts, skills: readonly string[]): string {
  const lines: string[] = [
    renderFrontMatter(facts),
    '',
    `# Handoff from ${facts.source}`,
    '',
    'You are the successor session. Continue the work described below. The summary',
    'is the handing-off session\'s own account of where the work stands, not a',
    'transcript of it.',
    '',
    '## What to read first',
    '',
    `- This document: \`.dsh/a2d2/handoffs/${facts.source}${HANDOFF_DOCUMENT_EXTENSION}\``,
    `- The task document: \`.dsh/a2d2/tasks/${facts.task}.yaml\``,
  ]

  if (facts.focus !== undefined) {
    lines.push('', '## Focus', '', facts.focus)
  }

  if (skills.length > 0) {
    lines.push('', '## Suggested skills', '')
    for (const skill of skills) lines.push(`- ${skill}`)
  }

  lines.push(
    '',
    '## Summary',
    '',
    HANDOFF_SUMMARY_START,
    HANDOFF_SUMMARY_PLACEHOLDER,
    HANDOFF_SUMMARY_END,
    '',
  )

  return lines.join('\n')
}

/**
 * Render a document whose summary is already written.
 *
 * The body is carried verbatim rather than re-rendered, so this reproduces the
 * document a person reads after a summary the redaction pass changed, and the
 * committed file stays the same text the successor received.
 * @param document - the document to serialize.
 * @returns the document's UTF-8 content.
 */
export function renderHandoffDocument(document: HandoffDocument): string {
  return `${renderFrontMatter(document)}\n${document.body.trimStart()}`
}

/** Render the front matter block, closing marker included and no trailing newline. */
function renderFrontMatter(facts: HandoffFacts): string {
  const fields: Record<string, unknown> = {
    version: HANDOFF_DOCUMENT_VERSION,
    source: facts.source,
    task: facts.task,
    createdAt: facts.createdAt,
  }
  if (facts.focus !== undefined) fields['focus'] = facts.focus
  return ['---', stringifyYaml(fields, { lineWidth: 0 }).trimEnd(), '---'].join('\n')
}
