import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalJobs from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import Subagents from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { WorkApplication } from '../src/work.ts'
import { RuntimeHost } from '../src/task-runtime/host.ts'
import { installWorkTools } from '../src/work-execution/tools.ts'
import { installWorkProgressTools } from '../src/work-progress-tools.ts'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import type { PublicJobRegistry } from '../src/work-execution/job-observation.ts'
import type { GitHubIssue, GitHubSourcePort } from '../src/work-sources/types.ts'
import type { WorkResult } from '../src/work-types.ts'
const operator = { operator: true }
const ok = (result: WorkResult) => { if (result.status !== 'completed') throw Error(JSON.stringify(result)); return result }
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve }); return { promise, release } }

it('collects real native notices and job_output before a new accountable completion releases the continuous slot', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal), native = gate(), job = gate(), parallel = gate()
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    await h.ctx.plugin(LocalJobs)
    await h.ctx.plugin(ToolJobs, { completionDelivery: 'quiet' })
    await h.ctx.plugin(Subagents, { maxActiveSubagents: 8, maxDepth: 1 })
    h.ctx.subagents.registerProvider({ name: 'fresh-local', capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, inheritsParentContext: false,
      async prepareContinuable() { return {} }, async start() { throw Error('Only native continuable creation is used') } })
    const nativeStarted = gate(), parallelStarted = gate()
    for (const [name, work, started] of [['hold_native', native, nativeStarted], ['hold_parallel', parallel, parallelStarted]] as const) {
      h.ctx.tools.register(defineTool({ name, description: 'Deterministic required result producer', parameters: {},
        output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
        async execute() { started.release(); await work.promise; return { result: `${name} verification passed` } } }))
    }
    const identity = { login: 'developer', nodeId: 'U_developer', name: null }, repository = { owner: 'example', repository: 'repo' }
    const issues: GitHubIssue[] = [1, 2].map(number => ({ nodeId: `I_${number}`, number, url: `https://github.com/example/repo/issues/${number}`, title: `Required work ${number}`, body: 'Verify collected native and background results.', repository, state: 'open', labels: [], assignees: [identity.login], observedAt: '2026-10-21T00:01:00Z', updatedAt: '2026-10-21T00:00:00Z', subIssues: { items: [], totalCount: 0, hasNextPage: false } }))
    let closes = 0
    const source: GitHubSourcePort = {
      list: async () => ({ identity, items: issues, observedAt: issues[0]!.observedAt }),
      detail: async (_, number) => ({ identity, issue: issues.find(issue => issue.number === number)! }),
      project: async () => ({ identity, project: { nodeId: 'PVT_fixture', title: 'Required work', url: 'https://github.com/orgs/example/projects/1', closed: false }, items: issues.map(issue => ({ id: `item:${issue.nodeId}`, kind: 'issue', issueNodeId: issue.nodeId, archived: false, fields: [], fieldsPartial: false })), issues, observedAt: issues[0]!.observedAt }),
      close: async target => { closes++; issues.find(issue => issue.nodeId === target.nodeId)!.state = 'closed'; return { status: 'closed' } },
    }
    const app = new WorkApplication(h.app.directory, h.host, source)
    installWorkProgressTools(h.ctx, app, 'runtime')
    installWorkTools(h.ctx, app, 'runtime')
    const connected = ok(await app.execute({ type: 'source.connect', commandId: 'connect', githubProject: { owner: 'example', type: 'org', number: 1 } }, operator))
    const projectId = connected.project!.id, sourceId = connected.source!.id
    ok(await app.query({ type: 'source.issues', projectId, sourceId, page: 1, perPage: 20, assignee: '@me', state: 'open', refresh: true }, operator))
    const options = ok(await app.query({ type: 'source.execution-options', projectId, sourceId }, operator)).executionOptions!
    ok(await app.execute({ type: 'continuous.configure', commandId: 'enable', projectId, sourceId, expectedVersion: 0, assignee: '@me', labels: [], resource: options.resources[0]!.ref, model: options.defaults.model, agentPreset: options.defaults.agentPreset, permissionPreset: options.defaults.permissionPreset, enabled: true }, operator))
    const rule = () => app.query({ type: 'continuous.status', projectId, sourceId }, operator).then(ok)
    const ref = (await rule()).continuousRule!.active!
    const detail = () => app.query({ type: 'task.detail', ref }, operator).then(ok)
    const execution = (await detail()).execution!, agent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
    await fixtures.run(() => agent.whenIdle())
    const registry = h.ctx.jobs as unknown as PublicJobRegistry
    expect(typeof registry.observe).toBe('function')
    expect(typeof Reflect.get(agent.session, 'appendIgnorable')).toBe('function')
    const require = createRequire(import.meta.url)
    const resolved = Object.fromEntries(['@deepseek-ai/dsh-session', '@deepseek-ai/dsh-jobs', '@deepseek-ai/dsh-jobs-local', '@deepseek-ai/dsh-tool-jobs'].map(name => [name, require.resolve(name)]))
    for (const path of Object.values(resolved)) expect(path).toContain('file+packages+')
    console.log('Matched Host 8282d612 module provenance', JSON.stringify(resolved))
    ok(await app.sessionOrganize(execution.session, 'specification', { kind: 'specification', expectedVersion: (await detail()).task!.version, goal: 'verify', specification: 'Verify all collected results.', acceptance: ['native and job results verified'] }))
    const parent = ok(await app.execute({ type: 'task.create', commandId: 'parent', projectId, title: 'Parent acceptance', goal: 'Collect accepted child results', specification: 'Child must independently pass', acceptance: ['child passed'] }, operator)).task!
    const parentRef = { projectId, taskId: parent.id }
    ok(await app.execute({ type: 'task.link-child', commandId: 'link-child', ref: parentRef, expectedVersion: parent.version, child: ref, childExpectedVersion: (await detail()).task!.version }, operator))
    const report = { specificationVersion: 2, stage: 'done', summary: 'Verified collected native and job results', next: '', blockers: [], criteria: [{ index: 0, passed: true, evidence: ['Native verification output and job_output result were reviewed'] }], closeExternal: true }
    const runTool = async (name: string, arguments_: Record<string, unknown>, text: string) => {
      h.model.nextTool = { name, arguments: arguments_ }
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await fixtures.run(() => agent.whenIdle())
    }
    h.model.nextTool = { name: 'hold_native', arguments: {} }
    const child = await h.ctx.subagents.startContinuable({ provider: 'fresh-local', label: 'required verification', request: { parent: agent, prompt: [{ type: 'text', text: 'Produce the required verification result.' }] }, signal: signal! })
    await nativeStarted.promise
    const jobId = h.ctx.jobs.start({ kind: 'bash', label: 'required background verification', owner: agent.id, run: () => ({ cancel() { job.release() }, done: job.promise.then(() => ({ status: 'completed' as const, result: 'background verification passed' })) }) })
    const receipt = () => registry.observe!(jobId, agent.id)
    await runTool('work_report', { report }, 'Attempt acceptance before the required native and job results are collected.')
    expect((await detail()).task!.completion).toBeUndefined()
    expect(JSON.stringify(await new RuntimeHost(h.ctx).events(agent.id))).toContain('completion-results-unsettled')
    expect(ok(await app.query({ type: 'task.detail', ref: parentRef }, operator)).task!.childCompletions).toBeUndefined()
    expect(closes).toBe(0)
    expect((await rule()).continuousRule!.active).toEqual(ref)
    native.release()
    await fixtures.run(() => h.ctx.agents.get(child.childId)!.whenIdle())
    await expect.poll(async () => (await h.host.execution.observation!(execution)).sessions.find(row => row.role === 'current')!.children).toContainEqual(expect.objectContaining({ result: 'consumed', session: { runtimeId: 'runtime', sessionId: child.childId } }))
    job.release()
    await h.ctx.jobs.wait(jobId, 1000, agent.id)
    expect(receipt().terminalResult).toBe('pending')
    await runTool('work_report', { report }, 'Attempt acceptance with returned but uncollected job output.')
    expect((await detail()).task!.completion).toBeUndefined()
    expect(receipt().terminalResult).toBe('pending')
    expect(closes).toBe(0)
    await runTool('job_output', { job_id: jobId, wait: true, timeout_ms: 1000 }, 'Collect the necessary background verification result.')
    expect(receipt().terminalResult).toBe('collected')
    const events = await new RuntimeHost(h.ctx).events(agent.id)
    expect(events.some(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled' && event.data.source.senderSessionId === child.childId)).toBe(true)
    expect(events.some(event => event.type === 'jobs/collected')).toBe(true)
    expect(JSON.stringify(events)).toContain('background verification passed')
    expect((await detail()).task!.completion).toBeUndefined()
    const inFlight = fixtures.run(() => h.ctx.tools.execute({ callId: ToolCallId('parallel-required-result'), name: 'hold_parallel', arguments: {}, agent, signal: signal! }))
    await parallelStarted.promise
    await runTool('work_report', { report }, 'An unrelated necessary tool is still active; do not treat all current Session work as the reporter.')
    expect((await detail()).task!.completion).toBeUndefined()
    expect(JSON.stringify(await new RuntimeHost(h.ctx).events(agent.id))).toContain('tool-result-pending')
    parallel.release(); await inFlight
    await app.reconcileCompletions()
    expect((await detail()).task!.completion).toBeUndefined()
    await runTool('work_report', { report }, 'Review the newly collected outputs and explicitly confirm acceptance now.')
    expect((await detail()).task!.completion).toBeDefined()
    expect(ok(await app.query({ type: 'task.detail', ref: parentRef }, operator)).task!.childCompletions).toHaveLength(1)
    h.model.nextTool = { name: 'work_control', arguments: { action: 'wait', text: 'Second queued Task started and awaits its independent acceptance.' } }
    await app.reconcileControls()
    const nextRef = (await rule()).continuousRule!.items[1]!.ref!
    const nextExecution = ok(await app.query({ type: 'task.detail', ref: nextRef }, operator)).execution!
    await fixtures.run(() => h.ctx.agents.get(SessionId(nextExecution.session.sessionId))!.whenIdle())
    await app.reconcileControls()
    const final = await detail()
    expect(final.task!.completion!.closeout.status).toBe('settled')
    expect(final.execution).toMatchObject({ id: execution.id, owner: execution.owner, epoch: execution.epoch, session: execution.session })
    expect(closes).toBe(1)
    const finalRule = (await rule()).continuousRule!
    expect(finalRule.items[0]!.state).toBe('completed')
    expect(finalRule.items[1]!.state).toBe('waiting')
    expect(ok(await app.query({ type: 'task.detail', ref: nextRef }, operator)).execution!.control).toMatchObject({ action: 'wait', reason: 'Second queued Task started and awaits its independent acceptance.' })
    expect(nextExecution.session).not.toEqual(execution.session)
    expect(finalRule.items[1]!.ref).toBeDefined()
    expect(finalRule.items[1]!.ref).not.toEqual(ref)
    expect(ok(await app.query({ type: 'project.detail', projectId }, operator)).tasks).toHaveLength(3)
    expect(await app.sessionControl(execution.session, 'late', 'resume', 'more')).toMatchObject({ status: 'failed', error: { code: 'continuous-completed' } })
    const beforeConversation = h.model.requests.length
    const question = createUserMessage({ content: [{ type: 'text', text: 'Explain the completed result without starting it again.' }], source: { kind: 'user' } })
    agent.followup(question)
    await fixtures.run(() => agent.whenIdle())
    expect(h.model.requests).toHaveLength(beforeConversation + 1)
    expect(h.model.requests.at(-1)!.messages).toContainEqual(expect.objectContaining({ id: question.id, content: question.content }))
    await app.reconcileControls()
    expect(h.model.requests).toHaveLength(beforeConversation + 1)
    expect(closes).toBe(1)
    expect((await detail()).task!.completion).toEqual(final.task!.completion)
    expect(ok(await app.query({ type: 'task.detail', ref: parentRef }, operator)).task!.childCompletions).toHaveLength(1)
    expect((await rule()).continuousRule!.items[1]!.state).toBe('waiting')
    await fixtures.run(() => h.ctx.sessions.flush(agent.session))
    await using handle = await h.ctx.sessionPersistence.open(agent.id, 'read')
    const persisted = await handle.read()
    const input = persisted.events.find(event => event.type === 'user/message' && event.data.id === question.id)!
    expect(input).toMatchObject({ data: { content: question.content } })
    expect(persisted.events.filter(event => event.type === 'user/message' && event.data.id === question.id)).toHaveLength(1)
    expect(persisted.events.findLast(event => event.type === 'assistant/message')!.seq).toBeGreaterThan(input.seq)
    expect(persisted.events.findLast(event => event.type === 'assistant/message')).toMatchObject({ data: { message: { content: [{ type: 'text', text: 'Recorded work progress' }] } } })
  } finally { native.release(); job.release(); parallel.release(); await fixtures.close() }
})
