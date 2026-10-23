import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import { applyObservedIssue } from '../src/work-sources/observations.ts'
import type { GitHubIssue, GitHubSourcePort } from '../src/work-sources/types.ts'
import type { WorkResult, WorkTask } from '../src/work-types.ts'

const roots: string[] = []
const operator = { operator: true }
const noHost = { resources: async () => [], sessions: async () => [] }
const identity = { login: 'imneov', nodeId: 'U_1', name: 'LiuFeng' }
const repository = { owner: 'a2d2-dev', repository: 'dsh-plugin' }
const base: GitHubIssue = {
  nodeId: 'I_160', url: 'https://github.com/a2d2-dev/dsh-plugin/issues/160', number: 160,
  title: 'A', body: 'Fixture A', repository, state: 'open', labels: [], assignees: ['imneov'],
  updatedAt: '2026-10-22T02:10:41Z', observedAt: '2026-10-22T08:19:20.516Z',
  subIssues: { items: [], totalCount: 0, hasNextPage: false },
}
function completed(result: WorkResult) {
  expect(result.status).toBe('completed')
  if (result.status !== 'completed') throw new Error(JSON.stringify(result))
  return result
}
afterEach(async () => { for (const root of roots.splice(0)) { if (!root.startsWith(join(tmpdir(), 'a2d2-observe-'))) throw new Error('Unsafe cleanup'); await rm(root, { recursive: true, force: true }) } })

it('keeps the richer observation when an equal-version list scan arrives without native children', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-observe-')); roots.push(directory)
  let listing: GitHubIssue = base
  const port: GitHubSourcePort = {
    list: async () => ({ identity, items: [listing], observedAt: listing.observedAt }),
    detail: async () => ({ identity, issue: base }),
  }
  const app = new WorkApplication(directory, noHost, port)
  const project = completed(await app.execute({ type: 'project.create', commandId: 'project', name: 'observe' }, operator)).project!
  const source = completed(await app.execute({ type: 'source.configure', commandId: 'source', projectId: project.id, repository }, operator)).source!
  const page = { type: 'source.issues' as const, projectId: project.id, sourceId: source.id, refresh: true, page: 1, perPage: 20, assignee: '*', state: 'open' as const }
  completed(await app.query(page, operator))
  const task = completed(await app.execute({ type: 'source.import', commandId: 'import', projectId: project.id, sourceId: source.id, nodeId: base.nodeId }, operator)).task! as WorkTask
  const observed = async () => completed(await app.query({ type: 'task.detail', ref: { projectId: task.projectId, taskId: task.id } }, operator)).bindings![0]!.lastObserved
  expect(await observed()).toMatchObject({ observedAt: base.observedAt, updatedAt: base.updatedAt, subIssues: base.subIssues })

  // A continuous candidate/catalog scan of the same version carries no native children.
  listing = { ...base, observedAt: '2026-10-22T08:25:20.404Z', subIssues: undefined }
  completed(await app.query(page, operator))
  expect(await observed()).toMatchObject({ observedAt: base.observedAt, updatedAt: base.updatedAt, subIssues: base.subIssues })

  // A genuinely newer version replaces the observation but never drops the known child list.
  listing = { ...base, updatedAt: '2026-10-22T09:00:00Z', observedAt: '2026-10-22T09:00:01Z', subIssues: undefined }
  completed(await app.query(page, operator))
  expect(await observed()).toMatchObject({ observedAt: '2026-10-22T09:00:01Z', updatedAt: '2026-10-22T09:00:00Z', subIssues: base.subIssues })
})

it('never replaces a newer observation with an older or equal list scan', () => {
  expect(applyObservedIssue(base, { ...base, updatedAt: base.updatedAt, observedAt: 'later' })).toBeUndefined()
  expect(applyObservedIssue(base, { ...base, updatedAt: '2026-10-22T01:00:00Z' })).toBeUndefined()
  expect(applyObservedIssue(undefined, { ...base })).toEqual(base)
  expect(applyObservedIssue(base, { ...base, updatedAt: '2026-10-22T09:00:00Z', subIssues: undefined })).toMatchObject({ updatedAt: '2026-10-22T09:00:00Z', subIssues: base.subIssues })
  expect(applyObservedIssue({ ...base, subIssues: undefined }, { ...base, updatedAt: '2026-10-22T09:00:00Z', subIssues: undefined })).toMatchObject({ subIssues: undefined })
})
