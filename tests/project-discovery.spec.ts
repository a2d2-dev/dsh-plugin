import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { WorkApplication } from '../src/work.ts'
import { snapshotSchema } from '../src/work-schema.ts'
import { SourceError } from '../src/work-sources/github.ts'
import { reconcileProjectSources, startProjectDiscovery } from '../src/work-sources/discovery.ts'
import type { SourceTransaction } from '../src/work-sources/application.ts'
import type { GitHubIssue, GitHubProjectPage, GitHubSourcePort, WorkSource } from '../src/work-sources/types.ts'
import type { WorkResult } from '../src/work-types.ts'
const roots: string[] = [], actor = { operator: true }, host = { resources: async () => [], sessions: async () => [] }
const identity = { login: 'imneov', nodeId: 'U_1', name: 'LF' }
const issue: GitHubIssue = { nodeId: 'I_1', number: 1, title: 'Issue 1', body: 'Original source', repository: { owner: 'a2d2-dev', repository: 'one' }, url: 'https://github.com/a2d2-dev/one/issues/1', state: 'open', labels: [], assignees: ['imneov'], updatedAt: '2026-10-20T00:00:00Z', observedAt: '2026-10-20T00:00:00Z', parent: null, subIssues: { items: [], totalCount: 0, hasNextPage: false } }
function page(issues: GitHubIssue[], nextCursor?: string): GitHubProjectPage { return { identity, project: { nodeId: 'PVT_1', title: 'Project', url: 'https://github.com/orgs/a2d2-dev/projects/1', closed: false }, items: issues.map(issue => ({ id: `item-${issue.nodeId}`, kind: 'issue', issueNodeId: issue.nodeId, archived: false, fields: [{ id: 'status', name: 'Status', type: 'single-select', value: 'Todo' }], fieldsPartial: false })), issues, observedAt: issue.observedAt, ...(nextCursor ? { nextCursor } : {}) } }
const port: GitHubSourcePort = { list: async () => ({ identity, items: [issue], observedAt: issue.observedAt }), detail: async () => ({ identity, issue }), project: async () => page([issue]) }
function complete(result: WorkResult) { expect(result.status).toBe('completed'); if (result.status !== 'completed') throw Error(JSON.stringify(result)); return result }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function transaction(directory: string): SourceTransaction {
  const file = join(directory, 'work-v3.json')
  return apply => withFileLock(file, async () => {
    const state = snapshotSchema.parse(JSON.parse(await readFile(file, 'utf8')))
    const result = await apply(state)
    await writeFileAtomic(file, JSON.stringify(snapshotSchema.parse(state)), { mode: 0o600, dirMode: 0o700 })
    return result
  })
}
async function setup(sourcePort: GitHubSourcePort = port) {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-project-source-')); roots.push(directory)
  const app = new WorkApplication(directory, host, sourcePort)
  const project = complete(await app.execute({ type: 'project.create', commandId: 'project', name: 'Domain project' }, actor)).project!
  const source = complete(await app.execute({ type: 'source.configure-project', commandId: 'source', projectId: project.id, githubProject: { owner: 'a2d2-dev', type: 'org', number: 1 } }, actor)).source!
  return { app, directory, source, project, transaction: transaction(directory) }
}
const query = (source: WorkSource, refresh = false) => ({ type: 'source.issues' as const, projectId: source.projectId, sourceId: source.id, page: 1, perPage: 20, assignee: '@me' as const, state: 'open' as const, refresh })
afterEach(async () => {
  vi.useRealTimers()
  for (const directory of roots.splice(0)) { if (!resolve(directory).startsWith(join(tmpdir(), 'a2d2-project-source-'))) throw Error('Unexpected test cleanup path'); await rm(directory, { recursive: true, force: true }) }
})

it('publishes only complete scans, persists partial cursors across restart, honors retries, and creates no Tasks', async () => {
  let time = Date.now(), phase = 0, calls = 0
  const updated = { ...issue, title: 'Updated', updatedAt: '2026-10-21T00:00:00Z' }, second = { ...issue, nodeId: 'I_2', number: 2, url: 'https://github.com/a2d2-dev/one/issues/2' }
  const sourcePort: GitHubSourcePort = { ...port, project: async (_, request) => {
    calls++
    if (phase === 0) return page([issue])
    if (!request.cursor) return page([updated], 'next')
    expect(request.cursor).toBe('next')
    if (phase === 1) throw new SourceError('github-rate-limited', 'Try later', new Date(time + 60_000).toISOString())
    return page([updated, second]) // repeated item across pages is still one membership
  } }
  const state = await setup(sourcePort), options = { now: () => time, force: true, maxPagesPerSource: 1 }
  await reconcileProjectSources(state.transaction, sourcePort, options)
  expect(complete(await state.app.query(query(state.source), actor)).page?.items).toEqual([issue])
  phase = 1
  await reconcileProjectSources(state.transaction, sourcePort, options)
  expect(complete(await state.app.query(query(state.source), actor)).page?.items[0]?.title).toBe('Issue 1')
  const coldTransaction = transaction(state.directory)
  await reconcileProjectSources(coldTransaction, sourcePort, options)
  const cached = complete(await new WorkApplication(state.directory, host).query(query(state.source), actor))
  expect(cached.source).toMatchObject({ discovery: { state: 'error', checkpoint: { cursor: 'next', pages: 1 } }, lastError: { code: 'github-rate-limited' } })
  expect(cached.page?.items[0]?.title).toBe('Issue 1')
  const before = calls
  await reconcileProjectSources(coldTransaction, sourcePort, options)
  expect(calls).toBe(before)
  phase = 2; time += 60_001
  await reconcileProjectSources(coldTransaction, sourcePort, options)
  const result = complete(await state.app.query(query(state.source), actor))
  expect(result.page?.items.map(item => item.nodeId)).toEqual(['I_1', 'I_2'])
  expect(result.page?.items[0]?.title).toBe('Updated')
  expect(result.source?.discovery).toMatchObject({ state: 'idle', failures: 0 })
  expect(result.source?.discovery?.checkpoint).toBeUndefined()
  expect(result.source?.lastError).toBeUndefined()
  expect(complete(await state.app.query({ type: 'project.detail', projectId: state.project.id }, actor)).tasks).toEqual([])
})

it('recovers an expired persisted reader lease and rejects the old reader after the new scan commits', async () => {
  let time = Date.now(), slow = false
  const started = deferred<void>(), remote = deferred<GitHubProjectPage>()
  const sourcePort = { ...port, project: async () => { if (!slow) return page([issue]); started.resolve(); return remote.promise } }
  const state = await setup(sourcePort), options = { force: true, now: () => time }
  await reconcileProjectSources(state.transaction, sourcePort, options)
  slow = true
  const old = reconcileProjectSources(state.transaction, sourcePort, options)
  await started.promise
  expect(complete(await state.app.query(query(state.source), actor)).page?.items).toEqual([issue])
  time += 90_001
  const newer = { ...issue, title: 'Recovered reader', updatedAt: '2026-10-21T00:00:00Z' }
  await reconcileProjectSources(transaction(state.directory), { ...port, project: async () => page([newer]) }, options)
  remote.resolve(page([{ ...issue, title: 'Expired reader' }]))
  await old
  expect(complete(await state.app.query(query(state.source), actor)).page?.items[0]?.title).toBe('Recovered reader')
})

it('drops an invalid persisted cursor and restarts safely without replacing the old list with a partial scan', async () => {
  let phase = 0, time = Date.now()
  const cursors: (string | undefined)[] = []
  const sourcePort = { ...port, project: async (_: unknown, request: { cursor?: string }) => {
    cursors.push(request.cursor)
    if (phase === 0) return page([issue])
    if (phase === 1 && !request.cursor) return page([{ ...issue, title: 'Partial' }], 'stale')
    if (phase === 1) throw new SourceError('github-cursor-invalid', 'Cursor expired')
    expect(request.cursor).toBeUndefined()
    return page([{ ...issue, title: 'Fresh full scan' }])
  } }
  const state = await setup(sourcePort), options = { force: true, now: () => time, maxPagesPerSource: 1 }
  await reconcileProjectSources(state.transaction, sourcePort, options)
  phase = 1
  await reconcileProjectSources(state.transaction, sourcePort, options)
  await reconcileProjectSources(transaction(state.directory), sourcePort, options)
  const retained = complete(await state.app.query(query(state.source), actor))
  expect(retained.page?.items[0]?.title).toBe('Issue 1')
  expect(retained.source?.discovery?.checkpoint).toBeUndefined()
  phase = 2; time += 5001
  await reconcileProjectSources(transaction(state.directory), sourcePort, { ...options, force: false })
  expect(cursors).toEqual([undefined, undefined, 'stale', undefined])
  expect(complete(await state.app.query(query(state.source), actor)).page?.items[0]?.title).toBe('Fresh full scan')
})

it('fences concurrent consumers and late pages after disable/re-enable while retaining the previous list', async () => {
  const started = deferred<void>(), response = deferred<GitHubProjectPage>()
  let slow = false, calls = 0
  const sourcePort = { ...port, project: async () => { calls++; if (slow) { started.resolve(); return response.promise }; return page([issue]) } }
  const state = await setup(sourcePort)
  await reconcileProjectSources(state.transaction, sourcePort, { force: true })
  slow = true
  const running = reconcileProjectSources(state.transaction, sourcePort, { force: true })
  await started.promise
  await reconcileProjectSources(transaction(state.directory), sourcePort, { force: true })
  expect(calls).toBe(2)
  await state.app.execute({ type: 'source.set-enabled', commandId: 'disable', projectId: state.project.id, sourceId: state.source.id, expectedVersion: 1, enabled: false }, actor)
  await state.app.execute({ type: 'source.set-enabled', commandId: 'enable', projectId: state.project.id, sourceId: state.source.id, expectedVersion: 2, enabled: true }, actor)
  response.resolve(page([{ ...issue, title: 'Must not commit' }]))
  await running
  expect(complete(await state.app.query(query(state.source), actor)).page?.items[0]?.title).toBe('Issue 1')
})

it('reuses canonical Issue work across repository and Project sources, retaining accepted text after reassignment and removal', async () => {
  let current = page([issue])
  const sourcePort = { ...port, project: async () => current }, state = await setup(sourcePort)
  const repo = complete(await state.app.execute({ type: 'source.configure', commandId: 'repo', projectId: state.project.id, repository: issue.repository }, actor)).source!
  await state.app.query(query(repo, true), actor)
  const imported = complete(await state.app.execute({ type: 'source.import', commandId: 'import-repo', projectId: state.project.id, sourceId: repo.id, nodeId: issue.nodeId }, actor))
  await state.app.query(query(state.source, true), actor)
  const again = complete(await state.app.execute({ type: 'source.import', commandId: 'import-project', projectId: state.project.id, sourceId: state.source.id, nodeId: issue.nodeId }, actor))
  expect(again.ref).toEqual(imported.ref)
  expect(again.binding?.sourceIds).toEqual([repo.id, state.source.id])
  current = page([{ ...issue, assignees: [], body: 'Remote changed', updatedAt: '2026-10-21T00:00:00Z' }])
  expect(complete(await state.app.query(query(state.source, true), actor)).page?.items).toEqual([])
  const task = complete(await state.app.query({ type: 'task.detail', ref: imported.ref! }, actor))
  expect(task.task?.specification.text).toBe('Original source')
  expect(task.bindings?.[0]?.lastObserved.body).toBe('Remote changed')
  current = page([])
  await state.app.query(query(state.source, true), actor)
  expect(complete(await state.app.query({ ...query(state.source), assignee: '*' }, actor)).page?.items).toEqual([])
  expect(complete(await state.app.query({ type: 'task.detail', ref: imported.ref! }, actor)).task?.id).toBe(imported.ref?.taskId)
  expect(complete(await state.app.query({ type: 'project.detail', projectId: state.project.id }, actor)).tasks).toHaveLength(1)
})

it('uses node identity for same-number Project Issues and retains parent/subissue observations', async () => {
  const other = { ...issue, nodeId: 'I_other', repository: { owner: 'a2d2-dev', repository: 'two' }, url: 'https://github.com/a2d2-dev/two/issues/1' }
  const sourcePort = { ...port, project: async () => page([issue, other]) }, state = await setup(sourcePort)
  await state.app.query(query(state.source, true), actor)
  expect(await state.app.query({ type: 'source.issue', projectId: state.project.id, sourceId: state.source.id, number: 1 }, actor)).toMatchObject({ status: 'failed', error: { code: 'source-issue-ambiguous' } })
  expect(await state.app.query({ type: 'source.issue', projectId: state.project.id, sourceId: state.source.id, number: 1, nodeId: 'I_other' }, actor)).toMatchObject({ status: 'completed', issue: { nodeId: 'I_other', parent: null, subIssues: { totalCount: 0 } } })
})

it('honors scheduled due times and discards a partial scan when the credential identity changes', async () => {
  let time = Date.now() + 1000, calls = 0, changed = false
  const sourcePort = { ...port, project: async (_: unknown, request: { cursor?: string }) => {
    calls++
    if (!request.cursor) return page([issue], changed ? 'next' : undefined)
    return { ...page([issue]), identity: { ...identity, nodeId: 'U_other', login: 'other' } }
  } }
  const state = await setup(sourcePort), options = { now: () => time, intervalMs: 1000, maxPagesPerSource: 1 }
  await reconcileProjectSources(state.transaction, sourcePort, options)
  await reconcileProjectSources(state.transaction, sourcePort, options)
  expect(calls).toBe(1)
  changed = true; time += 1001
  await reconcileProjectSources(state.transaction, sourcePort, options)
  await reconcileProjectSources(state.transaction, sourcePort, options)
  const result = complete(await state.app.query(query(state.source), actor))
  expect(result.source?.lastError?.code).toBe('github-identity-changed')
  expect(result.source?.discovery?.checkpoint).toBeUndefined()
  expect(result.page?.identity).toEqual(identity)
  expect(result.page?.items).toEqual([issue])
  await state.app.execute({ type: 'source.set-enabled', commandId: 'disable-due', projectId: state.project.id, sourceId: state.source.id, expectedVersion: 1, enabled: false }, actor)
  const before = calls
  time += 100_000
  await reconcileProjectSources(state.transaction, sourcePort, { ...options, force: true })
  expect(calls).toBe(before)
})

function nativeReference(value: GitHubIssue) { return { nodeId: value.nodeId, number: value.number, title: value.title, url: value.url, repository: value.repository, state: value.state } }
function nativePair(mode: 'parent-only' | 'child-only' | 'both' = 'both') {
  const parent = structuredClone(issue), child = { ...structuredClone(issue), nodeId: 'I_child', number: 2, title: 'Child', url: 'https://github.com/a2d2-dev/one/issues/2' }
  if (mode !== 'child-only') parent.subIssues = { items: [nativeReference(child)], totalCount: 1, hasNextPage: false }
  if (mode !== 'parent-only') child.parent = nativeReference(parent)
  return { parent, child }
}
it.each([['parent-first', 'parent-only'], ['child-first', 'parent-only'], ['parent-first', 'child-only'], ['child-first', 'child-only']] as const)('links native Tasks %s with %s observations and deduplicates repeated imports', async (order, mode) => {
  const { parent, child } = nativePair(mode), sourcePort = { ...port, project: async () => page([parent, child]) }, state = await setup(sourcePort)
  await state.app.query(query(state.source, true), actor)
  expect(complete(await state.app.query({ type: 'project.detail', projectId: state.project.id }, actor)).tasks).toEqual([])
  const accept = (nodeId: string, commandId: string) => state.app.execute({ type: 'source.import', projectId: state.project.id, sourceId: state.source.id, nodeId, commandId }, actor)
  const first = complete(await accept(order === 'parent-first' ? parent.nodeId : child.nodeId, 'first'))
  expect(first.task?.parent).toBeUndefined()
  expect(first.task?.children).toEqual([])
  const second = complete(await accept(order === 'parent-first' ? child.nodeId : parent.nodeId, 'second'))
  const parentRef = order === 'parent-first' ? first.ref! : second.ref!, childRef = order === 'parent-first' ? second.ref! : first.ref!
  const parentTask = complete(await state.app.query({ type: 'task.detail', ref: parentRef }, actor)).task!
  const childTask = complete(await state.app.query({ type: 'task.detail', ref: childRef }, actor)).task!
  expect(parentTask.children).toEqual([childRef]); expect(childTask.parent).toEqual(parentRef)
  await accept(parent.nodeId, 'repeat-parent'); await accept(child.nodeId, 'repeat-child')
  expect(complete(await state.app.query({ type: 'task.detail', ref: parentRef }, actor)).task).toEqual(parentTask)
  expect(complete(await state.app.query({ type: 'task.detail', ref: childRef }, actor)).task).toEqual(childTask)
  expect(complete(await state.app.query({ type: 'project.detail', projectId: state.project.id }, actor)).tasks).toHaveLength(2)
})

it('links an existing repository-imported canonical child when its Project parent is explicitly imported', async () => {
  const { parent, child } = nativePair('parent-only'), sourcePort = { ...port, list: async () => ({ identity, items: [child], observedAt: child.observedAt }), project: async () => page([parent, child]) }, state = await setup(sourcePort)
  const repo = complete(await state.app.execute({ type: 'source.configure', commandId: 'repo-child', projectId: state.project.id, repository: child.repository }, actor)).source!
  await state.app.query(query(repo, true), actor)
  const existing = complete(await state.app.execute({ type: 'source.import', commandId: 'existing-child', projectId: state.project.id, sourceId: repo.id, nodeId: child.nodeId }, actor))
  await state.app.query(query(state.source, true), actor)
  expect(complete(await state.app.query({ type: 'task.detail', ref: existing.ref! }, actor)).task?.parent).toBeUndefined()
  const acceptedParent = complete(await state.app.execute({ type: 'source.import', commandId: 'project-parent', projectId: state.project.id, sourceId: state.source.id, nodeId: parent.nodeId }, actor))
  expect(acceptedParent.task?.children).toEqual([existing.ref])
  expect(complete(await state.app.query({ type: 'task.detail', ref: existing.ref! }, actor)).task?.parent).toEqual(acceptedParent.ref)
})

it('keeps refreshed native hierarchy observational until an explicit re-import accepts the relationship', async () => {
  const { parent, child } = nativePair()
  let related = false
  const sourcePort = { ...port, project: async () => page(related ? [parent, child] : [{ ...parent, subIssues: { items: [], totalCount: 0, hasNextPage: false } }, { ...child, parent: null }]) }, state = await setup(sourcePort)
  await state.app.query(query(state.source, true), actor)
  const accept = (nodeId: string, commandId: string) => state.app.execute({ type: 'source.import', projectId: state.project.id, sourceId: state.source.id, nodeId, commandId }, actor)
  const first = complete(await accept(parent.nodeId, 'unrelated-parent')), second = complete(await accept(child.nodeId, 'unrelated-child'))
  related = true
  await state.app.query(query(state.source, true), actor)
  expect(complete(await state.app.query({ type: 'task.detail', ref: second.ref! }, actor)).task?.parent).toBeUndefined()
  const accepted = complete(await accept(child.nodeId, 'accept-native-relation'))
  expect(accepted.ref).toEqual(second.ref)
  expect(accepted.task?.parent).toEqual(first.ref)
  expect(complete(await state.app.query({ type: 'task.detail', ref: first.ref! }, actor)).task?.children).toEqual([second.ref])
  expect(complete(await state.app.query({ type: 'project.detail', projectId: state.project.id }, actor)).tasks).toHaveLength(2)
})

it('rejects native cycles without persisting a second Task or partial parent changes', async () => {
  const { parent, child } = nativePair('child-only'); parent.parent = nativeReference(child)
  const sourcePort = { ...port, project: async () => page([parent, child]) }, state = await setup(sourcePort)
  await state.app.query(query(state.source, true), actor)
  const first = complete(await state.app.execute({ type: 'source.import', commandId: 'cycle-first', projectId: state.project.id, sourceId: state.source.id, nodeId: parent.nodeId }, actor))
  expect(await state.app.execute({ type: 'source.import', commandId: 'cycle-second', projectId: state.project.id, sourceId: state.source.id, nodeId: child.nodeId }, actor)).toMatchObject({ status: 'conflict', error: { code: 'source-hierarchy-conflict' } })
  expect(complete(await state.app.query({ type: 'project.detail', projectId: state.project.id }, actor)).tasks).toEqual([first.task])
  expect(complete(await state.app.query({ type: 'source.issue', projectId: state.project.id, sourceId: state.source.id, nodeId: child.nodeId, number: child.number }, actor)).bindings).toEqual([])
})

it('preserves an explicitly established local parent when a conflicting native parent is imported', async () => {
  const { parent, child } = nativePair(), sourcePort = { ...port, project: async () => page([parent, child]) }, state = await setup(sourcePort)
  await state.app.query(query(state.source, true), actor)
  const imported = complete(await state.app.execute({ type: 'source.import', commandId: 'child-before-conflict', projectId: state.project.id, sourceId: state.source.id, nodeId: child.nodeId }, actor))
  const local = complete(await state.app.execute({ type: 'task.create', commandId: 'local-parent', projectId: state.project.id, title: 'Accepted local parent', goal: 'Keep relationship', specification: 'User decision', acceptance: ['Preserve child'] }, actor)).task!
  const localRef = { projectId: state.project.id, taskId: local.id }
  complete(await state.app.execute({ type: 'task.link-child', commandId: 'local-link', ref: localRef, expectedVersion: local.version, child: imported.ref!, childExpectedVersion: imported.task!.version }, actor))
  const before = complete(await state.app.query({ type: 'project.detail', projectId: state.project.id }, actor)).tasks
  expect(await state.app.execute({ type: 'source.import', commandId: 'conflicting-native-parent', projectId: state.project.id, sourceId: state.source.id, nodeId: parent.nodeId }, actor)).toMatchObject({ status: 'conflict', error: { code: 'source-hierarchy-conflict' } })
  expect(complete(await state.app.query({ type: 'project.detail', projectId: state.project.id }, actor)).tasks).toEqual(before)
})

it('keeps a native relative owned by another Project as a source reference without copying or cross-linking', async () => {
  const { parent, child } = nativePair(), sourcePort = { ...port, project: async () => page([parent, child]) }, state = await setup(sourcePort)
  await state.app.query(query(state.source, true), actor)
  const first = complete(await state.app.execute({ type: 'source.import', commandId: 'foreign-parent', projectId: state.project.id, sourceId: state.source.id, nodeId: parent.nodeId }, actor))
  const secondProject = complete(await state.app.execute({ type: 'project.create', commandId: 'second-project', name: 'Second local Project' }, actor)).project!
  const secondSource = complete(await state.app.execute({ type: 'source.configure-project', commandId: 'second-source', projectId: secondProject.id, githubProject: { owner: 'a2d2-dev', type: 'org', number: 1 } }, actor)).source!
  await state.app.query(query(secondSource, true), actor)
  const second = complete(await state.app.execute({ type: 'source.import', commandId: 'foreign-child', projectId: secondProject.id, sourceId: secondSource.id, nodeId: child.nodeId }, actor))
  expect(second.task?.parent).toBeUndefined()
  expect(second.binding?.accepted.parent?.nodeId).toBe(parent.nodeId)
  expect(complete(await state.app.query({ type: 'task.detail', ref: first.ref! }, actor)).task?.children).toEqual([])
  expect(complete(await state.app.query({ type: 'project.detail', projectId: state.project.id }, actor)).tasks).toHaveLength(1)
  expect(complete(await state.app.query({ type: 'project.detail', projectId: secondProject.id }, actor)).tasks).toHaveLength(1)
})

it('runs lifecycle discovery without a browser, never overlaps, and joins pending work on disposal', async () => {
  vi.useFakeTimers()
  const work = deferred<void>(), started = deferred<void>()
  let calls = 0
  const stop = startProjectDiscovery({ pollMs: 10, reconcile: async () => { calls++; started.resolve(); await work.promise } })
  await started.promise
  await vi.advanceTimersByTimeAsync(100)
  expect(calls).toBe(1)
  let stopped = false
  const disposal = stop().then(() => { stopped = true })
  await Promise.resolve()
  expect(stopped).toBe(false)
  work.resolve(); await disposal
  await vi.advanceTimersByTimeAsync(100)
  expect(calls).toBe(1)
})
