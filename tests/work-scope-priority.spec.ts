import { afterEach, beforeEach, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { installWorkTools } from '../src/work-execution/tools.ts'
import { installWorkOrganizationTools } from '../src/work-organization-tools.ts'
import type { WorkCompleted, WorkResult } from '../src/work-types.ts'

let fixtures: ExecutionFixtures
const operator = { operator: true }
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())
function completed(result: WorkResult): WorkCompleted {
  if (result.status !== 'completed') throw Error(JSON.stringify(result))
  return result
}
async function setup() {
  const h = await fixtures.mount(await fixtures.root())
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const project = completed(await h.app.execute({ type: 'project.create', commandId: 'project', name: 'Scope priority', resource }, operator)).project!
  const task = completed(await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.id, title: 'Verify the current image', goal: 'Verify installation and cleanup',
    specification: 'Use the current environment; record exact counts and image provenance.', acceptance: ['Installation and cleanup verified', 'Exact counts and image provenance verified', 'Preserve data outside the authorized scope'] }, operator)).task!
  const ref = { projectId: project.id, taskId: task.id }
  installWorkTools(h.ctx, h.app, 'runtime')
  installWorkOrganizationTools(h.ctx, h.app, 'runtime')
  const execution = completed(await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: task.version, resource, agentId: project.defaultAgentId,
    agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)).execution!
  const agent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
  await fixtures.run(() => agent.whenIdle())
  return { ...h, task, ref, execution, agent }
}

// These assertions verify the assembled instruction contract, not model decisions.
it('assembles current-goal ordering and explicit revision instructions in the real startup request', async () => {
  const h = await setup()
  const prompt = JSON.stringify(h.model.requests[0]!.messages)
  expect(prompt).toContain('按真实业务依赖先取得可行结果')
  expect(prompt).toContain('同步 todo 计划、work_organize 持久规格与派发')
  expect(prompt).toContain('被明确修订替代的旧条款保留历史，不再作为当前门槛')
  expect(prompt).toContain('未获用户明确修订时保留原验收')
})

it('exposes explicit user revisions and history preservation in the registered organize tool description', async () => {
  const h = await setup()
  const description = h.model.requests[0]!.tools!.find(tool => tool.name === 'work_organize')!.description
  expect(description).toContain('Explicit user revisions supersede the affected old criteria')
  expect(description).toContain('sync the todo plan, persistent specification and dispatches')
  expect(description).toContain('retain superseded requirements and the revision basis in history')
  expect(description).toContain('Without an explicit revision, preserve original acceptance')
})
