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
