import { describe, expect, it, vi } from 'vitest'
import { HANDOFF_DRAFT, appendToDraft } from '../../src/client/composer.ts'
import type { A2d2ClientContext } from '../../src/client/context.ts'

/** A context exposing only the two services the write path reaches. */
function fakeContext(options: {
  draft?: string
  withSessions?: boolean
  withConversation?: boolean
  withScope?: boolean
} = {}): { ctx: A2d2ClientContext; setDraft: ReturnType<typeof vi.fn> } {
  const setDraft = vi.fn()
  const services: Record<string, unknown> = {}
  if (options.withSessions !== false) {
    services['sessions'] = {
      scope: () => (options.withScope === false ? undefined : { scoped: true }),
    }
  }
  if (options.withConversation !== false) {
    services['conversation'] = {
      input: {
        for: () => ({
          state: { getSnapshot: () => ({ draft: options.draft ?? '' }) },
          setDraft,
        }),
      },
    }
  }
  return {
    ctx: { get: (name: string) => services[name] } as unknown as A2d2ClientContext,
    setDraft,
  }
}

describe('appending the handoff command to the composer', () => {
  it('fills an empty draft with the command and its separator space', () => {
    const { ctx, setDraft } = fakeContext({ draft: '' })
    expect(appendToDraft(ctx, 'session-a', HANDOFF_DRAFT)).toBe(true)
    expect(setDraft).toHaveBeenCalledWith('/handoff ')
  })

  it('keeps an existing draft and appends after it', () => {
    const { ctx, setDraft } = fakeContext({ draft: '先看这个 bug' })
    appendToDraft(ctx, 'session-a', HANDOFF_DRAFT)
    expect(setDraft).toHaveBeenCalledWith('先看这个 bug /handoff ')
  })

  it('treats a whitespace-only draft as empty', () => {
    const { ctx, setDraft } = fakeContext({ draft: '   ' })
    appendToDraft(ctx, 'session-a', HANDOFF_DRAFT)
    expect(setDraft).toHaveBeenCalledWith('/handoff ')
  })

  it('reports failure and writes nothing when the sessions service is absent', () => {
    const { ctx, setDraft } = fakeContext({ withSessions: false })
    expect(appendToDraft(ctx, 'session-a', HANDOFF_DRAFT)).toBe(false)
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('reports failure when the session has no scope', () => {
    const { ctx, setDraft } = fakeContext({ withScope: false })
    expect(appendToDraft(ctx, 'session-a', HANDOFF_DRAFT)).toBe(false)
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('reports failure when the conversation service is absent', () => {
    const { ctx, setDraft } = fakeContext({ withConversation: false })
    expect(appendToDraft(ctx, 'session-a', HANDOFF_DRAFT)).toBe(false)
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('appends the command the /handoff plugin registers, not a near miss', () => {
    expect(HANDOFF_DRAFT).toBe('/handoff ')
  })
})
