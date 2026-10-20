import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import type { GitHubIssue, GitHubSourcePort, WorkSource } from '../src/work-sources/types.ts'
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
