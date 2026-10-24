import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import type { NativeWorkMessage } from '../src/work-types.ts'

let fixtures: ExecutionFixtures
const operator = { operator: true }
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())
async function setup() {
  const h = await fixtures.mount(await fixtures.root())
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const project = await h.app.execute({ type: 'project.create', commandId: 'project', name: 'Goal delivery', resource }, operator)
  if (project.status !== 'completed' || !project.project) throw new Error('Missing project')
  const task = await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.project.id, title: 'Goal lifecycle', goal: 'Avoid empty retries', specification: 'Goal driver owns round admission', acceptance: ['No stale Goal replays'] }, operator)
  if (task.status !== 'completed' || !task.task) throw new Error('Missing task')
  const ref = { projectId: project.project.id, taskId: task.task.id }
  const started = await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: 1, resource, agentId: project.project.defaultAgentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  if (started.status !== 'completed' || !started.execution) throw new Error('Missing execution')
  const execution = started.execution
  const agent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
  await fixtures.run(() => agent.whenIdle())
  const fence = { ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }
  return { ...h, agent, execution, fence }
}
function goalMessage(): NativeWorkMessage {
  // A captured Goal envelope; no model generation is needed to reject a stale reservation.
  return { id: 'stale-goal-round', role: 'user', content: [{ type: 'text', text: '<goal_round>Round: 1/18</goal_round>' }], source: { kind: 'goal', goalId: 'paused-goal', revision: 1, round: 1 } }
}
it('leaves rejected Goal rounds with their producer instead of retaining them as Task input', async () => {
  const h = await setup()
  await h.app.execute({ type: 'task.control', commandId: 'wait', ...h.fence, action: 'wait', text: 'Wait for approval' }, operator)
  h.agent.followup(goalMessage() as never)
  await fixtures.run(() => h.agent.whenIdle())
  const result = await h.app.query({ type: 'task.execution', ref: h.fence.ref }, operator)
  expect(result).toMatchObject({ execution: { state: 'waiting' } })
  if (result.status !== 'completed' || !result.execution) throw new Error('Missing execution')
  expect(result.execution.events.some(event => event.id === 'stale-goal-round')).toBe(false)
  expect(h.model.requests).toHaveLength(1)
})
it.each(['accepted', 'delivered'])('discards a previously %s Goal round without replaying empty turns and preserves human input', async delivery => {
  const h = await setup()
  // The real Goal driver rejects rounds with no live reservation. This listener
  // reproduces that downstream admission decision using the recorded envelope.
  h.ctx.on('agent/pre-step', async ({ messages }, next) => messages.some(message => message.source.kind === ('goal' as string)) ? { kind: 'reject' } : next())
  const file = join(h.app.directory, 'work-v3.json')
  const snapshot = JSON.parse(await readFile(file, 'utf8'))
  const execution = snapshot.executions.find((item: { id: string }) => item.id === h.execution.id)
  execution.events.push({ id: 'stale-goal-round', text: 'Round: 1/18', kind: 'input', delivery, acceptance: 'unassessed', nativeMessage: goalMessage() })
  await writeFile(file, JSON.stringify(snapshot))
  const turnsBefore = h.agent.session.snapshotEvents().filter(event => event.type === 'turn/start').length
  for (let i = 0; i < 3; i++) {
    await h.app.reconcileControls()
    await fixtures.run(() => h.agent.whenIdle())
  }
  expect(h.agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(turnsBefore)
  const persisted = JSON.parse(await readFile(file, 'utf8'))
  expect(persisted.executions.find((item: { id: string }) => item.id === h.execution.id).events.find((event: { id: string }) => event.id === 'stale-goal-round')).toMatchObject({ delivery: 'discarded' })
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Explain the current state' }], source: { kind: 'user' } }))
  await fixtures.run(() => h.agent.whenIdle())
  expect(h.model.requests).toHaveLength(2)
})
