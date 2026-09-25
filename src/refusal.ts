/**
 * Shared provider-failure classification for host routes and client displays.
 *
 * Keep this module dependency-free so both Node host code and browser bundles
 * can use the same refusal vocabulary.
 */

export type FailureKind = 'refusal' | 'rate-limited' | 'empty' | 'error'

export interface FailureClassificationInput {
  readonly finishKind?: unknown
  readonly message?: unknown
  readonly code?: unknown
  readonly status?: unknown
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numericStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function isRateLimitFailure(input: FailureClassificationInput): boolean {
  const message = textOf(input.message)
  const code = textOf(input.code).toLowerCase()
  const status = numericStatus(input.status)
  return code.includes('rate')
    || code.includes('429')
    || status === 429
    || /(^|\D)429(\D|$)|rate limit|too many requests/iu.test(message)
}

function isNetworkConnectionRefused(message: string, code: string): boolean {
  return code === 'econnrefused'
    || /\beconnrefused\b/iu.test(message)
    || /\bconnection refused\b/iu.test(message)
}

export function isRefusalFailure(input: FailureClassificationInput): boolean {
  if (input.finishKind === 'refusal') return true
  const message = textOf(input.message)
  if (message.trim() === '') return false
  const code = textOf(input.code).toLowerCase()
  if (isNetworkConnectionRefused(message, code)) return false
  return /blocked under anthropic'?s usage policy/iu.test(message)
    || /anthropic'?s usage policy[\s\S]{0,120}\b(blocked|restrictions?)\b/iu.test(message)
    || /\bmodel refused\b|\brefused to\b|\brefusal(s)?\b|拒答/iu.test(message)
}

export function classifyFailureKind(input: FailureClassificationInput): FailureKind {
  if (input.finishKind === 'refusal') return 'refusal'
  if (isRateLimitFailure(input)) return 'rate-limited'
  if (isRefusalFailure(input)) return 'refusal'
  if (textOf(input.message).trim() === 'model returned no text') return 'empty'
  return 'error'
}
