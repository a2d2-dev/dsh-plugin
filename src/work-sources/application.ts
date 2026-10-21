import { randomUUID } from 'node:crypto'
import type { WorkSnapshot } from '../work-schema.ts'
import type { WorkCommand, WorkQuery, WorkResult, WorkTask } from '../work-types.ts'
import type { ExternalBinding, GitHubIssue, GitHubSourcePort, WorkSource } from './types.ts'
import { SourceError } from './github.ts'
import { issueSchema } from './schema.ts'
import { reconcileProjectSources } from './discovery.ts'
type SourceCommand = Extract<WorkCommand, { type: `source.${string}` }>
type SourceRead = Extract<WorkQuery, { type: 'source.issue' | 'source.issues' }>
export type SourceTransaction = <T>(apply: (state: WorkSnapshot) => Promise<T>) => Promise<T>
const fail = (code: string, message: string): WorkResult => ({ status: 'failed', error: { code, message } })
function urlKey(url: string): string { return url.toLowerCase().replace(/\/$/, '') }
function sourceAt(state: WorkSnapshot, projectId: string, sourceId: string) { return state.sources.find(item => item.id === sourceId && item.projectId === projectId) }
/** Explicit acceptance may link already imported native relatives; discovery never calls this. */
function linkNativeRelatives(state: WorkSnapshot, observed: GitHubIssue, projectId: string, commandId: string): WorkResult | undefined {
  const edges = new Map<string, { parent: WorkTask; child: WorkTask }>()
  const byNode = new Map(state.externalBindings.map(binding => [binding.nodeId, binding]))
  const local = (nodeId: string) => {
    const binding = byNode.get(nodeId)
    return binding?.ref.projectId === projectId ? state.tasks.find(task => task.id === binding.ref.taskId && task.projectId === projectId) : undefined
  }
  const conflict = (message: string): WorkResult => ({ status: 'conflict', error: { code: 'source-hierarchy-conflict', message } })
  const add = (parentNode: string, childNode: string): WorkResult | undefined => {
    if (parentNode !== observed.nodeId && childNode !== observed.nodeId) return
    const parent = local(parentNode), child = local(childNode)
    // A source reference is useful even when the other Task is absent or owned by another Project.
    if (!parent || !child) return
    const previous = edges.get(child.id)
    if (parent.id === child.id) return conflict('Native Issue relationships would make a Task its own parent')
    if (previous && previous.parent.id !== parent.id) return conflict('Native Issue observations disagree about the child Task parent')
    if (child.parent && (child.parent.projectId !== projectId || child.parent.taskId !== parent.id)) return conflict('Native Issue parent conflicts with an existing local Task parent')
    edges.set(child.id, { parent, child })
  }
  // The current explicit observation wins for this Issue; related bindings retain their own native observations.
  for (const issue of [observed, ...state.externalBindings.filter(binding => binding.nodeId !== observed.nodeId && binding.ref.projectId === projectId).map(binding => binding.lastObserved)]) {
    if (issue.parent) { const error = add(issue.parent.nodeId, issue.nodeId); if (error) return error }
    for (const child of issue.subIssues?.items ?? []) { const error = add(issue.nodeId, child.nodeId); if (error) return error }
  }
  const parentByChild = new Map(state.tasks.filter(task => task.projectId === projectId && task.parent).map(task => [task.id, task.parent!.taskId]))
  for (const { parent, child } of edges.values()) parentByChild.set(child.id, parent.id)
  for (const { child } of edges.values()) {
    const seen = new Set<string>()
    let id: string | undefined = child.id
    while (id) {
      if (seen.has(id)) return conflict('Native Issue relationships would create a Task parent cycle')
      seen.add(id); id = parentByChild.get(id)
    }
  }
  const changed = new Set<WorkTask>()
  for (const { parent, child } of edges.values()) {
    if (!child.parent) { child.parent = { projectId, taskId: parent.id }; changed.add(child) }
    if (!parent.children.some(ref => ref.projectId === projectId && ref.taskId === child.id)) { parent.children.push({ projectId, taskId: child.id }); changed.add(parent) }
  }
  for (const task of changed) {
    // A newly imported or explicitly linked Task already records this command;
    // its native relationship is part of that same accepted change.
    if (task.activity.at(-1)?.commandId === commandId) continue
    task.version++
    task.activity.push({ commandId, type: 'source.link-hierarchy', version: task.version })
  }
}
export function applySourceCommand(state: WorkSnapshot, command: SourceCommand): WorkResult {
  const projectId = 'projectId' in command ? command.projectId : command.ref.projectId
  const project = state.projects.find(item => item.id === projectId)
  if (!project) return fail('unknown-project', 'Project does not exist')
  if (command.type === 'source.configure-project') {
    const target = command.githubProject
    const previous = state.sources.find(item => item.projectId === projectId && item.githubProject?.type === target.type && item.githubProject.number === target.number && item.githubProject.owner.toLowerCase() === target.owner.toLowerCase())
    if (previous) return { status: 'completed', source: previous }
    const source: WorkSource = { id: randomUUID(), projectId, provider: 'github', githubProject: target, enabled: true, version: 1, sequence: 0, requests: {}, observations: [], pages: [], discovery: { state: 'idle', failures: 0, nextAttemptAt: new Date().toISOString() } }
    state.sources.push(source)
    return { status: 'completed', source }
  }
  if (command.type === 'source.configure') {
    const previous = state.sources.find(item => item.projectId === projectId && item.repository?.owner.toLowerCase() === command.repository.owner.toLowerCase() && item.repository.repository.toLowerCase() === command.repository.repository.toLowerCase())
    if (previous) return { status: 'completed', source: previous }
    const source: WorkSource = { id: randomUUID(), projectId, provider: 'github', repository: command.repository, enabled: true, version: 1, sequence: 0, requests: {}, observations: [], pages: [] }
    state.sources.push(source)
    return { status: 'completed', source }
  }
  const source = sourceAt(state, projectId, command.sourceId)
  if (!source) return fail('unknown-source', 'Source does not belong to this project')
  if (command.type === 'source.set-enabled') {
    if (source.version !== command.expectedVersion) return { status: 'conflict', error: { code: 'version-conflict', message: 'Source version is stale', currentVersion: source.version } }
    if (source.enabled !== command.enabled) {
      source.enabled = command.enabled; source.version++
      if (source.discovery) {
        delete source.discovery.checkpoint; delete source.discovery.inFlight
        source.discovery.state = 'idle'; source.discovery.nextAttemptAt = new Date().toISOString()
      }
    }
    return { status: 'completed', source }
  }
  if (!source.enabled) return fail('source-disabled', 'Source is disabled; retained local work remains available')
  const byIndex = (key: string) => { const ref = state.externalIndex[key]; return ref && state.externalBindings.find(item => item.ref.taskId === ref.taskId && item.ref.projectId === ref.projectId && (key.startsWith('github:node:') ? key === `github:node:${item.nodeId}` : item.urls.some(url => key === `github:url:${urlKey(url)}`))) }
  const requestedUrlMatch = command.url ? byIndex(`github:url:${urlKey(command.url)}`) : undefined
  const nodeId = command.nodeId ?? requestedUrlMatch?.nodeId
  const observed = source.observations.find(item => nodeId ? item.issue.nodeId === nodeId : urlKey(item.issue.url) === urlKey(command.url!))?.issue
  if (!observed) return fail('source-content-unavailable', 'No retrieved Issue content is available; a URL alone cannot create accepted work')
  const nodeMatch = byIndex(`github:node:${observed.nodeId}`)
  const urlMatch = byIndex(`github:url:${urlKey(observed.url)}`)
  if ((nodeMatch && urlMatch && nodeMatch !== urlMatch) || (urlMatch && urlMatch.nodeId !== observed.nodeId)) return { status: 'conflict', error: { code: 'external-mapping-conflict', message: 'External node and URL map to different work; automatic merging is forbidden' }, binding: urlMatch }
  const previous = nodeMatch ?? urlMatch
  if (previous) {
    if (previous.ref.projectId !== projectId || (command.type === 'source.link' && previous.ref.taskId !== command.ref.taskId)) return { status: 'conflict', error: { code: 'external-object-owned', message: 'Issue already belongs to the returned canonical TaskRef' }, binding: previous, ref: previous.ref }
    if (!previous.urls.includes(urlKey(observed.url))) previous.urls.push(urlKey(observed.url))
    state.externalIndex[`github:url:${urlKey(observed.url)}`] = previous.ref
    if (!previous.sourceIds.includes(source.id)) previous.sourceIds.push(source.id)
    if (observed.updatedAt >= previous.lastObserved.updatedAt) previous.lastObserved = observed
    const hierarchyError = linkNativeRelatives(state, observed, projectId, command.commandId)
    if (hierarchyError) return hierarchyError
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
  state.externalIndex[`github:node:${binding.nodeId}`] = binding.ref
  state.externalIndex[`github:url:${urlKey(observed.url)}`] = binding.ref
  const hierarchyError = linkNativeRelatives(state, observed, projectId, command.commandId)
  if (hierarchyError) return hierarchyError
  return { status: 'completed', task, binding, ref: binding.ref }
}
function pageKey(query: SourceRead) { return query.type === 'source.issue' ? `issue:${query.nodeId ?? query.number}` : JSON.stringify([query.page, query.perPage, query.assignee, query.state]) }
export function sourceResult(state: WorkSnapshot, query: SourceRead): WorkResult {
  const source = sourceAt(state, query.projectId, query.sourceId)
  if (!source) return fail('unknown-source', 'Source does not belong to this project')
  if (query.type === 'source.issue') {
    const matches = source.observations.filter(item => query.nodeId ? item.issue.nodeId === query.nodeId && (query.number === undefined || item.issue.number === query.number) : item.issue.number === query.number)
    if (matches.length > 1) return { ...fail('source-issue-ambiguous', 'This Project contains same-number Issues from different repositories; use the Issue node identity'), source }
    const issue = matches[0]?.issue
    return issue ? { status: 'completed', source, issue, bindings: state.externalBindings.filter(item => item.nodeId === issue.nodeId) } : { ...fail('source-content-unavailable', 'Issue content has never been retrieved'), source }
  }
  if (source.githubProject) {
    const snapshot = source.projectSnapshot
    if (!snapshot) return { ...fail('source-page-unobserved', 'Project discovery has not completed a full scan yet'), source }
    const byNode = new Map(source.observations.map(item => [item.issue.nodeId, item.issue]))
    const ids = [...new Set(snapshot.items.filter(item => item.kind === 'issue' && !item.archived).map(item => item.issueNodeId))]
    const issues = ids.map(id => id ? byNode.get(id) : undefined).filter((issue): issue is GitHubIssue => !!issue)
      .filter(issue => (query.state === 'all' || query.state === issue.state)
      && (query.assignee === '*' || issue.assignees.some(login => login.toLowerCase() === snapshot.identity.login.toLowerCase())))
    const start = (query.page - 1) * query.perPage
    return { status: 'completed', source, page: { identity: snapshot.identity, observedAt: snapshot.observedAt, items: issues.slice(start, start + query.perPage), ...(start + query.perPage < issues.length ? { nextPage: query.page + 1 } : {}) } }
  }
  const page = source.pages.find(item => item.key === pageKey(query))
  if (!page) return { ...fail('source-page-unobserved', 'This page has not been retrieved; refresh explicitly'), source }
  return { status: 'completed', source, page: { identity: page.identity, observedAt: page.observedAt, ...(page.nextPage ? { nextPage: page.nextPage } : {}), items: page.nodeIds.map(id => source.observations.find(item => item.issue.nodeId === id)!.issue) } }
}
/** Reserve locally, await remote I/O outside the transaction, then fence against disable and newer requests. */
export async function refreshSource(transaction: SourceTransaction, query: SourceRead, port?: GitHubSourcePort): Promise<WorkResult> {
  const selected = await transaction(async state => sourceAt(state, query.projectId, query.sourceId))
  if (selected?.githubProject) {
    if (!selected.enabled) return transaction(async state => ({ ...sourceResult(state, query), status: 'failed' as const, error: { code: 'source-disabled', message: 'Source is disabled' } }))
    await reconcileProjectSources(transaction, port, { sourceId: query.sourceId, projectId: query.projectId, force: true })
    return transaction(async state => {
      const result = sourceResult(state, query), source = sourceAt(state, query.projectId, query.sourceId)
      if (source && (!source.enabled || source.version !== selected.version)) return { ...result, status: 'conflict' as const, error: { code: 'source-observation-superseded', message: 'Observation was discarded after source configuration changed' } }
      return source?.lastError ? { ...result, status: 'failed' as const, error: source.lastError } : result
    })
  }
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
    if (!reserved.repository) throw new SourceError('github-invalid-scope', 'Source does not contain a repository')
    const number = query.type === 'source.issue' ? query.number ?? reserved.observations.find(item => item.issue.nodeId === query.nodeId)?.issue.number : undefined
    if (query.type === 'source.issue' && number === undefined) throw new SourceError('source-content-unavailable', 'Issue node has not been observed in this repository')
    result = query.type === 'source.issues' ? await port!.list(reserved.repository, query) : await port!.detail(reserved.repository, number!)
    if (query.type === 'source.issue' && query.nodeId && 'issue' in result && result.issue.nodeId !== query.nodeId) throw new SourceError('github-invalid-response', 'GitHub returned a different Issue node')
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
