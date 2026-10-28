import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { humanGuardIntent } from '../src/work-execution/guard.ts'
import { ExecutionFixtures } from './work-execution-fixture.ts'

const message = (text: string) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

it.each(['算了，你这个会话你直接关闭吧。', '结束当前会话', '关闭这个会话', '结束本会话'])('honors the direct user session closure request: %s', text => {
  expect(humanGuardIntent([message(text)])).toEqual({ answerOnly: true, recheckWait: false })
})

it.each([
  '关闭某个窗口，然后继续工作',
  '关闭这个 Issue，然后继续工作',
  '关闭当前连接，然后继续工作',
  '不要关闭当前会话，继续工作',
  '别结束这个会话，继续工作',
  '不是只回答，要继续做',
])('does not treat business actions or negated stops as session closure: %s', text => {
  expect(humanGuardIntent([message(text)]).answerOnly).toBe(false)
})

it.each([
  '历史记录说“算了，你这个会话你直接关闭吧。”，现在是什么状态？',
  '之前说「结束当前会话」，现在是什么状态？',
  '之前说"关闭这个会话"，现在是什么状态？',
])('ignores historical quoted session closure: %s', text => {
  expect(humanGuardIntent([message(text)])).toEqual({ answerOnly: false, recheckWait: true })
})

it.each(['a2d2-work-context', 'schedule'])('ignores session closure in non-user input from %s', kind => {
  expect(humanGuardIntent([{ ...message('结束当前会话'), source: { kind } }])).toEqual({ answerOnly: false, recheckWait: false })
})

let fixtures: ExecutionFixtures
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())

it.each(['算了，你这个会话你直接关闭吧。', '结束当前会话', '关闭这个会话'])('adds no continuation correction and does not end or complete the task after: %s', async text => {
  const root = await fixtures.root()
  const h = await fixtures.mount(root, 'danger-full-access', true)
  const operator = { operator: true }
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const project = await h.app.execute({ type: 'project.create', commandId: 'project', name: 'Stop intent', resource }, operator)
  if (project.status !== 'completed' || !project.project) throw Error('Missing project')
  const task = await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.project.id, title: 'Unfinished work', goal: 'Produce proof', specification: 'Read dependency and write proof', acceptance: ['Proof matches dependency'] }, operator)
  if (task.status !== 'completed' || !task.task) throw Error('Missing task')
  const ref = { projectId: project.project.id, taskId: task.task.id }
  await writeFile(join(root, 'dependency.txt'), 'READY')
  h.model.nextTool = { name: 'read', arguments: { file_path: 'dependency.txt' } }
  const start = await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: 1, resource, agentId: project.project.defaultAgentId,
    agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'danger-full-access' }, operator)
  if (start.status !== 'completed' || !start.execution) throw Error('Missing execution')
  const agent = h.ctx.agents.get(SessionId(start.execution.session.sessionId))!
  await fixtures.run(() => agent.whenIdle())
  const requests = h.model.requests.length
  const calls = agent.session.snapshotEvents().filter(event => event.type === 'tool/call').length
  agent.followup(message(text))
  await fixtures.run(() => agent.whenIdle())
  expect(h.model.requests).toHaveLength(requests + 1)
  expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/call')).toHaveLength(calls)
  const execution = await h.app.query({ type: 'task.execution', ref }, operator)
  if (execution.status !== 'completed' || !execution.execution) throw Error('Missing execution')
  expect(execution.execution.control).toBeUndefined()
  const detail = await h.app.query({ type: 'task.detail', ref }, operator)
  if (detail.status !== 'completed' || !detail.task) throw Error('Missing task detail')
  expect(detail.task.completion).toBeUndefined()
}, 15000)
