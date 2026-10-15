import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Delivery, RunRecord } from './types.ts'

interface Event { type: string; seq: number; time: number; data: Record<string, any> }
interface Observation extends Disposable {
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
interface Persistence { stat(id: SessionId): Promise<unknown | undefined> }

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
    let agent = this.agents.get(id)
    if (!agent) {
      const persisted = await (this.ctx.get('sessionPersistence') as unknown as Persistence).stat(id)
      agent = persisted === undefined
        ? (await this.agents.create({ sessionId: id, meta: { cwd: record.cwd } })).agent
        : await this.agent(id)
    }
    const workspace = this.workspaces.get(record.workspace)
    if (!workspace) throw new Error(`Recorded workspace ${record.workspace} is unavailable`)
    await workspace.attachSession(id)
    await this.ctx.a2d2.initializeSessionAgent(record.cwd, id, 'ceo')
    await this.flush(agent)
    return agent
  }
  async flush(agent: Agent): Promise<void> {
    if (!await this.ctx.sessions.flush(agent.session)) throw new Error(`Session ${agent.id} is no longer live`)
  }
  async events(id: SessionId): Promise<readonly Event[]> {
    using observation = await this.query.observeSession(id)
    return observation.events.slice(observation.inheritedEventCount)
  }
  async pressure(id: SessionId): Promise<number | undefined> {
    using observation = await this.query.observeSession(id)
    const pressure = observation.projections?.values.contextPressure as { projectedTokens?: number; pressureTokens?: number } | undefined
    return pressure?.projectedTokens ?? pressure?.pressureTokens
  }
  /** Read-back by stable message identity closes retry-after-flush windows. */
  async deliver(id: SessionId, delivery: Delivery): Promise<void> {
    const agent = await this.agent(id)
    await this.flush(agent)
    const events = await this.events(id)
    let observed = false
    for (const event of events) {
      if (event.type === 'user/message' && event.data.id === delivery.message.id) observed = true
    }
    const queued = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(message => message.id === delivery.message.id)
    if (!observed && !queued) agent.followup(delivery.message)
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
    // Registration declares an external dependency. A delivered task event or
    // explicit continue supplies a later turn that can choose further work.
    return events.slice(start).some(event => event.type === 'tool/call' && event.data.name === 'github_watch')
  }
}
