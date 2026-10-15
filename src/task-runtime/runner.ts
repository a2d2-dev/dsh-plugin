import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { HandoffDocumentError, parseHandoffDocument } from '../handoff-document.ts'
import { handoffPrompt } from '../handoff-prompt.ts'
import { redactText } from '../handoff.ts'
import { handoffsDirectory, readHandoffDocument } from '../store.ts'
import { RuntimeStore } from './store.ts'
import { RuntimeHost } from './host.ts'
import type { Delivery, RunRecord, TaskAddress } from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'a2d2-task-runtime': { kind: 'a2d2-task-runtime'; eventId: string } & ContextFormed
  }
}

export interface RunnerOptions { enabled: boolean; rotateTokens: number; maxAutoTurns: number; maxFailures: number }
const CONTINUE = 'Continue the bound task. The host continues active tasks automatically. Report task_runtime wait-human or wait-event when blocked, or continue with concrete progress when useful. Use complete_task when acceptance is met. Do not poll for external events.'

function delivery(id: string, text: string): Delivery {
  return { id, message: createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'a2d2-task-runtime', eventId: id, form: 'notice', summary: 'A²D² task runtime' },
  }) }
}

/** Durable coordinator. Session logs are delivery receipts; task documents own the main pointer. */
export class TaskRunner {
  readonly instance = randomUUID()
  private readonly ownership = new Map<string, { release: () => void; finished: Promise<void> }>()
  private readonly acquiring = new Map<string, Promise<void>>()
  private readonly ticks = new Map<string, Promise<void>>()
  private closed = false
  constructor(
    private readonly ctx: Context,
    readonly store: RuntimeStore,
    readonly host: RuntimeHost,
    readonly options: RunnerOptions,
  ) {}

  async status(cwd: string, session: SessionId): Promise<RunRecord | undefined> {
    const projectRoot = await this.ctx.a2d2.projectRoot(cwd)
    return (await this.store.list()).find(record => record.projectRoot === projectRoot && record.sessions.includes(session))
  }
  private async own(address: TaskAddress): Promise<void> {
    const key = this.store.key(address)
    if (this.ownership.has(key)) return
    const pending = this.acquiring.get(key)
    if (pending) return pending
    let ready!: () => void
    let reject!: (error: unknown) => void
    let release!: () => void
    const readyPromise = new Promise<void>((resolve, fail) => { ready = resolve; reject = fail })
    const held = new Promise<void>(resolve => { release = resolve })
    const finished = this.store.own(address, async () => {
      if (this.closed) throw new Error('Task runtime is stopping')
      this.ownership.set(key, { release, finished })
      ready()
      await held
    }).catch(error => { reject(error) })
    this.acquiring.set(key, readyPromise)
    try { await readyPromise } finally { this.acquiring.delete(key) }
  }
  private assertOwned(record: RunRecord): void {
    if (this.closed || !this.ownership.has(this.store.key(record)) || record.owner !== this.instance) {
      throw new Error('Task execution belongs to another runtime; no side effect was issued')
    }
  }
  async start(cwd: string, session: SessionId, binding?: { issue: number; title?: string }): Promise<RunRecord> {
    if (!this.options.enabled) throw new Error('Task runtime is disabled; enable the a2d2-task-runtime mount first')
    if (binding) await this.ctx.a2d2.bindMainSession({ cwd, mainSession: session, now: new Date(), ...binding })
    const task = await this.ctx.a2d2.taskOfMainSession(cwd, session)
    if (!task || task.state === 'done') throw new Error('Start requires the active main session of a bound task issue')
    const address = { projectRoot: await this.ctx.a2d2.projectRoot(cwd), task: task.id }
    await this.own(address)
    let created = false
    await this.store.locked(address, async existing => {
      if (existing) {
        if (existing.current !== session) throw new Error('Runtime and task main session disagree; recover the pending operation')
        existing.owner = this.instance
        await this.store.save(existing)
        return
      }
      const agent = await this.host.agent(session)
      created = true
      const record: RunRecord = {
        ...address, version: 1, cwd: agent.session.header.cwd!, workspace: this.host.workspace(session),
        current: session, sessions: [session], generation: 0, state: 'running', owner: this.instance,
        autoTurns: 0, noProgress: 0, failures: 0, inbox: [], updatedAt: new Date().toISOString(),
        drive: delivery(`start:${randomUUID()}`, CONTINUE),
      }
      await this.store.save(record)
    })
    if (created) await this.tick(address)
    return (await this.store.read(address))!
  }
  async control(cwd: string, session: SessionId, action: 'stop' | 'resume' | 'rotate', focus?: string): Promise<RunRecord> {
    const record = await this.status(cwd, session)
    if (!record) throw new Error('This session has no task runtime; use start first')
    if (record.current !== session) throw new Error(`Retired main session; current main is ${record.current}`)
    if (!this.options.enabled) throw new Error('Task runtime is disabled')
    await this.own(record)
    await this.store.locked(record, async current => {
      if (!current || current.current !== session) throw new Error('Main session changed during command')
      current.owner = this.instance
      if (current.state === 'done') throw new Error('Completed tasks cannot resume')
      if (action === 'stop') current.state = 'paused'
      else {
        current.state = 'running'
        current.failures = 0
        current.error = undefined
        if (action === 'rotate') this.planRotation(current, focus)
        else {
          current.autoTurns = 0
          current.noProgress = 0
          if (!current.operation) current.drive = delivery(`resume:${randomUUID()}`, CONTINUE)
        }
      }
      await this.store.save(current)
    })
    if (action !== 'stop') await this.tick(record)
    return (await this.store.read(record))!
  }
  private planRotation(record: RunRecord, focus?: string): void {
    if (record.operation) return
    const id = randomUUID()
    record.operation = { id, source: record.current, successor: SessionId(`session-${id}`), step: 'prepare', focus, createdAt: new Date().toISOString() }
    record.sessions.push(record.operation.successor)
  }
  async decide(cwd: string, session: SessionId, kind: 'continue' | 'wait-human' | 'wait-event', progress: string): Promise<void> {
    const record = await this.status(cwd, session)
    if (!record) throw new Error('This task has not enabled runtime')
    await this.store.locked(record, async current => {
      if (!current || current.current !== session) throw new Error('Only the current main session may set continuation state')
      this.assertOwned(current)
      if (current.state === 'paused' || current.state === 'done') throw new Error(`Task runtime is ${current.state}`)
      if (kind === 'continue' && !progress.trim()) throw new Error('Continue requires concrete progress; otherwise report a wait')
      current.state = 'running'
      if (kind !== 'continue' && current.drive && !current.drive.delivered) current.drive = undefined
      current.decision = { kind, progress: progress.trim() }
      await this.store.save(current)
    })
  }
  async enqueue(address: TaskAddress, id: string, text: string): Promise<boolean> {
    return this.store.locked(address, async record => {
      if (!record) return false
      if (!record.inbox.some(item => item.id === id)) {
        record.inbox.push(delivery(id, text))
        await this.store.save(record)
      }
      return true
    })
  }
  async addressOfSession(cwd: string, session: SessionId): Promise<TaskAddress | undefined> {
    const root = await this.ctx.a2d2.projectRoot(cwd)
    const task = (await this.ctx.a2d2.list(cwd)).find(item => item.issue && item.members.some(member => member.sessionId === session))
    return task ? { projectRoot: root, task: task.id } : undefined
  }
  /** Admission reads the atomic record without acquiring its writer lock. */
  async allowed(agent: Agent, messages: readonly UserMessage[] = []): Promise<boolean> {
    const record = (await this.store.list()).find(item => item.sessions.includes(agent.id))
    if (!record) return true
    if (this.closed || record.owner !== this.instance || !this.ownership.has(this.store.key(record))) return false
    if (record.current !== agent.id || ['paused', 'blocked', 'done'].includes(record.state)) return false
    const task = await this.ctx.a2d2.readTask(record.projectRoot, record.task)
    if (task?.issue?.mainSession !== agent.id || task.state === 'done') return false
    const answered = record.state === 'waiting-human' && !await this.host.askedHuman(agent.id)
    if ((messages.length > 0 || answered) && ['waiting-event', 'waiting-human'].includes(record.state)) {
      await this.store.locked(record, async current => {
        if (!current || current.current !== agent.id) return
        this.assertOwned(current)
        if (['waiting-event', 'waiting-human'].includes(current.state)) {
          current.state = 'running'
          await this.store.save(current)
        }
      })
    }
    return true
  }
  async guardHandoff(cwd: string, source: SessionId, successor: SessionId | undefined, operation?: string): Promise<void> {
    const record = await this.status(cwd, source)
    if (!record) return
    this.assertOwned(record)
    if (!operation || record.operation?.id !== operation || record.operation.source !== source
      || (successor && record.operation.successor !== successor)) {
      throw new Error(`Task runtime owns this handoff; use /task-runtime rotate in ${record.current}`)
    }
  }
  async recover(): Promise<void> {
    if (!this.options.enabled || this.closed) return
    for (const record of await this.store.list()) {
      try {
        await this.own(record)
        await this.store.locked(record, async current => {
          if (!current) return
          current.owner = this.instance
          await this.store.save(current)
        })
        await this.tick(record)
      } catch (error) { this.ctx.logger.warn(`task-runtime ${record.task}: ${String(error)}`) }
    }
  }
  async tick(address: TaskAddress): Promise<void> {
    const key = this.store.key(address)
    if (this.closed || !this.ownership.has(key)) return
    const previous = this.ticks.get(key)
    if (previous) return previous
    const pending = this.store.locked(address, async record => {
      if (!record) return
      this.assertOwned(record)
      if (['paused', 'blocked', 'done'].includes(record.state)) return
      try {
        await this.advance(record)
      } catch (error) {
        record.failures++
        record.error = error instanceof Error ? error.message : String(error)
        if (record.failures >= this.options.maxFailures) record.state = 'blocked'
        await this.store.save(record)
      }
    })
    this.ticks.set(key, pending)
    try { await pending } finally { this.ticks.delete(key) }
  }
  private async advance(record: RunRecord): Promise<void> {
    const task = await this.ctx.a2d2.readTask(record.projectRoot, record.task)
    if (!task?.issue) throw new Error('Bound task disappeared')
    if (task.state === 'done') { record.state = 'done'; await this.store.save(record); return }
    const intended = record.operation?.successor
    if (task.issue.mainSession !== record.current && task.issue.mainSession !== intended) {
      throw new Error('Task document and runtime main session disagree')
    }
    if (record.operation && task.issue.mainSession === intended) {
      record.current = intended
      record.operation.step = 'deliver'
      await this.store.save(record)
    }
    const agent = await this.host.agent(record.current)
    if (await this.host.askedHuman(record.current)) {
      record.state = 'waiting-human'
      await this.store.save(record)
      return
    }
    if (agent.status !== 'idle') return
    if (record.operation) { await this.rotate(record, agent); return }
    const event = record.inbox.find(item => !item.delivered)
    if (event) {
      // A human wait is explicit: hold external events until LF resumes.
      if (record.state === 'waiting-human') return
      event.target ??= record.current
      record.state = 'running'
      record.decision = undefined
      await this.store.save(record)
      await this.host.deliver(event.target, event)
      event.delivered = true
      await this.store.save(record)
      return
    }
    if (record.drive) {
      const drive = record.drive
      if (!drive.delivered) {
        await this.host.deliver(record.current, drive)
        drive.delivered = true
        await this.store.save(record)
        return
      }
      record.drive = undefined
    }
    if (record.state !== 'running') { await this.store.save(record); return }
    const failed = await this.host.lastTurnFailure(record.current)
    if (failed) {
      record.error = failed.message
      if (failed.userCancelled) record.state = 'paused'
      else if (record.recoveredFailure !== failed.id) {
        record.recoveredFailure = failed.id
        record.failures++
        if (record.failures >= this.options.maxFailures) record.state = 'blocked'
        else record.drive = delivery(`recover:${failed.id}`, `The preceding turn was interrupted or failed. Inspect its durable results before repeating side effects.\n${CONTINUE}`)
      } else record.state = 'blocked'
      await this.store.save(record)
      return
    }
    record.failures = 0
    record.error = undefined
    const decision = record.decision
    record.decision = undefined
    if (await this.host.askedHuman(record.current)) record.state = 'waiting-human'
    else if (await this.host.unsettledChildren(record.current)) record.state = 'waiting-event'
    else if (decision?.kind === 'wait-human') record.state = 'waiting-human'
    else if (decision?.kind === 'wait-event') record.state = 'waiting-event'
    else if (!decision && (await this.host.waitingOnWatch(record.current)
      || (await this.ctx.a2d2.list(record.projectRoot)).some(child => child.issue?.parent === task.issue!.number && child.state !== 'done'))) {
      record.state = 'waiting-event'
    }
    else {
      const progress = decision?.progress || await this.host.progress(record.current)
      record.noProgress = record.lastProgress === progress ? (record.noProgress ?? 0) + 1 : 0
      if (record.noProgress >= this.options.maxFailures) {
        record.state = 'blocked'
        throw new Error('No new progress across repeated turns; inspect the task before resuming')
      }
      record.autoTurns++
      record.lastProgress = progress
      const pressure = await this.host.pressure(record.current)
      if ((pressure !== undefined && pressure >= this.options.rotateTokens) || record.autoTurns >= this.options.maxAutoTurns) this.planRotation(record)
      else record.drive = delivery(`continue:${randomUUID()}`, CONTINUE)
    }
    await this.store.save(record)
  }
  private async rotate(record: RunRecord, agent: Agent): Promise<void> {
    const operation = record.operation!
    if (operation.step === 'deliver') {
      if (!operation.continuation) throw new Error('Recovery cannot find the persisted continuation message')
      await this.host.deliver(record.current, operation.continuation)
      operation.continuation.delivered = true
      record.generation++
      record.autoTurns = 0
      record.operation = undefined
      record.drive = undefined
      record.decision = undefined
      record.failures = 0
      record.error = undefined
      await this.store.save(record)
      return
    }
    if (await this.host.unsettledChildren(operation.source)) {
      record.error = 'Rotation is waiting for native subagents to settle and their notifications to be consumed'
      await this.store.save(record)
      return
    }
    await agent.runMaintenance(async () => {
      this.assertOwned(record)
      if (operation.step === 'prepare') {
        const prepared = await this.ctx.a2d2.prepareHandoff({
          cwd: record.projectRoot, source: operation.source, taskId: record.task,
          now: new Date(operation.createdAt), focus: operation.focus, runtimeOperation: operation.id,
        })
        operation.instruction = delivery(`prepare:${operation.id}`, prepared.instruction)
        operation.step = 'write'
        await this.store.save(record)
      }
      if (operation.step === 'write') {
        if (!operation.instruction) throw new Error('Missing handoff instruction checkpoint')
        if (!operation.instruction.delivered) {
          await this.host.deliver(operation.source, operation.instruction)
          operation.instruction.delivered = true
          await this.store.save(record)
          return
        }
        try {
          parseHandoffDocument(await readHandoffDocument(handoffsDirectory(record.projectRoot), operation.source), operation.source)
        } catch (error) {
          const failed = await this.host.lastTurnFailure(operation.source)
          if (!(error instanceof HandoffDocumentError) || error.code !== 'unwritten' || !failed
            || record.recoveredFailure === failed.id) throw error
          record.recoveredFailure = failed.id
          record.failures++
          record.error = failed.message
          if (failed.userCancelled) record.state = 'paused'
          else if (record.failures >= this.options.maxFailures) record.state = 'blocked'
          else operation.instruction = delivery(`prepare-recover:${failed.id}`, operation.instruction.message.content
            .map(block => block.type === 'text' ? block.text : '').join('\n'))
          await this.store.save(record)
          return
        }
        operation.step = 'create'
        await this.store.save(record)
      }
      if (operation.step === 'create') {
        await this.host.ensureSuccessor(record)
        operation.step = 'take'
        await this.store.save(record)
      }
      if (operation.step === 'take') {
        if (!operation.continuation) {
          const parsed = parseHandoffDocument(await readHandoffDocument(handoffsDirectory(record.projectRoot), operation.source), operation.source)
          operation.continuation = delivery(`take:${operation.id}`, `${handoffPrompt({ ...parsed, body: redactText(parsed.body).text })}\n\n${CONTINUE}`)
          await this.store.save(record)
        }
        const taken = await this.ctx.a2d2.takeHandoff({
          cwd: record.projectRoot, source: operation.source, successor: operation.successor, runtimeOperation: operation.id,
        })
        if (taken.task.issue?.mainSession !== operation.successor) throw new Error('Handoff did not install the reserved successor')
        record.current = operation.successor
        operation.step = 'deliver'
        await this.store.save(record)
      }
    })
  }
  async close(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.ticks.values(), ...this.acquiring.values()])
    for (const ownership of this.ownership.values()) ownership.release()
    await Promise.all([...this.ownership.values()].map(ownership => ownership.finished))
    this.ownership.clear()
  }
}
