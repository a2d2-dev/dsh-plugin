import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'

const roots: string[] = []
const operator = { operator: true } as const
const noHost = { resources: async () => [], sessions: async () => [] }
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), 'a2d2-work-'))) throw new Error('Unexpected cleanup path')
    await rm(root, { recursive: true, force: true })
  }
})
async function open() {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-work-'))
  roots.push(directory)
  return { directory, app: new WorkApplication(directory, noHost) }
}

it('reloads an independent local project, default Project Agents and complete Task through work commands and queries', async () => {
  const { directory, app } = await open()
  const created = await app.execute({ type: 'project.create', commandId: 'create-project', name: 'Offline work' }, operator)
  expect(created.status).toBe('completed')
  if (created.status !== 'completed' || !created.project) throw new Error('Expected project')
  const project = created.project
  const saved = await app.execute({ type: 'task.create', commandId: 'create-task', projectId: project.id,
    title: 'Design local work', goal: 'Keep accepted work available offline', specification: 'No Issue, repository or Session required',
    acceptance: ['Stable identities after reload', 'Complete specification retained'] }, operator)
  expect(saved.status).toBe('completed')
  if (saved.status !== 'completed' || !saved.task) throw new Error('Expected task')
  const reloaded = new WorkApplication(directory, noHost)
  const detail = await reloaded.query({ type: 'task.detail', ref: { projectId: project.id, taskId: saved.task.id } }, operator)
  expect(detail).toMatchObject({ status: 'completed', task: {
    id: saved.task.id, projectId: project.id, goal: 'Keep accepted work available offline',
    specification: { version: 1, text: 'No Issue, repository or Session required', acceptance: ['Stable identities after reload', 'Complete specification retained'] },
    agentId: project.defaultAgentId,
  } })
  const view = await reloaded.query({ type: 'project.detail', projectId: project.id }, operator)
  expect(view).toMatchObject({ status: 'completed', project, agents: [expect.objectContaining({ projectId: project.id, role: 'coordinator' })] })
})

it('deduplicates concurrent commands across application instances and reload, without overwriting same-name projects', async () => {
  const { directory, app } = await open()
  const command = { type: 'project.create', commandId: 'retry-create', name: 'Same name' }
  const results = await Promise.all(Array.from({ length: 6 }, () => new WorkApplication(directory, noHost).execute(command, operator)))
  expect(results.every(result => result.status === 'completed')).toBe(true)
  const ids = results.map(result => result.status === 'completed' ? result.project?.id : undefined)
  expect(new Set(ids).size).toBe(1)
  expect(await new WorkApplication(directory, noHost).execute(command, operator)).toEqual(results[0])
  expect(await app.execute({ ...command, name: 'Different content' }, operator)).toMatchObject({ status: 'conflict', error: { code: 'command-id-reused' } })
  await app.execute({ ...command, commandId: 'another-create' }, operator)
  const projects = await app.query({ type: 'projects.list' }, operator)
  expect(projects.status === 'completed' && projects.projects).toHaveLength(2)
  expect(await app.execute(command, { operator: false })).toMatchObject({ status: 'failed', error: { code: 'forbidden' } })
})

async function createWork(app: WorkApplication, key = 'work') {
  const projectResult = await app.execute({ type: 'project.create', commandId: `${key}-project`, name: 'Local project' }, operator)
  if (projectResult.status !== 'completed' || !projectResult.project) throw new Error('Expected project')
  const result = await app.execute({ type: 'task.create', commandId: `${key}-task`, projectId: projectResult.project.id,
    title: 'Local task', goal: 'Original goal', specification: 'Original specification', acceptance: ['Original criterion'] }, operator)
  if (result.status !== 'completed' || !result.task) throw new Error('Expected task')
  return { project: projectResult.project, task: result.task, ref: { projectId: projectResult.project.id, taskId: result.task.id } }
}

it('updates specifications with versioned acceptance while concurrent stale edits cannot replace accepted work', async () => {
  const { directory, app } = await open()
  const { ref } = await createWork(app)
  const command = { type: 'task.update-spec', commandId: 'edit-spec', ref, expectedVersion: 1,
    goal: 'Revised goal', specification: 'Revised specification', acceptance: ['Revised criterion'] }
  const results = await Promise.all([app.execute(command, operator),
    new WorkApplication(directory, noHost).execute({ ...command, commandId: 'competing-edit' }, operator)])
  expect(results.filter(result => result.status === 'completed')).toHaveLength(1)
  expect(results.filter(result => result.status === 'conflict')).toMatchObject([{ error: { code: 'version-conflict', currentVersion: 2 } }])
  const detail = await new WorkApplication(directory, noHost).query({ type: 'task.detail', ref }, operator)
  expect(detail).toMatchObject({ status: 'completed', task: { version: 2, goal: 'Revised goal',
    specification: { version: 2, text: 'Revised specification', acceptance: ['Revised criterion'] },
    specificationHistory: [{ version: 1, text: 'Original specification', acceptance: ['Original criterion'] }] } })
})

it('creates local children through parent TaskRef and rejects foreign links and cycles before changing work', async () => {
  const { directory, app } = await open()
  const { ref } = await createWork(app)
  const created = await app.execute({ type: 'task.create-child', commandId: 'create-child', ref, expectedVersion: 1,
    title: 'Independent child', goal: 'Child goal', specification: 'Child specification', acceptance: ['Child accepted'] }, operator)
  expect(created).toMatchObject({ status: 'completed', task: { parent: ref, title: 'Independent child' } })
  if (created.status !== 'completed' || !created.task) throw new Error('Expected child')
  const childRef = { projectId: ref.projectId, taskId: created.task.id }
  const reload = new WorkApplication(directory, noHost)
  expect(await reload.query({ type: 'task.detail', ref }, operator)).toMatchObject({ status: 'completed', task: { version: 2, children: [childRef] }, children: [{ id: childRef.taskId }] })
  const foreign = await createWork(app, 'foreign')
  expect(await app.execute({ type: 'task.link-child', commandId: 'foreign-child', ref, expectedVersion: 2, child: foreign.ref, childExpectedVersion: 1 }, operator))
    .toMatchObject({ status: 'failed', error: { code: 'cross-project-reference' } })
  expect(await app.execute({ type: 'task.link-child', commandId: 'cycle', ref: childRef, expectedVersion: 1, child: ref, childExpectedVersion: 2 }, operator))
    .toMatchObject({ status: 'failed', error: { code: 'task-cycle' } })
  expect(await app.query({ type: 'task.detail', ref: { ...ref, taskId: foreign.task.id } }, operator))
    .toMatchObject({ status: 'failed', error: { code: 'unknown-task' } })
  const spare = await app.execute({ type: 'task.create', commandId: 'spare-task', projectId: ref.projectId,
    title: 'Existing child', goal: 'Existing goal', specification: 'Existing spec', acceptance: ['Accepted'] }, operator)
  if (spare.status !== 'completed' || !spare.task) throw new Error('Expected task')
  expect(await app.execute({ type: 'task.link-child', commandId: 'link-existing', ref, expectedVersion: 2,
    child: { projectId: ref.projectId, taskId: spare.task.id }, childExpectedVersion: 1 }, operator)).toMatchObject({ status: 'completed', task: { version: 3 } })
})

it('persists requirement breakdown independently of child Tasks and rejects duplicate block identities', async () => {
  const { directory, app } = await open()
  const { ref } = await createWork(app)
  const blocks = [{ id: 'storage', title: 'Persist accepted work', description: 'Retain local facts' },
    { id: 'host', title: 'Resolve host resources', description: 'Read approved workspace identities' }]
  expect(await app.execute({ type: 'task.replace-breakdown', commandId: 'breakdown', ref, expectedVersion: 1, blocks }, operator))
    .toMatchObject({ status: 'completed', task: { version: 2, breakdown: blocks, children: [], sessions: [] } })
  expect(await app.execute({ type: 'task.replace-breakdown', commandId: 'duplicate-blocks', ref, expectedVersion: 2, blocks: [blocks[0], blocks[0]] }, operator))
    .toMatchObject({ status: 'failed', error: { code: 'duplicate-block' } })
  expect(await new WorkApplication(directory, noHost).query({ type: 'task.detail', ref }, operator))
    .toMatchObject({ status: 'completed', task: { version: 2, breakdown: blocks } })
})
