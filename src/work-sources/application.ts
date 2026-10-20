import { randomUUID } from 'node:crypto'
import type { WorkSnapshot } from '../work-schema.ts'
import type { WorkCommand, WorkQuery, WorkResult, WorkTask } from '../work-types.ts'
import type { ExternalBinding, GitHubIssue, GitHubSourcePort, WorkSource } from './types.ts'
import { SourceError } from './github.ts'
import { issueSchema } from './schema.ts'
type SourceCommand = Extract<WorkCommand, { type: `source.${string}` }>
type SourceRead = Extract<WorkQuery, { type: 'source.issue' | 'source.issues' }>
export type SourceTransaction = <T>(apply: (state: WorkSnapshot) => Promise<T>) => Promise<T>
const fail = (code: string, message: string): WorkResult => ({ status: 'failed', error: { code, message } })
function urlKey(url: string): string { return url.toLowerCase().replace(/\/$/, '') }
function sourceAt(state: WorkSnapshot, projectId: string, sourceId: string) { return state.sources.find(item => item.id === sourceId && item.projectId === projectId) }
export function applySourceCommand(state: WorkSnapshot, command: SourceCommand): WorkResult {
  const projectId = 'projectId' in command ? command.projectId : command.ref.projectId
  const project = state.projects.find(item => item.id === projectId)
  if (!project) return fail('unknown-project', 'Project does not exist')
  if (command.type === 'source.configure') {
    const previous = state.sources.find(item => item.projectId === projectId && item.repository.owner.toLowerCase() === command.repository.owner.toLowerCase() && item.repository.repository.toLowerCase() === command.repository.repository.toLowerCase())
    if (previous) return { status: 'completed', source: previous }
    const source: WorkSource = { id: randomUUID(), projectId, provider: 'github', repository: command.repository, enabled: true, version: 1, sequence: 0, requests: {}, observations: [], pages: [] }
    state.sources.push(source)
    return { status: 'completed', source }
  }
  const source = sourceAt(state, projectId, command.sourceId)
  if (!source) return fail('unknown-source', 'Source does not belong to this project')
  if (command.type === 'source.set-enabled') {
    if (source.version !== command.expectedVersion) return { status: 'conflict', error: { code: 'version-conflict', message: 'Source version is stale', currentVersion: source.version } }
    if (source.enabled !== command.enabled) { source.enabled = command.enabled; source.version++ }
    return { status: 'completed', source }
  }
  if (!source.enabled) return fail('source-disabled', 'Source is disabled; retained local work remains available')
  const observed = source.observations.find(item => item.issue.nodeId === command.nodeId)?.issue
  if (!observed) return fail('source-content-unavailable', 'No retrieved Issue content is available; a URL alone cannot create accepted work')
  const nodeMatch = state.externalBindings.find(item => item.nodeId === observed.nodeId)
  const urlMatch = state.externalBindings.find(item => item.urls.some(url => urlKey(url) === urlKey(observed.url)))
  if ((nodeMatch && urlMatch && nodeMatch !== urlMatch) || (urlMatch && urlMatch.nodeId !== observed.nodeId)) return { status: 'conflict', error: { code: 'external-mapping-conflict', message: 'External node and URL map to different work; automatic merging is forbidden' }, binding: urlMatch }
  const previous = nodeMatch ?? urlMatch
  if (previous) {
    if (previous.ref.projectId !== projectId || (command.type === 'source.link' && previous.ref.taskId !== command.ref.taskId)) return { status: 'conflict', error: { code: 'external-object-owned', message: 'Issue already belongs to the returned canonical TaskRef' }, binding: previous, ref: previous.ref }
    if (!previous.urls.includes(urlKey(observed.url))) previous.urls.push(urlKey(observed.url))
    if (!previous.sourceIds.includes(source.id)) previous.sourceIds.push(source.id)
    if (observed.updatedAt >= previous.lastObserved.updatedAt) previous.lastObserved = observed
    return { status: 'completed', binding: previous, task: state.tasks.find(item => item.id === previous.ref.taskId)!, ref: previous.ref }
  }
  let task: WorkTask
  if (command.type === 'source.link') {
    const existing = state.tasks.find(item => item.id === command.ref.taskId && item.projectId === projectId)
    if (!existing) return fail('unknown-task', 'Task does not belong to this project')
    if (existing.version !== command.expectedVersion) return { status: 'conflict', error: { code: 'version-conflict', message: 'Task version is stale', currentVersion: existing.version } }
    task = existing
    task.version++
    task.activity.push({ commandId: command.commandId, type: command.type, version: task.version })
  } else {
    task = { id: randomUUID(), projectId, title: observed.title, goal: observed.title, version: 1, agentId: project.defaultAgentId,
      specification: { version: 1, text: observed.body ?? '', acceptance: [], missing: [...(!observed.body?.trim() ? ['body' as const] : []), 'acceptance'] },
      specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [{ commandId: command.commandId, type: command.type, version: 1 }] }
    state.tasks.push(task)
  }
  const binding: ExternalBinding = { provider: 'github', nodeId: observed.nodeId, urls: [urlKey(observed.url)], ref: { projectId, taskId: task.id }, sourceIds: [source.id], accepted: observed, lastObserved: observed }
  state.externalBindings.push(binding)
  return { status: 'completed', task, binding, ref: binding.ref }
}
function pageKey(query: SourceRead) { return query.type === 'source.issue' ? `issue:${query.number}` : JSON.stringify([query.page, query.perPage, query.assignee, query.state]) }
export function sourceResult(state: WorkSnapshot, query: SourceRead): WorkResult {
  const source = sourceAt(state, query.projectId, query.sourceId)
  if (!source) return fail('unknown-source', 'Source does not belong to this project')
  if (query.type === 'source.issue') {
    const issue = source.observations.find(item => item.issue.number === query.number)?.issue
    return issue ? { status: 'completed', source, issue, bindings: state.externalBindings.filter(item => item.nodeId === issue.nodeId) } : { ...fail('source-content-unavailable', 'Issue content has never been retrieved'), source }
  }
  const page = source.pages.find(item => item.key === pageKey(query))
  if (!page) return { ...fail('source-page-unobserved', 'This page has not been retrieved; refresh explicitly'), source }
  return { status: 'completed', source, page: { identity: page.identity, observedAt: page.observedAt, ...(page.nextPage ? { nextPage: page.nextPage } : {}), items: page.nodeIds.map(id => source.observations.find(item => item.issue.nodeId === id)!.issue) } }
}
/** Reserve locally, await remote I/O outside the transaction, then fence against disable and newer requests. */
export async function refreshSource(transaction: SourceTransaction, query: SourceRead, port?: GitHubSourcePort): Promise<WorkResult> {
  const reservation = await transaction(async state => {
    const source = sourceAt(state, query.projectId, query.sourceId)
    if (!source) return { error: fail('unknown-source', 'Source does not belong to this project') }
    if (!source.enabled) return { error: { ...fail('source-disabled', 'Source is disabled'), source } }
    if (!port) return { error: { ...sourceResult(state, query), status: 'failed' as const, error: { code: 'github-capability-unavailable', message: 'GitHub source is unavailable on this server; local work remains readable' } } }
    const key = pageKey(query)
    source.sequence++
    source.requests[key] = source.sequence
    return { source: structuredClone(source), key, sequence: source.sequence, version: source.version }
  })
  if ('error' in reservation) return reservation.error!
  const { source: reserved, key, sequence, version } = reservation
  let result: Awaited<ReturnType<GitHubSourcePort['list']>> | Awaited<ReturnType<GitHubSourcePort['detail']>> | undefined
  let error: SourceError | undefined
  try {
    result = query.type === 'source.issues' ? await port!.list(reserved.repository, query) : await port!.detail(reserved.repository, query.number)
    const items = 'items' in result ? result.items : [result.issue]
    for (const item of items) issueSchema.parse(item)
  } catch (caught) { error = caught instanceof SourceError ? caught : new SourceError('github-invalid-response', 'GitHub source did not return a usable observation') }
  return transaction(async state => {
    const source = sourceAt(state, query.projectId, query.sourceId)!
    if (!source.enabled || source.version !== version || source.requests[key] !== sequence) return { ...sourceResult(state, query), status: 'conflict', error: { code: 'source-observation-superseded', message: 'Observation was discarded after source disable or a newer request' } }
    if (error) {
      source.lastError = { code: error.code, message: error.message, ...(error.retryAt ? { retryAt: error.retryAt } : {}) }
      return { ...sourceResult(state, query), status: 'failed', error: source.lastError }
    }
    const observation = result!
    source.identity = observation.identity
    delete source.lastError
    const items = 'items' in observation ? observation.items : [observation.issue]
    for (const issue of items) {
      const existing = source.observations.find(item => item.issue.nodeId === issue.nodeId)
      if (existing && (existing.issue.updatedAt > issue.updatedAt || (existing.issue.updatedAt === issue.updatedAt && existing.sequence > sequence))) continue
      if (existing) { existing.issue = issue; existing.sequence = sequence } else source.observations.push({ issue, sequence })
      const binding = state.externalBindings.find(item => item.nodeId === issue.nodeId)
      if (binding && issue.updatedAt >= binding.lastObserved.updatedAt) binding.lastObserved = issue
    }
    if ('items' in observation) {
      const page = { key, nodeIds: [...new Set(observation.items.map(item => item.nodeId))], identity: observation.identity, observedAt: observation.observedAt, ...(observation.nextPage ? { nextPage: observation.nextPage } : {}) }
      source.pages = source.pages.filter(item => item.key !== key)
      source.pages.push(page)
    }
    return sourceResult(state, query)
  })
}
