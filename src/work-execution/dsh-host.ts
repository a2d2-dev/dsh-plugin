import { supersededReminders } from './reminders.ts'
import { continuationBoundary } from './continuation.ts'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { humanGuardIntent } from './guard.ts'
import type { WorkGuard } from './guard.ts'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-fs-local'
import type {} from '@deepseek-ai/dsh-bash-local'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { createUserMessage, MessageId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { WorkEvent, WorkExecution } from '../work-types.ts'
import { RuntimeHost } from '../task-runtime/host.ts'
import { rootSessionProfile } from '../root-session.ts'
import { resolveSessionAgent } from '../official-session.ts'
import { WorkExecutionError } from './host.ts'
import type { WorkAdmission, MaintenanceAdmission, WorkExecutionHost } from './host.ts'
import { settleUncollectedJob } from './job-observation.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'a2d2-work-input-seal': { kind: 'a2d2-work-input-seal'; operationId: string }
    'a2d2-work-child-result': { kind: 'a2d2-work-child-result'; executionId: string; parent: import('../work-types.ts').SessionRef; child: import('../work-types.ts').SessionRef; endSeq: number; noticeId: string }
    'a2d2-work-dispatch': { kind: 'a2d2-work-dispatch' }
    'a2d2-work-context': { kind: 'a2d2-work-context'; form: 'notice'; summary: string }
  }
}

/** Deterministic original visible output. seq/turn/message IDs resolve the full native log. */
export function projectChildResult(events: readonly Pick<Awaited<ReturnType<RuntimeHost['events']>>[number], 'type' | 'seq' | 'data'>[]) {
  return events.flatMap<{ type: string; seq: number; data: Record<string, unknown> }>(event => {
    const { type, seq, data } = event
    if (type === 'turn/start' || type === 'turn/end') return [{ type, seq, data: { ...(data.turn !== undefined ? { turn: data.turn } : {}), ...(data.reason !== undefined ? { reason: data.reason } : {}) } }]
    if (type !== 'assistant/message' && type !== 'tool/result') return []
    const message = data.message
    if (type === 'tool/result' && !message?.isError) return [{ type, seq, data: { toolCallId: message?.toolCallId, isError: false } }]
    const content = (message?.content ?? []).flatMap((block: { type: string; text?: string }) => block.type === 'text' ? [{ type: 'text', text: block.text }] : [])
    if (!content.length && !message?.isError) return []
    return [{ type, seq, data: { message: { id: message.id, role: message.role, ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}), ...(message.isError !== undefined ? { isError: message.isError } : {}), content } } }]
  })
}

const installed = new WeakMap<Agent, { executionId: string }>()
/** Public DSH create, preset, local model, maintenance and persisted delivery APIs. */
export class DshWorkExecutionHost implements WorkExecutionHost {
  readonly runtime: RuntimeHost
  constructor(private readonly ctx: Context, readonly runtimeId: string) { this.runtime = new RuntimeHost(ctx) }
  /** The production plugin also serves local browsing without execution services. */
  private service<K extends keyof Context>(name: K, ...methods: string[]): NonNullable<Context[K]> {
    const service = (this.ctx.get as (key: string) => unknown).call(this.ctx, name as string)
    if (!service) throw new WorkExecutionError('host-capability-unavailable', `DSH ${String(name)} is required for managed execution`)
    for (const method of methods) {
      if (typeof (service as Record<string, unknown>)[method] !== 'function') throw new WorkExecutionError('host-capability-unavailable', `DSH ${String(name)}.${method} is required for managed execution`)
    }
    return service as NonNullable<Context[K]>
  }
  private authorize?: (sessionId: string, messages?: readonly import('../work-types.ts').NativeWorkMessage[]) => Promise<WorkAdmission>
  private stepBoundary?: (sessionId: string) => Promise<boolean>
  connectStepBoundary(observe: (sessionId: string) => Promise<boolean>): void { this.stepBoundary = observe }
  private conversation?: (sessionId: string) => Promise<string | undefined>
  private pendingHumanInput?: (sessionId: string) => Promise<readonly import('../work-types.ts').NativeWorkMessage[]>
  private filterInput?: (sessionId: string, messages: readonly import('../work-types.ts').NativeWorkMessage[]) => Promise<readonly import('../work-types.ts').NativeWorkMessage[]>
  private readonly maintenanceTurns = new WeakMap<Agent, MaintenanceAdmission>()
  private readonly admittedTurns = new WeakMap<Agent, number>()
  private readonly conversationSnapshots = new WeakMap<Agent, string>()
  private readonly activeTools = new Map<import('@deepseek-ai/dsh-tools').ToolExecutionToken, import('@deepseek-ai/dsh-tools').ToolExecution>()
  private readonly resumeInstructions = new WeakMap<Agent, string>()
  private guard?: WorkGuard
  private readonly guardWaitCommands = new WeakMap<Agent, string>()
  private readonly guardProgress = new WeakMap<Agent, Set<string>>()
  private readonly guardIntent = new WeakMap<Agent, ReturnType<typeof humanGuardIntent>>()
  connectGuard(guard: WorkGuard): void { this.guard = guard }
  private steerGuard(agent: Agent, text: string): void {
    agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'a2d2-work-context', form: 'notice', summary: '继续已授权的工作' } }))
  }
  private connected = false
  connect(authorize: (sessionId: string, messages?: readonly import('../work-types.ts').NativeWorkMessage[]) => Promise<WorkAdmission>, conversation?: (sessionId: string) => Promise<string | undefined>, pendingHumanInput?: (sessionId: string) => Promise<readonly import('../work-types.ts').NativeWorkMessage[]>, filterInput?: (sessionId: string, messages: readonly import('../work-types.ts').NativeWorkMessage[]) => Promise<readonly import('../work-types.ts').NativeWorkMessage[]>): void {
    this.authorize = authorize
    this.conversation = conversation
    this.pendingHumanInput = pendingHumanInput
    this.filterInput = filterInput
    if (this.connected) return
    this.connected = true
    this.ctx.on('agent/pre-step', async ({ agent, messages, turn }, next) => {
      // Task scheduling controls automatic turns, never the native human conversation.
      // An admitted turn can finish its tool results and final answer after wait/done.
      const managed = !!await this.conversation?.(agent.id)
      if (managed) {
        const superseded = supersededReminders([...messages, ...agent.inbox.nextStep, ...agent.inbox.nextTurn])
        for (const id of superseded) {
          if (agent.inbox.remove(MessageId(id))) continue
          const claimed = messages.find(message => message.id === id)
          if (claimed) {
            // A claim is not consumption. Publish its explicit cancellation so
            // a later source seal cannot resurrect this superseded envelope.
            agent.inbox.splice('next-turn', agent.inbox.nextTurn.length, 0, [claimed])
            agent.inbox.remove(claimed.id)
          }
        }
        const replacedHead = messages.some(message => superseded.has(message.id))
        for (let i = messages.length - 1; i >= 0; i--) if (superseded.has(messages[i]!.id)) messages.splice(i, 1)
        if (replacedHead && !messages.length) {
          const retained = agent.inbox.nextStep[0] ?? agent.inbox.nextTurn[0]
          if (retained && agent.inbox.remove(retained.id)) messages.push(retained)
        }
      }
      let filteredHead = false
      if (messages.length && this.filterInput) {
        const filtered = await this.filterInput(agent.id, messages)
        filteredHead = filtered.length === 0
        messages.splice(0, messages.length, ...filtered as UserMessage[])
      }
      const humans = messages.filter(message => message.source?.kind === 'user')
      const automatic = messages.filter(message => message.source?.kind !== 'user')
      // Queue controls normal unmanaged conversations. Managed Task input must
      // reach the next safe step even when the automatic head is admissible.
      if (managed) for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
        if (message.source?.kind === 'user' && agent.inbox.remove(message.id)) humans.push(message)
      }
      if (managed && this.pendingHumanInput) {
        const pending = await this.pendingHumanInput(agent.id)
        if (pending.length) {
          const seen = new Set<string>(messages.map(message => message.id))
          for (const message of humans) seen.add(message.id)
          for (const event of await this.runtime.events(agent.id)) if (event.type === 'user/message') seen.add(event.data.id)
          humans.unshift(...structuredClone(pending.filter(message => !seen.has(message.id))) as UserMessage[])
        }
      }
      const human = humans.length > 0
      // Discarding a claimed control must not strand a valid envelope behind it.
      // Human recovery above retains precedence; an admitted turn keeps its tool tail.
      if (filteredHead && !human && this.admittedTurns.get(agent) !== turn) {
        const queued = [...agent.inbox.nextStep, ...agent.inbox.nextTurn]
        const retainedInputs = await this.filterInput!(agent.id, queued)
        const retained = queued.find(message => retainedInputs.includes(message))
        if (!retained || !agent.inbox.remove(retained.id)) return { kind: 'reject' }
        automatic.push(retained)
      }
      let businessInstruction: string | undefined
      const proceed = human || this.maintenanceTurns.has(agent) || await this.stepBoundary?.(agent.id) !== false
      if (human && automatic.length || !human && (!proceed || this.admittedTurns.get(agent) !== turn)) {
        // The host claims one next-turn envelope. Inspect all already queued
        // automatic input at this safe boundary so an unrelated old notice
        // cannot hide the exact result that satisfies a model-owned wait.
        // Rejected input is persisted by authorize in the Task recovery lane.
        if (managed) for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
          if (message.source?.kind !== 'user' && agent.inbox.remove(message.id)) automatic.push(message)
        }
        const admission = await this.authorize!(agent.id, automatic)
        if (!admission) {
          // Authorization persists deferred automatic envelopes in their Task
          // recovery lane. Human conversation never smuggles them past control.
          if (!human) return { kind: 'reject' }
          messages.splice(0, messages.length, ...humans)
          this.maintenanceTurns.delete(agent)
        } else {
          const maintenance = typeof admission === 'object' && 'step' in admission
          if (human && maintenance) agent.inbox.splice('next-turn', 0, 0, automatic)
          messages.splice(0, messages.length, ...(human && maintenance ? [] : automatic), ...humans)
          if (!human && maintenance) this.maintenanceTurns.set(agent, admission)
          else {
            this.maintenanceTurns.delete(agent)
            if (!human && typeof admission === 'object' && 'instruction' in admission) businessInstruction = admission.instruction
          }
        }
      } else if (human) messages.splice(0, messages.length, ...humans)
      if (human) {
        this.maintenanceTurns.delete(agent)
        this.guardIntent.set(agent, humanGuardIntent(humans))
        await this.guard?.(agent.id, { kind: 'ingress', messages: humans })
      }
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const scope = this.maintenanceTurns.get(agent)
      if (scope?.step === 'settle') decision.messages = decision.messages.filter(message => scope.messageIds!.includes(message.id))
      this.admittedTurns.set(agent, turn)
      if (businessInstruction) decision.messages.push(createUserMessage({
        content: [{ type: 'text', text: businessInstruction }],
        source: { kind: 'a2d2-work-context', form: 'notice', summary: '接续维护已结束，推进原任务' },
      }))
      const context = [await this.conversation?.(agent.id), this.resumeInstructions.get(agent)].filter(Boolean).join('\n')
      this.resumeInstructions.delete(agent)
      if (context && context !== this.conversationSnapshots.get(agent)) {
        this.conversationSnapshots.set(agent, context)
        decision.messages.push(createUserMessage({
          content: [{ type: 'text', text: context }],
          source: { kind: 'a2d2-work-context', form: 'notice', summary: context.split('\n')[0]! },
        }))
      }
      return decision
    }, { prepend: true })
    this.ctx.on('agent/created', async ({ agent, source, signal }) => {
      if (!['startup', 'resume', 'compact'].includes(source) || signal?.aborted) return
      const instruction = await this.guard?.(agent.id, { kind: 'resume' })
      // Resolving/viewing a Session may create its Agent. Keep this directive
      // silent until an independently admitted turn; browsing never starts work.
      if (instruction && !signal?.aborted) this.resumeInstructions.set(agent, instruction)
    })
    this.ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
      if (signal.aborted || this.maintenanceTurns.has(agent)) return
      const intent = this.guardIntent.get(agent) ?? { answerOnly: false, recheckWait: false }
      const progress = [...(this.guardProgress.get(agent) ?? [])]
      this.guardProgress.delete(agent)
      const currentWaitCommand = this.guardWaitCommands.get(agent)
      this.guardWaitCommands.delete(agent)
      const instruction = await this.guard?.(agent.id, { kind: 'stopping', progress, ...intent, ...(currentWaitCommand ? { currentWaitCommand } : {}) })
      if (instruction && !signal.aborted) this.steerGuard(agent, instruction)
    })
    this.ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') { this.admittedTurns.delete(agent); this.maintenanceTurns.delete(agent); this.guardIntent.delete(agent); this.guardProgress.delete(agent); this.guardWaitCommands.delete(agent) } })
    this.ctx.inject(['tools'], toolsCtx => { toolsCtx.effect(() => toolsCtx.tools.guard(exec => {
      const scope = exec.agent && this.maintenanceTurns.get(exec.agent)
      if (!scope) return
      const allowed = scope.step === 'material' ? exec.name === 'work_continuation_material'
        : scope.step === 'receive' ? exec.name === 'work_continuation_received'
        : scope.step === 'collect' && exec.name === 'job_output' && scope.jobIds?.includes(String((exec.arguments as { job_id?: unknown } | undefined)?.job_id))
      if (!allowed || exec.parent) return `Continuation ${scope.operationId} permits only its ${scope.step} maintenance step; business tools are unavailable in this maintenance turn, including after receipt; stop this turn and let the plugin admit the next business turn under current Task control`
    }), 'narrow continuation maintenance tools') })
    this.ctx.on('tools/result', (exec, result) => {
      this.activeTools.delete(exec.token)
      if (exec.agent && !exec.parent && !result.isError && exec.name === 'work_control') {
        const args = exec.arguments as { action: string; yield_reason?: string }
        if (args.action === 'wait' && args.yield_reason && args.yield_reason !== 'internal') {
          const value = JSON.parse((result.value as { result: string }).result) as { status: string; saved?: boolean }
          if (value.status === 'completed' && value.saved) this.guardWaitCommands.set(exec.agent,
            `tool:${createHash('sha256').update(JSON.stringify([this.runtimeId, exec.agent.id, exec.callId])).digest('hex')}`)
        }
      }
      // A report/status/Goal update is coordination, not work. Repeated identical
      // reads keep the same identity across turns and process reloads.
      if (!exec.agent || exec.parent || result.isError || this.maintenanceTurns.has(exec.agent)
        || /^(?:work_(?!related_issue$).*|.*goal.*)$/.test(exec.name)) return
      let identity: unknown = [exec.name, exec.arguments, result.content]
      if (exec.name === 'work_related_issue') {
        // This tool's own normalized result has a stable source schema. Fresh
        // observation timestamps and local report versions are not new facts.
        const value = JSON.parse((result.value as { result: string }).result) as { status: string; issue?: import('../work-sources/types.ts').GitHubIssue }
        if (value.status !== 'completed' || !value.issue) return
        const { observedAt, updatedAt, ...issue } = value.issue
        identity = [exec.name, issue]
      }
      const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
      const progress = this.guardProgress.get(exec.agent) ?? new Set<string>()
      progress.add(key)
      this.guardProgress.set(exec.agent, progress)
    })
    this.ctx.on('tools/pre-execute', async (exec, next) => {
      // Observation includes admission still in flight. Task writes authorize in WorkApplication.
      this.activeTools.set(exec.token, exec)
      return next()
    }, { prepend: true })
  }
  async failure(execution: WorkExecution): Promise<{ id: string; message: string; userCancelled: boolean } | undefined> {
    if (!execution.actual) return undefined
    const events = await this.runtime.events(SessionId(execution.session.sessionId))
    const last = events.findLast(event => event.type === 'turn/end')
    const kind = last?.data.reason?.kind
    const userCancelled = kind === 'aborted' && last!.data.reason?.reason?.kind === 'user'
    // A live turn supersedes provider failures, but native conversation alone
    // never acknowledges a user's Stop of managed work.
    if (!userCancelled && this.status(execution) === 'running' && events.some(event => event.type === 'turn/start' && (!last || event.seq > last.seq))) return undefined
    // Controlled admission blocks are already described by control/handoff state.
    if (!['error', 'aborted', 'interrupted', 'max-tokens'].includes(kind)) return undefined
    return { id: `${execution.session.sessionId}:${last!.seq}`, message: `Last model turn ended ${kind}: ${last!.data.reason?.error?.message ?? ''}`.slice(0, 100_000), userCancelled }
  }
  async profile(execution: WorkExecution): Promise<NonNullable<WorkExecution['actual']>> {
    const id = SessionId(execution.session.sessionId)
    const agent = await this.runtime.agent(id)
    const profile = await rootSessionProfile(this.ctx, id)
    await this.runtime.flush(agent)
    using observation = await this.service('sessionQuery').observeSession(id)
    const events = observation.events
    const selection = events.findLast(event => event.type === 'model/selection')
    const header = events.findLast(event => event.type === 'request/header')
    const route = selection && (!header || selection.seq > header.seq) ? selection.data : header?.data.header?.config
    const workspace = this.service('workspaceRegistry').list().find(item => item.id === execution.resource.workspaceId)
    if (!workspace?.sessionIds.includes(id) || agent.session.header.cwd !== workspace.path || !profile.agentPreset || !profile.permission?.sandbox || !profile.permission.approval || !route?.provider || !route.model) {
      throw new WorkExecutionError('continuation-profile-unknown', 'Actual source workspace, model, preset and effective permissions must be known')
    }
    if (!this.service('permissionPresets').names.includes(profile.permission.preset)) throw new WorkExecutionError('continuation-permission-unknown', 'Custom source permission cannot be safely recreated by this host adapter')
    return { runtimeId: this.runtimeId, cwd: workspace.path, agentPreset: profile.agentPreset,
      provider: route.provider, model: route.model, ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}), permissionPreset: profile.permission.preset, sandbox: profile.permission.sandbox, approval: profile.permission.approval }
  }
  async measure(execution: WorkExecution): Promise<import('../work-types.ts').ContinuationObservation> {
    const profile = await this.profile(execution)
    const agent = await this.runtime.agent(SessionId(execution.session.sessionId))
    const meter = (this.ctx.get as (name: string) => unknown).call(this.ctx, 'tokenMeter') as {
      measure(session: typeof agent.session): { totalTokens: number; logRevision: number; baseline: { kind: 'usage' | 'estimated' | 'none' } }
    } | undefined
    if (!meter?.measure) throw new WorkExecutionError('continuation-meter-unavailable', 'Public tokenMeter.measure is unavailable; automatic continuation is blocked')
    const info = await this.service('llm', 'resolveModelInfo').resolveModelInfo(profile.provider, profile.model)
    const header = agent.session.requestHeader()?.config
    if (header && (header.provider !== profile.provider || header.model !== profile.model || header.reasoningEffort !== profile.reasoningEffort)) throw new WorkExecutionError('continuation-route-changed', 'Source model selection differs from its measured request route; reconfigure after the route is established')
    const capacity = info.context?.contextWindow
    const outputReserve = Math.max(header?.maxTokens ?? 0, info.defaultMaxTokens ?? 0)
    if (!Number.isSafeInteger(capacity) || !capacity || !Number.isSafeInteger(outputReserve) || !outputReserve || outputReserve >= capacity) throw new WorkExecutionError('continuation-metadata-unknown', 'Exact model context capacity and output reserve must both be known')
    const measured = meter.measure(agent.session)
    if (measured.logRevision !== agent.session.seq || !Number.isFinite(measured.totalTokens) || measured.totalTokens < 0 || !['usage', 'estimated', 'none'].includes(measured.baseline.kind)) throw new WorkExecutionError('continuation-meter-stale', 'Token measurement is invalid or does not cover the current source log')
    return { totalTokens: measured.totalTokens, logRevision: measured.logRevision, baseline: measured.baseline.kind,
      capacity, outputReserve, routeKey: JSON.stringify([profile.provider, profile.model, profile.reasoningEffort ?? null, capacity, outputReserve]), observedAt: new Date().toISOString() }
  }
  private observationScope?: import('./observation.ts').ObservationScope
  connectObservation(scope: import('./observation.ts').ObservationScope): void { this.observationScope = scope }
  async observation(execution: WorkExecution, associations?: readonly import('../work-types.ts').SessionAssociation[], reporter?: import('@deepseek-ai/dsh-tools').ToolExecutionToken): Promise<import('./observation.ts').ExecutionObservation> {
    const { sessionKey } = await import('./observation.ts')
    const roots = new Map<string, { session: import('../work-types.ts').SessionRef; role: import('./observation.ts').ObservedSession['role']; parent?: import('../work-types.ts').SessionRef }>()
    const blockers: import('./observation.ts').ExecutionBlocker[] = []
    const reminders = new Set<string>()
    const limitations = new Set<string>()
    let bindings: readonly import('../work-types.ts').SessionAssociation[] = associations ?? []
    if (associations === undefined) {
      try {
        if (!this.observationScope) throw new Error('Authority scope resolver is unavailable')
        bindings = await this.observationScope(execution)
      } catch { blockers.push({ code: 'execution-scope-unavailable', session: execution.session }); limitations.add('无法从权威 Task 记录证明完整关联范围，结算状态未知。') }
    }
    for (const binding of bindings) roots.set(sessionKey(binding.session), { session: binding.session, role: binding.purpose })
    for (const old of execution.retired ?? []) roots.set(sessionKey(old.session), { session: old.session, role: 'retired' })
    roots.set(sessionKey(execution.session), { session: execution.session, role: 'current' })
    const receivedChildren = new Map<string, number>()
    if (execution.childReceipts?.length) {
      for (const receipt of execution.childReceipts) {
        if (receipt.complete && await this.childReceiptCommitted(execution, receipt)) receivedChildren.set(sessionKey(receipt.child), receipt.endSeq)
      }
    }

    const reporting = reporter && this.activeTools.get(reporter)
    const trustedReport = reporting?.name === 'work_report' && !reporting.parent && reporting.agent?.id === execution.session.sessionId ? reporting : undefined
    const sessions: import('./observation.ts').ObservedSession[] = []
    const seen = new Set<string>()
    for (const root of roots.values()) {
      const key = sessionKey(root.session)
      if (seen.has(key)) continue
      seen.add(key)
      if (root.session.runtimeId !== this.runtimeId) {
        blockers.push({ code: 'executor-runtime-unavailable', session: root.session }); limitations.add('关联执行者属于其他宿主，未读取其会话。'); continue
      }
      try {
        const row = await this.runtime.executionFacts(SessionId(root.session.sessionId), this.runtimeId, root.role, root.parent)
        sessions.push(row)
        const active = [...this.activeTools.values()].filter(call => call.agent?.id === row.session.sessionId)
        const ownReport = row.role === 'current' && trustedReport && active.length === 1 && active[0]?.token === trustedReport.token
        const outstanding = (row.tools ?? []).filter(call => !(ownReport && call.callId === trustedReport?.callId && call.name === 'work_report'))
        if (outstanding.length || active.some(call => call.token !== (ownReport && trustedReport.token))) blockers.push({ code: 'tool-result-pending', session: row.session })
        if ((row.status === 'running' && !ownReport) || row.status === 'unknown') blockers.push({ code: row.status === 'unknown' ? 'executor-state-unknown' : 'executor-unsettled', session: row.session })
        if (row.waitingHuman) blockers.push({ code: 'executor-waiting-human', session: row.session })
        for (const child of row.children) {
          child.coordinatorReceived = child.returned === true && child.endSeq !== undefined && receivedChildren.get(sessionKey(child.session)) === child.endSeq
          const carried = [execution.continuation, ...(execution.continuationHistory ?? [])].some(op => op?.pendingChildren?.some(pending => sessionKey(pending.child) === sessionKey(child.session)))
          const binding = execution.childReplacements?.find(item => sessionKey(item.child) === sessionKey(child.session) && sessionKey(item.parent) === sessionKey(row.session))
          let replaced = false
          if (binding && child.returned && child.endSeq === binding.endSeq && ['idle', 'inactive'].includes(child.status) && receivedChildren.get(sessionKey(binding.replacement)) === binding.replacementEndSeq) {
            const parent = await this.runtime.executionFacts(SessionId(binding.replacementParent.sessionId), this.runtimeId, 'retired')
            const replacement = parent.children.find(item => sessionKey(item.session) === sessionKey(binding.replacement))
            replaced = replacement?.returned === true && replacement.endSeq === binding.replacementEndSeq && replacement.attempt?.reason === 'completed' && ['idle', 'inactive'].includes(replacement.status)
          }
          if (carried && child.returned && child.attempt?.reason !== 'completed' && !replaced) blockers.push({ code: 'child-work-unfinished', session: child.session })
          if (!replaced && (!child.returned || (child.mode === 'continuable' && child.result !== 'consumed' && !child.coordinatorReceived) || child.mode === 'unknown')) blockers.push({ code: 'native-result-pending', session: row.session })
          if (!roots.has(sessionKey(child.session))) roots.set(sessionKey(child.session), { session: child.session, role: 'native-child', parent: row.session })
        }
        if (row.jobObservation === 'unavailable') { blockers.push({ code: 'job-observation-unavailable', session: row.session }); limitations.add('当前宿主缺少正式 jobs.observe 非消费接口，无法证明终态结果已交付。') }
        // A host without any jobs service has no registry to prove reachability:
        // job facts come from the journal alone, which is a bounded limitation.
        if (row.jobObservation === 'disabled' && row.jobs.length) limitations.add('宿主未提供 jobs 服务：作业结果只能依据会话日志判断，不可达作业只提醒不阻断。')
        for (const job of row.jobs) {
          // A reachable result must be collected before completion; a job whose
          // registry instance is gone only leaves a bounded reminder (#201).
          const settled = settleUncollectedJob(job)
          if (settled.blocker) blockers.push({ code: settled.blocker, session: row.session, jobId: job.id })
          // A list-only host cannot prove delivery and already raises
          // job-observation-unavailable; a parallel "registry unreachable"
          // reminder for the same job would contradict that blocker.
          if (settled.reminder && row.jobObservation !== 'unavailable') reminders.add(settled.reminder)
          if (job.result === 'unknown') limitations.add('作业输出交付与模型消费、业务验收分别呈现；公开观察不会调用 jobs.read。')
        }
      } catch {
        blockers.push({ code: 'executor-observation-unavailable', session: root.session }); limitations.add('相关执行者观察失败，接续安全状态未知。')
      }
    }
    const unknown = blockers.some(blocker => /unknown|unavailable/.test(blocker.code))
    return { settlement: unknown ? 'unknown' : blockers.length ? 'pending' : 'settled', sessions, blockers, reminders: [...reminders], limitations: [...limitations] }
  }
  /** Read facts from their original trusted coordinator logs, including retired epochs. */
  async childReceiptCommitted(execution: WorkExecution, receipt: NonNullable<WorkExecution['childReceipts']>[number]): Promise<boolean> {
    const coordinators = [{ session: execution.session, epoch: execution.epoch }, ...(execution.retired ?? [])]
    // Legacy receipts have one epoch and no per-page provenance. Resolve only through this execution.
    const legacy = coordinators.find(item => item.epoch === receipt.epoch)
    const pages = receipt.pages ?? (legacy ? receipt.callIds.map(callId => ({ session: legacy.session, epoch: receipt.epoch, callId })) : [])
    if (!pages.length || pages.length !== receipt.callIds.length) return false
    const logs = new Map<string, Awaited<ReturnType<RuntimeHost['events']>>>()
    let cursor = 0
    for (const [index, page] of pages.entries()) {
      if (page.callId !== receipt.callIds[index] || page.session.runtimeId !== this.runtimeId || !coordinators.some(item => item.epoch === page.epoch && item.session.runtimeId === page.session.runtimeId && item.session.sessionId === page.session.sessionId)) return false
      const id = page.session.sessionId
      if (!logs.has(id)) logs.set(id, await this.runtime.events(SessionId(id)))
      const events = logs.get(id)!
      const call = events.find(event => event.type === 'tool/call' && event.data.callId === page.callId && event.data.name === 'work_child_recover')
      const result = events.find(event => event.type === 'tool/result' && event.data.message?.toolCallId === page.callId && !event.data.message?.isError)
      if (!call || !result || result.seq <= call.seq) return false
      let arguments_: { child_session_id?: string; action?: string; expected_epoch?: number; cursor?: number; revision?: string }
      try { arguments_ = JSON.parse(call.data.arguments) } catch { return false }
      if (arguments_.child_session_id !== receipt.child.sessionId || arguments_.action !== 'result' || arguments_.expected_epoch !== page.epoch || (arguments_.cursor ?? 0) !== cursor || (cursor > 0 && arguments_.revision !== receipt.revision)) return false
      const text = result.data.message.content?.filter((block: { type: string }) => block.type === 'text').map((block: { text: string }) => block.text).join('')
      let returned: { status?: string; childStatus?: string; endSeq?: number; revision?: string; child?: { runtimeId?: string; sessionId?: string }; content?: string; nextCursor?: number; complete?: boolean }
      try { returned = JSON.parse(text) } catch { return false }
      if (returned.status !== 'completed' || returned.childStatus !== 'returned' || returned.child?.sessionId !== receipt.child.sessionId || returned.child.runtimeId !== receipt.child.runtimeId || returned.endSeq !== receipt.endSeq || returned.revision !== receipt.revision || typeof returned.content !== 'string') return false
      cursor += returned.content.length
      if (index < pages.length - 1 && (returned.complete !== false || returned.nextCursor !== cursor)) return false
      if (index === pages.length - 1 && (returned.complete !== receipt.complete || (!receipt.complete && returned.nextCursor !== cursor))) return false
    }
    return cursor === receipt.cursor
  }
  async childRecovery(execution: WorkExecution, child: NonNullable<import('../work-types.ts').ContinuationOperation['pendingChildren']>[number], action: 'status' | 'result' | 'resume', request?: NonNullable<WorkExecution['childRecovery']>[number], signal: AbortSignal = new AbortController().signal): Promise<{ status: string; endSeq?: number; messageId?: string; events?: unknown[] }> {
    if (child.child.runtimeId !== this.runtimeId || child.parent.runtimeId !== this.runtimeId) throw new WorkExecutionError('executor-runtime-unavailable', 'Child belongs to another runtime')
    const parentId = SessionId(child.parent.sessionId), childId = SessionId(child.child.sessionId)
    const facts = await this.runtime.executionFacts(parentId, this.runtimeId, 'retired')
    const native = facts.children.find(item => item.session.sessionId === childId)
    if (!native) throw new WorkExecutionError('unrelated-child', 'Original parent catalog does not own this child')
    if (native.status === 'running') return { status: 'running' }
    const events = await this.runtime.events(childId)
    if (native.returned && !(action === 'resume' && ['interrupted', 'error', 'aborted', 'blocked', 'max-tokens'].includes(native.attempt?.reason ?? ''))) {
      const start = events.findLastIndex(event => event.type === 'turn/start')
      return { status: 'returned', endSeq: native.endSeq, ...(action === 'result' ? { events: projectChildResult(events.slice(Math.max(0, start))) } : {}) }
    }
    if (action !== 'resume') return { status: native.status }
    if (native.mode !== 'continuable' || !request) throw new WorkExecutionError('child-not-resumable', 'This exact child is not a native continuable Session')
    const marker = `A²D² Task recovery request ${request.requestId}`
    const accepted = events.flatMap(event => event.type === 'user/message' ? [event.data] : event.type === 'agent/inbox/spliced' ? event.data.inserted ?? [] : []).find(message => message.role === 'user' && message.content?.some((block: { type: string; text?: string }) => block.type === 'text' && block.text?.startsWith(marker)))
    if (accepted) return { status: 'accepted', messageId: accepted.id as string }
    const parent = await this.runtime.agent(parentId).catch(error => {
      throw new WorkExecutionError('child-recovery-parent-unavailable', `Original parent ${parentId} is unavailable for child ${childId}: ${String(error)}. Public child routing cannot restore this layer through an ordinary Session controller. The current coordinator must verify the old execution has stopped before explicitly redelegating its remaining work from the saved workspace and progress. After the replacement completes, fully read its result with work_child_recover result, then call replace for this old child with replacement_child_session_id. Do not duplicate a running child.`)
    })
    const service = (this.ctx.get as (name: string) => unknown).call(this.ctx, 'subagents') as { sendMessage?: (parent: Agent, child: SessionId, content: { type: 'text'; text: string }[], options: { signal: AbortSignal }) => Promise<string> } | undefined
    if (!service?.sendMessage) throw new WorkExecutionError('host-capability-unavailable', 'Public subagents.sendMessage is required for native recovery')
    const messageId = await service.sendMessage(parent, childId, [{ type: 'text', text: `${marker}\nCurrent Task coordinator: ${execution.session.sessionId}, epoch ${execution.epoch}. Original parent linkage remains unchanged. Continue only this authorized child work:\n${request.text}` }], { signal })
    const live = this.ctx.get('agents')?.get(childId)
    if (live) await this.runtime.flush(live)
    return { status: 'accepted', messageId }
  }
  async maintain<T>(execution: WorkExecution, body: () => Promise<T>): Promise<T> {
    if (!this.observationScope) throw new WorkExecutionError('execution-scope-unavailable', 'Safe maintenance requires the authority-owned Task observation scope resolver')
    const id = SessionId(execution.session.sessionId)
    const agent = await this.runtime.agent(id)
    await agent.whenIdle()
    return agent.runMaintenance(async () => {
      await this.runtime.flush(agent)
      const scope = continuationBoundary(await this.observation(execution))
      const related = scope.sessions.map(row => this.ctx.get('agents')?.get(SessionId(row.session.sessionId)))
        .filter((candidate): candidate is Agent => !!candidate && candidate.id !== id)
      const held = new Set<string>([id])
      const lock = async (index: number): Promise<T> => {
        const candidate = related[index]
        if (candidate) {
          if (candidate.status !== 'idle') throw new WorkExecutionError('continuation-waiting-executions', 'A related executor is still running')
          held.add(candidate.id)
          return candidate.runMaintenance(async () => { await this.runtime.flush(candidate); return lock(index + 1) })
        }
        // The graph was read once to identify locks. Read again while every live
        // executor is fenced: no related tool can start a job between check/take.
        const observation = continuationBoundary(await this.observation(execution))
        if (observation.settlement !== 'settled') throw new WorkExecutionError('continuation-waiting-executions', `Continuation is waiting for related execution facts: ${observation.blockers.map(blocker => `${blocker.code}:${blocker.session.sessionId}${blocker.jobId ? `:${blocker.jobId}` : ''}`).join(', ')}`)
        const added = observation.sessions.map(row => this.ctx.get('agents')?.get(SessionId(row.session.sessionId)))
          .filter((candidate): candidate is Agent => !!candidate && !held.has(candidate.id))
        if (added.length) { related.push(...added); return lock(index) }
        return body()
      }
      return lock(0)
    })
  }
  /** Called in source maintenance after take. The log marker is the intake boundary, including a take/save crash gap. */
  async sealInput(execution: WorkExecution, operationId: string): Promise<{ seq: number; messages: readonly import('../work-types.ts').NativeWorkMessage[] }> {
    const id = SessionId(execution.session.sessionId)
    const agent = await this.runtime.agent(id)
    let events = await this.runtime.events(id)
    const markerId = MessageId(`intake-seal:${operationId}`)
    const findMarker = () => events.find(event => event.type === 'agent/inbox/spliced' && event.data.inserted?.some((message: UserMessage) => message.id === markerId))
    let marker = findMarker()
    if (!marker) {
      // Session.append cannot mark external event types ignorable. Use the
      // published durable inbox splice vocabulary and remove this inert notice
      // synchronously under maintenance, before it can enter a model request.
      agent.followup({ id: markerId, role: 'user', content: [], source: { kind: 'a2d2-work-input-seal', operationId } })
      if (!agent.inbox.remove(markerId)) throw new WorkExecutionError('continuation-seal-failed', 'The source intake marker escaped maintenance')
      await this.runtime.flush(agent)
      events = await this.runtime.events(id)
      marker = findMarker()
      if (!marker) throw new WorkExecutionError('continuation-seal-missing', 'Durable intake marker could not be read back')
    } else await this.runtime.flush(agent)
    const lanes: Record<string, import('../work-types.ts').NativeWorkMessage[]> = { 'next-turn': [], 'next-step': [] }
    const unconsumed = new Map<string, import('../work-types.ts').NativeWorkMessage>()
    const consumed = new Set<string>()
    for (const event of events) {
      if (event.seq >= marker.seq) break
      if (event.type === 'agent/inbox/spliced') {
        const data = event.data as { target: string; start: number; removedCount?: number; inserted: import('../work-types.ts').NativeWorkMessage[]; outcome?: string }
        const lane = lanes[data.target]
        if (!lane) throw new WorkExecutionError('continuation-inbox-invalid', 'Source inbox log uses an unknown target')
        const removed = lane.splice(data.start, data.removedCount ?? 0, ...data.inserted)
        if (data.outcome === 'canceled') for (const message of removed) unconsumed.delete(message.id)
        // A claimed message remains recoverable until user/message admission;
        // rejected cold pre-steps must not erase its original full payload.
        for (const message of data.inserted) unconsumed.set(message.id, message)
      } else if (event.type === 'user/message') consumed.add(event.data.id as string)
    }
    for (const id of consumed) unconsumed.delete(id)
    return { seq: marker.seq, messages: structuredClone([...unconsumed.values()]) }
  }
  pending(execution: WorkExecution): readonly import('../work-types.ts').NativeWorkMessage[] {
    const agent = this.service('agents').get(SessionId(execution.session.sessionId))
    return agent ? structuredClone([...agent.inbox.nextTurn, ...agent.inbox.nextStep]) : []
  }
  async history(execution: WorkExecution, session: import('../work-types.ts').SessionRef, cursor = 0, limit = 100): Promise<{ events: unknown[]; nextCursor?: number }> {
    if (session.runtimeId !== this.runtimeId || execution.resource.runtimeId !== this.runtimeId) throw new WorkExecutionError('incompatible-session', 'History belongs to another runtime')
    const id = SessionId(session.sessionId)
    const workspace = this.service('workspaceRegistry').list().find(item => item.id === execution.resource.workspaceId)
    if (!workspace?.sessionIds.includes(id)) throw new WorkExecutionError('incompatible-session', 'History does not belong to the execution workspace')
    using observation = await this.service('sessionQuery').observeSession(id)
    let bytes = 0
    const events: unknown[] = []
    for (const event of observation.events.slice(cursor, cursor + limit)) {
      const encoded = JSON.stringify(event)
      if (events.length && bytes + encoded.length > 200_000) break
      events.push(encoded.length > 200_000 ? { type: event.type, seq: event.seq, truncated: true, preview: encoded.slice(0, 200_000) } : structuredClone(event))
      bytes += encoded.length
    }
    const nextCursor = cursor + events.length
    return { events, ...(nextCursor < observation.events.length ? { nextCursor } : {}) }
  }
  async wake(execution: WorkExecution): Promise<void> { await this.runtime.wakePending(await this.runtime.agent(SessionId(execution.session.sessionId))) }
  status(execution: WorkExecution): 'running' | 'idle' | 'inactive' {
    return this.ctx.get('agents')?.get(SessionId(execution.session.sessionId))?.status ?? 'inactive'
  }
  async choices(): Promise<import('../work-types.ts').HostExecutionChoices> {
    if (!this.ctx.get('sessionController') || !this.ctx.get('agentPresets') || !this.ctx.get('permissionPresets')) throw new WorkExecutionError('host-capability-unavailable', 'Host execution catalogs are unavailable')
    // A peer resolved from this plugin can be its development dependency rather
    // than the serving Host. Admission checks the actual public services below;
    // package engines declare the verified rc.2 / official rc.3 releases.
    const catalog = await this.service('sessionController', 'modelCatalog', 'resolveAgent').modelCatalog()
    // The host's own catalogs are the authority, like a normal new Session: a
    // managed execution may use any activated Agent preset and any configured
    // permission preset (the derived auto mode is not a fixed sandbox).
    const declared = (await this.service('agentPresets').list()).filter(preset => preset.broken === undefined).map(preset => preset.id)
    const defaultAgentPreset = this.service('agentPresets').defaultId
    const agentPresets = declared.length ? declared : [defaultAgentPreset]
    const agentPreset = agentPresets.includes(defaultAgentPreset) ? defaultAgentPreset : agentPresets[0]!
    const declaredPermissions = this.service('permissionPresets').names.filter(name => name !== 'auto')
    const defaultPermissionPreset = this.service('permissionPresets').defaultPreset
    const permissionPresets = declaredPermissions.length ? [...declaredPermissions] : [defaultPermissionPreset]
    const permissionPreset = permissionPresets.includes(defaultPermissionPreset) ? defaultPermissionPreset : permissionPresets[0]!
    return { agentPresets, permissionPresets,
      models: catalog.groups.flatMap(group => group.models.map(model => ({ provider: group.id, model: model.id }))),
      defaults: { agentPreset, permissionPreset, model: { provider: catalog.default.provider, model: catalog.default.model } } }
  }
  private async validateModel(model: WorkExecution['model'], policy?: WorkExecution['policy']) {
    const choices = await this.choices()
    if (!choices.models.some(item => item.provider === model.provider && item.model === model.model)) throw new WorkExecutionError('unavailable-model', 'Model is not in the real host catalog')
    if (policy?.modelCandidates.length && !policy.modelCandidates.includes(`${model.provider}/${model.model}`)) throw new WorkExecutionError('disallowed-model', 'Current Session model is not authorized by the Project Agent policy')
    if (model.reasoningEffort !== undefined) {
      const info = await this.service('llm').resolveModelInfo(model.provider, model.model)
      if (!info.reasoning?.efforts.some(effort => effort.id === model.reasoningEffort)) throw new WorkExecutionError('unavailable-model', 'Requested reasoning effort is unavailable')
    }
    const requested = await this.service('llm').resolveCallConfig({ provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort ? ReasoningEffortId(model.reasoningEffort) : undefined })
    return { choices, requested }
  }
  async check(request: Pick<WorkExecution, 'resource' | 'session' | 'sessionMode' | 'agentPreset' | 'model' | 'permissionPreset'>, execution?: WorkExecution): Promise<import('../work-types.ts').HostExecutionChoices> {
    for (const name of ['sessionController', 'sessionPersistence', 'sessionQuery', 'agents', 'sessions', 'agentPresets', 'permissionPresets', 'sandboxPolicy', 'approval', 'llm', 'workspaceRegistry', 'agentDefaultModel']) {
      if (!(this.ctx.get as (key: string) => unknown).call(this.ctx, name)) throw new WorkExecutionError('host-capability-unavailable', `DSH ${name} is required for managed execution`)
    }
    this.service('sessionController', 'modelCatalog', 'resolveAgent')
    this.service('sessionQuery', 'observeSession')
    this.service('sessionPersistence', 'stat', 'create', 'open')
    this.service('sessions', 'prepare', 'flush')
    this.service('llm', 'resolveCallConfig', 'resolveModelInfo')
    if (this.ctx.get('fs')?.sandboxMode === undefined || this.ctx.get('shell')?.sandboxMode === undefined) throw new WorkExecutionError('host-permission-unenforced', 'Managed execution requires real sandbox-aware filesystem and shell providers')
    if (request.resource.runtimeId !== this.runtimeId) throw new WorkExecutionError('incompatible-resource', 'Execution belongs to another runtime')
    const workspace = this.service('workspaceRegistry').list().find(item => item.id === request.resource.workspaceId)
    if (!workspace || await workspace.status() !== 'ok') throw new WorkExecutionError('unavailable-resource', 'Execution workspace is unavailable')
    if (request.sessionMode === 'reuse') {
      const legacy = this.ctx.get('a2d2')
      if (!legacy) throw new WorkExecutionError('legacy-authority-unavailable', 'Existing Session reuse requires the legacy authority to rule out active old ownership')
      if (await legacy.taskOfMainSession(workspace.path, SessionId(request.session.sessionId))) throw new WorkExecutionError('legacy-authority-retained', 'Legacy Session authority must be safely migrated before v3 reuse')
    }
    // Once this execution owns a composed Session, its explicit host-local
    // selection is the current configuration. Never write the startup snapshot
    // back over a user model switch. Initial adoption still requires a match.
    const stat = await this.service('sessionPersistence').stat(SessionId(request.session.sessionId))
    let model = request.model
    if (execution?.actual && stat) {
      using observation = await this.service('sessionQuery').observeSession(SessionId(request.session.sessionId))
      const selection = observation.events.findLast(item => item.type === 'model/selection')
      const header = observation.events.findLast(item => item.type === 'request/header')
      const route = selection && (!header || selection.seq > header.seq) ? selection.data : header?.data.header.config
      if (!route?.provider || !route.model) throw new WorkExecutionError('continuation-profile-unknown', 'Current Session model selection must be known before recovery')
      model = { provider: route.provider, model: route.model, ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}) }
    }
    const { choices, requested } = await this.validateModel(model, execution?.policy)
    const preset = await this.service('agentPresets').resolve(request.agentPreset)
    if (preset.broken) throw new WorkExecutionError('unavailable-agent-preset', 'Requested Agent preset has an activation failure')
    if (!this.service('permissionPresets').names.includes(request.permissionPreset)) throw new WorkExecutionError('invalid-permission-preset', 'Permission preset is unavailable')
    if (!stat && request.sessionMode === 'reuse') throw new WorkExecutionError('incompatible-session', 'Requested Session does not exist')
    if (stat) {
      if (request.sessionMode === 'reuse' && !workspace.sessionIds.includes(SessionId(request.session.sessionId))) throw new WorkExecutionError('incompatible-session', 'Session is not a member of the selected workspace')
      using inspection = await this.service('sessionQuery').observeSession(SessionId(request.session.sessionId))
      const selectedPreset = (inspection.projections?.values as { agentPreset?: string | null } | undefined)?.agentPreset ?? inspection.header.agentPreset
      if (inspection.header.cwd !== workspace.path || selectedPreset !== request.agentPreset) throw new WorkExecutionError('incompatible-session', 'Existing Session resource or preset differs')
      const header = inspection.events.findLast(item => item.type === 'request/header')
      if (!execution?.actual && header?.type === 'request/header' && (header.data.header.config.provider !== model.provider || header.data.header.config.model !== model.model || header.data.header.config.reasoningEffort !== requested.reasoningEffort)) throw new WorkExecutionError('incompatible-session', 'Existing Session model differs; silent reconfiguration refused')
      const pending = inspection.events.findLast(item => item.type === 'model/selection')
      const local = pending?.type === 'model/selection' && (!header || pending.seq > header.seq) ? pending.data : undefined
      const selected = local ?? (header?.type === 'request/header' ? header.data.header.config : undefined)
      // A local selection preserves omission; a request header contains the
      // adapter's resolved default effort. Compare each at its own boundary.
      const expectedEffort = local ? model.reasoningEffort : requested.reasoningEffort
      if (selected && (selected.provider !== model.provider || selected.model !== model.model || selected.reasoningEffort !== expectedEffort)) throw new WorkExecutionError('incompatible-session', 'Existing Session local selection differs; silent reconfiguration refused')
      if (request.sessionMode === 'reuse') {
        const effective = selected ?? this.service('agentDefaultModel').currentSelection()
        if (effective.provider !== model.provider || effective.model !== model.model || effective.reasoningEffort !== (selected ? expectedEffort : model.reasoningEffort)) throw new WorkExecutionError('incompatible-session', 'Existing Session local selection differs')
        using observation = await this.service('sessionQuery').observeSession(SessionId(request.session.sessionId))
        const permission = (observation.projections?.values as { permissions?: { currentValue: string } } | undefined)?.permissions
        if (!execution?.actual && permission?.currentValue !== request.permissionPreset) throw new WorkExecutionError('incompatible-session', 'Existing Session effective permission differs')
      }
    }
    return choices
  }
  private delivery(event: WorkEvent) {
    const message: UserMessage = event.nativeMessage ? event.nativeMessage as UserMessage : { id: MessageId(event.id), role: 'user', content: [{ type: 'text', text: event.text }], source: { kind: 'a2d2-work-dispatch' } }
    if (message.id !== event.id || message.role !== 'user') throw new WorkExecutionError('invalid-native-message', 'Stored native input identity is inconsistent')
    return { id: event.id, message }
  }
  async discardInput(execution: WorkExecution, event: WorkEvent): Promise<void> {
    const agent = await this.runtime.agent(SessionId(execution.session.sessionId))
    const expected = this.delivery(event).message
    if ([...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(message => isDeepStrictEqual(message, expected)) && agent.inbox.remove(expected.id)) await this.runtime.flush(agent)
  }
  async observe(execution: WorkExecution, event: WorkEvent): Promise<'accepted' | 'delivered' | 'consumed'> {
    const state = await this.runtime.deliveryState(SessionId(execution.session.sessionId), this.delivery(event))
    return state === 'missing' ? 'accepted' : state === 'queued' ? 'delivered' : 'consumed'
  }
  /** Called while the exact source lifecycle is held in settled maintenance. */
  async disarmSource(execution: WorkExecution): Promise<NonNullable<NonNullable<WorkExecution['continuation']>['goalActivation']>> {
    const agent = this.service('agents').get(SessionId(execution.session.sessionId))
    if (!agent || agent.session.id !== agent.id) throw new WorkExecutionError('continuation-goal-agent-unavailable', 'The exact live source Agent is required to retire Goal activation')
    const goals = (this.ctx.get as (name: string) => unknown).call(this.ctx, 'goals') as {
      get(agent: Agent): { id: string; revision: number; phase: string; activation: string } | undefined
      disarm?(agent: Agent): unknown
    } | undefined
    if (!goals) {
      if ((await this.runtime.events(agent.id)).some(event => event.type === 'goal/change')) throw new WorkExecutionError('continuation-goal-capability-unavailable', 'Source has Goal history but its public lifecycle service is unavailable; controlled takeover cannot prove activation retirement')
      return { status: 'none' }
    }
    if (typeof goals.get !== 'function') throw new WorkExecutionError('continuation-goal-capability-unavailable', 'Public goals.get(exactLiveAgent) is unavailable')
    const before = goals.get(agent)
    if (!before) return { status: 'none' }
    if (typeof goals.disarm !== 'function') throw new WorkExecutionError('continuation-goal-capability-unavailable', 'Public goals.disarm(exactLiveAgent) is unavailable; human pause/resume is a separate authority')
    goals.disarm(agent)
    const after = goals.get(agent)
    if (!after || after.id !== before.id || after.revision !== before.revision || after.phase !== before.phase || after.activation !== 'disarmed'
      || this.service('agents').get(agent.id) !== agent) throw new WorkExecutionError('continuation-goal-unconfirmed', 'Exact source Goal activation could not be verified without changing durable identity, phase or revision')
    return { status: 'disarmed', goalId: after.id, revision: after.revision, phase: after.phase }
  }
  async flushSession(session: import('../work-types.ts').SessionRef): Promise<void> {
    if (session.runtimeId !== this.runtimeId) throw new WorkExecutionError('executor-runtime-unavailable', 'Collection owner belongs to another runtime')
    const agent = await this.runtime.agent(SessionId(session.sessionId))
    if (agent.status !== 'idle') throw new WorkExecutionError('continuation-waiting-executions', 'The exact collection owner is still running')
    await this.runtime.flush(agent)
  }
  async received(execution: WorkExecution): Promise<boolean> {
    const op = execution.continuation!
    const agent = await this.runtime.agent(SessionId(execution.session.sessionId))
    await this.runtime.flush(agent)
    if (!op.readable) return false
    const events = await this.runtime.events(agent.id)
    const requestId = op.readRequestId ?? op.kickoffId
    const message = events.findLast(event => event.type === 'user/message' && event.data.id === requestId)
    const call = events.findLast(event => event.type === 'tool/call' && event.data.callId === op.readable!.callId && event.data.name === 'work_continuation_received')
    const result = events.findLast(event => event.type === 'tool/result' && event.data.message?.toolCallId === op.readable!.callId)
    const expected = JSON.stringify({ status: 'completed', operationId: op.operationId, materialCommandId: op.material!.commandId, epoch: execution.epoch })
    return !!message && !!call && !!result && call.seq > message.seq && result.seq > call.seq && result.data.message.isError === false
      && result.data.message.content.some((block: { type: string; text?: string }) => block.type === 'text' && block.text === expected)
  }
  async end(execution: WorkExecution): Promise<void> {
    const facts = await this.observation(execution)
    // Native lineage grants control; a related/review association alone does not.
    const scope = (observation: import('./observation.ts').ExecutionObservation) => {
      const ids = new Set([execution.session.sessionId])
      for (const id of ids) {
        const row = observation.sessions.find(row => row.session.sessionId === id)
        for (const child of row?.children ?? []) ids.add(child.session.sessionId)
      }
      return ids
    }
    let controlled = scope(facts)
    const owned = facts.sessions.filter(row => controlled.has(row.session.sessionId))
    const agents: Agent[] = []
    for (const row of owned) {
      if (row.session.runtimeId !== this.runtimeId) throw new WorkExecutionError('queue-end-runtime-unavailable', '无法停止其他宿主的执行者')
      const id = SessionId(row.session.sessionId)
      const agent = this.ctx.get('agents')?.get(id)
      if (agent) {
        // Same public cancellation used by the host Stop action. Preserve inbox/results.
        if (agent.status !== 'idle') agent.cancel({ kind: 'user' }, { keepInbox: true })
        agents.push(agent)
      }
      for (const job of row.jobs) if (job.availability === 'live' && ['running', 'stopping'].includes(job.status)) {
        this.service('jobs', 'kill').kill(job.id as Parameters<NonNullable<Context['jobs']>['kill']>[0], id, '结束本项队列处理')
      }
    }
    for (const agent of agents) {
      await agent.whenIdle()
      await agent.runMaintenance(async () => { await this.runtime.flush(agent) })
    }
    // Termination has a physical-stop barrier, not the business acceptance gate:
    // terminal job output and unconsumed child notices stay retained and unassessed.
    const stopped = await this.observation(execution)
    controlled = scope(stopped)
    // Output-delivery observation may be unsupported while public list/get still
    // report each reachable job's real lifecycle. Termination needs that lifecycle.
    const blockers = stopped.blockers.filter(row => (controlled.has(row.session.sessionId) || row.code === 'execution-scope-unavailable') && !['job-result-unknown', 'job-observation-unavailable'].includes(row.code) && /unavailable|unknown/.test(row.code))
    for (const row of stopped.sessions.filter(row => controlled.has(row.session.sessionId))) {
      if (row.status === 'running' || row.status === 'unknown' || row.waitingHuman) blockers.push({ code: 'executor-unsettled', session: row.session })
      if ([...this.activeTools.values()].some(call => call.agent?.id === row.session.sessionId)) blockers.push({ code: 'tool-result-pending', session: row.session })
      for (const job of row.jobs) if (job.availability === 'live' && ['running', 'stopping'].includes(job.status)) blockers.push({ code: 'job-unsettled', session: row.session, jobId: job.id })
    }
    if (blockers.length) throw new WorkExecutionError('queue-end-unsettled', `结束尚未完成：${blockers.map(row => `${row.code}:${row.session.sessionId}${row.jobId ? `:${row.jobId}` : ''}`).join(', ')}。停止后可重试结束；历史结果保持未验收。`)
  }

  async settle(execution: WorkExecution): Promise<void> {
    const agent = await this.runtime.agent(SessionId(execution.session.sessionId))
    await agent.whenIdle()
    await agent.runMaintenance(async () => { await this.runtime.flush(agent) })
  }
  async deliver(execution: WorkExecution, event: WorkEvent, inMaintenance = false): Promise<'delivered' | 'consumed'> {
    const id = SessionId(execution.session.sessionId)
    const delivery = this.delivery(event)
    await this.runtime.deliver(id, delivery, inMaintenance)
    return await this.runtime.deliveryState(id, delivery) === 'consumed' ? 'consumed' : 'delivered'
  }
  async ensure(execution: WorkExecution, _allowed?: () => Promise<WorkAdmission>): Promise<NonNullable<WorkExecution['actual']>> {
    await this.check(execution, execution)
    const id = SessionId(execution.session.sessionId)
    if (!await this.service('sessionPersistence').stat(id) && !this.service('agents').get(id)) {
      const workspace = this.service('workspaceRegistry').list().find(item => item.id === execution.resource.workspaceId)!
      const detached = this.service('sessions').prepare(id, { meta: { cwd: workspace.path, agentPreset: execution.agentPreset } })
      const handle = await this.service('sessionPersistence').create(detached.header)
      try { await handle.append([{ type: 'model/selection', seq: SessionSeq(0), time: Date.now(), data: execution.model }]) }
      finally { await handle.close() }
    } else if (execution.sessionMode === 'create' && !this.service('agents').get(id)) {
      const events = await this.runtime.events(id)
      if (events.length === 0) {
        const handle = await this.service('sessionPersistence').open(id, 'write')
        try { await handle.append([{ type: 'model/selection', seq: SessionSeq(0), time: Date.now(), data: execution.model }]); await handle.flush() }
        finally { await handle.close() }
      }
    }
    const agent = await resolveSessionAgent(this.ctx, id)
    const workspace = this.service('workspaceRegistry').list().find(item => item.id === execution.resource.workspaceId)!
    await workspace.attachSession(id)
    await agent.whenIdle()
    return agent.runMaintenance(async () => {
      const events = await this.runtime.events(id)
      const started = events.some(item => item.type === 'turn/start')
      const profile = await rootSessionProfile(this.ctx, id)
      // Owned, started Sessions retain their current host permissions. A blank
      // successor still needs its inherited permission initialized before use.
      if (started && !execution.actual && profile.permission?.preset !== execution.permissionPreset) throw new WorkExecutionError('incompatible-session', 'Existing Session permission differs; silent reconfiguration refused')
      if (!started && profile.permission?.preset !== execution.permissionPreset) this.service('permissionPresets').set(agent.session, execution.permissionPreset)
      const prior = installed.get(agent)
      if (prior && prior.executionId !== execution.id) throw new WorkExecutionError('session-in-use', 'Agent already belongs to another execution')
      await this.runtime.flush(agent)
      // Selection may change while restore is pending, and older selectors do
      // not share the maintenance lock. Validate the captured profile itself;
      // never return a fresh, unchecked route after validating an earlier read.
      const current = await this.profile(execution)
      await this.validateModel(current, execution.policy)
      const filesystem = this.service('agentPresets').serviceFor(agent, 'fs') ?? this.ctx.get('fs')
      const shell = this.service('agentPresets').serviceFor(agent, 'shell') ?? this.ctx.get('shell')
      if (filesystem?.sandboxMode === undefined || shell?.sandboxMode === undefined) throw new WorkExecutionError('host-permission-unenforced', 'Selected preset did not compose sandbox-aware filesystem and shell providers')
      if ((!execution.actual && current.permissionPreset !== execution.permissionPreset) || current.agentPreset !== execution.agentPreset) throw new WorkExecutionError('host-context-mismatch', 'Host did not compose the requested execution context')
      if (!prior) installed.set(agent, { executionId: execution.id })
      return current
    })
  }
}
