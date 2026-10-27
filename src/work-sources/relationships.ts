import { z } from 'zod'
import { issueSchema } from './schema.ts'
import { SourceError } from './errors.ts'
import type { GitHubIdentity, GitHubIssue, GitHubSourcePort } from './types.ts'

/** Both source kinds publish relationship facts before automatic admission can inspect them. */
export async function hydrateCandidateRelationships(issue: GitHubIssue, identity: GitHubIdentity, port: GitHubSourcePort): Promise<GitHubIssue> {
  if (issue.parent !== undefined && issue.subIssues && !issue.subIssues.hasNextPage && issue.subIssues.totalCount === issue.subIssues.items.length
    && issue.dependencies?.availability === 'available' && !issue.dependencies.blockedBy.hasNextPage && issue.dependencies.blockedBy.totalCount === issue.dependencies.blockedBy.items.length) return issue
  let detail: Awaited<ReturnType<GitHubSourcePort['detail']>>
  try { detail = await port.detail(issue.repository, issue.number, { nativeRelationships: true }) }
  catch (error) {
    const failure = error instanceof SourceError ? error : new SourceError('github-native-relationships-unavailable', 'Native Issue relationships could not be read')
    return { ...issue, dependencies: { availability: 'unavailable', code: failure.code, message: failure.message } }
  }
  const parsed = z.object({ identity: z.object({ login: z.string().min(1), nodeId: z.string().min(1), name: z.string().nullable() }), issue: issueSchema }).parse(detail)
  if (parsed.identity.nodeId !== identity.nodeId || parsed.identity.login.toLowerCase() !== identity.login.toLowerCase()) throw new SourceError('github-identity-changed', 'GitHub account changed during native relationship hydration')
  if (parsed.issue.nodeId !== issue.nodeId || parsed.issue.number !== issue.number || parsed.issue.repository.owner.toLowerCase() !== issue.repository.owner.toLowerCase() || parsed.issue.repository.repository.toLowerCase() !== issue.repository.repository.toLowerCase()) throw new SourceError('github-invalid-response', 'Native relationship detail returned a different Issue')
  return { ...issue, ...parsed.issue, dependencies: parsed.issue.dependencies ?? { availability: 'unavailable', code: 'github-native-dependencies-unavailable', message: 'Source adapter did not provide native Issue dependency observations' } }
}
