import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Delivery, RunRecord } from './types.ts'
import { createRootSession, rootSessionProfile } from '../root-session.ts'
import { observeJobs } from '../work-execution/job-observation.ts'
import type { PublicJobRegistry } from '../work-execution/job-observation.ts'

interface Event { type: string; seq: number; time: number; data: Record<string, any>; ignorable?: boolean }
interface Observation extends Disposable {
  header?: { origin?: string; parentSession?: string }
  events: readonly Event[]
  inheritedEventCount: number
  projections?: { values: Record<string, unknown> }
}
interface Workspace {
  id: string
  sessionIds: readonly SessionId[]
  attachSession(session: SessionId): Promise<void>
}
interface WorkspaceRegistry { list(): Workspace[]; get(id: string): Workspace | undefined }
interface SessionQuery { observeSession(id: SessionId): Promise<Observation> }

/** Only published DSH services: no registry mutation or direct session-file access. */
export class RuntimeHost {
  constructor(private readonly ctx: Context) {}
  private get agents(): AgentRegistry { return this.ctx.get('agents') as AgentRegistry }
  private get workspaces(): WorkspaceRegistry { return this.ctx.get('workspaceRegistry') as unknown as WorkspaceRegistry }
  private get query(): SessionQuery { return this.ctx.get('sessionQuery') as unknown as SessionQuery }
  async agent(id: SessionId): Promise<Agent> {
    const live = this.agents.get(id)
    if (live) return live
    const controller = this.ctx.get('sessionController') as unknown as {
      resolveAgent(id: SessionId): Promise<{ agent: Agent } | { error: { message?: string; code?: string } }>
    }
    const resolved = await controller.resolveAgent(id)
    if ('error' in resolved) throw new Error(resolved.error.message ?? resolved.error.code ?? 'Session cannot resume')
    return resolved.agent
  }
  workspace(id: SessionId): string {
    const workspace = this.workspaces.list().find(item => item.sessionIds.includes(id))
    if (!workspace) throw new Error(`Session ${id} must belong to a workspace before task-runtime start`)
    return workspace.id
  }
  async ensureSuccessor(record: RunRecord): Promise<Agent> {
    const id = record.operation!.successor
    const agent = await createRootSession(this.ctx, {
      source: record.operation!.source, sessionId: id, cwd: record.cwd,
      workspaceId: record.workspace, profile: record.operation!.profile, repairLegacy: true,
    })
    // A replay after take validates the composition without trying to record
    // an Agent role again: the bound main session already owns the CEO role.
    if (!await this.ctx.a2d2.taskOfMainSession(record.cwd, id)) await this.ctx.a2d2.initializeSessionAgent(record.cwd, id, 'ceo')
    await this.flush(agent)
    return agent
  }
  async profile(source: SessionId) { return rootSessionProfile(this.ctx, source) }
  async flush(agent: Agent): Promise<void> {
    const sessions = this.ctx.get('sessions')
    if (!sessions) throw new Error('DSH sessions is required to flush managed execution')
    if (!await sessions.flush(agent.session)) throw new Error(`Session ${agent.id} is no longer live`)
  }
  async events(id: SessionId): Promise<readonly Event[]> {
    using observation = await this.query.observeSession(id)
    return observation.events.slice(observation.inheritedEventCount)
  }
  /** Read-only adapter: never resolves/activates an Agent or consumes a job cursor. */
  async executionFacts(id: SessionId, runtimeId: string, role: import('../work-execution/observation.ts').ObservedSession['role'], parent?: import('../work-types.ts').SessionRef): Promise<import('../work-execution/observation.ts').ObservedSession> {
    using observation = await this.query.observeSession(id)
    const events = observation.events.slice(observation.inheritedEventCount)
    const questions = observation.projections?.values.userQuestions as { active: readonly unknown[] } | undefined
    const toolCalls = new Map<string, string>()
    const questionCalls = new Set<string>()
    for (const event of events) {
      if (event.type === 'tool/call') toolCalls.set(event.data.callId, event.data.name)
      if (event.type === 'tool/result') toolCalls.delete(event.data.message?.toolCallId)
      if (event.type === 'tool/ptc-dispatch-start') toolCalls.set(event.data.subCallId, event.data.name)
      if (event.type === 'tool/ptc-dispatch') toolCalls.delete(event.data.subCallId)
      if (event.type === 'tool/call' && ['ask_user', 'ask_user_question'].includes(event.data.name)) questionCalls.add(event.data.callId)
      if (event.type === 'tool/result') questionCalls.delete(event.data.message?.toolCallId)
    }
    const session = { runtimeId, sessionId: id }
    const ended = events.findLast(event => event.type === 'turn/end')
    const started = events.findLast(event => event.type === 'turn/start')
    const live = this.agents.get(id)
    const status = live?.status ?? (started && (!ended || started.seq > ended.seq) ? 'unknown' : 'inactive')
    const catalog = new Map<string, Event>()
    for (const event of events) if (event.type === 'subagent/catalog' && typeof event.data.childId === 'string') catalog.set(event.data.childId, event)
    const children: import('../work-execution/observation.ts').NativeExecution[] = []
    for (const [childId, catalogEvent] of catalog) {
      using childObservation = await this.query.observeSession(childId as SessionId)
      const childEvents = childObservation.events.slice(childObservation.inheritedEventCount)
      const end = childEvents.findLast(event => event.type === 'turn/end')
      const start = childEvents.findLast(event => event.type === 'turn/start')
      const childStatus = this.agents.get(childId as SessionId)?.status ?? (start && (!end || start.seq > end.seq) ? 'unknown' : 'inactive')
      const mode = catalogEvent.data.mode === 'continuable' || catalogEvent.data.mode === 'one-shot' ? catalogEvent.data.mode : 'unknown'
      // Same published settlement rule as the legacy boundary. Identity comes
      // from the catalog and source.senderSessionId, never from notice text.
      const notice = events.findLast(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled' && event.data.source.senderSessionId === childId)
      const result = !end || (start && start.seq > end.seq) || childStatus === 'running' ? 'pending'
        : mode === 'continuable' ? (notice && notice.time >= end.time ? 'consumed' : 'pending') : 'unknown'
      // Only the first durable insertion of an original native notice can cover
      // an end. Re-inserting an old id after a newer child turn cannot freshen it.
      const inserted = new Map<string, { message: import('../work-types.ts').NativeWorkMessage; time: number }>()
      for (const event of events) if (event.type === 'agent/inbox/spliced') for (const message of event.data.inserted ?? []) {
        if (!inserted.has(message.id)) inserted.set(message.id, { message, time: event.time })
      }
      const consumed = new Set(events.filter(event => event.type === 'user/message').map(event => event.data.id))
      const descriptor = childEvents.findLast(event => event.type === 'subagent/descriptor')
      const native = childObservation.header?.origin === 'subagent' && childObservation.header.parentSession === id && descriptor?.data.mode === 'continuable'
      const pending = native && mode === 'continuable' && end && result === 'pending' && childStatus !== 'running' && !(start && start.seq > end.seq)
        ? [...inserted.values()].find(({ message, time }) => !consumed.has(message.id) && time >= end.time && message.role === 'user'
          && (message.source as { kind?: string; form?: string; senderSessionId?: string } | undefined)?.kind === 'subagent-settled'
          && (message.source as { form?: string }).form === 'notice' && (message.source as { senderSessionId?: string }).senderSessionId === childId) : undefined
      children.push({ session: { runtimeId, sessionId: childId }, mode, status: childStatus, result, returned: !!end && !(start && start.seq > end.seq),
        ...(end ? { endSeq: end.seq, attempt: { turn: end.data.turn, reason: end.data.reason?.kind } } : {}),
        ...(pending ? { settlement: { message: structuredClone(pending.message), endSeq: end!.seq } } : {}) })
    }
    const registry = (this.ctx.get as (key: string) => unknown).call(this.ctx, 'jobs') as PublicJobRegistry | undefined
    // Official V3→V4 restoration retains unknown ignorable fork records under
    // plugin:<old-type>. Their original epoch/instance domain stays separate.
    const journal = events.filter(event => ['jobs/registered', 'jobs/settled', 'jobs/collected'].includes(
      event.ignorable === true && event.type.startsWith('plugin:') ? event.type.slice('plugin:'.length) : event.type,
    )).map(event => event.data as unknown as import('../work-execution/job-observation.ts').PublicJobObservation)
    const jobs = observeJobs(registry, id, runtimeId, journal, events)
    return { session, role, ...(parent ? { parent } : {}), status, children, tools: [...toolCalls].map(([callId, name]) => ({ callId, name })), jobs: jobs.jobs, jobObservation: jobs.capability, waitingHuman: !!questions?.active.length || questionCalls.size > 0,
      ...(ended ? { attempt: { turn: ended.data.turn, reason: ended.data.reason?.kind } } : {}) }
  }
  async pressure(id: SessionId): Promise<number | undefined> {
    using observation = await this.query.observeSession(id)
    const pressure = observation.projections?.values.contextPressure as { projectedTokens?: number; pressureTokens?: number } | undefined
    return pressure?.projectedTokens ?? pressure?.pressureTokens
  }
  /** A queue acknowledgement is distinct from admission into a model request. */
  async deliveryState(id: SessionId, delivery: Delivery): Promise<'consumed' | 'queued' | 'missing'> {
    const agent = await this.agent(id)
    if ((await this.events(id)).some(event => event.type === 'user/message' && event.data.id === delivery.message.id)) return 'consumed'
    const queued = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(message => message.id === delivery.message.id)
    return queued ? 'queued' : 'missing'
  }
  /** Public wake latch: a transient inbox item wakes existing work, then is removed before maintenance releases it. */
  async wakePending(agent: Agent, inMaintenance = false): Promise<boolean> {
    if (agent.status !== 'idle' || agent.inbox.nextTurn.length + agent.inbox.nextStep.length === 0) return false
    const wake = async () => {
      const signal = createUserMessage({ content: [], source: { kind: 'a2d2-task-runtime', eventId: 'wake-inbox', form: 'notice', summary: 'Resume pending task input' } })
      agent.followup(signal)
      if (!agent.inbox.remove(signal.id)) throw new Error('Runtime wake signal escaped its maintenance boundary')
      await this.flush(agent)
    }
    if (inMaintenance) await wake()
    else await agent.runMaintenance(wake)
    return true
  }
  /** Read-back by stable message identity closes retry-after-flush windows. */
  async deliver(id: SessionId, delivery: Delivery, inMaintenance = false): Promise<void> {
    const agent = await this.agent(id)
    await this.flush(agent)
    const state = await this.deliveryState(id, delivery)
    if (state === 'missing') agent.followup(delivery.message)
    else if (state === 'queued') await this.wakePending(agent, inMaintenance)
    await this.flush(agent)
  }
  /** A continuable child is safe only after its settled notice reached the parent log. */
  async unsettledChildren(id: SessionId): Promise<boolean> {
    const events = await this.events(id)
    const settled = new Map(events.filter(event => event.type === 'user/message'
      && event.data.source?.kind === 'subagent-settled')
      .map(event => [event.data.source.senderSessionId as string, event.time]))
    for (const event of events) {
      if (event.type !== 'subagent/catalog') continue
      const child = event.data.childId as SessionId
      if (this.agents.get(child)?.status === 'running') return true
      const childEvents = await this.events(child)
      const ended = childEvents.findLast(item => item.type === 'turn/end')
      const started = childEvents.findLast(item => item.type === 'turn/start')
      if (!ended || (started && started.seq > ended.seq)) return true
      if (event.data.mode === 'continuable') {
        if ((settled.get(child) ?? -1) < ended.time) return true
      } else if (event.data.mode !== 'one-shot') return true
    }
    return false
  }
  async lastTurnFailure(id: SessionId): Promise<{ id: string; message: string; userCancelled: boolean } | undefined> {
    const event = [...await this.events(id)].reverse().find(item => item.type === 'turn/end')
    const kind = event?.data.reason?.kind
    if (['error', 'blocked', 'aborted', 'interrupted', 'max-tokens'].includes(kind)) {
      return {
        id: `${id}:${event!.seq}`,
        message: `Last turn ended ${kind}: ${event?.data.reason?.error?.message ?? ''}`,
        userCancelled: kind === 'aborted' && event?.data.reason?.reason?.kind === 'user',
      }
    }
  }
  async askedHuman(id: SessionId): Promise<boolean> {
    using observation = await this.query.observeSession(id)
    const questions = observation.projections?.values.userQuestions as { active: readonly unknown[] } | undefined
    if (questions?.active.length) return true
    const calls = new Set<string>()
    for (const event of observation.events.slice(observation.inheritedEventCount)) {
      if (event.type === 'tool/call' && ['ask_user', 'ask_user_question'].includes(event.data.name)) calls.add(event.data.callId)
      if (event.type === 'tool/result') calls.delete(event.data.message?.toolCallId)
    }
    return calls.size > 0
  }
  async progress(id: SessionId): Promise<string> {
    const events = await this.events(id)
    const start = events.findLastIndex(event => event.type === 'turn/start')
    const content = events.slice(start).flatMap(event => {
      if (event.type === 'assistant/message') return [(event.data.message?.content ?? []).map((block: Record<string, unknown>) => {
        const { id: _id, ...content } = block
        return content
      })]
      if (event.type === 'tool/result') return [event.data.message?.content ?? []]
      return []
    })
    return createHash('sha256').update(JSON.stringify(content)).digest('hex')
  }
  async waitingOnWatch(id: SessionId): Promise<boolean> {
    const events = await this.events(id)
    const start = events.findLastIndex(event => event.type === 'turn/start')
    const calls = new Set(events.slice(start).filter(event => event.type === 'tool/call'
      && event.data.name === 'github_watch').map(event => event.data.callId))
    return events.slice(start).some(event => {
      if (event.type !== 'tool/result' || event.data.message?.isError || !calls.has(event.data.message?.toolCallId)) return false
      const result = event.data.meta?.a2d2GitHubWatch
      return result && (result.status === 'pending' || (result.status === 'watching' && result.state === 'open'))
    })
  }
}
