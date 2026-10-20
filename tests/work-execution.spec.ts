import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkApplication } from '../src/work.ts'

const roots: string[] = []
const operator = { operator: true }
const resource = { ref: { runtimeId: 'runtime', workspaceId: 'workspace' }, title: 'Actual resource' }
const host = { resources: async () => [resource], sessions: async () => [] }
afterEach(async () => {
  for (const path of roots.splice(0)) {
    if (!path.startsWith(join(tmpdir(), 'a2d2-execution-'))) throw new Error('Unexpected cleanup path')
    await rm(path, { recursive: true, force: true })
  }
})
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-execution-'))
  roots.push(directory)
  const app = new WorkApplication(directory, host)
  const p = await app.execute({ type: 'project.create', commandId: 'project', name: 'Coordination', resource: resource.ref }, operator)
  if (p.status !== 'completed' || !p.project) throw new Error('Missing project')
  const t = await app.execute({ type: 'task.create', commandId: 'task', projectId: p.project.id, title: 'First', goal: 'One owner', specification: 'Persist execution before host effects', acceptance: ['No double owner'] }, operator)
  if (t.status !== 'completed' || !t.task) throw new Error('Missing task')
  return { directory, app, ref: { projectId: p.project.id, taskId: t.task.id }, agentId: p.project.defaultAgentId }
}
it('durably accepts one execution for competing starts and command replay without claiming it has run', async () => {
  const { directory, app, ref, agentId } = await setup()
  const command = { type: 'task.start', commandId: 'start-one', ref, expectedVersion: 1, resource: resource.ref,
    agentId, agentPreset: 'workspace-agent', model: { provider: 'fixture', model: 'model' }, permissionPreset: 'read-only' }
  const results = await Promise.all([app.execute(command, operator), new WorkApplication(directory, host).execute({ ...command, commandId: 'start-two' }, operator)])
  expect(results).toEqual([expect.objectContaining({ status: 'completed', execution: expect.objectContaining({ state: 'accepted', epoch: 1, agentId, ref }) }), expect.objectContaining({ status: 'completed', execution: expect.objectContaining({ state: 'accepted', epoch: 1, agentId, ref }) })])
  const one = results[0] as any
  expect((results[1] as any).execution.id).toBe(one.execution.id)
  expect(await new WorkApplication(directory, host).execute(command, operator)).toEqual(one)
  expect(await app.query({ type: 'task.execution', ref }, operator)).toMatchObject({ status: 'completed', execution: { id: one.execution.id, state: 'accepted', owner: one.execution.owner } })
})
