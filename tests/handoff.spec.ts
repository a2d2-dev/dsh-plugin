/**
 * The `/handoff` command grammar and the redaction pass a summary goes through
 * on its way into a successor's prompt.
 *
 * @module dsh-a2d2/tests/handoff
 */

import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  HANDOFF_USAGE,
  parseHandoffCommand,
  parseSessionId,
  redactText,
} from '../src/handoff.ts'

describe('session id parsing', () => {
  it.each(['3eb796c2-5159-4686-affe-df8719f6f987', '3EB796C2-5159-4686-AFFE-DF8719F6F987'])(
    'keeps the Team UUID unchanged: %s', id => {
      expect(parseSessionId(id)).toBe(id)
      expect(parseHandoffCommand(`take ${id}`)).toEqual({ kind: 'take', source: id })
    },
  )
  it.each(['/', '..', 'session-..', 'session-a/../b', 'session-a\\b',
    '3eb796c2-5159-4686-affe-df8719f6f987/..', 'session-a\n'])(
    'rejects unsafe input %j', id => { expect(parseSessionId(id)).toBeUndefined() },
  )

  it('accepts a session id and rejects a traversal attempt', () => {
    expect(parseSessionId('session-3eb796c2-5159-4686-affe-df8719f6f987'))
      .toBe(SessionId('session-3eb796c2-5159-4686-affe-df8719f6f987'))
    expect(parseSessionId('../../etc/passwd')).toBeUndefined()
    expect(parseSessionId('session/a')).toBeUndefined()
    expect(parseSessionId('')).toBeUndefined()
  })
})

describe('/handoff syntax', () => {
  it('reads bare /handoff as a generic handoff of the current session', () => {
    expect(parseHandoffCommand('')).toEqual({ kind: 'prepare', focus: undefined, task: undefined })
  })

  it('treats free text as the next session focus', () => {
    expect(parseHandoffCommand(' finish the store layer '))
      .toEqual({ kind: 'prepare', focus: 'finish the store layer', task: undefined })
  })

  it('reads --task and --focus as named options', () => {
    expect(parseHandoffCommand('--task fix-flaky-test --focus land the edge case'))
      .toEqual({ kind: 'prepare', focus: 'land the edge case', task: 'fix-flaky-test' })
  })

  it('accepts a quoted or inline value as well as a spaced one', () => {
    expect(parseHandoffCommand('--focus="ship it"'))
      .toEqual({ kind: 'prepare', focus: 'ship it', task: undefined })
    expect(parseHandoffCommand('--focus=ship-it'))
      .toEqual({ kind: 'prepare', focus: 'ship-it', task: undefined })
  })

  it('rejects an unknown option instead of reading it as a focus', () => {
    expect(parseHandoffCommand('--fucos typo')).toEqual({
      kind: 'invalid',
      message: 'Unknown option "--fucos".',
    })
  })

  it('rejects an option left without a value', () => {
    expect(parseHandoffCommand('--focus')).toEqual({
      kind: 'invalid',
      message: 'Option "--focus" needs a value.',
    })
  })

  it('rejects the same option given twice', () => {
    expect(parseHandoffCommand('--focus a --focus b')).toEqual({
      kind: 'invalid',
      message: 'Option "--focus" was given twice.',
    })
  })

  it('rejects a task id that is not a document id', () => {
    expect(parseHandoffCommand('--task ../escape')).toEqual({
      kind: 'invalid',
      message: '"../escape" is not a task id.',
    })
  })

  it('reads a take invocation as the one session id it continues', () => {
    expect(parseHandoffCommand('take session-a')).toEqual({
      kind: 'take',
      source: SessionId('session-a'),
    })
  })

  it('fails loud when take names a task id as well', () => {
    expect(parseHandoffCommand('take fix-flaky-test session-a')).toEqual({
      kind: 'invalid',
      message: 'take takes exactly one session id.',
    })
  })

  it('fails loud when take carries an invalid session id', () => {
    expect(parseHandoffCommand('take not-a-session!')).toEqual({
      kind: 'invalid',
      message: '"not-a-session!" is not a session id.',
    })
  })

  it('fails loud when take is missing its session id', () => {
    expect(parseHandoffCommand('take')).toEqual({
      kind: 'invalid',
      message: 'take needs the handed-off session id.',
    })
  })

  it('reads --help before anything else', () => {
    expect(parseHandoffCommand('--help')).toEqual({ kind: 'help' })
    expect(HANDOFF_USAGE).toContain('/handoff take <session-id>')
    expect(HANDOFF_USAGE).toContain('/handoff [<focus>] [--task <task-id>] [--focus <focus>]')
  })
})

describe('secret redaction', () => {
  it('preserves the continuation specification path and token-like identifier suffixes', () => {
    const text = 'See docs/specs/task-interaction-v4-delivery.md and prefix_ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345.'
    expect(redactText(text)).toEqual({ text, labels: [], count: 0 })
  })

  it.each(['sk-abcdefghijklmnopqrstuvwxyz', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', 'xoxb-1234567890-abcdef'])('redacts a standalone %s token without retaining its capture', secret => {
    const once = redactText(`Use (${secret}), then continue.`)
    expect(once).toEqual({ text: `Use ([redacted ${secret.length} chars]), then continue.`, labels: ['high-entropy token'], count: 1 })
    expect(redactText(once.text)).toEqual({ text: once.text, labels: [], count: 0 })
  })

  it('removes a labelled assignment and counts the removed characters', () => {
    const secret = 'sk-live-0123456789abcdef'
    const redacted = redactText(`API_KEY=${secret}`)
    expect(redacted.text).toBe(`API_KEY=[redacted ${secret.length} chars]`)
    expect(redacted.labels).toEqual(['labelled assignment'])
  })

  it('removes a bearer token but keeps the scheme readable', () => {
    const redacted = redactText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdef')
    expect(redacted.text).toBe('Authorization: Bearer [redacted 27 chars]')
  })

  it('removes a `token:` style YAML value', () => {
    expect(redactText('token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345').text)
      .toBe('token: [redacted 36 chars]')
  })

  it('removes a URL userinfo password', () => {
    expect(redactText('postgres://app:hunter2@db.internal:5432/x').text)
      .toBe('postgres://app:[redacted 7 chars]@db.internal:5432/x')
  })

  it('leaves ordinary prose, identifiers, and short words untouched', () => {
    const prose = 'The task id is fix-flaky-test and the port is 3080; see docs/testing.md.'
    expect(redactText(prose).text).toBe(prose)
    expect(redactText(prose).labels).toEqual([])
    expect(redactText(prose).count).toBe(0)
  })

  it('does not redact a mention of a key name without a value', () => {
    expect(redactText('set DEEPSEEK_API_KEY in the environment').text)
      .toBe('set DEEPSEEK_API_KEY in the environment')
  })

  it('does not redact a key name followed by a separator word', () => {
    expect(redactText('put the TOKEN in the header instead').text)
      .toBe('put the TOKEN in the header instead')
  })

  it('reports every distinct label it applied', () => {
    expect(redactText('token: abcdefghijklmnop and Bearer abcdefghijklmnop').labels)
      .toEqual(['labelled assignment', 'bearer token'])
  })

  it('is idempotent, so a document rewritten after redaction is stable', () => {
    const once = redactText(
      'API_KEY=sk-abcdefghijklmnopqrstuvwxyz and Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdef',
    )
    const twice = redactText(once.text)
    expect(twice.text).toBe(once.text)
    expect(twice.count).toBe(0)
  })
})
