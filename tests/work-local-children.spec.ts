import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkApplication } from '../src/work.ts'
import type { WorkCompleted, WorkResult } from '../src/work-types.ts'

const operator = { operator: true }
const noHost = { resources: async () => [], sessions: async () => [] }
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
function ok(result: WorkResult): WorkCompleted { if (result.status !== 'completed') throw Error(JSON.stringify(result)); return result }

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'work-local-child-')); roots.push(root)
  const app = new WorkApplication(join(root, 'work'), noHost)
  const project = ok(await app.execute({ type: 'project.create', commandId: 'project', name: 'local' }, operator)).project!
  const task = ok(await app.execute({ type: 'task.create', commandId: 'task', projectId: project.id, title: 'parent', goal: 'finish', specification: 'verify', acceptance: ['verified'] }, operator)).task!
  return { root, app, project, task, ref: { projectId: project.id, taskId: task.id } }
}

it('refuses to create a local-only child task and keeps the task tree unchanged', async () => {
  const { app, ref } = await setup()
  expect(await app.execute({ type: 'task.create-child', commandId: 'child', ref, expectedVersion: 1,
    title: 'child', goal: 'g', specification: 's', acceptance: ['a'] }, operator))
    .toMatchObject({ status: 'failed', error: { code: 'local-subtask-not-supported' } })
  expect(ok(await app.query({ type: 'task.detail', ref }, operator)).task!.children).toEqual([])
})

it('refuses to link a local task as a child without a primary-store sub-issue record', async () => {
  const { app, project, ref } = await setup()
  const other = ok(await app.execute({ type: 'task.create', commandId: 'other', projectId: project.id,
    title: 'other', goal: 'g', specification: 's', acceptance: ['a'] }, operator)).task!
  expect(await app.execute({ type: 'task.link-child', commandId: 'link', ref, expectedVersion: 1,
    child: { projectId: project.id, taskId: other.id }, childExpectedVersion: 1 }, operator))
    .toMatchObject({ status: 'failed', error: { code: 'subtask-not-in-primary-store' } })
  expect(ok(await app.query({ type: 'task.detail', ref }, operator)).task!.children).toEqual([])
})

it('drops an unstarted legacy local child on load so it can never gate the parent', async () => {
  const { root, project, ref } = await setup()
  // Simulate what an earlier build wrote: a local child with no binding, execution,
  // progress or completion, plus a requirement block that referenced it.
  const file = join(root, 'work', 'work-v3.json')
  const snapshot = JSON.parse(await readFile(file, 'utf8')) as { tasks: Record<string, unknown>[] }
  const parent = snapshot.tasks.find(task => task.id === ref.taskId) as Record<string, unknown>
  const childId = '11111111-1111-4111-8111-111111111111'
  snapshot.tasks.push({ ...structuredClone(parent), id: childId, title: 'legacy child', version: 1,
    children: [], sessions: [], parent: ref, activity: [{ commandId: 'legacy', type: 'task.organize-child', version: 1 }] })
  parent.children = [{ projectId: project.id, taskId: childId }]
  parent.breakdown = [{ id: 'block', title: 'block', description: 'legacy child block', status: 'done', evidence: [], child: { projectId: project.id, taskId: childId } }]
  parent.version = (parent.version as number) + 1
  await writeFile(file, JSON.stringify(snapshot))

  const reloaded = new WorkApplication(join(root, 'work'), noHost)
  const detail = ok(await reloaded.query({ type: 'task.detail', ref }, operator))
  expect(detail.task!.children).toEqual([])
  expect(detail.task!.breakdown).toMatchObject([{ id: 'block' }])
  expect(detail.task!.breakdown[0]!.child).toBeUndefined()
  expect(ok(await reloaded.query({ type: 'project.detail', projectId: project.id }, operator)).tasks!.map(task => task.id)).not.toContain(childId)
})
