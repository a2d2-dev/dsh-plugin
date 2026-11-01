import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { installWorkControlRecovery, installWorkTools } from '../src/work-execution/tools.ts'
import type { WorkExecution } from '../src/work-types.ts'

let fixtures: ExecutionFixtures
const operator = { operator: true }
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())
const material = { body: 'Keep the original accepted work.', decisions: 'Keep the same Task and owner.', evidence: 'Real source Session tools.', unfinished: 'Verify the successor.', next: 'Continue the accepted verification.' }
function fence(execution: WorkExecution) { return { ref: execution.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch } }
async function setup() {
  const h = await fixtures.mount(await fixtures.root())
  const resource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const p = await h.app.execute({ type: 'project.create', commandId: 'project', name: 'Recovery', resource }, operator)
  if (p.status !== 'completed' || !p.project) throw Error('Missing project')
  const t = await h.app.execute({ type: 'task.create', commandId: 'task', projectId: p.project.id, title: 'Continue accepted work', goal: 'Keep execution moving', specification: 'Recover saved continuation without another human message', acceptance: ['Successor reads the saved material'] }, operator)
  if (t.status !== 'completed' || !t.task) throw Error('Missing Task')
  const ref = { projectId: p.project.id, taskId: t.task.id }
  installWorkTools(h.ctx, h.app, 'runtime')
  const started = await h.app.execute({ type: 'task.start', commandId: 'start', ref, expectedVersion: 1, resource, agentId: p.project.defaultAgentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
  if (started.status !== 'completed' || !started.execution) throw Error('Missing execution')
  const source = h.ctx.agents.get(SessionId(started.execution.session.sessionId))!
  await fixtures.run(() => source.whenIdle())
  return { ...h, ref, source, execution: started.execution }
}

it.each([{ trigger: 'idle', paused: false }, { trigger: 'startup', paused: false }, { trigger: 'startup', paused: true }] as const)('recovers native saved material from $trigger, paused=$paused, while an unrelated global scan stays pending', async ({ trigger, paused }) => {
  const h = await setup()
  if (paused) await h.app.execute({ type: 'task.control', commandId: 'pause', ...fence(h.execution), action: 'pause', text: 'Preserve the human pause while changing Session only.' }, operator)
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const scanning = new Promise<void>(resolve => { entered = resolve })
  let released = false
  vi.spyOn(h.app, 'reconcileContinuous').mockImplementation(async () => { entered(); await gate })
  const started = performance.now()
  try {
    if (trigger === 'idle') { installWorkControlRecovery(h.ctx, h.app); await scanning }
    h.model.nextTool = { name: 'work_continuation_material', arguments: material }
    await fixtures.run(() => h.app.execute({ type: 'task.continue', commandId: 'continue', ...fence(h.execution) }, operator))
    await fixtures.run(() => h.source.whenIdle())
    if (trigger === 'startup') { installWorkControlRecovery(h.ctx, h.app); await scanning }
    await vi.waitFor(async () => expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { id: h.execution.id, owner: h.execution.owner, epoch: 2, continuation: { phase: 'received', material } } }), { timeout: 5000, interval: 25 })
    expect(released).toBe(false)
    const result = await h.app.query({ type: 'task.execution', ref: h.ref }, operator)
    if (result.status !== 'completed' || !result.execution) throw Error('Missing successor')
    const successor = h.ctx.agents.get(SessionId(result.execution.session.sessionId))!
    await fixtures.run(() => successor.whenIdle())
    const log = await fixtures.run(() => h.ctx.sessionController.inspect(successor.id))
    expect(log.events.filter(event => event.type === 'tool/call' && event.data.name === 'work_continuation_received')).toHaveLength(1)
    expect(log.events.some(event => event.type === 'tool/result' && event.data.message?.isError === false)).toBe(true)
    expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(2)
    if (paused) {
      expect(result.execution).toMatchObject({ state: 'paused', control: { commandId: 'pause', action: 'pause', status: 'applied' } })
      expect(result.execution.events.some(event => event.id.startsWith('continuation-business:'))).toBe(false)
    }
    const requests = h.model.requests.length
    // Duplicate idle notifications and a retired source cannot repeat a handoff.
    await Promise.all([h.app.reconcileSessionControls(h.source.id), h.app.reconcileSessionControls(successor.id), h.app.reconcileSessionControls(successor.id)])
    expect(h.model.requests).toHaveLength(requests)
    expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(2)
  } finally {
    process.stdout.write(`recovery ${trigger}, paused=${paused}: ${Math.round(performance.now() - started)} ms before releasing unrelated scan\n`)
    released = true
    release()
  }
})

it('waits for the real source turn to become idle before taking saved material', async () => {
  const h = await setup()
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const saving = new Promise<void>(resolve => { entered = resolve })
  let saved = false
  h.ctx.on('tools/result', exec => { if (exec.agent === h.source && exec.name === 'work_continuation_material') saved = true })
  h.ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (agent === h.source && saved) { entered(); await gate }
    return next()
  })
  try {
    h.model.nextTool = { name: 'work_continuation_material', arguments: material }
    await h.app.execute({ type: 'task.continue', commandId: 'continue', ...fence(h.execution) }, operator)
    await saving
    expect(h.source.status).not.toBe('idle')
    installWorkControlRecovery(h.ctx, h.app)
    await h.app.reconcileSessionControls(h.source.id)
    expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { epoch: 1, continuation: { phase: 'material-saved' } } })
    expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(1)
    release()
    await fixtures.run(() => h.source.whenIdle())
    await vi.waitFor(async () => expect(await h.app.query({ type: 'task.execution', ref: h.ref }, operator)).toMatchObject({ execution: { epoch: 2, continuation: { phase: 'received' } } }), { timeout: 5000 })
  } finally { release() }
})

it('limits startup backlog creation to one while repeated timer ticks cannot duplicate the batch', async () => {
  const h = await setup()
  const executions = [h.execution]
  for (let index = 1; index < 4; index++) {
    const task = await h.app.execute({ type: 'task.create', commandId: `task-${index}`, projectId: h.ref.projectId, title: `Pending ${index}`, goal: 'Recover saved material', specification: 'Use one successor', acceptance: ['Receive the original material'] }, operator)
    if (task.status !== 'completed' || !task.task) throw Error('Missing Task')
    const started = await h.app.execute({ type: 'task.start', commandId: `start-${index}`, ref: { projectId: h.ref.projectId, taskId: task.task.id }, expectedVersion: 1, resource: h.execution.resource, agentId: h.execution.agentId, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write' }, operator)
    if (started.status !== 'completed' || !started.execution) throw Error('Missing execution')
    executions.push(started.execution)
    await fixtures.run(() => h.ctx.agents.get(SessionId(started.execution!.session.sessionId))!.whenIdle())
  }
  const successors = new Set<string>()
  for (const execution of executions.slice(0, 3)) {
    h.model.nextTool = { name: 'work_continuation_material', arguments: material }
    await h.app.execute({ type: 'task.continue', commandId: `continue-${execution.id}`, ...fence(execution) }, operator)
    await fixtures.run(() => h.ctx.agents.get(SessionId(execution.session.sessionId))!.whenIdle())
    const current = await h.app.query({ type: 'task.execution', ref: execution.ref }, operator)
    if (current.status !== 'completed' || !current.execution?.continuation) throw Error('Missing continuation')
    expect(current.execution.continuation.phase).toBe('material-saved')
    successors.add(current.execution.continuation.successor.sessionId)
  }
  let releaseCreate!: () => void
  let releaseScan!: () => void
  const createGate = new Promise<void>(resolve => { releaseCreate = resolve })
  const scanGate = new Promise<void>(resolve => { releaseScan = resolve })
  vi.spyOn(h.app, 'reconcileContinuous').mockImplementation(() => scanGate)
  const ensure = h.host.execution.ensure.bind(h.host.execution)
  const created = new Set<string>()
  let active = 0
  let maxActive = 0
  vi.spyOn(h.host.execution, 'ensure').mockImplementation(async (execution, allowed) => {
    if (!successors.has(execution.session.sessionId) || created.has(execution.session.sessionId)) return ensure(execution, allowed)
    created.add(execution.session.sessionId)
    active++
    maxActive = Math.max(maxActive, active)
    try { await createGate; return await ensure(execution, allowed) }
    finally { active-- }
  })
  try {
    installWorkControlRecovery(h.ctx, h.app)
    await vi.waitFor(() => expect(created.size).toBeGreaterThan(0))
    // Observe the existing two-second timer fire while the first real create is parked.
    await new Promise(resolve => setTimeout(resolve, 2200))
    expect(created.size).toBe(1)
    expect(maxActive).toBe(1)
    // A fresh native idle can still advance its exact Session while the backlog is parked.
    const fresh = executions[3]!
    h.model.nextTool = { name: 'work_continuation_material', arguments: material }
    await h.app.execute({ type: 'task.continue', commandId: 'continue-fresh', ...fence(fresh) }, operator)
    await fixtures.run(() => h.ctx.agents.get(SessionId(fresh.session.sessionId))!.whenIdle())
    await vi.waitFor(async () => expect(await h.app.query({ type: 'task.execution', ref: fresh.ref }, operator)).toMatchObject({ execution: { epoch: 2, continuation: { phase: 'received' } } }), { timeout: 6000 })
    expect(created.size).toBe(1)
    releaseCreate()
    await vi.waitFor(async () => {
      for (const execution of executions) expect(await h.app.query({ type: 'task.execution', ref: execution.ref }, operator)).toMatchObject({ execution: { epoch: 2, continuation: { phase: 'received' } } })
    }, { timeout: 6000 })
    expect(created.size).toBe(3)
    expect(maxActive).toBe(1)
    expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(8)
  } finally { releaseCreate(); releaseScan() }
})
