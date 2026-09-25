import { describe, expect, it } from 'vitest'
import { classifyFailureKind, isRefusalFailure } from '../src/refusal.ts'

const anthropicUsagePolicyRefusal = "This request triggered restrictions on violative cyber content and was blocked under Anthropic's Usage Policy. To learn more, see https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback."

describe('provider failure classification', () => {
  it('recognizes direct refusal finishes and Anthropic policy-block error text', () => {
    expect(classifyFailureKind({ finishKind: 'refusal' })).toBe('refusal')
    expect(classifyFailureKind({ message: anthropicUsagePolicyRefusal, code: 'PI_AI_ERROR' })).toBe('refusal')
    expect(isRefusalFailure({ message: 'The model refused to answer this request.' })).toBe(true)
  })

  it('keeps rate limits, server failures, and network errors out of the refusal bucket', () => {
    expect(classifyFailureKind({ message: '429 too many requests', code: 'RATE_LIMIT' })).toBe('rate-limited')
    expect(classifyFailureKind({ message: '502 bad gateway from upstream', status: 502 })).toBe('error')
    expect(classifyFailureKind({ message: 'fetch failed: ECONNRESET', code: 'ECONNRESET' })).toBe('error')
  })
})
