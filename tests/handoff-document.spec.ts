/**
 * The handoff document's v2 lifecycle: the skeleton the plugin writes, the
 * summary the handing-off agent writes between the markers, and the parse that
 * refuses everything in between.
 *
 * @module dsh-a2d2/tests/handoff-document
 */

import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskId } from '../src/brand.ts'
import {
  HANDOFF_DOCUMENT_VERSION,
  HANDOFF_SUMMARY_END,
  HANDOFF_SUMMARY_PLACEHOLDER,
  HANDOFF_SUMMARY_START,
  HandoffDocumentError,
  handoffDocumentName,
  parseHandoffDocument,
  renderHandoffDocument,
  renderHandoffSkeleton,
} from '../src/handoff-document.ts'
import type { HandoffDocument, HandoffFacts } from '../src/handoff-document.ts'

const source = SessionId('session-a')

const facts: HandoffFacts = {
  source,
  task: TaskId('fix-flaky-test'),
  createdAt: '2026-09-21T00:00:00.000Z',
  focus: 'land the retry guard',
}

const skills = ['tdd', 'code-review']

/** The document the handing-off agent produces: the skeleton with its summary filled in. */
function written(summary: string, options: { facts?: HandoffFacts; skills?: readonly string[] } = {}): string {
  const skeleton = renderHandoffSkeleton(options.facts ?? facts, options.skills ?? skills)
  expect(skeleton).toContain(HANDOFF_SUMMARY_PLACEHOLDER)
  return skeleton.replace(HANDOFF_SUMMARY_PLACEHOLDER, summary)
}

/** Parse a document expected to be refused, returning the classified failure. */
function refusal(text: string, sessionId: SessionId = source): HandoffDocumentError {
  try {
    parseHandoffDocument(text, sessionId)
  } catch (error) {
    if (error instanceof HandoffDocumentError) return error
    throw error
  }
  throw new Error('expected the handoff document to be refused')
}

/** The body of a rendered document: everything after the closing front-matter delimiter. */
function bodyOf(text: string): string {
  const closing = text.indexOf('\n---\n', '---\n'.length)
  return text.slice(closing + '\n---\n'.length)
}

describe('handoff skeleton', () => {
  it('writes version 2 front matter carrying the handoff facts', () => {
    const skeleton = renderHandoffSkeleton(facts, skills)
    expect(HANDOFF_DOCUMENT_VERSION).toBe(2)
    expect(skeleton).toContain(`version: ${HANDOFF_DOCUMENT_VERSION}`)
    expect(skeleton).toContain('source: session-a')
    expect(skeleton).toContain('task: fix-flaky-test')
    expect(skeleton).toContain('createdAt: 2026-09-21T00:00:00.000Z')
    expect(skeleton).toContain('focus: land the retry guard')
  })

  it('writes the fixed sections the successor is told to read', () => {
    const skeleton = renderHandoffSkeleton(facts, skills)
    expect(skeleton).toContain('# Handoff from session-a')
    expect(skeleton).toContain('## What to read first')
    expect(skeleton).toContain('.dsh/a2d2/handoffs/session-a.md')
    expect(skeleton).toContain('.dsh/a2d2/tasks/fix-flaky-test.yaml')
    expect(skeleton).toContain('## Focus')
    expect(skeleton).toContain('## Suggested skills')
    expect(skeleton).toContain('- tdd')
    expect(skeleton).toContain('- code-review')
    expect(skeleton).toContain('## Summary')
  })

  it('leaves the take line out of the document the successor reads', () => {
    // The successor reads this body as its first prompt, and `take` has recorded
    // the edge by then; the line that finishes a handoff belongs to the source
    // side's command result, which the person reads before a successor exists.
    const skeleton = renderHandoffSkeleton(facts, skills)
    expect(skeleton).not.toContain('/handoff take')
    expect(skeleton).not.toContain('no successor')
  })

  it('leaves the summary region carrying its placeholder', () => {
    const skeleton = renderHandoffSkeleton(facts, skills)
    const region = skeleton.slice(
      skeleton.indexOf(HANDOFF_SUMMARY_START) + HANDOFF_SUMMARY_START.length,
      skeleton.indexOf(HANDOFF_SUMMARY_END),
    )
    expect(region.trim()).toBe(HANDOFF_SUMMARY_PLACEHOLDER)
  })

  it('omits the focus section, and the focus field, when the handoff states none', () => {
    const focusless: HandoffFacts = { ...facts, focus: undefined }
    const skeleton = renderHandoffSkeleton(focusless, skills)
    expect(skeleton).not.toContain('## Focus')
    expect(skeleton).not.toContain('focus:')
    expect(parseHandoffDocument(written('the store layer is next', { facts: focusless }), source).focus)
      .toBeUndefined()
  })

  it('omits the suggested-skills section when the deployment configures none', () => {
    expect(renderHandoffSkeleton(facts, [])).not.toContain('## Suggested skills')
  })

  it('names the document after the handed-off session', () => {
    expect(handoffDocumentName(source)).toBe('session-a.md')
  })
})

describe('reading a handoff document', () => {
  it('refuses a skeleton whose summary is still the placeholder', () => {
    const failure = refusal(renderHandoffSkeleton(facts, skills))
    expect(failure.code).toBe('unwritten')
    expect(failure.message).toContain('not written yet')
  })

  it('refuses a document whose summary region is empty', () => {
    expect(refusal(written('')).code).toBe('unwritten')
  })

  it('refuses a body carrying no summary region at all', () => {
    const text = renderHandoffSkeleton(facts, skills)
      .replace(HANDOFF_SUMMARY_START, '').replace(HANDOFF_SUMMARY_END, '').replace(HANDOFF_SUMMARY_PLACEHOLDER, '')
    const failure = refusal(text)
    expect(failure.code).toBe('malformed')
    expect(failure.message).toContain('summary region')
    expect(failure.message).toContain(HANDOFF_SUMMARY_START)
  })

  it('reads back the facts and the body of a written document', () => {
    const summary = 'The retry guard landed; the store layer is next.'
    const text = written(summary)
    const document = parseHandoffDocument(text, source)
    expect(document).toEqual({
      source,
      task: facts.task,
      createdAt: facts.createdAt,
      focus: facts.focus,
      body: bodyOf(text),
    })
    expect(document.body).toContain(summary)
    expect(document.body).not.toContain(HANDOFF_SUMMARY_PLACEHOLDER)
    expect(document.body).not.toContain('version:')
  })

  it('refuses front matter carrying a field this build does not know', () => {
    const text = written('done').replace('task: fix-flaky-test\n', 'task: fix-flaky-test\ncapturedThroughSeq: 42\n')
    const failure = refusal(text)
    expect(failure.code).toBe('malformed')
    expect(failure.message).toContain('unknown field "capturedThroughSeq"')
  })

  it('refuses an unsupported version, naming both versions', () => {
    const text = written('done').replace(`version: ${HANDOFF_DOCUMENT_VERSION}`, 'version: 1')
    const failure = refusal(text)
    expect(failure.code).toBe('unsupported-version')
    expect(failure.message).toContain('version 1')
    expect(failure.message).toContain(`version ${HANDOFF_DOCUMENT_VERSION}`)
  })

  it('refuses a document that belongs to another session', () => {
    const failure = refusal(written('done'), SessionId('session-b'))
    expect(failure.code).toBe('source-mismatch')
    expect(failure.message).toContain('session-b')
    expect(failure.message).toContain('session-a')
  })

  it('refuses a document with a missing required field', () => {
    const failure = refusal(written('done').replace('task: fix-flaky-test\n', ''))
    expect(failure.code).toBe('malformed')
    expect(failure.message).toContain('task must be a non-empty string')
  })

  it('refuses a present but blank focus', () => {
    const failure = refusal(written('done').replace('focus: land the retry guard', 'focus: ""'))
    expect(failure.code).toBe('malformed')
    expect(failure.message).toContain('focus must be a non-empty string when present')
  })

  it('refuses a document that is not front matter plus body', () => {
    expect(refusal('just prose').code).toBe('malformed')
    expect(refusal('---\nversion: 2\n').message).toContain('front matter')
  })

  it('refuses invalid YAML in the front matter', () => {
    const failure = refusal('---\nversion: [\n---\nbody\n')
    expect(failure.code).toBe('malformed')
    expect(failure.message).toContain('not valid YAML')
  })
})

describe('writing a document back', () => {
  const body = [
    '# Handoff from session-a',
    '',
    '## Summary',
    '',
    HANDOFF_SUMMARY_START,
    'The retry guard landed; the store layer is next.',
    HANDOFF_SUMMARY_END,
    '',
  ].join('\n')
  const document: HandoffDocument = { ...facts, body }

  it('re-renders the front matter and carries the body verbatim', () => {
    expect(parseHandoffDocument(renderHandoffDocument(document), source)).toEqual(document)
  })

  it('writes a redacted body back as the text the successor reads', () => {
    const redacted: HandoffDocument = {
      ...document,
      body: body.replace('the store layer', 'the wire layer'),
    }
    const rendered = renderHandoffDocument(redacted)
    expect(rendered).toContain('the wire layer')
    expect(rendered).not.toContain('the store layer')
    expect(parseHandoffDocument(rendered, source)).toEqual(redacted)
  })
})
