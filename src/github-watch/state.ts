/**
 * Pull-request state as the a2d2 hooks service reports it, and how a change in
 * it is told to the session that is waiting.
 *
 * The service owns reading GitHub (a2d2-services ADR 0002); this side only
 * compares what it receives with what it last told the session.
 *
 * @module @deepseek-ai/dsh-a2d2/src/github-watch/state
 */

/** Mirror of the service's `PrState` (a2d2-services `services/hooks/src/pr-state.ts`). */
export interface PrState {
  readonly number: number
  readonly state: 'open' | 'closed' | 'merged' | 'not_found'
  readonly draft: boolean
  readonly headSha: string | null
  readonly mergedAt: string | null
  readonly checks: 'success' | 'failure' | 'error' | 'pending' | 'expected' | null
  readonly review: 'approved' | 'changes_requested' | 'review_required' | null
}

const STATES = new Set(['open', 'closed', 'merged', 'not_found'])

/** Narrow untrusted wire data to a {@link PrState}. */
export function isPrState(value: unknown): value is PrState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Number.isSafeInteger(v.number) && (v.number as number) > 0
    && typeof v.state === 'string' && STATES.has(v.state)
    && typeof v.draft === 'boolean'
    && (v.headSha === null || typeof v.headSha === 'string')
    && (v.mergedAt === null || typeof v.mergedAt === 'string')
    && (v.checks === null || typeof v.checks === 'string')
    && (v.review === null || typeof v.review === 'string')
}

export const sameState = (a: PrState, b: PrState): boolean =>
  a.state === b.state && a.draft === b.draft && a.headSha === b.headSha && a.mergedAt === b.mergedAt
  && a.checks === b.checks && a.review === b.review

/** A PR in this state will not change again; its watch ends once reported. */
export const isTerminal = (pr: PrState): boolean => pr.state !== 'open'

const CHECKS: Record<NonNullable<PrState['checks']>, string> = {
  success: 'CI passed',
  failure: 'CI failed',
  error: 'CI errored',
  pending: 'CI running',
  expected: 'CI waiting for required checks',
}

const REVIEW: Record<NonNullable<PrState['review']>, string> = {
  approved: 'review approved',
  changes_requested: 'changes requested',
  review_required: 'review required',
}

/** The changes from `before` to `after`, most consequential first, in plain words. */
export function describeChanges(before: PrState | undefined, after: PrState): string[] {
  const changes: string[] = []
  if (before?.state !== after.state) {
    changes.push({ open: 'open', closed: 'closed without merging', merged: 'merged', not_found: 'not found' }[after.state])
  }
  if (after.state === 'open' && before !== undefined && before.draft !== after.draft) {
    changes.push(after.draft ? 'converted to draft' : 'ready for review')
  }
  if (before?.checks !== after.checks && after.checks !== null) changes.push(CHECKS[after.checks])
  if (before?.review !== after.review && after.review !== null) changes.push(REVIEW[after.review])
  if (before !== undefined && before.headSha !== null && after.headSha !== null && before.headSha !== after.headSha) {
    changes.push(`new head ${after.headSha.slice(0, 7)}`)
  }
  return changes
}

/** One-line account shown on the notice row; also the start of the message. */
export function noticeSummary(repo: string, before: PrState | undefined, after: PrState): string {
  const changes = describeChanges(before, after)
  return `${repo}#${after.number}: ${changes.length > 0 ? changes.join(', ') : 'updated'}`
}

/** The message the waiting session receives. */
export function noticeText(repo: string, before: PrState | undefined, after: PrState): string {
  const lines = [
    `GitHub update for ${repo} PR #${after.number} (https://github.com/${repo}/pull/${after.number}), which this session is watching:`,
    `- ${describeChanges(before, after).join('\n- ') || 'state updated'}`,
    '',
    `Current state: ${after.state}${after.draft ? ' (draft)' : ''}`
      + `; CI ${after.checks ?? 'none'}; review ${after.review ?? 'none'}`
      + (after.headSha === null ? '' : `; head ${after.headSha.slice(0, 7)}`)
      + (after.mergedAt === null ? '' : `; merged at ${after.mergedAt}`)
      + '.',
    isTerminal(after)
      ? 'The watch on this PR has ended. Continue the task from here.'
      : 'The watch stays active. Continue the task if this unblocks it; otherwise keep waiting.',
  ]
  return lines.join('\n')
}
