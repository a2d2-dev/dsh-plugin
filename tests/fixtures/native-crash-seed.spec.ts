import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import Subagents from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mountExecution } from '../work-execution-fixture.ts'

// Separate worker dies while a genuine native tool is unfinished. No session
// events are edited and no in-process mock supplies the orphaned execution.
it.skipIf(!process.env.A2D2_NATIVE_CRASH_PATH)('persists a real unfinished native execution before host loss', async () => {
  const path = process.env.A2D2_NATIVE_CRASH_PATH!
  const h = await mountExecution(path, 'read-only')
  await h.ctx.plugin(Subagents, { maxActiveSubagents: 8, maxDepth: 1 })
  h.ctx.subagents.registerProvider({ name: 'fresh-local', capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, inheritsParentContext: false,
    async prepareContinuable() { return {} }, async start() { throw Error('Only native continuable creation is used') } })
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  h.ctx.tools.register(defineTool({ name: 'crash_native', description: 'Work interrupted by host loss', parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
    async execute() { entered(); await new Promise(() => {}); return { result: 'unreachable' } } }))
  const operator = { operator: true }, resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const p = await h.app.execute({ type: 'project.create', commandId: 'project', name: 'cold native', resource }, operator)
  if (p.status !== 'completed' || !p.project) throw Error(JSON.stringify(p))
  const t = await h.app.execute({ type: 'task.create', commandId: 'task', projectId: p.project.id, title: 'cold native', goal: 'verify', specification: 'Resume unfinished child', acceptance: ['verified'] }, operator)
  if (t.status !== 'completed' || !t.task) throw Error(JSON.stringify(t))
  const ref = { projectId: p.project.id, taskId: t.task.id }
  const e = await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: 1, resource, agentId: p.project.defaultAgentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'read-only' }, operator)
  if (e.status !== 'completed' || !e.execution) throw Error(JSON.stringify(e))
  const parent = h.ctx.agents.get(SessionId(e.execution.session.sessionId))!
  await parent.whenIdle()
  h.model.nextTool = { name: 'crash_native', arguments: {} }
  const child = await h.ctx.subagents.startContinuable({ provider: 'fresh-local', label: 'orphaned verification', request: { parent, prompt: [{ type: 'text', text: 'Verify before host loss' }] }, signal: new AbortController().signal })
  await started
  await h.ctx.sessions.flush(parent.session)
  await h.ctx.sessions.flush(h.ctx.agents.get(child.childId)!.session)
  await writeFile(join(path, 'crash-seed.json'), JSON.stringify({ execution: e.execution, childId: child.childId, ref }))
  process.kill(process.pid, 'SIGKILL')
})
