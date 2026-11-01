import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Subagents from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { installWorkControlRecovery, installWorkTools } from '../src/work-execution/tools.ts'
import { RuntimeHost } from '../src/task-runtime/host.ts'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import type { WorkResult } from '../src/work-types.ts'
const operator = { operator: true }
const ok = (result: WorkResult) => { if (result.status !== 'completed') throw Error(JSON.stringify(result)); return result }
const material = { body: 'Retain original accepted work.', decisions: 'Continue the same Task.', evidence: 'Native child still owes a result.', unfinished: 'Collect pending child work.', next: 'Use work_child_recover for the exact pending child.' }
const report = { specificationVersion: 1, stage: 'done' as const, summary: 'verified', next: '', blockers: [], criteria: [{ index: 0, passed: true, evidence: ['native result verified'] }] }

async function receiveChild(h: Awaited<ReturnType<ExecutionFixtures['mount']>>, agent: import('@deepseek-ai/dsh-agent').Agent, childId: string, epoch: number, fixtures: ExecutionFixtures) {
  const input = createUserMessage({ content: [{ type: 'text', text: 'Receive the exact child result completely.' }], source: { kind: 'user' } })
  let first = true
  h.model.selectTool = request => {
    if (request.sessionId !== agent.id || !request.messages.some(message => message.id === input.id)) return
    if (first) {
      first = false
      return { name: 'work_child_recover', arguments: { child_session_id: childId, action: 'result', expected_epoch: epoch } }
    }
    const output = request.messages.findLast(message => message.role === 'tool')
    if (!output) return
    const text = output.content.map(block => block.type === 'text' ? block.text : '').join('')
    let page: { nextCursor?: number; revision?: string }
    try { page = JSON.parse(text) } catch { return }
    if (page.nextCursor !== undefined) return { name: 'work_child_recover', arguments: { child_session_id: childId, action: 'result', expected_epoch: epoch, cursor: page.nextCursor, revision: page.revision } }
  }
  agent.followup(input)
  await fixtures.run(() => agent.whenIdle())
  h.model.selectTool = undefined
}

it('hands off while a real native child tool is running, receives its late result and preserves native delivery facts', { timeout: 20_000 }, async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  let release!: () => void
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    h.model.uniqueToolIds = true
    await h.ctx.plugin(Subagents, { maxActiveSubagents: 8, maxDepth: 1 })
    h.ctx.subagents.registerProvider({ name: 'fresh-local', capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, inheritsParentContext: false,
      async prepareContinuable() { return {} }, async start() { throw Error('Only native continuable creation is used') } })
    installWorkTools(h.ctx, h.app, 'runtime')
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    h.ctx.tools.register(defineTool({ name: 'hold_native', description: 'Real unfinished child work', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
      async execute() { entered(); await gate; return { result: 'late native verification passed' } } }))
    const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
    const project = ok(await h.app.execute({ type: 'project.create', commandId: 'project', name: 'pending child', resource }, operator)).project!
    const task = ok(await h.app.execute({ type: 'task.create', commandId: 'task', projectId: project.id, title: 'pending child', goal: 'verify', specification: 'native continuation', acceptance: ['verified'] }, operator)).task!
    const ref = { projectId: project.id, taskId: task.id }
    const execution = ok(await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: task.version, agentId: task.agentId, resource, model: { provider: 'contract', model: 'default' }, agentPreset: 'contract', permissionPreset: 'read-only' }, operator)).execution!
    const parent = h.ctx.agents.get(SessionId(execution.session.sessionId))!
    await fixtures.run(() => parent.whenIdle())
    h.model.nextTool = { name: 'hold_native', arguments: {} }
    const child = await fixtures.run(() => h.ctx.subagents.startContinuable({ provider: 'fresh-local', label: 'unfinished verification', request: { parent, prompt: [{ type: 'text', text: 'Produce native evidence' }] }, signal: signal! }))
    await started
    h.model.nextTool = { name: 'work_continuation_material', arguments: material }
    const command = { type: 'task.continue', commandId: 'continue-pending-child', ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }
    const reserved = ok(await h.app.execute(command, operator)).execution!
    expect(reserved.continuation!.error).toBeUndefined()
    await fixtures.run(() => parent.whenIdle())
    await fixtures.run(() => h.app.reconcileControls())
    let current = ok(await h.app.query({ type: 'task.execution', ref }, operator)).execution!
    expect(current).toMatchObject({ epoch: 2, continuation: { pendingChildren: [{ parent: execution.session, child: { runtimeId: 'runtime', sessionId: child.childId }, status: 'running', returned: false, result: 'pending', tools: [{ name: 'hold_native' }] }] } })
    const successor = h.ctx.agents.get(SessionId(current.session.sessionId))!
    await fixtures.run(() => successor.whenIdle())
    await fixtures.run(() => h.app.reconcileControls())
    current = ok(await h.app.query({ type: 'task.execution', ref }, operator)).execution!
    expect(current.continuation!.phase).toBe('received')
    const log = await new RuntimeHost(h.ctx).events(successor.id)
    expect(JSON.stringify(log)).toContain(child.childId)
    expect(JSON.stringify(log)).toContain('Unreturned child work')
    expect(await h.app.sessionReport(current.session, 'premature-done', report, 2)).toMatchObject({ status: 'failed', error: { code: 'completion-results-unsettled' } })
    expect(await h.app.sessionChildRecovery(current.session, 'running-no-replace', child.childId, 'replace', undefined, 2, signal!, 0, undefined, 'unused-replacement')).toMatchObject({ status: 'failed', error: { code: 'child-replacement-not-stopped' } })
    expect(await h.app.sessionChildRecovery(current.session, 'running-no-restart', child.childId, 'resume', 'Finish verification', 2, signal!)).toMatchObject({ status: 'completed', childStatus: 'running' })
    expect(await h.app.sessionControl(execution.session, 'retired-write', 'progress', 'No authority')).toMatchObject({ status: 'failed', error: { code: 'forbidden' } })
    await h.app.execute(command, operator)
    expect(ok(await h.app.query({ type: 'task.execution', ref }, operator)).execution!.epoch).toBe(2)
    release()
    await expect.poll(async () => (await new RuntimeHost(h.ctx).executionFacts(parent.id, 'runtime', 'retired')).children[0]?.returned).toBe(true)
    await fixtures.run(() => parent.whenIdle())
    expect(await h.app.sessionReport(current.session, 'still-unreceived', report, 2)).toMatchObject({ status: 'failed', error: { code: 'completion-results-unsettled' } })
    let page = await h.app.sessionChildRecovery(current.session, 'uncommitted-result-0', child.childId, 'result', undefined, 2, signal!)
    let pageIndex = 1
    while ('nextCursor' in page && page.nextCursor !== undefined) page = await h.app.sessionChildRecovery(current.session, `uncommitted-result-${pageIndex++}`, child.childId, 'result', undefined, 2, signal!, page.nextCursor, page.revision)
    const uncommitted = ok(await h.app.query({ type: 'task.execution', ref }, operator)).execution!
    expect((await h.host.execution.observation!(uncommitted)).settlement).toBe('pending')
    await receiveChild(h, successor, child.childId, 2, fixtures)
    const received = ok(await h.app.query({ type: 'task.execution', ref }, operator)).execution!
    expect(received.childReceipts).toMatchObject([{ child: { sessionId: child.childId }, complete: true, epoch: 2 }])
    const facts = await h.host.execution.observation!(received)
    expect(facts.settlement, JSON.stringify(facts)).toBe('settled')
    expect(facts.sessions.find(row => row.role === 'retired')!.children[0]!.result).toBe('consumed')
    expect(JSON.stringify(await new RuntimeHost(h.ctx).events(successor.id))).toContain('late native verification passed')
    expect((await new RuntimeHost(h.ctx).events(parent.id)).some(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled')).toBe(true)
    h.model.nextTool = { name: 'work_continuation_material', arguments: material }
    await h.app.execute({ type: 'task.continue', commandId: 'continue-already-received-child', ref, executionId: current.id, owner: current.owner, epoch: 2 }, operator)
    await fixtures.run(() => successor.whenIdle())
    await fixtures.run(() => h.app.reconcileControls())
    current = ok(await h.app.query({ type: 'task.execution', ref }, operator)).execution!
    expect(current.epoch).toBe(3)
    const third = h.ctx.agents.get(SessionId(current.session.sessionId))!
    await fixtures.run(() => third.whenIdle())
    await fixtures.run(() => h.app.reconcileControls())
    expect(await h.app.sessionReport(current.session, 'third-before-receipt', report, 3)).toMatchObject({ status: 'failed', error: { code: 'completion-results-unsettled' } })
    await receiveChild(h, third, child.childId, 3, fixtures)
    expect(await h.app.sessionReport(current.session, 'accepted-done', report, 3)).toMatchObject({ status: 'completed' })
    expect(await h.app.sessionChildRecovery(current.session, 'completed-resume', child.childId, 'resume', 'Should not run', 3, signal!)).toMatchObject({ status: 'failed', error: { code: 'task-completed' } })
  } finally { release?.(); await fixtures.close() }
})

it.for(['resume', 'replace', 'resume-wait', 'resume-wait-startup'] as const)('cold-recovers actual host-lost child work via %s without reviving old coordination', { timeout: 20_000 }, async (mode, { signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  let releaseRecovered = () => {}
  let releaseForeign = () => {}
  let foreignChildId: string | undefined
  try {
    const awaitingNotice = mode === 'resume-wait' || mode === 'resume-wait-startup'
    const { spawn } = await import('node:child_process')
    const { readFile, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const path = await fixtures.root()
    const processResult = await new Promise<{ code: number | null; log: string }>((resolve, reject) => {
      const child = spawn('pnpm', ['exec', 'vitest', 'run', 'tests/fixtures/native-crash-seed.spec.ts'], { cwd: process.cwd(), env: { ...process.env, A2D2_NATIVE_CRASH_PATH: path }, stdio: ['ignore', 'pipe', 'pipe'] })
      let log = ''
      child.stdout.on('data', data => { log += data })
      child.stderr.on('data', data => { log += data })
      child.on('error', reject)
      child.on('close', code => resolve({ code, log }))
    })
    expect(processResult.code).not.toBe(0)
    await writeFile('/tmp/continuation-native-crash-seed.log', processResult.log)
    const seed = JSON.parse(await readFile(join(path, 'crash-seed.json'), 'utf8'))
    let h = await fixtures.mount(path, 'read-only')
    h.model.uniqueToolIds = true
    await h.ctx.plugin(Subagents, { maxActiveSubagents: 8, maxDepth: 1 })
    h.ctx.subagents.registerProvider({ name: 'fresh-local', capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, inheritsParentContext: false,
      async prepareContinuable() { return {} }, async start() { throw Error('Only native continuable creation is used') } })
    installWorkTools(h.ctx, h.app, 'runtime')
    const before = await h.host.execution.observation!(seed.execution)
    expect(before.sessions.find(row => row.session.sessionId === seed.childId)).toMatchObject({ status: 'inactive', attempt: { reason: 'interrupted' } })
    const restoredParent = await h.ctx.sessionController.resolveAgent(SessionId(seed.execution.session.sessionId))
    if ('error' in restoredParent) throw Error(JSON.stringify(restoredParent))
    h.model.nextTool = { name: 'work_continuation_material', arguments: material }
    const command = { type: 'task.continue', commandId: 'continue-host-lost-child', ref: seed.ref, executionId: seed.execution.id, owner: seed.execution.owner, epoch: seed.execution.epoch }
    await h.app.execute(command, operator)
    await fixtures.run(() => restoredParent.agent.whenIdle())
    await fixtures.run(() => h.app.reconcileControls())
    const current = ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!
    expect(current.epoch).toBe(2)
    let successor = h.ctx.agents.get(SessionId(current.session.sessionId))!
    await fixtures.run(() => successor.whenIdle())
    await fixtures.run(() => h.app.reconcileControls())
    const pending = ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!
    expect(pending.continuation!.pendingChildren).toMatchObject([{ child: { sessionId: seed.childId }, status: 'inactive', returned: true }])
    await fixtures.dispose(h.ctx)
    h = await fixtures.mount(path, 'read-only')
    h.model.uniqueToolIds = true
    await h.ctx.plugin(Subagents, { maxActiveSubagents: 8, maxDepth: 1 })
    h.ctx.subagents.registerProvider({ name: 'fresh-local', capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, inheritsParentContext: false,
      async prepareContinuable() { return {} }, async start() { throw Error('Only native continuable creation is used') } })
    installWorkTools(h.ctx, h.app, 'runtime')
    expect(h.ctx.agents.get(SessionId(seed.execution.session.sessionId))).toBeUndefined()
    const restoredSuccessor = await h.ctx.sessionController.resolveAgent(SessionId(current.session.sessionId))
    if ('error' in restoredSuccessor) throw Error(JSON.stringify(restoredSuccessor))
    successor = restoredSuccessor.agent
    const unfinishedFacts = await h.host.execution.observation!(pending)
    expect(unfinishedFacts.blockers).toContainEqual(expect.objectContaining({ code: 'child-work-unfinished', session: { runtimeId: 'runtime', sessionId: seed.childId } }))
    let resultChildId = seed.childId
    if (mode === 'replace') {
      vi.spyOn(h.ctx.subagents, 'sendMessage').mockRejectedValueOnce(Error('Original child provider cannot be restored'))
      await expect(h.app.sessionChildRecovery(current.session, 'unrecoverable-original', seed.childId, 'resume', 'Continue remaining verification.', 2, signal!)).rejects.toThrow('cannot be restored')
      let replacementRuns = 0
      h.ctx.tools.register(defineTool({ name: 'replacement_verification', description: 'Perform replacement verification', parameters: {},
        output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
        async execute() { replacementRuns++; return { result: 'Replacement performed the unfinished verification successfully.' } } }))
      h.model.nextTool = { name: 'replacement_verification', arguments: {} }
      const replacement = await fixtures.run(() => h.ctx.subagents.startContinuable({ provider: 'fresh-local', label: 'replacement verification', request: { parent: successor, prompt: [{ type: 'text', text: 'Perform the unfinished original verification and return real evidence.' }] }, signal: signal! }))
      resultChildId = replacement.childId
      await expect.poll(async () => (await new RuntimeHost(h.ctx).executionFacts(successor.id, 'runtime', 'current')).children.find(child => child.session.sessionId === resultChildId)?.returned).toBe(true)
      await fixtures.run(() => successor.whenIdle())
      expect(replacementRuns).toBe(1)
      expect(await h.app.sessionChildRecovery(current.session, 'unreceived-replacement', seed.childId, 'replace', undefined, 2, signal!, 0, undefined, resultChildId)).toMatchObject({ status: 'failed', error: { code: 'child-replacement-unreceived' } })
      const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
      const foreignTask = ok(await h.app.execute({ type: 'task.create', commandId: 'foreign-task', projectId: seed.ref.projectId, title: 'foreign', goal: 'separate authorization', specification: 'foreign verification', acceptance: ['verified'] }, operator)).task!
      const foreignExecution = ok(await h.app.execute({ type: 'task.start', commandId: 'foreign-start', ref: { projectId: foreignTask.projectId, taskId: foreignTask.id }, expectedVersion: 1, resource, agentId: foreignTask.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'read-only' }, operator)).execution!
      const foreignParent = h.ctx.agents.get(SessionId(foreignExecution.session.sessionId))!
      await fixtures.run(() => foreignParent.whenIdle())
      const foreignGate = new Promise<void>(resolve => { releaseForeign = resolve })
      const stream = h.model.stream.bind(h.model)
      let heldForeign = false
      vi.spyOn(h.model, 'stream').mockImplementation(async function* (request) {
        if (!heldForeign && JSON.stringify(request.messages).includes('Verify a different Task')) {
          heldForeign = true
          await foreignGate
        }
        yield* stream(request)
      })
      const foreign = await h.ctx.subagents.startContinuable({ provider: 'fresh-local', label: 'foreign verification', request: { parent: foreignParent, prompt: [{ type: 'text', text: 'Verify a different Task' }] }, signal: signal! })
      foreignChildId = foreign.childId
      h.ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
        if (agent === successor && JSON.stringify(messages).includes('Receive the exact child result completely.')) {
          // Another real Session may reach the shared adapter before the coordinator.
          releaseForeign()
          await h.ctx.agents.get(foreign.childId)!.whenIdle()
        }
        return next()
      })
      expect(await h.app.sessionChildRecovery(current.session, 'foreign-replacement', seed.childId, 'replace', undefined, 2, signal!, 0, undefined, foreign.childId)).toMatchObject({ status: 'failed', error: { code: 'child-replacement-unrelated' } })
      expect(await h.app.sessionChildRecovery(current.session, 'foreign-result', foreign.childId, 'result', undefined, 2, signal!)).toMatchObject({ status: 'failed', error: { code: 'unrelated-child' } })
    } else {
      let enteredRecovered!: () => void
      const recoveredStarted = new Promise<void>(resolve => { enteredRecovered = resolve })
      if (awaitingNotice) {
        h.ctx.tools.register(defineTool({ name: 'hold_recovered', description: 'Resumed native child awaiting real result', parameters: {},
          output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
          async execute() { enteredRecovered(); await new Promise<void>(resolve => { releaseRecovered = resolve }); return { result: 'Resumed child completed the verification.' } } }))
        h.model.nextTool = { name: 'hold_recovered', arguments: {} }
      }
      const send = h.ctx.subagents.sendMessage.bind(h.ctx.subagents)
      let lost = false
      vi.spyOn(h.ctx.subagents, 'sendMessage').mockImplementation(async (...args) => {
        const receipt = await send(...args)
        if (!lost) { lost = true; throw Error('Real child accepted; recovery receipt lost') }
        return receipt
      })
      await expect(h.app.sessionChildRecovery(current.session, 'recover-host-lost-child', seed.childId, 'resume', 'Finish the interrupted verification and report real evidence.', 2, signal!)).rejects.toThrow('recovery receipt lost')
      expect(lost).toBe(true)
      if (awaitingNotice) {
        await recoveredStarted
        h.model.nextTool = { name: 'work_control', arguments: { action: 'wait', text: 'Await the restored child result', yield_reason: 'executor', checked_facts: ['Exact restored native child is running hold_recovered'], wake_condition: 'Exact child returns a real result', executor_session_id: seed.childId } }
        successor.followup(createUserMessage({ content: [{ type: 'text', text: 'Wait for the exact running restored child and receive its real result on return.' }], source: { kind: 'user' } }))
        await fixtures.run(() => successor.whenIdle())
        await fixtures.run(() => h.app.reconcileControls())
        const waiting = ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!
        expect(waiting).toMatchObject({ state: 'waiting', control: { action: 'wait', yield: { reason: 'executor', executor: { sessionId: seed.childId } } } })
        expect(waiting.childReceipts).toBeUndefined()
      }
      releaseRecovered()
      await expect.poll(async () => (await new RuntimeHost(h.ctx).executionFacts(restoredParent.agent.id, 'runtime', 'retired')).children[0]?.returned).toBe(true)
      expect(await h.app.sessionChildRecovery(current.session, 'recover-host-lost-child', seed.childId, awaitingNotice ? 'status' : 'resume', 'Finish the interrupted verification and report real evidence.', 2, signal!)).toMatchObject({ status: 'completed', childStatus: 'returned' })
    }
    const childEvents = await new RuntimeHost(h.ctx).events(SessionId(seed.childId))
    expect(childEvents.filter(event => event.type === 'turn/start')).toHaveLength(mode === 'replace' ? 1 : 2)
    expect(childEvents.filter(event => event.type === 'tool/call' && event.data.name === 'crash_native')).toHaveLength(1)
    expect(childEvents.find(event => event.type === 'tool/result' && event.data.message?.toolCallId === childEvents.find(event => event.type === 'tool/call')!.data.callId)).toMatchObject({ data: { message: { isError: true } } })
    expect(await h.app.sessionChildRecovery(seed.execution.session, 'retired-resume', seed.childId, 'resume', 'Must reject', 1, signal!)).toMatchObject({ status: 'failed', error: { code: 'stale-execution-authority' } })
    expect(await h.app.sessionReport(current.session, 'unreceived-done', report, 2)).toMatchObject({ status: 'failed', error: { code: 'completion-results-unsettled' } })
    if (awaitingNotice) {
      if (mode === 'resume-wait-startup') {
        const previousRequests = h.model.requests
        await fixtures.dispose(h.ctx)
        h = await fixtures.mount(path, 'read-only')
        h.model.uniqueToolIds = true
        h.model.requests.push(...previousRequests)
        await h.ctx.plugin(Subagents, { maxActiveSubagents: 8, maxDepth: 1 })
        h.ctx.subagents.registerProvider({ name: 'fresh-local', capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false }, inheritsParentContext: false,
          async prepareContinuable() { return {} }, async start() { throw Error('Only native continuable creation is used') } })
        installWorkTools(h.ctx, h.app, 'runtime')
        expect(h.ctx.agents.get(SessionId(current.session.sessionId))).toBeUndefined()
      }
      h.model.selectTool = request => {
        const noticeIndex = request.messages.findLastIndex(message => (message as { source?: { kind?: string } }).source?.kind === 'a2d2-work-child-result')
        if (noticeIndex < 0) return
        const output = request.messages.slice(noticeIndex + 1).findLast(message => message.role === 'tool')
        if (!output) return { name: 'work_child_recover', arguments: { child_session_id: seed.childId, action: 'result', expected_epoch: 2 } }
        const text = output.content.map(block => block.type === 'text' ? block.text : '').join('')
        const page = JSON.parse(text) as { nextCursor?: number; revision?: string }
        if (page.nextCursor !== undefined) return { name: 'work_child_recover', arguments: { child_session_id: seed.childId, action: 'result', expected_epoch: 2, cursor: page.nextCursor, revision: page.revision } }
      }
      installWorkControlRecovery(h.ctx, h.app)
      await expect.poll(async () => ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!.childReceipts?.find(receipt => receipt.child.sessionId === seed.childId)?.complete, { timeout: 6000 }).toBe(true)
      successor = h.ctx.agents.get(SessionId(current.session.sessionId))!
      await fixtures.run(() => successor.whenIdle())
      const relayed = ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!
      expect(relayed.history.some(entry => entry.commandId.startsWith('automatic-wake:child-result:'))).toBe(true)
      expect(relayed.events.filter(event => event.id.startsWith('child-result:'))).toMatchObject([{ kind: 'result', acceptance: 'unassessed' }])
      await fixtures.run(() => h.app.reconcileControls())
      await fixtures.run(() => h.app.reconcileControls())
      const successorLog = await new RuntimeHost(h.ctx).events(successor.id)
      expect(successorLog.filter(event => event.type === 'user/message' && event.data.source?.kind === 'a2d2-work-child-result')).toHaveLength(1)
      expect((await new RuntimeHost(h.ctx).events(SessionId(seed.execution.session.sessionId))).some(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled')).toBe(true)
    } else await receiveChild(h, successor, resultChildId, 2, fixtures)
    if (mode === 'replace') {
      const foreignEvents = await new RuntimeHost(h.ctx).events(SessionId(foreignChildId!))
      expect(foreignEvents.filter(event => event.type === 'tool/call' && event.data.name === 'work_child_recover')).toHaveLength(0)
      const replacementResult = await h.app.sessionChildRecovery(current.session, 'accept-replacement', seed.childId, 'replace', undefined, 2, signal!, 0, undefined, resultChildId)
      const trace = replacementResult.status === 'failed' ? await Promise.all([successor.id, SessionId(foreignChildId!)].map(async id => ({ id, events: (await new RuntimeHost(h.ctx).events(id)).filter(event => event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'turn/end') }))) : undefined
      expect(replacementResult, JSON.stringify({ replacementResult, trace })).toMatchObject({ status: 'completed', childStatus: 'replaced', replacement: { sessionId: resultChildId } })
    }
    const received = ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!
    const facts = await h.host.execution.observation!(received)
    expect(facts.settlement, JSON.stringify(facts)).toBe('settled')
    expect(ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!.session).toEqual(current.session)
    if (awaitingNotice) {
      let futureStarted!: () => void
      const futureRunning = new Promise<void>(resolve => { futureStarted = resolve })
      h.ctx.tools.register(defineTool({ name: 'hold_future_native', description: 'A later child turn needs a newer notice', parameters: {},
        output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_, value) => [{ type: 'text', text: value.result }] },
        async execute() { futureStarted(); await new Promise<void>(resolve => { releaseRecovered = resolve }); return { result: 'Later child result remains unassessed under user hold.' } } }))
      h.model.nextTool = { name: 'hold_future_native', arguments: {} }
      const originalParent = await new RuntimeHost(h.ctx).agent(SessionId(seed.execution.session.sessionId))
      await h.ctx.subagents.sendMessage(originalParent, SessionId(seed.childId), [{ type: 'text', text: 'Perform the next explicitly authorized verification turn.' }], { signal })
      await futureRunning
      h.model.nextTool = { name: 'work_control', arguments: { action: 'wait', text: 'Wait for the newer child turn', yield_reason: 'executor', checked_facts: ['Same exact child is running a newer turn'], wake_condition: 'The new turn returns its own result', executor_session_id: seed.childId } }
      successor.followup(createUserMessage({ content: [{ type: 'text', text: 'Wait for this newer child turn.' }], source: { kind: 'user' } }))
      await fixtures.run(() => successor.whenIdle())
      await fixtures.run(() => h.app.reconcileControls())
      await expect.poll(async () => ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!.state, { timeout: 6000 }).toBe('waiting')
      const nextWait = ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!
      const oldNotice = nextWait.events.find(event => event.id.startsWith('child-result:'))!.nativeMessage!
      const requests = (await new RuntimeHost(h.ctx).events(successor.id)).filter(event => event.type === 'assistant/message' || event.type === 'tool/call').length
      // The scripted result reader has completed. A replay is now an ordinary
      // native observation, not a second scripted request to read every page.
      h.model.selectTool = undefined
      successor.followup(oldNotice as never)
      await fixtures.run(() => successor.whenIdle())
      await fixtures.run(() => h.app.reconcileControls())
      const afterReplay = ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!
      expect(afterReplay.control).toEqual(nextWait.control)
      expect(afterReplay.state).toBe('waiting')
      const replayed = await new RuntimeHost(h.ctx).events(successor.id)
      expect(replayed.filter(event => event.type === 'assistant/message' || event.type === 'tool/call')).toHaveLength(requests + 1)
      expect(replayed.filter(event => event.type === 'user/message' && event.data.id === oldNotice.id)).toHaveLength(2)
      const afterReplayRequests = requests + 1
      await h.app.execute({ type: 'task.control', commandId: 'explicit-user-pause-before-late-result', ref: seed.ref, executionId: current.id, owner: current.owner, epoch: 2, action: 'pause', text: 'User paused this Task' }, operator)
      await fixtures.run(() => h.app.reconcileControls())
      await expect.poll(async () => ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!.state, { timeout: 6000 }).toBe('paused')
      releaseRecovered()
      await expect.poll(async () => (await new RuntimeHost(h.ctx).executionFacts(originalParent.id, 'runtime', 'retired')).children[0]?.returned).toBe(true)
      await expect.poll(async () => ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!.events.filter(event => event.id.startsWith('child-result:')).length, { timeout: 6000 }).toBe(2)
      const paused = ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!
      expect(paused).toMatchObject({ state: 'paused', control: { action: 'pause', commandId: 'explicit-user-pause-before-late-result' } })
      expect(paused.events.filter(event => event.id.startsWith('child-result:'))[1]).toMatchObject({ delivery: 'accepted', acceptance: 'unassessed' })
      expect((await new RuntimeHost(h.ctx).events(successor.id)).filter(event => event.type === 'assistant/message' || event.type === 'tool/call')).toHaveLength(afterReplayRequests)
      await h.app.execute({ type: 'task.control', commandId: 'explicit-user-wait-after-late-result', ref: seed.ref, executionId: current.id, owner: current.owner, epoch: 2, action: 'wait', text: 'User has not delegated an automatic observation turn' }, operator)
      await fixtures.run(() => h.app.reconcileControls())
      await fixtures.run(() => h.app.reconcileControls())
      await expect.poll(async () => ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!.state, { timeout: 6000 }).toBe('waiting')
      expect(ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!).toMatchObject({ state: 'waiting', control: { commandId: 'explicit-user-wait-after-late-result', action: 'wait' } })
      expect((await new RuntimeHost(h.ctx).events(successor.id)).filter(event => event.type === 'assistant/message' || event.type === 'tool/call')).toHaveLength(afterReplayRequests)
    }
    if (mode === 'replace') {
      expect(facts.sessions.flatMap(row => row.children).find(child => child.session.sessionId === seed.childId)).toMatchObject({ returned: true, attempt: { reason: 'interrupted' }, result: 'pending' })
      h.model.nextTool = { name: 'work_continuation_material', arguments: material }
      await h.app.execute({ type: 'task.continue', commandId: 'continue-with-replacement-binding', ref: seed.ref, executionId: current.id, owner: current.owner, epoch: 2 }, operator)
      await fixtures.run(() => successor.whenIdle())
      await fixtures.run(() => h.app.reconcileControls())
      const final = ok(await h.app.query({ type: 'task.execution', ref: seed.ref }, operator)).execution!
      expect(final.epoch).toBe(3)
      const third = h.ctx.agents.get(SessionId(final.session.sessionId))!
      await fixtures.run(() => third.whenIdle())
      await fixtures.run(() => h.app.reconcileControls())
      expect(await h.app.sessionReport(final.session, 'replacement-before-new-receipt', report, 3)).toMatchObject({ status: 'failed', error: { code: 'completion-results-unsettled' } })
      await receiveChild(h, third, resultChildId, 3, fixtures)
      expect(await h.app.sessionReport(final.session, 'replacement-accepted-done', report, 3)).toMatchObject({ status: 'completed' })
    }
  } finally { releaseRecovered(); releaseForeign(); await fixtures.close() }
})
