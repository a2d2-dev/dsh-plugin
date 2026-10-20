import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import type { GitHubIssue, GitHubSourcePort, WorkSource } from '../src/work-sources/types.ts'
import { SourceError } from '../src/work-sources/github.ts'
import type { WorkResult } from '../src/work-types.ts'
const roots: string[] = []
const operator = { operator: true }
const noHost = { resources: async () => [], sessions: async () => [] }
const identity = { login: 'imneov', nodeId: 'U_1', name: 'LiuFeng' }
const issue: GitHubIssue = { nodeId: 'I_112', url: 'https://github.com/a2d2-dev/dsh-plugin/issues/112', number: 112, title: 'Existing GitHub work', body: 'Original specification\n\n## Acceptance\n- Preserve exact source', repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' }, state: 'open', labels: ['ready-for-agent'], assignees: ['imneov'], updatedAt: '2026-10-19T00:00:00Z', observedAt: '2026-10-20T00:00:00Z' }
const port: GitHubSourcePort = { list: async () => ({ identity, items: [issue], observedAt: issue.observedAt }), detail: async () => ({ identity, issue }) }
function completed(result: WorkResult) { expect(result.status).toBe('completed'); if (result.status !== 'completed') throw new Error(JSON.stringify(result)); return result }
afterEach(async () => { for (const root of roots.splice(0)) { if (!root.startsWith(join(tmpdir(), 'a2d2-source-'))) throw new Error('Unsafe cleanup'); await rm(root, { recursive: true, force: true }) } })
async function open(source: GitHubSourcePort | undefined = port) {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-source-')); roots.push(directory)
  const app = new WorkApplication(directory, noHost, source)
  const project = completed(await app.execute({ type: 'project.create', commandId: 'project', name: 'Existing work' }, operator)).project!
  const configured = completed(await app.execute({ type: 'source.configure', commandId: 'source', projectId: project.id, repository: issue.repository }, operator))
  return { app, directory, project, source: configured.source! }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
it('does not hold the work lock during network I/O and discards a late response after disable and re-enable', async () => {
  const started = deferred<void>(), remote = deferred<Awaited<ReturnType<GitHubSourcePort['list']>>>()
  const { app, project, source } = await open({ ...port, list: async () => { started.resolve(); return remote.promise } })
  const reading = app.query(pageQuery(source), operator)
  await started.promise
  try {
    expect(await app.execute({ type: 'task.create', commandId: 'local-during-network', projectId: project.id, title: 'Local', goal: 'Continue offline', specification: 'Independent content', acceptance: ['Local read works'] }, operator)).toMatchObject({ status: 'completed' })
    expect(await app.execute({ type: 'source.set-enabled', commandId: 'disable', projectId: project.id, sourceId: source.id, expectedVersion: 1, enabled: false }, operator)).toMatchObject({ status: 'completed', source: { enabled: false, version: 2 } })
    expect(await app.execute({ type: 'source.import', commandId: 'disabled-import', projectId: project.id, sourceId: source.id, nodeId: issue.nodeId }, operator)).toMatchObject({ status: 'failed', error: { code: 'source-disabled' } })
    await app.execute({ type: 'source.set-enabled', commandId: 'enable', projectId: project.id, sourceId: source.id, expectedVersion: 2, enabled: true }, operator)
  } finally { remote.resolve({ identity, items: [issue], observedAt: issue.observedAt }) }
  expect(await reading).toMatchObject({ status: 'conflict', error: { code: 'source-observation-superseded' } })
  expect(await app.query({ type: 'source.issue', projectId: project.id, sourceId: source.id, number: 112 }, operator)).toMatchObject({ status: 'failed', error: { code: 'source-content-unavailable' } })
})
it.each(['github-unauthorized', 'github-forbidden', 'github-rate-limited', 'github-offline', 'github-unavailable'])('keeps accepted content and cached pages after %s and a page interruption', async code => {
  let failed = false
  const { app, directory, project, source } = await open({ ...port, list: async (_, request) => {
    if (failed || request.page === 2) throw new SourceError(code, 'Source refresh failed')
    return { identity, items: [issue], nextPage: 2, observedAt: issue.observedAt }
  } })
  await app.query(pageQuery(source), operator)
  const imported = completed(await app.execute({ type: 'source.import', commandId: 'accept', projectId: project.id, sourceId: source.id, nodeId: issue.nodeId }, operator))
  expect(await app.query(pageQuery(source, true, 2), operator)).toMatchObject({ status: 'failed', error: { code } })
  expect(await app.query(pageQuery(source, false), operator)).toMatchObject({ status: 'completed', page: { items: [issue], nextPage: 2 } })
  failed = true
  expect(await app.query(pageQuery(source), operator)).toMatchObject({ status: 'failed', error: { code }, page: { items: [issue] } })
  const offline = new WorkApplication(directory, noHost)
  expect(await offline.query(pageQuery(source, false), operator)).toMatchObject({ status: 'completed', source: { lastError: { code } }, page: { items: [issue] } })
  expect(await offline.query({ type: 'task.detail', ref: imported.binding!.ref }, operator)).toMatchObject({ status: 'completed', task: imported.task })
})
it('lets a newer refresh win without allowing a late older request to replace its page', async () => {
  const started = deferred<void>(), oldResponse = deferred<Awaited<ReturnType<GitHubSourcePort['list']>>>()
  let calls = 0
  const updated = { ...issue, title: 'New title', updatedAt: '2026-10-20T00:00:00Z' }
  const { app, source } = await open({ ...port, list: async () => {
    if (++calls === 1) { started.resolve(); return oldResponse.promise }
    return { identity, items: [updated], observedAt: updated.observedAt }
  } })
  const old = app.query(pageQuery(source), operator); await started.promise
  try { expect(await app.query(pageQuery(source), operator)).toMatchObject({ status: 'completed', page: { items: [updated] } }) }
  finally { oldResponse.resolve({ identity, items: [issue], observedAt: issue.observedAt }) }
  expect(await old).toMatchObject({ status: 'conflict', page: { items: [updated] } })
})
it('links to existing local work without replacing specification or parent/session history, and distinguishes empty body from never retrieved content', async () => {
  const empty = { ...issue, body: null }
  const { app, directory, project, source } = await open({ ...port, list: async () => ({ identity, items: [empty], observedAt: issue.observedAt }) })
  const command = { type: 'source.import', commandId: 'not-retrieved', projectId: project.id, sourceId: source.id, nodeId: issue.nodeId }
  expect(await app.execute(command, operator)).toMatchObject({ status: 'failed', error: { code: 'source-content-unavailable' } })
  await app.query(pageQuery(source), operator)
  const local = completed(await app.execute({ type: 'task.create', commandId: 'local', projectId: project.id, title: 'Accepted local work', goal: 'Accepted goal', specification: 'Accepted local specification', acceptance: ['Approved local criterion'] }, operator)).task!
  const link = { type: 'source.link', commandId: 'link', sourceId: source.id, ref: { projectId: project.id, taskId: local.id }, expectedVersion: local.version, nodeId: issue.nodeId }
  expect(await app.execute(link, operator)).toMatchObject({ status: 'completed', task: { id: local.id, goal: local.goal, specification: local.specification, agentId: local.agentId }, binding: { accepted: { body: null } } })
  const offline = new WorkApplication(directory, noHost)
  expect(await offline.query({ type: 'work.capabilities' }, operator)).toMatchObject({ capabilities: { githubRead: false, githubWrite: false, taskStart: false, projectViews: false } })
  const imported = completed(await offline.execute({ ...command, commandId: 'reuse-local-offline' }, operator))
  expect(imported.task!.id).toBe(local.id)
})
it('blocks URL-only work that has never been fetched, then reuses normalized URLs without a second task', async () => {
  const { app, project, source } = await open()
  const command = { type: 'source.import', commandId: 'url-only', projectId: project.id, sourceId: source.id, url: 'https://github.com/A2D2-DEV/DSH-PLUGIN/issues/112/' }
  expect(await app.execute(command, operator)).toMatchObject({ status: 'failed', error: { code: 'source-content-unavailable' } })
  await app.query(pageQuery(source), operator)
  const imported = completed(await app.execute(command, operator))
  expect(await app.execute({ ...command, commandId: 'url-again', url: issue.url }, operator)).toMatchObject({ status: 'completed', task: { id: imported.task!.id } })
})
it('reuses an imported child after repeated pages while same-number Issues in another repository remain distinct', async () => {
  const otherIssue = { ...issue, nodeId: 'I_other_repo_112', url: 'https://github.com/a2d2-dev/other/issues/112', repository: { owner: 'a2d2-dev', repository: 'other' } }
  const { app, project, source } = await open({ ...port, list: async repository => ({ identity, items: repository.repository === 'other' ? [otherIssue] : [issue, issue], observedAt: issue.observedAt }) })
  await app.query(pageQuery(source), operator)
  const command = { type: 'source.import', projectId: project.id, sourceId: source.id, nodeId: issue.nodeId }
  const child = completed(await app.execute({ ...command, commandId: 'child-import' }, operator)).task!
  const parent = completed(await app.execute({ type: 'task.create', commandId: 'parent', projectId: project.id, title: 'Parent', goal: 'Organize child', specification: 'Keep unique child work', acceptance: ['One child identity'] }, operator)).task!
  const ref = { projectId: project.id, taskId: parent.id }
  await app.execute({ type: 'task.link-child', commandId: 'link-child', ref, expectedVersion: 1, child: { projectId: project.id, taskId: child.id }, childExpectedVersion: 1 }, operator)
  await app.query(pageQuery(source, true, 2), operator)
  expect(await app.execute({ ...command, commandId: 'repeat-child' }, operator)).toMatchObject({ status: 'completed', task: { id: child.id, parent: ref } })
  const other = completed(await app.execute({ type: 'source.configure', commandId: 'same-number-source', projectId: project.id, repository: otherIssue.repository }, operator)).source!
  await app.query(pageQuery(other), operator)
  const separate = completed(await app.execute({ ...command, commandId: 'other-repo-import', sourceId: other.id, nodeId: otherIssue.nodeId }, operator)).task!
  expect(separate.id).not.toBe(child.id)
  expect(completed(await app.query({ type: 'task.detail', ref }, operator)).children).toMatchObject([{ id: child.id }])
})
it('retains an explicitly revised local specification through remote state changes and disabled-source rereads', async () => {
  let current = issue, calls = 0
  const { app, project, source } = await open({ ...port, list: async () => { calls++; return { identity, items: [current], observedAt: current.observedAt } } })
  await app.query(pageQuery(source), operator)
  const imported = completed(await app.execute({ type: 'source.import', commandId: 'import-before-edit', projectId: project.id, sourceId: source.id, nodeId: issue.nodeId }, operator))
  const ref = imported.ref!
  const revised = completed(await app.execute({ type: 'task.update-spec', commandId: 'accept-local-spec', ref, expectedVersion: 1, goal: 'Accepted revised goal', specification: 'User-approved local specification', acceptance: ['User-approved criterion'] }, operator)).task!
  current = { ...issue, body: 'Remote conflicting content', state: 'closed', updatedAt: '2026-10-20T00:00:00Z' }
  await app.query(pageQuery(source), operator)
  expect(await app.query({ type: 'task.detail', ref }, operator)).toMatchObject({ task: revised, bindings: [{ accepted: issue, lastObserved: current }] })
  await app.execute({ type: 'source.set-enabled', commandId: 'disable-with-work', projectId: project.id, sourceId: source.id, expectedVersion: 1, enabled: false }, operator)
  expect(await app.query(pageQuery(source), operator)).toMatchObject({ status: 'failed', error: { code: 'source-disabled' } })
  expect(calls).toBe(2)
  expect(await app.query(pageQuery(source, false), operator)).toMatchObject({ status: 'completed', page: { items: [current] } })
  expect(await app.query({ type: 'task.detail', ref }, operator)).toMatchObject({ status: 'completed', task: revised, bindings: [{ accepted: issue }] })
})
const pageQuery = (source: WorkSource, refresh = true, page = 1) => ({ type: 'source.issues', projectId: source.projectId, sourceId: source.id, refresh, page, perPage: 2, assignee: '@me', state: 'open' })
it('browses without creating work then atomically accepts source content, binding and retry receipt without invented acceptance', async () => {
  const { app, directory, project, source } = await open()
  expect(await app.query(pageQuery(source), operator)).toMatchObject({ status: 'completed', page: { items: [issue], identity } })
  expect(completed(await app.query({ type: 'project.detail', projectId: project.id }, operator)).tasks).toEqual([])
  const command = { type: 'source.import', commandId: 'import', projectId: project.id, sourceId: source.id, nodeId: issue.nodeId }
  const imported = completed(await app.execute(command, operator))
  expect(imported.task).toMatchObject({ title: issue.title, goal: issue.title, specification: { text: issue.body, acceptance: [], missing: ['acceptance'] } })
  expect(imported.binding).toMatchObject({ nodeId: issue.nodeId, accepted: issue, ref: { projectId: project.id, taskId: imported.task!.id } })
  const reload = new WorkApplication(directory, noHost)
  expect(await reload.execute(command, operator)).toEqual(imported)
  expect(await reload.execute({ ...command, commandId: 'import-again' }, operator)).toMatchObject({ status: 'completed', task: { id: imported.task!.id } })
  expect(await reload.query({ type: 'task.detail', ref: imported.binding!.ref }, operator)).toMatchObject({ status: 'completed', task: imported.task, bindings: [imported.binding] })
})
it('reuses a stable node across duplicate pages, URL case aliases and repository rename, rejecting mapping and cross-project conflicts', async () => {
  let current = issue
  const { app, directory, project, source } = await open({ ...port, list: async () => ({ identity, items: [current, current], observedAt: current.observedAt }) })
  await app.query(pageQuery(source), operator)
  const command = { type: 'source.import', projectId: project.id, sourceId: source.id, nodeId: issue.nodeId }
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => new WorkApplication(directory, noHost).execute({ ...command, commandId: `race-${i}` }, operator)))
  const ids = results.map(result => completed(result).task!.id)
  expect(new Set(ids).size).toBe(1)
  const first = completed(results[0]!).task!
  current = { ...issue, url: 'https://github.com/A2D2-DEV/Renamed/issues/112', repository: { owner: 'A2D2-DEV', repository: 'Renamed' }, body: 'External edit must not overwrite accepted content', updatedAt: '2026-10-20T00:00:00Z' }
  await app.query(pageQuery(source), operator)
  expect(await app.execute({ ...command, commandId: 'renamed' }, operator)).toMatchObject({ status: 'completed', task: { id: first.id, specification: { text: issue.body } }, binding: { urls: [issue.url, current.url.toLowerCase()], lastObserved: current } })
  const otherProject = completed(await app.execute({ type: 'project.create', commandId: 'other-project', name: 'Other' }, operator)).project!
  const otherSource = completed(await app.execute({ type: 'source.configure', commandId: 'other-source', projectId: otherProject.id, repository: current.repository }, operator)).source!
  await app.query(pageQuery(otherSource), operator)
  expect(await app.execute({ ...command, commandId: 'other-import', projectId: otherProject.id, sourceId: otherSource.id }, operator)).toMatchObject({ status: 'conflict', error: { code: 'external-object-owned' }, ref: { projectId: project.id, taskId: first.id } })
  current = { ...current, nodeId: 'I_conflicting_node' }
  await app.query(pageQuery(source), operator)
  expect(await app.execute({ ...command, commandId: 'alias-conflict', nodeId: current.nodeId }, operator)).toMatchObject({ status: 'conflict', error: { code: 'external-mapping-conflict' } })
  expect(completed(await app.query({ type: 'project.detail', projectId: project.id }, operator)).tasks).toHaveLength(1)
})
