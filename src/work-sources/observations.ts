import type { GitHubIssue } from './types.ts'

/**
 * Apply a lower-fidelity list scan to an already observed Issue.
 *
 * Continuous candidate and catalog scans read Issues through list endpoints
 * that do not carry native child lists. Replacing a richer observation with
 * one of those would drop `subIssues`, which later makes the coordinator's
 * native child scope look incomplete and makes an exact-`observedAt` child
 * adoption look superseded. Only a strictly newer Issue version may replace
 * the observation, and a replacement never drops a native child list the
 * previous observation already carried; a fresh `work_related_issue` read is
 * what refreshes that detail.
 *
 * @param previous - the currently observed Issue, if any.
 * @param incoming - the Issue as seen by the completing read.
 * @returns the observation to store, or `undefined` when the read must not replace it.
 */
export function applyObservedIssue(previous: GitHubIssue | undefined, incoming: GitHubIssue): GitHubIssue | undefined {
  if (previous && incoming.updatedAt <= previous.updatedAt) return undefined
  if (incoming.subIssues === undefined && previous?.subIssues !== undefined) return { ...incoming, subIssues: previous.subIssues }
  return incoming
}
