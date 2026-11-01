import { mkdtemp, readFile, readdir, rm, writeFile, stat, symlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import { WorkDao } from '../src/work-store/dao.ts'
import type { GitHubIssue, GitHubSourcePort } from '../src/work-sources/types.ts'
import type { WorkExecution } from '../src/work-types.ts'

const roots: string[] = [], actor = { operator: true }, host = { resources: async () => [], sessions: async () => [] }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'source-storage-')); roots.push(directory)
  const app = new WorkApplication(directory, host), dao = WorkDao.forDirectory(directory)
  const created = await app.execute({ type: 'project.create', commandId: 'project', name: 'Storage' }, actor)
  if (created.status !== 'completed' || !created.project) throw Error('Missing project')
  await app.execute({ type: 'source.configure-project', commandId: 'source', projectId: created.project.id, githubProject: { owner: 'a2d2-dev', type: 'org', number: 1 } }, actor)
  const file = join(directory, 'work-v3.json'), archive = join(directory, 'work-v3.archive')
  return { directory, dao, file, archive, project: created.project }
}
const checkpoint = { sourceVersion: 1, startedAt: '2026-11-01T00:00:00Z', pages: 1, cursor: 'next', items: [], issues: [] }
const issue: GitHubIssue = { nodeId: 'I_1', number: 1, title: 'Issue', body: 'kept', repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' }, url: 'https://github.com/a2d2-dev/dsh-plugin/issues/1', state: 'open', labels: [], assignees: [], updatedAt: checkpoint.startedAt, observedAt: checkpoint.startedAt }

it.each(['inline', 'v1'] as const)('exports exactly the same data across %s checkpoint migration, then writes progress alone', async format => {
  const { directory, dao, file, archive } = await setup()
  await dao.transaction(async state => { state.sources[0]!.observations = [{ issue, sequence: 1 }]; state.sources[0]!.discovery!.checkpoint = checkpoint })
  const baseline = await dao.exportSnapshot()
  if (format === 'inline') await writeFile(file, JSON.stringify(baseline))
  else {
    const state = JSON.parse(await readFile(file, 'utf8')), source = baseline.sources[0]!
    const body = { observations: source.observations, pages: source.pages, checkpoint: source.discovery!.checkpoint }
    const ref = `${randomUUID()}.json`; await writeFile(join(archive, ref), JSON.stringify(body))
    state.storage.sources[source.id] = ref; delete state.storage.checkpoints
    await writeFile(file, JSON.stringify(state))
  }
  await dao.migrate()
  expect(await dao.exportSnapshot()).toEqual(baseline)
  const migrated = JSON.parse(await readFile(file, 'utf8')), sourceId = baseline.sources[0]!.id
  const before = new Set(await readdir(archive))
  await dao.transaction(async state => { state.sources[0]!.discovery!.checkpoint!.pages++; state.sources[0]!.discovery!.checkpoint!.cursor = 'after-reload' })
  const saved = JSON.parse(await readFile(file, 'utf8'))
  expect(saved.storage.sources[sourceId]).toBe(migrated.storage.sources[sourceId])
  const added = (await readdir(archive)).filter(file => !before.has(file))
  expect(added).toEqual([saved.storage.checkpoints[sourceId]])
  expect((await stat(join(archive, added[0]!))).size).toBeLessThan(500)
  // A copied directory creates a fresh DAO and proves cold reload/resume.
  const cold = await mkdtemp(join(tmpdir(), 'source-storage-')); roots.push(cold)
  const { cp } = await import('node:fs/promises'); await cp(directory, cold, { recursive: true })
  expect((await WorkDao.forDirectory(cold).read()).sources[0]!.discovery!.checkpoint).toMatchObject({ pages: 2, cursor: 'after-reload' })
  const control = await readFile(file, 'utf8'), files = await readdir(archive)
  await dao.transaction(async state => { void state.sources[0]!.observations; void state.sources[0]!.discovery!.checkpoint })
  expect(await readFile(file, 'utf8')).toBe(control); expect(await readdir(archive)).toEqual(files)
})

it('collects only unreachable UUID blobs and preserves receipt histories, screening chains and the latest checkpoint', async () => {
  const { dao, file, archive, directory, project } = await setup()
  const review = { version: 1, key: 'review', generatedAt: checkpoint.startedAt, ruleVersion: 1, sourceId: (await dao.read()).sources[0]!.id, sourceVersion: 1, basis: {}, authorization: {}, decisions: [] }
  const oldReview = await dao.archiveScreening(review), latestReview = await dao.archiveScreening({ ...review, version: 2 }, oldReview)
  const execution: WorkExecution = { id: randomUUID(), ref: { projectId: project.id, taskId: randomUUID() }, agentId: project.defaultAgentId, owner: randomUUID(), epoch: 1, resource: { runtimeId: 'host', workspaceId: 'workspace' }, session: { runtimeId: 'host', sessionId: 'session' }, sessionMode: 'create', agentPreset: 'test', model: { provider: 'test', model: 'test' }, permissionPreset: 'workspace-write', policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] }, state: 'waiting', events: [], history: [{ state: 'waiting', commandId: 'history-1' }] }
  // The receipt is a real schema-validated command result with a screening root.
  await dao.transaction(async state => {
    state.sources[0]!.discovery!.checkpoint = checkpoint
    state.executions.push(execution)
    dao.recordCommand(state, 'receipt-history', 'fingerprint', { status: 'completed', execution })
  })
  await dao.transaction(async state => { dao.appendHistory(state.executions[0]!, { state: 'ready', commandId: 'history-2' }); state.sources[0]!.observations = [{ issue, sequence: 1 }] })
  // Attach a screening root to the stored receipt's continuous rule via an existing valid fixture shape.
  const snapshot = JSON.parse(await readFile(file, 'utf8'))
  const receiptRef = snapshot.storage.receipts['receipt-history']
  const receipt = JSON.parse(await readFile(join(archive, receiptRef), 'utf8'))
  const rule = { id: randomUUID(), projectId: project.id, sourceId: review.sourceId, version: 1, enabled: false, scope: { assignee: '*' as const, labels: [] }, resource: execution.resource, model: execution.model, agentPreset: 'test', permissionPreset: 'workspace-write', items: [] }
  // Validate the receipt root using the actual public schema.
  const { continuousRuleSchema } = await import('../src/work-schema.ts')
  const parsedRule = continuousRuleSchema.parse({ ...rule, screeningReview: { version: 2, key: review.key, generatedAt: review.generatedAt, ruleVersion: 1, sourceId: review.sourceId, sourceVersion: 1, ref: latestReview, fingerprint: 'a'.repeat(64) } })
  receipt.result.continuousRule = parsedRule
  await writeFile(join(archive, receiptRef), JSON.stringify(receipt))
  const currentReview = await dao.archiveScreening({ ...review, version: 3 })
  await dao.transaction(async state => { state.continuousRules = [{ ...parsedRule, screeningReview: { ...parsedRule.screeningReview!, version: 3, ref: currentReview } }] })
  const stale = `${randomUUID()}.json`; await writeFile(join(archive, stale), 'unreachable body deliberately is not JSON')
  await writeFile(join(archive, 'manual.json'), 'leave me')
  const link = `${randomUUID()}.json`; await symlink(join(directory, 'work-v3.json'), join(archive, link))
  const baseline = await dao.exportSnapshot(), control = await readFile(file, 'utf8')
  const dry = await dao.collectArchives({ offline: true })
  expect(dry.reachable).toEqual(expect.arrayContaining([oldReview, latestReview, currentReview, receiptRef, snapshot.storage.checkpoints[review.sourceId]]))
  expect(dry.candidates.map(item => item.file)).toContain(stale)
  expect(dry.ignored).toEqual(expect.arrayContaining(['manual.json', link]))
  expect(await readFile(join(archive, stale), 'utf8')).toContain('unreachable')
  const applied = await dao.collectArchives({ offline: true, dryRun: false })
  await expect(stat(join(archive, stale))).rejects.toThrow()
  expect(await readFile(file, 'utf8')).toBe(control)
  expect(await dao.exportSnapshot()).toEqual(baseline)
  expect(JSON.parse(await readFile(applied.manifest, 'utf8')).candidateBytes).toBe(applied.candidateBytes)
})

it.each(['missing', 'corrupt', 'cycle', 'length'] as const)('fails closed before deletion on a %s reachable graph', async fault => {
  const { dao, file, archive } = await setup()
  const state = JSON.parse(await readFile(file, 'utf8'))
  const ref = `${randomUUID()}.json`, stale = `${randomUUID()}.json`
  await writeFile(join(archive, stale), 'unreachable')
  if (fault === 'missing') state.storage.sources[state.sources[0].id] = ref
  if (fault === 'corrupt') await writeFile(join(archive, state.storage.sources[state.sources[0].id]), '{invalid')
  if (fault === 'cycle' || fault === 'length') {
    await writeFile(join(archive, ref), JSON.stringify({ entries: [], ...(fault === 'cycle' ? { previous: ref } : {}) }))
    state.storage.histories.extra = { head: ref, length: 1 }
  }
  await writeFile(file, JSON.stringify(state))
  await expect(dao.collectArchives({ offline: true, dryRun: false })).rejects.toThrow()
  expect(await readFile(join(archive, stale), 'utf8')).toBe('unreachable')
})

it('persists a newly created discovery object and resumes actual pagination after cold reload', async () => {
  const { directory, dao, archive } = await setup()
  await dao.transaction(async state => { delete state.sources[0]!.discovery })
  const { reconcileProjectSources } = await import('../src/work-sources/discovery.ts')
  const identity = { login: 'lf', nodeId: 'U_1', name: null }, project = { nodeId: 'P_1', title: 'Project', url: 'https://github.com/orgs/a2d2-dev/projects/1', closed: false }
  const cursors: (string | undefined)[] = []
  const port: GitHubSourcePort = { list: async () => { throw Error('Unexpected repository list') }, detail: async () => { throw Error('Unexpected issue detail') }, project: async (_, request) => {
    cursors.push(request.cursor)
    return { identity, project, items: [], issues: [], observedAt: checkpoint.startedAt, ...(request.cursor ? {} : { nextCursor: 'second-page' }) }
  } }
  await reconcileProjectSources(apply => dao.transaction(apply), port, { force: true, maxPagesPerSource: 1 })
  const baseline = await dao.exportSnapshot()
  expect(baseline.sources[0]!.discovery!.checkpoint).toMatchObject({ cursor: 'second-page', pages: 1 })
  const cold = await mkdtemp(join(tmpdir(), 'source-storage-')); roots.push(cold)
  const { cp } = await import('node:fs/promises'); await cp(directory, cold, { recursive: true })
  const restarted = WorkDao.forDirectory(cold)
  await reconcileProjectSources(apply => restarted.transaction(apply), port, { force: true, maxPagesPerSource: 1 })
  expect(cursors).toEqual([undefined, 'second-page'])
  expect((await restarted.read()).sources[0]!.discovery!.checkpoint).toBeUndefined()
  expect((await restarted.read()).sources[0]!.projectSnapshot).toMatchObject({ project })
  expect((await readdir(archive)).length).toBeGreaterThan(0)
})

it('writes checkpoint append/update deltas, preserves chains through GC, and resets on reorder/removal', async () => {
  const { dao, file, archive, directory } = await setup()
  await dao.transaction(async state => { state.sources[0]!.discovery!.checkpoint = { ...checkpoint, issues: [issue] } })
  const sourceId = (await dao.read()).sources[0]!.id
  const initial = JSON.parse(await readFile(file, 'utf8')).storage.checkpoints[sourceId]
  const second = { ...issue, nodeId: 'I_2', number: 2, url: 'https://github.com/a2d2-dev/dsh-plugin/issues/2' }
  await dao.transaction(async state => { const pending = state.sources[0]!.discovery!.checkpoint!; pending.issues[0]!.body = 'updated'; pending.issues.push(second); pending.pages++ })
  const latest = JSON.parse(await readFile(file, 'utf8')).storage.checkpoints[sourceId]
  const chunk = JSON.parse(await readFile(join(archive, latest), 'utf8'))
  expect(chunk.previous).toBe(initial); expect(chunk.issues).toHaveLength(2)
  const report = await dao.collectArchives({ offline: true, dryRun: false })
  expect(report.reachable).toEqual(expect.arrayContaining([initial, latest]))
  const cold = await mkdtemp(join(tmpdir(), 'source-storage-')); roots.push(cold)
  const { cp } = await import('node:fs/promises'); await cp(directory, cold, { recursive: true })
  const restored = await WorkDao.forDirectory(cold).exportSnapshot()
  expect(restored).toEqual(await dao.exportSnapshot())
  for (const change of ['reorder', 'remove'] as const) {
    await dao.transaction(async state => { const pending = state.sources[0]!.discovery!.checkpoint!; if (change === 'reorder') pending.issues.reverse(); else pending.issues.pop() })
    const ref = JSON.parse(await readFile(file, 'utf8')).storage.checkpoints[sourceId]
    expect(JSON.parse(await readFile(join(archive, ref), 'utf8')).previous).toBeUndefined()
  }
  const after = await dao.collectArchives({ offline: true })
  expect(after.candidates.map(item => item.file)).toEqual(expect.arrayContaining([initial, latest]))
})

it.each(['missing', 'cycle', 'count'] as const)('fails closed on %s checkpoint chains without deleting garbage', async fault => {
  const { dao, file, archive } = await setup()
  await dao.transaction(async state => { state.sources[0]!.discovery!.checkpoint = { ...checkpoint, issues: [issue] } })
  const stored = JSON.parse(await readFile(file, 'utf8')), ref = stored.storage.checkpoints[stored.sources[0].id]
  const chunk = JSON.parse(await readFile(join(archive, ref), 'utf8'))
  if (fault === 'missing') chunk.previous = `${randomUUID()}.json`
  if (fault === 'cycle') chunk.previous = ref
  if (fault === 'count') chunk.issueCount++
  await writeFile(join(archive, ref), JSON.stringify(chunk))
  const garbage = `${randomUUID()}.json`; await writeFile(join(archive, garbage), 'garbage')
  await expect(dao.collectArchives({ offline: true, dryRun: false })).rejects.toThrow()
  expect(await readFile(join(archive, garbage), 'utf8')).toBe('garbage')
})

it('preserves historical project executionDefaults through read, migration, transaction and export', async () => {
  const { dao, file } = await setup()
  const baseline = await dao.exportSnapshot()
  const defaults = { resource: { runtimeId: 'host', workspaceId: 'workspace' }, model: { provider: 'test', model: 'test', reasoningEffort: 'medium' }, agentPreset: 'test', permissionPreset: 'workspace-write' }
  const fixture = { ...baseline, projects: baseline.projects.map(project => ({ ...project, executionDefaults: defaults })) }
  await writeFile(file, JSON.stringify(fixture))
  expect((await dao.read()).projects[0]).toMatchObject({ executionDefaults: defaults })
  await dao.migrate()
  expect(await dao.exportSnapshot()).toEqual(fixture)
  await dao.transaction(async state => { state.projects[0]!.name = 'Renamed with defaults preserved' })
  expect((await dao.exportSnapshot()).projects[0]).toMatchObject({ name: 'Renamed with defaults preserved', executionDefaults: defaults })
  const saved = JSON.parse(await readFile(file, 'utf8'))
  saved.projects[0].executionDefaults.unrecognized = true
  await writeFile(file, JSON.stringify(saved))
  await expect(dao.read()).rejects.toThrow()
})
