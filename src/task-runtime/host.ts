import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Delivery, RunRecord } from './types.ts'
import { createRootSession, rootSessionProfile } from '../root-session.ts'

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
