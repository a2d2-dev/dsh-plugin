import { hydrateCandidateRelationships } from './relationships.ts'
import { z } from 'zod'
import type { SourceTransaction } from './application.ts'
import { issueSchema } from './schema.ts'
import { SourceError } from './errors.ts'
import { applyObservedIssue } from './observations.ts'
import type { GitHubIssue, GitHubSourcePort } from './types.ts'
import type { WorkResult } from '../work-types.ts'

export const MAX_REPOSITORY_CANDIDATES = 1000
const identitySchema = z.object({ login: z.string().min(1), nodeId: z.string().min(1), name: z.string().nullable() }).strict()
const pageSchema = z.object({ identity: identitySchema, items: z.array(issueSchema).max(100), nextPage: z.number().int().positive().optional(), observedAt: z.iso.datetime() }).strict()
const failure = (code: string, message: string): WorkResult => ({ status: 'failed', error: { code, message } })

/** Publish only a complete credential-visible repository scan; browsing pages never form a dispatch scope. */
export async function refreshRepositoryCandidates(transaction: SourceTransaction, scope: { projectId: string; sourceId: string }, port?: GitHubSourcePort): Promise<WorkResult> {
  const reservation = await transaction(async state => {
    const source = state.sources.find(source => source.id === scope.sourceId && source.projectId === scope.projectId)
    if (!source) return { error: failure('unknown-source', 'Source does not belong to this project') }
    if (!source.repository) return { project: true as const }
    if (!source.enabled) return { error: failure('source-disabled', 'Source is disabled; existing executions are retained') }
    if (!port) return { error: failure('github-capability-unavailable', 'Repository candidate reading is unavailable') }
    source.sequence++
    source.requests['continuous-candidates'] = source.sequence
    return { source: structuredClone(source), sequence: source.sequence }
  })
  if ('error' in reservation) return reservation.error!
  if ('project' in reservation) return { status: 'completed' }
  const { source: reserved, sequence } = reservation
  let result: { identity: z.infer<typeof identitySchema>; issues: GitHubIssue[]; observedAt: string } | undefined
  let error: { code: string; message: string; retryAt?: string } | undefined
  try {
    const issues = new Map<string, GitHubIssue>()
    let identity: z.infer<typeof identitySchema> | undefined
    let page = 1
    for (let count = 0; count < 10; count++) {
      const observed = pageSchema.parse(await port!.list(reserved.repository!, { page, perPage: 100, assignee: '*', state: 'open' }))
      if (identity && (identity.nodeId !== observed.identity.nodeId || identity.login.toLowerCase() !== observed.identity.login.toLowerCase())) throw new SourceError('github-identity-changed', 'GitHub account changed during repository candidate pagination')
      identity = observed.identity
      for (const issue of observed.items) {
        if (issue.repository.owner.toLowerCase() !== reserved.repository!.owner.toLowerCase() || issue.repository.repository.toLowerCase() !== reserved.repository!.repository.toLowerCase()) throw new SourceError('github-invalid-response', 'Repository candidate belongs to a different repository')
        issues.set(issue.nodeId, await hydrateCandidateRelationships(issue, identity, port!))
      }
      if (issues.size > MAX_REPOSITORY_CANDIDATES) throw new SourceError('source-candidate-limit', 'Repository candidate scope exceeds 1000 visible Issues; nothing was enabled')
      if (!observed.nextPage) { result = { identity, issues: [...issues.values()], observedAt: observed.observedAt }; break }
      if (observed.nextPage !== page + 1) throw new SourceError('source-pagination-invalid', 'Repository pagination did not advance to the next complete page')
      page = observed.nextPage
    }
    if (!result) throw new SourceError('source-candidate-limit', 'Repository scan exceeds 10 pages of 100 entries; candidate scope is incomplete')
  } catch (caught) {
    error = caught instanceof SourceError ? { code: caught.code, message: caught.message, ...(caught.retryAt ? { retryAt: caught.retryAt } : {}) } : { code: 'github-invalid-response', message: 'Repository candidates could not be read completely' }
  }
  return transaction(async state => {
    const source = state.sources.find(source => source.id === reserved.id && source.projectId === reserved.projectId)
    if (!source?.enabled || source.version !== reserved.version || source.requests['continuous-candidates'] !== sequence) return failure('source-observation-superseded', 'Repository candidate scan was superseded by source configuration or a newer scan')
    if (error) { source.lastError = error; return failure(error.code, error.message) }
    source.identity = result!.identity
    source.repositorySnapshot = { sourceVersion: source.version, identity: result!.identity, nodeIds: result!.issues.map(issue => issue.nodeId), observedAt: result!.observedAt }
    delete source.lastError
    for (const issue of result!.issues) {
      const observation = source.observations.find(item => item.issue.nodeId === issue.nodeId)
      if (observation && (observation.sequence > sequence || observation.issue.updatedAt > issue.updatedAt)) continue
      if (observation) { observation.issue = issue; observation.sequence = sequence } else source.observations.push({ issue, sequence })
      const binding = state.externalBindings.find(binding => binding.nodeId === issue.nodeId)
      const observed = binding && applyObservedIssue(binding.lastObserved, issue)
      if (binding && observed) binding.lastObserved = observed
    }
    return { status: 'completed', source }
  })
}
