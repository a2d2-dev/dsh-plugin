import { screeningBasis, screeningKey, validateScreening, SCREENING_PENDING } from './work-screening.ts'
import { workSessionTitles } from './work-session-titles.ts'
import { refreshRepositoryCandidates } from './work-sources/repository-candidates.ts'
import { buildExecutionGraph, type ExecutionObservation } from './work-execution/observation.ts'
import { refreshCatalog } from './work-sources/catalog-application.ts'
import { PlanningError, planningBasis, planningBasisFingerprint, validatePlan, samePlannedExecution, planningModelErrorSummary } from './work-planning.ts'
import type { WorkPlanner } from './work-planning.ts'
import { issueSchema } from './work-sources/schema.ts'
import { SourceError } from './work-sources/errors.ts'
import type { SourceCandidate, WorkSource } from './work-sources/types.ts'
import { synchronizeClose } from './work-completion/recovery.ts'
import { isTaskCompleted, queueParentResults } from './work-completion/index.ts'
import { mkdir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join, normalize } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { commandSchema, querySchema } from './work-schema.ts'
import { applySourceCommand, refreshSource, sourceResult } from './work-sources/application.ts'
import type { GitHubSourcePort } from './work-sources/types.ts'
import type { WorkSnapshot } from './work-schema.ts'
import { WorkExecutionError } from './work-execution/host.ts'
import { continuationInFlight, continuationFactsKey, collectionRequest, MANAGED_WORK_INSTRUCTIONS, maintenanceEvent, materialRequest, reserveContinuation, successorMessage } from './work-execution/continuation.ts'
import { applyTaskOrganization, taskStructureBlocker } from './work-organization.ts'
import { isCanonicalChild } from './work-migrate.ts'
import { applyTaskReport, projectProgress, taskProgressView } from './work-progress.ts'
import { continuousCandidates, continuousDependenciesReady, continuousOwner, continuousMayAdvance, continuousCompleted, observeContinuousTasks, discoverContinuous, sourceScopeError, sameTask, continuousRetry, continuousSlots, continuousHasSlot, continuousSetSlot, continuousProblem, MAX_CONTINUOUS_ATTEMPTS } from './work-continuous.ts'
import { reconcileProjectSources } from './work-sources/discovery.ts'
import { WorkDao } from './work-store/dao.ts'
export { WorkDao } from './work-store/dao.ts'
import type { WorkExecutionHost } from './work-execution/host.ts'
export type { WorkExecutionHost } from './work-execution/host.ts'
import type { HostResource, NativeWorkMessage, Project, ResourceRef, SessionCandidate, TaskRef, WorkCommand, WorkEvent, WorkResult, WorkTask } from './work-types.ts'
export type * from './work-types.ts'

/** Only trusted adapters construct authorization; browser payloads cannot supply it. */
export interface WorkActor { readonly operator: boolean; readonly session?: import('./work-types.ts').SessionRef; readonly agentId?: string; readonly reporter?: import('@deepseek-ai/dsh-tools').ToolExecutionToken }
/** Trusted resource observation with an explicit optional managed execution capability. */
export interface WorkHost {
  execution?: WorkExecutionHost & { connectObservation?(scope: (execution: import('./work-types.ts').WorkExecution) => Promise<readonly import('./work-types.ts').SessionAssociation[]>): void; observation?(execution: import('./work-types.ts').WorkExecution, associations?: readonly import('./work-types.ts').SessionAssociation[], reporter?: import('@deepseek-ai/dsh-tools').ToolExecutionToken): Promise<import('./work-execution/observation.ts').ExecutionObservation> }
  resources(): Promise<readonly HostResource[]>
  sessions(resource: HostResource): Promise<readonly SessionCandidate[]>
  /** Title-only metadata maintenance; must never resume or wake an Agent. */
  nameSession?(session: import('./work-types.ts').SessionRef, title: string): Promise<void>
}
function failed(code: string, message: string): WorkResult { return { status: 'failed', error: { code, message } } }
function conflict(currentVersion: number): WorkResult {
  return { status: 'conflict', error: { code: 'version-conflict', message: 'Expected version is stale', currentVersion } }
}
function lifecycleOwned(message: NativeWorkMessage | undefined): boolean {
  const source = message?.source
  return typeof source === 'object' && source !== null && 'kind' in source && (source.kind === 'goal' || source.kind === 'a2d2-work-maintenance')
}
function pendingEvent(event: WorkEvent): boolean { return event.delivery !== 'consumed' && event.delivery !== 'discarded' }
function discardLifecycleEvents(execution: import('./work-types.ts').WorkExecution): void {
  for (const event of execution.events) if (pendingEvent(event) && lifecycleOwned(event.nativeMessage)) event.delivery = 'discarded'
}
function legacyKey(address: { runtimeId: string; projectRoot: string; taskId: string }): string { return JSON.stringify([address.runtimeId, address.projectRoot, address.taskId]) }
function sameResource(a: ResourceRef, b: ResourceRef): boolean { return a.runtimeId === b.runtimeId && a.workspaceId === b.workspaceId }
function sameSession(a: { runtimeId: string; sessionId: string }, b: { runtimeId: string; sessionId: string }): boolean { return a.runtimeId === b.runtimeId && a.sessionId === b.sessionId }
function taskAt(state: WorkSnapshot, ref: TaskRef): WorkTask | undefined {
  return state.tasks.find(item => item.id === ref.taskId && item.projectId === ref.projectId)
}

function sourceIssuesAt(state: WorkSnapshot, ref: TaskRef): import('./work-sources/types.ts').GitHubIssueReference[] {
  return state.externalBindings.filter(binding => binding.ref.projectId === ref.projectId && binding.ref.taskId === ref.taskId)
    .map(({ lastObserved: issue }) => ({ nodeId: issue.nodeId, url: issue.url, number: issue.number, title: issue.title, repository: issue.repository, state: issue.state }))
}

/** Public local work commands and queries. One v3 snapshot is the only writer authority. */
/**
 * The Project table reads a row's state, labels and assignees, never the issue
 * body; the detail query returns the body separately. Dropping it keeps the
 * source payload small enough for ordinary HTTP limits.
 */
function tableSource(source: WorkSource): WorkSource {
  return { ...source, observations: source.observations.map(row => ({ ...row, issue: { ...row.issue, body: null } })) }
}
function tableResult(result: WorkResult): WorkResult {
  return result.source === undefined ? result : { ...result, source: tableSource(result.source) }
}

/** The source tab list needs identity, never the observation payload a thousands-item Project carries. */
function slimSource(source: WorkSource): WorkSource {
  return { ...source, observations: [], pages: [], ...(source.projectSnapshot ? { projectSnapshot: { ...source.projectSnapshot, items: [] } } : {}) }
}
export class WorkApplication {
  private readonly dao: WorkDao
  private readonly discoverySchedule = new Map<string, { version: number; persisted: string; next: string }>()
  /** User-triggered source reads currently running; the scheduled pass yields to them. */
  private readonly screeningJobs = new Map<string, Promise<void>>()
  private refreshCount = 0
  constructor(readonly directory: string, readonly host: WorkHost, readonly source?: GitHubSourcePort, readonly planner?: WorkPlanner) {
    if (!isAbsolute(directory)) throw new Error('Work record directory must be absolute')
    this.dao = WorkDao.forDirectory(directory)
    this.host.execution?.connectObservation?.(async requested => {
      const state = await this.load()
      const current = state.executions.find(item => item.id === requested.id && sameTask(item.ref, requested.ref))
      const task = current && taskAt(state, current.ref)
      if (!current || !task || current.owner !== requested.owner) throw new WorkExecutionError('stale-execution-authority', 'Observation scope does not belong to the current Task execution')
      const exact = current.epoch === requested.epoch && sameSession(current.session, requested.session)
      // Recovery after a committed take may only seal the already-retired fixed
      // source of that same operation; it does not restore source authority.
      const operation = current.continuation
      const sealing = operation?.phase === 'taken' && operation.inputSeal === undefined
        && requested.continuation?.operationId === operation.operationId && current.epoch === operation.sourceEpoch + 1
        && sameSession(current.session, operation.successor) && requested.epoch === operation.sourceEpoch && sameSession(requested.session, operation.source)
        && current.retired?.some(old => old.operationId === operation.operationId && old.epoch === requested.epoch && sameSession(old.session, requested.session))
      if (!exact && !sealing) throw new WorkExecutionError('stale-execution-authority', 'Observation scope is stale for this coordinator epoch')
      return sealing ? [...task.sessions, { session: current.session, purpose: 'related' as const }] : task.sessions
    })
    this.host.execution?.connect(async (sessionId, messages = []) => {
      const mayAdvance = (execution: import('./work-types.ts').WorkExecution | undefined) => !execution || (!isTaskCompleted(taskAt(state, execution.ref)) && continuousMayAdvance(state, execution) && !['accepted', 'creating', 'failed', 'waiting', 'paused'].includes(execution.state)
        && !(execution.control?.status === 'accepted' && execution.control.action !== 'resume')
        && !execution.continuationBlocked
        && !continuationInFlight(execution))
      let state = await this.load()
      const initial = state.executions.find(item => item.session.sessionId === sessionId)
      if (initial && messages.length > 0 && initial.continuationPolicy?.enabled && !continuationInFlight(initial)) {
        await this.observeContinuation(initial.id)
        state = await this.load()
      }
      for (const owner of state.executions) {
        const op = owner.continuation
        if (!op || !continuationInFlight(owner) || isTaskCompleted(taskAt(state, owner.ref))) continue
        if (owner.epoch === op.sourceEpoch && sameSession(owner.session, op.source) && messages.length && this.host.execution?.observation
          && messages.some(message => (message.source as { kind?: string } | undefined)?.kind === 'subagent-settled')) {
          const facts = await this.host.execution.observation(owner)
          const parent = facts.sessions.find(row => row.session.sessionId === sessionId)
          const notices = parent?.children.filter(child => child.settlement && messages.some(message => JSON.stringify(message) === JSON.stringify(child.settlement!.message))) ?? []
          if (notices.length) return this.dao.transaction(async current => {
            const execution = current.executions.find(item => item.id === owner.id)!
            const operation = execution.continuation
            if (!operation || operation.operationId !== op.operationId || !continuationInFlight(execution) || execution.epoch !== op.sourceEpoch || !sameSession(execution.session, op.source)
              || isTaskCompleted(taskAt(current, execution.ref))) return false
            for (const child of notices) {
              const notice = child.settlement!
              if (!operation.settlements?.some(step => step.messageId === notice.message.id)) (operation.settlements ??= []).push({ parent: parent!.session, child: child.session, endSeq: notice.endSeq, messageId: notice.message.id, delivery: 'delivered' })
            }
            const messageIds = notices.map(child => child.settlement!.message.id)
            for (const message of messages) {
              if (messageIds.includes(message.id) || lifecycleOwned(message) || execution.events.some(event => event.id === message.id)) continue
              execution.events.push({ id: message.id, text: 'Automatic input deferred during native settlement maintenance', kind: 'input', delivery: 'accepted', acceptance: 'unassessed', nativeMessage: structuredClone(message) })
            }
            return { operationId: operation.operationId, step: 'settle' as const, messageIds }
          })
        }
        const step = op.collections?.find(step => step.status === 'requested' && step.session.sessionId === sessionId)
        if (step && messages.some(message => message.id === step.requestId && JSON.stringify(message.source) === JSON.stringify({ kind: 'a2d2-work-maintenance', operationId: op.operationId, step: 'collect' }))) return { operationId: op.operationId, step: 'collect', jobIds: step.jobs.map(job => job.id) }
      }
      const maintenance = state.executions.find(item => item.continuation && item.session.sessionId === sessionId)
      const operation = maintenance?.continuation
      if (operation && !isTaskCompleted(taskAt(state, maintenance!.ref))) {
        const step = operation.phase === 'material-requested' ? 'material' : ['taken', 'delivered'].includes(operation.phase) ? 'receive' : undefined
        const id = step === 'material' ? operation.materialRequestId : operation.readRequestId ?? operation.kickoffId
        if (step && messages.some(message => message.id === id && JSON.stringify(message.source) === JSON.stringify({ kind: 'a2d2-work-maintenance', operationId: operation.operationId, step }))) return { operationId: operation.operationId, step }
      }
      if (state.executions.some(item => item.retired?.some(old => old.session.sessionId === sessionId) || (item.continuation?.successor.sessionId === sessionId && item.session.sessionId !== sessionId))) return false
      const execution = state.executions.find(item => item.session.sessionId === sessionId)
      if (mayAdvance(execution) || messages.length === 0) return mayAdvance(execution)
      return this.dao.transaction(async current => {
        const owner = current.executions.find(item => item.session.sessionId === sessionId)
        if (current.executions.some(item => item.retired?.some(old => old.session.sessionId === sessionId))) return false
        state = current
        if (mayAdvance(owner)) return true
        for (const message of messages) {
          if (lifecycleOwned(message) || owner!.events.some(item => item.id === message.id)) continue
          const text = message.content.flatMap(block => typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string' ? [block.text] : []).join('\n')
          const managed = continuousOwner(current, owner!.ref)
          if (managed && !managed.item.end && owner!.control?.action !== 'end' && (!(owner!.error || owner!.continuation?.error || owner!.runtimeFailure || managed.item.recoveryBlocked) || typeof message.source === 'object' && message.source !== null && 'kind' in message.source && message.source.kind === 'user') && managed.item.state !== 'completed' && !continuousCompleted(current, owner!) && owner!.state !== 'paused' && !(owner!.control?.action === 'pause' && owner!.control.status === 'accepted')) { managed.item.resumeRequested = true; managed.item.attempts = 0; delete managed.item.retryAt; delete managed.item.recoveryBlocked; if (owner!.runtimeFailure) owner!.runtimeFailure.acknowledged = true }
          owner!.events.push({ id: message.id, text: text.trim() ? text.slice(0, 100_000) : 'Native Session input', kind: 'input', delivery: 'accepted', acceptance: 'unassessed', nativeMessage: structuredClone(message) })
        }
        return false
      })
    }, sessionId => this.conversationContext(sessionId), async sessionId => {
      const execution = (await this.load()).executions.find(item => item.session.sessionId === sessionId)
      return (execution?.events ?? []).flatMap(event => {
        const message = event.nativeMessage
        const source = message?.source
        return pendingEvent(event) && message && typeof source === 'object' && source !== null && 'kind' in source && source.kind === 'user' ? [message] : []
      })
    })
  }
  /** Inform native conversations without changing Task state or coordinator identity. */
  private async conversationContext(sessionId: string): Promise<string | undefined> {
    const state = await this.load()
    const execution = state.executions.find(item => item.session.sessionId === sessionId
      || item.retired?.some(old => old.session.sessionId === sessionId)
      || item.continuation?.successor.sessionId === sessionId)
    if (!execution) return undefined
    const task = taskAt(state, execution.ref)
    const current = execution.session.sessionId === sessionId
    const status = isTaskCompleted(task) ? '已完成' : execution.control?.action === 'end' ? (execution.control.status === 'applied' ? '队列已结束，业务验收未确认' : '正在结束队列处理') : execution.control?.status === 'accepted' && execution.control.action !== 'resume'
      ? execution.control.action === 'pause' ? '暂停中' : '等待中'
      : execution.state === 'waiting' ? '等待中' : execution.state === 'paused' ? '已暂停' : execution.state
    return [
      current ? `关联任务：${task?.title ?? execution.ref.taskId}；状态：${status}。你可以继续在此对话。`
        : `任务已转到会话 ${execution.session.sessionId}；此会话仍可继续对话。`,
      `当前任务处理会话：${execution.session.sessionId}。可从“关联任务 → 进入当前处理会话”打开。`,
      `Task ${execution.ref.taskId}；协调代次 ${execution.epoch}。${current ? '此会话仍是当前协调会话。' : '此会话不再负责该 Task；不要继续自动推进原任务或冒充当前协调者写入 Task 记录。'}`,
      ...(execution.control?.reason ? [`最近控制说明：${execution.control.reason.slice(0, 1200)}`] : []),
      '这是当前协调事实，优先于历史启动消息的过期身份说明。正常接收并回答人工消息，可按用户请求使用宿主已有工具和权限；不需要先恢复 Task 才能对话。人工对话本身不解除暂停、不重开已完成任务、不恢复自动调度或改变协调归属。等待或完成工具返回后，向用户交代结果再结束本轮。Task 写操作按各自规则检查当前身份和状态。',
    ].join('\n')
  }
  /** Reads authoritative execution facts without collecting jobs or starting any executor. */
  private async executionGraph(state: WorkSnapshot, task: WorkTask) {
    const executionAt = (ref: TaskRef) => state.executions.find(item => sameTask(item.ref, ref))
    const observe = async (execution?: import('./work-types.ts').WorkExecution): Promise<ExecutionObservation | undefined> => {
      if (!execution || !this.host.execution?.observation) return undefined
      try { return await this.host.execution.observation(execution) }
      catch (error) { return { settlement: 'unknown', sessions: [], blockers: [], reminders: [], limitations: [error instanceof Error ? error.message : '执行观察失败'] } }
    }
    const execution = executionAt({ projectId: task.projectId, taskId: task.id })
    const children = await Promise.all(task.children.flatMap(ref => {
      const child = taskAt(state, ref)
      if (!child) return []
      return [(async () => {
        const run = executionAt(ref), issue = state.externalBindings.find(binding => sameTask(binding.ref, ref))?.lastObserved
        return { task: child, execution: run, observation: await observe(run), ...(issue ? { issue: { number: issue.number, url: issue.url, assignees: issue.assignees } } : {}) }
      })()]
    }))
    const graph = buildExecutionGraph({ task, execution, observation: await observe(execution), children })
    const binding = state.externalBindings.find(binding => sameTask(binding.ref, graph.ref))
    const issue = binding?.lastObserved
    for (const warning of state.externalBindings.flatMap(item => item.hierarchyWarnings ?? []).filter(item => sameTask(item.parent, graph.ref) || sameTask(item.child, graph.ref))) {
      if (!graph.limitations.includes(warning.message)) graph.limitations.push(warning.message)
    }
    const native = issue?.subIssues ? issue : [binding?.accepted, ...state.sources.flatMap(source => source.observations.map(row => row.issue))]
      .filter((item): item is import('./work-sources/types.ts').GitHubIssue => !!item && item.nodeId === binding?.nodeId && !!item.subIssues)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0]
    // List scans preserve richer binding details, so object identity alone no
    // longer tells us whether the current source actually returned child data.
    const latestSourceIssue = state.sources
      .filter(source => binding?.sourceIds.includes(source.id))
      .flatMap(source => source.observations.map(row => row.issue))
      .filter(item => item.nodeId === binding?.nodeId)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.updatedAt.localeCompare(a.updatedAt))[0]
    const retainedChildren = native && latestSourceIssue
      && latestSourceIssue.observedAt >= native.observedAt
      && latestSourceIssue.updatedAt >= native.updatedAt
      && latestSourceIssue.subIssues === undefined
    if (native && (native !== issue || retainedChildren)) graph.limitations.push('原生子 Issue 关系来自最后已知观察；当前来源未返回此字段。')
    else if (issue && !native) graph.limitations.push('原生子 Issue 关系尚未读取；不能据此断言没有子工作。')
    graph.nativeIssues = (native?.subIssues?.items ?? []).map(issue => {
      const binding = state.externalBindings.find(binding => binding.nodeId === issue.nodeId)
      const run = binding && executionAt(binding.ref)
      const observed = binding?.lastObserved ?? state.sources.flatMap(source => source.observations.map(row => row.issue)).find(item => item.nodeId === issue.nodeId)
      return { issue, ...(binding ? { ref: binding.ref } : {}), ...(run ? { executionId: run.id, owner: run.owner, epoch: run.epoch, currentSession: run.session } : {}), ...(observed ? { assignees: observed.assignees } : {}), status: run ? 'started' as const : binding || observed ? 'not-started' as const : 'unread' as const }
    })
    if (native?.subIssues?.hasNextPage) graph.limitations.push('原生子 Issue 列表尚未完整读取。')
    return graph
  }
  private async load(): Promise<WorkSnapshot> {
    const state = await this.dao.read()
    let sources = state.sources
    for (let index = 0; index < sources.length; index++) {
      const source = sources[index]!, schedule = this.discoverySchedule.get(source.id)
      if (!schedule) continue
      if (source.version === schedule.version && source.discovery?.nextAttemptAt === schedule.persisted) {
        if (sources === state.sources) sources = [...state.sources]
        // Preserve lazy cold-field descriptors when applying the scheduling overlay.
        const descriptors = Object.getOwnPropertyDescriptors(source)
        const discoveryDescriptors = Object.getOwnPropertyDescriptors(source.discovery)
        discoveryDescriptors.nextAttemptAt = { value: schedule.next, enumerable: true }
        descriptors.discovery = { value: Object.freeze(Object.defineProperties({}, discoveryDescriptors)) as NonNullable<WorkSource['discovery']>, enumerable: true }
        const copy = Object.freeze(Object.defineProperties({}, descriptors)) as WorkSource
        sources[index] = copy
      } else this.discoverySchedule.delete(source.id)
    }
    return sources === state.sources ? state : { ...state, sources }
  }
  /** Observe durable changes without granting work/execution authority. */
  onChange(listener: () => void): () => void { return this.dao.subscribe(listener) }
  /** Migrate inline source bulk, historical results and execution logs together. */
  async ensureSourceSplit(): Promise<void> { await this.dao.migrate() }
  private async sourceTransaction<T>(apply: (state: WorkSnapshot) => Promise<T>): Promise<T> {
    let schedules: { id: string; version: number; next?: string }[] = []
    const result = await this.dao.transaction(async state => {
      for (const source of state.sources) {
        const schedule = this.discoverySchedule.get(source.id)
        if (schedule && source.version === schedule.version && source.discovery?.nextAttemptAt === schedule.persisted) source.discovery.nextAttemptAt = schedule.next
      }
      const result = await apply(state)
      schedules = state.sources.map(source => ({ id: source.id, version: source.version, next: source.discovery?.nextAttemptAt }))
      return result
    })
    const committed = await this.dao.read()
    for (const schedule of schedules) {
      const source = committed.sources.find(source => source.id === schedule.id), persisted = source?.discovery?.nextAttemptAt
      if (source?.version === schedule.version && persisted && schedule.next && schedule.next !== persisted) this.discoverySchedule.set(schedule.id, { version: schedule.version, persisted, next: schedule.next })
      else this.discoverySchedule.delete(schedule.id)
    }
    return result
  }
  private async coordinatorUnavailable(session: import('./work-types.ts').SessionRef): Promise<WorkResult> {
    const execution = (await this.load()).executions.find(item => item.retired?.some(old => sameSession(old.session, session)))
    return failed('forbidden', execution
      ? `This Task is now coordinated by Session ${execution.session.sessionId} (epoch ${execution.epoch}). Conversation here remains available; use the current Session for Task changes.`
      : 'Calling Session is not a current Task coordinator')
  }
  /** Trusted ToolRunContext adapter supplies only its real Session and call identity. */
  async sessionControl(session: import('./work-types.ts').SessionRef, callId: string, action: string, text?: string, expectedEpoch?: number): Promise<WorkResult> {
    const state = await this.load()
    const execution = state.executions.find(item => sameSession(item.session, session))
    if (!execution) return this.coordinatorUnavailable(session)
    if (action === 'status') return { status: 'completed', task: taskAt(state, execution.ref), bindings: state.externalBindings.filter(item => sameTask(item.ref, execution.ref)), sourceIssues: sourceIssuesAt(state, execution.ref), execution, executionRuntime: this.host.execution?.status(execution) ?? 'inactive' }
    const commandId = `tool:${createHash('sha256').update(JSON.stringify([session.runtimeId, session.sessionId, callId])).digest('hex')}`
    return this.execute({ type: 'task.control', commandId, ref: execution.ref,
      executionId: execution.id, owner: execution.owner, epoch: expectedEpoch ?? execution.epoch, action, text },
    { operator: false, session, agentId: execution.agentId })
  }
  /** Public trusted adapter: source identity and Task references are resolved on the server. */
  async sessionContinuationMaterial(session: import('./work-types.ts').SessionRef, callId: string,
    content: import('./work-types.ts').ContinuationContent, expectedEpoch?: number): Promise<WorkResult> {
    const execution = (await this.load()).executions.find(item => sameSession(item.session, session))
    if (!execution) return this.coordinatorUnavailable(session)
    const commandId = `material:${createHash('sha256').update(JSON.stringify([session.runtimeId, session.sessionId, callId])).digest('hex')}`
    return this.execute({ type: 'task.continuation-material', commandId, ref: execution.ref,
      executionId: execution.id, owner: execution.owner, epoch: expectedEpoch ?? execution.epoch, content },
    { operator: false, session, agentId: execution.agentId })
  }
  /** A claim is not readable until the host finds its successful committed result. */
  async sessionContinuationReceived(session: import('./work-types.ts').SessionRef, callId: string, operationId: string, materialCommandId: string, epoch: number) {
    return this.sourceTransaction(async state => {
      const execution = state.executions.find(item => sameSession(item.session, session))
      const op = execution?.continuation
      if (!execution || !op || op.protocolVersion !== 1 || op.operationId !== operationId || !['taken', 'delivered', 'received'].includes(op.phase)
        || !sameSession(session, op.successor) || execution.epoch !== epoch || epoch !== op.sourceEpoch + 1
        || op.material?.commandId !== materialCommandId) return { status: 'failed' as const, error: { code: 'stale-continuation-receipt', message: 'Only the fixed current successor can acknowledge this exact material and epoch' } }
      if (op.phase !== 'received') op.readable = { callId, materialCommandId }
      return { status: 'completed' as const, operationId, materialCommandId, epoch }
    })
  }
  async sessionReport(session: import('./work-types.ts').SessionRef, callId: string, report: import('./work-progress.ts').TaskReport, expectedEpoch?: number, reporter?: import('@deepseek-ai/dsh-tools').ToolExecutionToken): Promise<WorkResult> {
    const execution = (await this.load()).executions.find(item => sameSession(item.session, session))
    if (!execution) return this.coordinatorUnavailable(session)
    const commandId = `report:${createHash('sha256').update(JSON.stringify([session.runtimeId, session.sessionId, callId])).digest('hex')}`
    return this.execute({ type: 'task.report', commandId, ref: execution.ref, executionId: execution.id, owner: execution.owner, epoch: expectedEpoch ?? execution.epoch, report }, { operator: false, session, agentId: execution.agentId, reporter })
  }
  /** Only accepted Task-related source identities may use the host credential route. */
  async sessionReadRelatedIssue(session: import('./work-types.ts').SessionRef, nodeId?: string, expectedEpoch?: number): Promise<WorkResult> {
    const state = await this.load()
    const execution = state.executions.find(item => sameSession(item.session, session))
    if (!execution || (expectedEpoch !== undefined && execution.epoch !== expectedEpoch)) return failed('forbidden', 'Calling Session is not the current coordinator at this epoch')
    const bindings = state.externalBindings.filter(item => sameTask(item.ref, execution.ref))
    if (bindings.length !== 1) return failed('native-child-binding-required', 'A unique accepted source is required')
    const binding = bindings[0]!
    const known = [binding.accepted, ...((binding.acceptedChildren ?? binding.accepted.subIssues)?.items ?? [])]
    const ref = known.find(item => item.nodeId === (nodeId ?? binding.nodeId))
    if (!ref) return failed('source-reference-unrelated', 'Only this Task source and its accepted native children may be read')
    if (!this.source) return failed('github-capability-unavailable', 'Trusted source reading is unavailable')
    try {
      const response = await this.source.detail(ref.repository, ref.number, ref.nodeId === binding.nodeId ? { nativeChildren: true } : undefined)
      const issue = issueSchema.parse(response.issue)
      const account = binding.sourceIds.flatMap(id => { const source = state.sources.find(item => item.id === id); return source?.identity ?? source?.projectSnapshot?.identity ?? source?.pages[0]?.identity ?? [] })[0]
      if (issue.nodeId !== ref.nodeId || issue.number !== ref.number || issue.repository.owner.toLowerCase() !== ref.repository.owner.toLowerCase() || issue.repository.repository.toLowerCase() !== ref.repository.repository.toLowerCase() || (account && response.identity.nodeId !== account.nodeId)) return failed('source-identity-changed', 'Related source identity or authenticated account changed')
      return this.sourceTransaction(async current => {
        const owner = current.executions.find(item => item.id === execution.id)
        if (!owner || owner.owner !== execution.owner || owner.epoch !== execution.epoch || !sameSession(owner.session, session)) return failed('forbidden', 'Coordinator changed while reading source material')
        const currentBinding = current.externalBindings.find(item => item.nodeId === binding.nodeId)!
        const related = currentBinding.relatedObservations ??= []
        const previous = related.find(item => item.nodeId === issue.nodeId)
        if (previous && previous.updatedAt > issue.updatedAt) return failed('source-observation-superseded', 'An older source result cannot replace newer observed material')
        if (previous) related.splice(related.indexOf(previous), 1)
        related.push(issue)
        if (issue.nodeId === binding.nodeId) currentBinding.lastObserved = issue
        const canonical = current.externalBindings.find(item => item.nodeId === issue.nodeId)
        return { status: 'completed', issue, ...(canonical ? { ref: canonical.ref, task: taskAt(current, canonical.ref) } : {}) }
      })
    } catch (error) { return failed(error instanceof SourceError ? error.code : 'source-read-failed', error instanceof SourceError ? error.message : 'Related source material could not be read or validated') }
  }
  async sessionOrganize(session: import('./work-types.ts').SessionRef, callId: string, organization: import('./work-organization.ts').TaskOrganization, expectedEpoch?: number): Promise<WorkResult> {
    const execution = (await this.load()).executions.find(item => sameSession(item.session, session))
    if (!execution) return this.coordinatorUnavailable(session)
    const commandId = `organize:${createHash('sha256').update(JSON.stringify([session.runtimeId, session.sessionId, callId])).digest('hex')}`
    return this.execute({ type: 'task.organize', commandId, ref: execution.ref, executionId: execution.id, owner: execution.owner, epoch: expectedEpoch ?? execution.epoch, organization }, { operator: false, session, agentId: execution.agentId })
  }
  async reconcileSources(): Promise<void> {
    // One scan per source at a time: a user refresh in flight owns the pass.
    if (this.refreshCount > 0) return
    // The scheduled pull is a full refresh: one tick drains the Project so a
    // five-minute cadence never leaves a half-scanned view behind.
    if (this.source) await reconcileProjectSources(apply => this.sourceTransaction(apply), this.source, { maxPagesPerSource: 200 })
    const snapshot = await this.load()
    const repositories = snapshot.sources.filter(source => source.enabled && source.repository && snapshot.continuousRules?.some(rule => rule.sourceId === source.id && rule.enabled && rule.planning && !rule.queue))
    if (repositories.length) {
      const lease = join(this.directory, 'continuous.planning')
      await withFileLock(lease, async () => {
        for (const source of repositories) {
          if (source.lastError?.retryAt && Date.parse(source.lastError.retryAt) > Date.now()) continue
          await refreshRepositoryCandidates(apply => this.sourceTransaction(apply), { projectId: source.projectId, sourceId: source.id }, this.source)
        }
      }, { waitMs: 0 }).catch(error => {
        if (!(error instanceof Error) || error.message !== `atomic-write: timed out waiting for the writer lock at ${lease}.lock`) throw error
      })
    }
    await this.sourceTransaction(async state => {
      for (const source of state.sources) {
        const project = state.projects.find(project => project.id === source.projectId)
        if (project && source.githubProject && source.projectSnapshot && project.name === `${source.githubProject.owner} / Project #${source.githubProject.number}`) { project.name = source.projectSnapshot.project.title; project.version++ }
      }
    })
  }
  private async configureContinuous(state: WorkSnapshot, command: Extract<WorkCommand, { type: 'continuous.configure' | 'continuous.set-enabled' }>, choices?: import('./work-types.ts').HostExecutionChoices): Promise<WorkResult> {
    const project = state.projects.find(project => project.id === command.projectId)
    const source = state.sources.find(source => source.id === command.sourceId && source.projectId === command.projectId)
    if (!project || !source) return failed('unknown-source', 'Source does not belong to this project')
    const previous = state.continuousRules?.find(rule => rule.projectId === project.id)
    if (command.expectedVersion !== (previous?.version ?? 0)) return conflict(previous?.version ?? 0)
    if (command.type === 'continuous.set-enabled') {
      if (!previous) return failed('continuous-unconfigured', 'Configure the exact execution scope before enabling continuous work')
      if (previous.sourceId !== source.id) return failed('continuous-source-mismatch', 'Use the Project queue source for this command')
      if (command.enabled && previous.migrationConflict) return failed(previous.migrationConflict.code, previous.migrationConflict.message)
      if (command.enabled && previous.planning && !previous.queue) {
        const plan = previous.planning.plans.at(-1)
        if (!plan || plan.draftVersion !== previous.planning.draftVersion) return failed('planning-preview-required', 'Preview the current instruction, scope and Block before enabling')
        try {
          const fresh = planningBasis(state, previous)
          const remaining = plan.steps.filter(step => !previous.items.some(item => item.nodeId === step.nodeId && item.ref))
          validatePlan({ steps: remaining }, fresh, previous)
          for (const step of remaining.filter(step => step.mode === 'existing')) {
            if (!samePlannedExecution(plan.basis.candidates.find(candidate => candidate.issue.nodeId === step.nodeId)?.execution, fresh.candidates.find(candidate => candidate.issue.nodeId === step.nodeId)?.execution)) return failed('planning-coordination-changed', `Issue ${step.nodeId} coordination changed; preview again`)
          }
        }
        catch (error) { return failed(error instanceof PlanningError ? error.code : 'planning-invalid', error instanceof Error ? error.message : 'Plan is no longer valid') }
        previous.planning.enabledPlanVersion = plan.version
      }
      previous.enabled = command.enabled; previous.version++
      return { status: 'completed', continuousRule: previous }
    }
    if (previous?.sourceId !== undefined && previous.sourceId !== source.id && !command.queue) return failed('continuous-source-mismatch', 'Save explicit queue settings to change the Project queue source')
    if (previous?.migrationConflict && !command.queue) return failed(previous.migrationConflict.code, previous.migrationConflict.message)
    if (source.repository && command.enabled && !command.queue && !previous?.queue) return failed('planning-preview-required', 'Save resources, preview the repository instruction, then explicitly enable its plan')
    if (command.assignee === '@me' && !source.identity) return failed('github-identity-unobserved', 'Refresh the GitHub Project before authorizing the current account')
    if (!choices?.models.some(model => model.provider === command.model.provider && model.model === command.model.model)) return failed('unavailable-model', 'Exact model is unavailable')
    if (!choices.agentPresets.includes(command.agentPreset) || !choices.permissionPresets.includes(command.permissionPreset)) return failed('disallowed-preset', 'Exact execution presets must be inherited host choices')
    const agent = state.agents.find(agent => agent.id === project.defaultAgentId)!
    if (agent.policy.modelCandidates.length && !agent.policy.modelCandidates.includes(`${command.model.provider}/${command.model.model}`)) return failed('disallowed-model', 'Model is not authorized by the Project Agent policy')
    if (state.projects.some(other => other.id !== project.id && other.resources.some(ref => sameResource(ref, command.resource)))) return failed('resource-in-use', 'Resource belongs to another project')
    if (!project.resources.some(ref => sameResource(ref, command.resource))) { project.resources.push(command.resource); project.version++ }
    if (previous) observeContinuousTasks(state, previous)
    const rule: import('./work-types.ts').ContinuousWorkRule = {
      id: previous?.id ?? randomUUID(), projectId: project.id, sourceId: source.id, version: (previous?.version ?? 0) + 1, enabled: command.enabled,
      scope: { assignee: command.assignee, labels: [...new Set(command.labels)].sort(), ...(command.assignee === '@me' ? { identity: { login: source.identity!.login, nodeId: source.identity!.nodeId } } : {}) },
      resource: command.resource, model: command.model, agentPreset: command.agentPreset, permissionPreset: command.permissionPreset,
      items: previous?.items ?? [], slots: previous ? continuousSlots(previous) : [], ...(previous?.active ? { active: previous.active } : {}),
      ...(command.queue || previous?.queue ? { queue: command.queue ?? previous!.queue } : {}),
      ...(previous?.legacyRules ? { legacyRules: previous.legacyRules } : {}),
      ...(previous?.planning ? { planning: { ...previous.planning, scopeVersion: previous.planning.scopeVersion + 1, draftVersion: previous.planning.draftVersion + 1 }, ...(!command.queue && !previous.queue ? { enabled: false } : {}) } : {}),
    }
    if (command.queue && previous) { delete previous.migrationConflict; delete previous.error; delete previous.screeningError }
    rule.error = sourceScopeError(rule, source)
    if (!rule.error) discoverContinuous(rule, source)
    observeContinuousTasks(state, rule)
    if (previous) Object.assign(previous, rule)
    else (state.continuousRules ??= []).push(rule)
    return { status: 'completed', continuousRule: previous ?? rule }
  }
  /** Complete source observation and waiting-only model screening; never dispatches. */
  private async refreshContinuous(scope: { projectId: string; sourceId: string; expectedVersion: number }, command?: Extract<WorkCommand, { type: 'continuous.refresh' }>, waitForScreening = true): Promise<WorkResult> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const lease = join(this.directory, 'continuous.refresh')
    const before = await this.load()
    if (command) {
      const prior = before.commands.find(item => item.commandId === command.commandId)
      if (prior) return prior.fingerprint === JSON.stringify(command) ? prior.result : failed('command-id-reused', 'Command identity has different content')
    }
    const rule = before.continuousRules?.find(rule => rule.projectId === scope.projectId)
    if (!rule) return failed('continuous-unconfigured', 'Configure the Project queue first')
    if (rule.version !== scope.expectedVersion) return conflict(rule.version)
    if (rule.sourceId !== scope.sourceId) return failed('continuous-source-mismatch', 'Refresh the actual Project queue source')
    if (rule.migrationConflict) return failed(rule.migrationConflict.code, rule.migrationConflict.message)
    const source = before.sources.find(source => source.id === rule.sourceId)!
    // Network observation never holds the refresh lease: each source reserves its own
    // request identity, so a concurrent pass coalesces instead of failing on a lock.
    let scan: WorkResult = { status: 'completed' }
    if (source.repository) scan = await refreshRepositoryCandidates(apply => this.sourceTransaction(apply), scope, this.source)
    else await reconcileProjectSources(apply => this.sourceTransaction(apply), this.source, { ...scope, force: true, maxPagesPerSource: 200 })
    const refreshed = await withFileLock(lease, () => this.sourceTransaction(async state => {
      const current = state.continuousRules!.find(item => item.id === rule.id)!
      if (current.version !== scope.expectedVersion) return conflict(current.version)
      const observed = state.sources.find(source => source.id === current.sourceId)!
      current.error = scan.status !== 'completed' ? scan.error : sourceScopeError(current, observed)
      if (current.queue) current.nextRefreshAt = new Date(Date.now() + current.queue.refreshMinutes * 60_000).toISOString()
      if (!current.error) {
        if (current.queue?.filterPrompt?.trim()) for (const item of current.items) if (!item.ref && !['blocked', 'completed', 'paused'].includes(item.state)) delete item.screening
        discoverContinuous(current, observed); current.lastRefreshedAt = new Date(Date.now()).toISOString(); delete current.screeningError
      }
      observeContinuousTasks(state, current)
      return { status: 'completed' as const, continuousRule: current }
    }), { waitMs: 30_000 })
    if (refreshed.status !== 'completed') return refreshed
    const refreshedRule = refreshed.continuousRule!
    if (waitForScreening && !refreshedRule.error && refreshedRule.queue?.filterPrompt?.trim()) {
      // Bound interactive latency: a slow model keeps running in the background
      // while the queue's existing poll reports its decisions.
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([this.screenContinuous(refreshedRule.id, scope.expectedVersion),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 1_500) })])
      if (timer) clearTimeout(timer)
    }
    return withFileLock(lease, () => this.sourceTransaction(async state => {
      const current = state.continuousRules!.find(item => item.id === refreshedRule.id)!
      if (current.version !== scope.expectedVersion) return conflict(current.version)
      const result: WorkResult = { status: 'completed', continuousRule: current }
      if (command && !state.commands.some(item => item.commandId === command.commandId)) this.dao.recordCommand(state, command.commandId, JSON.stringify(command), result)
      return result
    }), { waitMs: 30_000 })
  }
  private screenContinuous(ruleId: string, expectedVersion: number): Promise<void> {
    const key = `${ruleId}:${expectedVersion}`
    const pending = this.screeningJobs.get(key)
    if (pending) return pending
    const job = this.runScreenContinuous(ruleId, expectedVersion).finally(() => { this.screeningJobs.delete(key) })
    this.screeningJobs.set(key, job)
    return job
  }
  private async runScreenContinuous(ruleId: string, expectedVersion: number): Promise<void> {
    const snapshot = await this.load(), rule = snapshot.continuousRules!.find(rule => rule.id === ruleId)!
    if (rule.version !== expectedVersion) return
    const source = snapshot.sources.find(source => source.id === rule.sourceId)!
    if (!rule.items.some(item => !item.ref && item.state === 'waiting' && item.reason === SCREENING_PENDING)) return
    const basis = screeningBasis(rule, source), key = screeningKey(rule, source)
    try {
      if (!this.planner?.screen) throw new Error('宿主大模型筛选能力不可用')
      const { decisions } = validateScreening(await this.planner.screen(basis, rule.model), basis)
      await this.sourceTransaction(async state => {
        const current = state.continuousRules!.find(rule => rule.id === ruleId)!
        if (current.version !== expectedVersion) return
        const observed = state.sources.find(source => source.id === current.sourceId)!
        if (sourceScopeError(current, observed) || key !== screeningKey(current, observed)) throw new Error('筛选期间候选内容发生变化，请刷新重试')
        for (const decision of decisions) {
          const item = current.items.find(item => item.nodeId === decision.nodeId)!
          if (!item.ref && !['blocked', 'completed', 'paused'].includes(item.state)) item.screening = { key, matches: decision.matches, reason: decision.reason }
        }
        delete current.screeningError
        discoverContinuous(current, observed)
      })
    } catch (error) {
      await this.sourceTransaction(async state => {
        const current = state.continuousRules!.find(rule => rule.id === ruleId)!
        if (current.version === expectedVersion) current.screeningError = { code: 'screening-failed', message: `大模型筛选失败：${planningModelErrorSummary(error)}。刷新可重试。` }
      })
    }
  }
  private async previewContinuous(command: Extract<WorkCommand, { type: 'continuous.preview' }>): Promise<WorkResult> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    return withFileLock(join(this.directory, 'continuous.planning'), async () => {
      let snapshot = await this.load()
      const prior = snapshot.commands.find(item => item.commandId === command.commandId)
      if (prior) return prior.fingerprint === JSON.stringify(command) ? prior.result : failed('command-id-reused', 'Command identity has different content')
      let rule = snapshot.continuousRules?.find(rule => rule.projectId === command.projectId && rule.sourceId === command.sourceId)
      if (!rule) return failed('continuous-unconfigured', 'Configure authorized scope and resources first')
      if (rule.version !== command.expectedVersion) return conflict(rule.version)
      const scan = await refreshRepositoryCandidates(apply => this.sourceTransaction(apply), command, this.source)
      if (scan.status !== 'completed') return scan
      snapshot = await this.load()
      rule = snapshot.continuousRules!.find(item => item.id === rule!.id)!
      if (rule.version !== command.expectedVersion) return conflict(rule.version)
      try {
        if (!this.planner) throw new PlanningError('planning-model-unavailable', 'Host LLM planning capability is unavailable')
        const basis = planningBasis(snapshot, rule)
        const fingerprint = planningBasisFingerprint(basis)
        const requestCharacters = JSON.stringify(basis).length, candidateCount = basis.candidates.length
        let output: unknown
        try { output = await this.planner.generate(basis, rule.model) }
        catch (error) {
          const summary = planningModelErrorSummary(error)
          throw new PlanningError('planning-model-failed', `Model planning failed: ${summary}; requestCharacters=${requestCharacters}, candidates=${candidateCount}`)
        }
        return await this.sourceTransaction(async state => {
          const current = state.continuousRules!.find(item => item.id === rule.id)!
          if (current.version !== command.expectedVersion) return conflict(current.version)
          const fresh = planningBasis(state, current)
          if (planningBasisFingerprint(fresh) !== fingerprint) return failed('planning-basis-changed', 'Planning authority or candidate identities changed while planning; preview again')
          const plan = validatePlan(output, fresh, current)
          const planning = current.planning!
          planning.plans.push({ version: (planning.plans.at(-1)?.version ?? 0) + 1, draftVersion: planning.draftVersion, basis, steps: plan.steps, createdAt: new Date().toISOString() })
          delete planning.error
          current.version++
          const result: WorkResult = { status: 'completed', continuousRule: current }
          this.dao.recordCommand(state, command.commandId, JSON.stringify(command), result)
          return result
        })
      } catch (error) {
        const detail = { code: error instanceof PlanningError ? error.code : 'planning-model-failed', message: error instanceof Error ? error.message : 'Model planning failed' }
        await this.sourceTransaction(async state => {
          const current = state.continuousRules!.find(item => item.id === rule.id)!
          if (current.version === command.expectedVersion && current.planning) current.planning.error = detail
        })
        return failed(detail.code, detail.message)
      }
    })
  }
  /** Persistent ordered dispatch reuses ordinary task.start reservations and execution drivers. */
  async reconcileContinuous(): Promise<void> {
    if (!this.host.execution) return
    const host = this.host.execution
    const configured = (await this.load()).continuousRules
    if (!configured?.length) return
    for (const rule of configured) if (rule.queue && rule.enabled && !rule.migrationConflict && (!rule.nextRefreshAt || Date.parse(rule.nextRefreshAt) <= Date.now())) {
      await this.refreshContinuous({ projectId: rule.projectId, sourceId: rule.sourceId, expectedVersion: rule.version }, undefined, false)
    }
    // Session occupancy changes the screening batch independently of source polling.
    // Reclassify cached candidates so stale decisions enter the existing screening path.
    await this.sourceTransaction(async state => {
      for (const rule of state.continuousRules ?? []) {
        const source = state.sources.find(source => source.id === rule.sourceId)
        if (rule.enabled && rule.queue?.filterPrompt?.trim() && source && !sourceScopeError(rule, source)) {
          discoverContinuous(rule, source)
          observeContinuousTasks(state, rule)
        }
      }
    })
    const screeningSnapshot = await this.load()
    for (const rule of screeningSnapshot.continuousRules ?? []) {
      const source = screeningSnapshot.sources.find(source => source.id === rule.sourceId)
      if (rule.enabled && rule.queue?.filterPrompt?.trim() && !rule.screeningError && !sourceScopeError(rule, source) && rule.items.some(item => !item.ref && item.state === 'waiting' && item.reason === SCREENING_PENDING)) {
        void this.screenContinuous(rule.id, rule.version).catch(error => { console.warn(`Continuous screening persistence failed: ${planningModelErrorSummary(error)}`) })
      }
    }
    const lease = join(this.directory, 'continuous.scheduler')
    await withFileLock(lease, async () => {
      await this.sourceTransaction(async state => {
        for (const rule of state.continuousRules ?? []) {
          const source = state.sources.find(source => source.id === rule.sourceId)
          rule.error = sourceScopeError(rule, source)
          observeContinuousTasks(state, rule)
          const recovery = rule.items.find(item => item.recoveryBlocked)
          if (!rule.error && recovery) rule.error = { code: 'continuous-recovery-blocked', message: recovery.reason ?? 'Host recovery needs an explicit retry' }
          if (!rule.error && source) {
            if (!rule.queue) { discoverContinuous(rule, source); observeContinuousTasks(state, rule) }
            if (rule.planning || rule.queue) for (const item of rule.items) {
              if (item.state === 'queued' && !continuousDependenciesReady(state, rule, item.nodeId)) item.reason = `Issue ${item.nodeId} is waiting for complete child/dependency acceptance`
            }
          }
        }
      })
      for (const ruleId of (await this.load()).continuousRules!.map(rule => rule.id)) {
        let state = await this.load()
        let rule = state.continuousRules!.find(rule => rule.id === ruleId)!
        for (const slot of continuousSlots(rule)) {
          let execution = state.executions.find(execution => sameTask(execution.ref, slot))
          if (!execution) {
            await this.sourceTransaction(async state => {
              const current = state.continuousRules!.find(rule => rule.id === ruleId)!
              current.error = { code: 'continuous-execution-missing', message: 'Reserved active execution is missing; explicit recovery is required' }
            })
            continue
          }
          if (execution) {
            if (execution.control?.action === 'end') {
              if (execution.control.status === 'accepted' && host.status(execution) !== 'running') await this.ensureExecution(execution.id, execution.control.commandId)
              continue
            }
            let owner = continuousOwner(state, execution.ref)!
            // Older hosts could activate the controller before sessionQuery. Only
            // that proven read-only failure is safe to re-observe automatically;
            // unknown settlement/creation outcomes still require explicit recovery.
            if (owner.item.recoveryBlocked && execution.actual && owner.item.executionId === execution.id
              && owner.item.reason === "Cannot read properties of undefined (reading 'observeSession')" && host.failure) {
              try {
                await this.observeRuntimeFailure(execution.id)
              } catch { continue } // The required observation is still unavailable.
              await this.sourceTransaction(async state => {
                const current = state.executions.find(item => item.id === execution!.id)!
                const managed = continuousOwner(state, current.ref)!
                if (current.control?.action === 'end' || continuousCompleted(state, current)
                  || current.epoch !== execution!.epoch || !sameSession(current.session, execution!.session)
                  || managed.item.executionId !== current.id || !continuousHasSlot(managed.rule, current.ref)
                  || managed.item.reason !== "Cannot read properties of undefined (reading 'observeSession')") return
                delete managed.item.recoveryBlocked; delete managed.item.reason
                managed.item.attempts = 0
                if (!continuousCompleted(state, current) && current.state !== 'failed' && !current.error && !current.continuation?.error
                  && !current.continuationBlocked && !(current.runtimeFailure && !current.runtimeFailure.acknowledged)) {
                  managed.item.state = ['waiting', 'paused'].includes(current.state) ? current.state as 'waiting' | 'paused'
                    : current.control?.status === 'accepted' && current.control.action !== 'resume' ? 'blocked' : 'active'
                }
                managed.item.reason = (current.error ?? current.continuation?.error ?? current.continuationBlocked
                  ?? (current.runtimeFailure && !current.runtimeFailure.acknowledged ? current.runtimeFailure : undefined))?.message
                  ?? (['waiting', 'paused'].includes(current.state) || current.control?.status === 'accepted' && current.control.action !== 'resume' ? current.control?.reason : undefined)
                const remaining = managed.rule.items.find(item => item.recoveryBlocked)
                managed.rule.error = sourceScopeError(managed.rule, state.sources.find(source => source.id === managed.rule.sourceId))
                  ?? (remaining ? { code: 'continuous-recovery-blocked', message: remaining.reason ?? 'Host recovery needs an explicit retry' } : undefined)
              })
              state = await this.load(); execution = state.executions.find(item => item.id === execution!.id)!
              owner = continuousOwner(state, execution.ref)!
            }
            if (host.status(execution) === 'running') continue
            if (owner.item.recoveryBlocked && !owner.item.resumeRequested) continue
            try {
              await this.observeRuntimeFailure(execution.id)
              await this.observeContinuation(execution.id)
              // Read back receipts before declaring an idle execution unfinished; observation never wakes it.
              if (execution.actual && !['accepted', 'creating'].includes(execution.state)) {
                const deliveries = await Promise.all(execution.events.filter(pendingEvent).map(async event => ({ id: event.id, delivery: await host.observe(execution!, event) })))
                await this.sourceTransaction(async state => {
                  const current = state.executions.find(item => item.id === execution!.id)!
                  if (current.epoch !== execution!.epoch) return
                  for (const result of deliveries) { const event = current.events.find(event => event.id === result.id); if (event) event.delivery = result.delivery }
                })
              }
              state = await this.load(); execution = state.executions.find(item => item.id === execution!.id)!
              // Stop requests remain actionable while completion already denies future model steps.
              if (execution.control?.status === 'accepted' && execution.control.action !== 'resume') {
                await this.ensureExecution(execution.id, execution.control.commandId)
                state = await this.load(); execution = state.executions.find(item => item.id === execution!.id)!
              }
              if (host.status(execution) === 'running') continue
              let currentOwner = continuousOwner(state, execution.ref)!
              let release: import('./work-types.ts').ContinuousWorkItem['state'] | undefined
              let reason: string | undefined
              if (continuousCompleted(state, execution)) release = 'completed'
              else if ((execution.error || execution.continuation?.error) && !currentOwner.item.resumeRequested) { release = 'blocked'; reason = (execution.error ?? execution.continuation!.error)!.message }
              else if (execution.runtimeFailure && !execution.runtimeFailure.acknowledged) { release = 'blocked'; reason = execution.runtimeFailure.message }
              else if (execution.continuationBlocked) { release = 'blocked'; reason = execution.continuationBlocked.message }
              else if (['waiting', 'paused'].includes(execution.state) && !currentOwner.item.resumeRequested) { release = execution.state as 'waiting' | 'paused'; reason = execution.control?.reason }
              else if (currentOwner.item.state === 'blocked' && !currentOwner.item.resumeRequested) { release = 'blocked'; reason = currentOwner.item.reason }
              else if (!continuationInFlight(execution) && !execution.error && !currentOwner.item.resumeRequested && !['accepted', 'creating', 'failed'].includes(execution.state) && execution.events.every(event => !pendingEvent(event))) {
                const task = taskAt(state, execution.ref)!
                const progress = task.progress
                const fingerprint = progress && createHash('sha256').update(JSON.stringify({ stage: progress.stage, summary: progress.summary, next: progress.next, blockers: progress.blockers, criteria: progress.criteria, breakdown: task.breakdown })).digest('hex')
                if (progress?.specificationVersion === task.specification.version && progress.stage === 'in-progress' && progress.next.trim() && !progress.blockers.length && fingerprint && !currentOwner.item.followups?.includes(fingerprint)) {
                  await this.sourceTransaction(async state => {
                    const current = state.executions.find(item => item.id === execution!.id)!
                    const owner = continuousOwner(state, current.ref)!
                    if (owner.item.followups?.includes(fingerprint) || continuousCompleted(state, current)) return
                    ;(owner.item.followups ??= []).push(fingerprint)
                    current.events.push({ id: `continuous-next:${current.id}:${fingerprint}`, text: `Continue the already authorized Issue work using the accepted next step: ${progress.next}\nReport concrete progress and evidence. If blocked, waiting or complete, report that state and stop. This message grants no additional permissions.`, kind: 'input', delivery: 'accepted', acceptance: 'unassessed' })
                  })
                } else { release = 'blocked'; reason = 'Execution is idle without new actionable progress; send input or explicitly resume' }
              }
              if (release) {
                // Fence native input before the safe host boundary, and retain the slot if settling fails.
                const boundary = await this.sourceTransaction(async state => {
                  const current = state.executions.find(item => item.id === execution!.id)!
                  const owner = continuousOwner(state, current.ref)!
                  if (current.epoch !== execution!.epoch || host.status(current) === 'running' || (current.control?.status === 'accepted' && current.control.action === 'resume')) return undefined
                  if (continuationInFlight(current) && !continuousCompleted(state, current) && !['waiting', 'paused'].includes(current.state) && !current.continuation?.error && !current.continuationBlocked) return undefined
                  if (release === 'blocked' && !current.error && !current.runtimeFailure && !current.continuationBlocked && !current.continuation?.error && (owner.item.resumeRequested || current.events.some(pendingEvent))) return undefined
                  owner.item.state = release!; owner.item.reason = reason
                  return current
                })
                if (!boundary) continue
                if (release === 'completed') {
                  if (taskAt(await this.load(), boundary.ref)?.completion?.closeout.status !== 'settled') continue
                } else await host.settle(boundary)
                await this.sourceTransaction(async state => {
                  const current = state.executions.find(item => item.id === boundary.id)!
                  const owner = continuousOwner(state, current.ref)!
                  if (continuousHasSlot(owner.rule, current.ref) && current.epoch === boundary.epoch && owner.item.state === release && host.status(current) !== 'running') continuousSetSlot(owner.rule, current.ref, false)
                })
              } else {
                if (currentOwner.item.resumeRequested) {
                  await this.sourceTransaction(async state => {
                    const current = state.executions.find(item => item.id === execution!.id)!
                    const owner = continuousOwner(state, current.ref)!
                    if (continuousCompleted(state, current) || owner.item.end || current.control?.action === 'end') return
                    owner.item.state = 'active'; delete owner.item.resumeRequested; delete owner.item.explicitResumeRequested; delete owner.item.reason
                    if (['waiting', 'paused'].includes(current.state) || current.control?.action !== 'resume') current.control = { commandId: `continuous-resume:${current.id}:${current.events.length}`, action: 'resume', status: 'accepted' }
                  })
                }
                await this.observeContinuation(execution.id)
                const result = await this.ensureExecution(execution.id, this.dao.firstHistory(execution)!.commandId)
                if (result.status === 'completed' && (result.execution?.error || result.execution?.continuation?.error)) {
                  const error = result.execution.error ?? result.execution.continuation!.error!
                  await this.sourceTransaction(async state => { continuousProblem(continuousOwner(state, execution!.ref)!.item, error.message) })
                } else {
                  await this.sourceTransaction(async state => { const item = continuousOwner(state, execution!.ref)!.item; item.attempts = 0; delete item.retryAt; delete item.reason })
                }
                // One advancement per active rule per tick. A newly idle result is classified next tick.
                continue
              }
            } catch (error) {
              await this.sourceTransaction(async state => {
                const owner = continuousOwner(state, execution!.ref)!
                continuousProblem(owner.item, error instanceof Error ? error.message : 'Continuous recovery outcome is unknown')
                owner.item.recoveryBlocked = true
                owner.rule.error = { code: 'continuous-recovery-failed', message: owner.item.reason! }
              })
              continue
            }
          }
        }
        for (let dispatch = 0; dispatch < (rule.queue?.concurrency ?? 1); dispatch++) {
          state = await this.load(); rule = state.continuousRules!.find(rule => rule.id === ruleId)!
          if (continuousSlots(rule).length >= (rule.queue?.concurrency ?? 1)) break
          if (rule.migrationConflict) break
          // Paused queues admit explicit existing-Task recovery only; accepted input waits.
          const next = continuousCandidates(rule, state.sources.find(source => source.id === rule.sourceId)).find(item => item.resumeRequested || (!(rule.planning || rule.queue) || continuousDependenciesReady(state, rule, item.nodeId)))
          const resume = next?.resumeRequested ? next : undefined
          if (resume) {
            await this.sourceTransaction(async state => {
              const current = state.continuousRules!.find(rule => rule.id === ruleId)!
              const item = current.items.find(item => item.nodeId === resume.nodeId)!
              const execution = state.executions.find(execution => execution.id === item.executionId)!
              if (item.end || execution.control?.action === 'end' || continuousSlots(current).length >= (current.queue?.concurrency ?? 1) || continuousCompleted(state, execution) || current.queue && !current.enabled && !item.explicitResumeRequested) return
              continuousSetSlot(current, item.ref!, true); item.state = 'active'; delete item.resumeRequested; delete item.explicitResumeRequested; delete item.reason
              execution.control = { commandId: `continuous-resume:${execution.id}:${execution.events.length}`, action: 'resume', status: 'accepted' }
            })
            await this.ensureExecution(resume.executionId!, `continuous-resume:${resume.executionId}`)
            continue
          }
          if (!rule.enabled || rule.error) continue
          const candidate = next?.state === 'queued' ? next : undefined
          if (!candidate) continue
          let choices: import('./work-types.ts').HostExecutionChoices
          try {
            const canonical = state.externalBindings.find(binding => binding.nodeId === candidate.nodeId)
            const existing = canonical && state.executions.find(execution => sameTask(execution.ref, canonical.ref))
            const step = rule.queue ? undefined : rule.planning?.plans.find(plan => plan.version === rule.planning!.enabledPlanVersion)?.steps.find(step => step.nodeId === candidate.nodeId)
            choices = await host.check(existing && (rule.queue || step && step.mode === 'existing')
              ? { resource: existing.resource, model: existing.model, agentPreset: existing.agentPreset, permissionPreset: existing.permissionPreset, sessionMode: 'reuse', session: existing.session }
              : { resource: rule.resource, model: rule.model, agentPreset: rule.agentPreset, permissionPreset: rule.permissionPreset,
                  sessionMode: 'create', session: { runtimeId: rule.resource.runtimeId, sessionId: `continuous-check-${rule.id}` } })
          } catch (error) {
            await this.sourceTransaction(async state => {
              const current = state.continuousRules!.find(rule => rule.id === ruleId)!
              const item = current.items.find(item => item.nodeId === candidate.nodeId)!
              continuousProblem(item, error instanceof Error ? error.message : 'Host admission failed')
              current.error = { code: error instanceof WorkExecutionError ? error.code : 'host-admission-failed', message: item.reason! }
            })
            continue
          }
          const executionId = await this.sourceTransaction(async state => {
            const current = state.continuousRules!.find(rule => rule.id === ruleId)!
            const freshSource = state.sources.find(source => source.id === current.sourceId)
            if (freshSource && !sourceScopeError(current, freshSource)) discoverContinuous(current, freshSource)
            observeContinuousTasks(state, current)
            const item = current.items.find(item => item.nodeId === candidate.nodeId)!
            if (item.end || continuousSlots(current).length >= (current.queue?.concurrency ?? 1) || !current.enabled || current.version !== rule.version || item.state !== 'queued' || sourceScopeError(current, state.sources.find(source => source.id === current.sourceId))) return undefined
            if ((current.planning || current.queue) && !continuousDependenciesReady(state, current, item.nodeId)) return undefined
            const commandId = `continuous:${current.id}:${createHash('sha256').update(item.nodeId).digest('hex')}`
            // Reserve import, binding, execution and slot in one snapshot. No host side effects precede this commit.
            const draft = this.dao.fork(state)
            const canonical = draft.externalBindings.find(binding => binding.nodeId === item.nodeId)
            const imported = canonical
              ? { status: 'completed' as const, ref: canonical.ref, task: taskAt(draft, canonical.ref) }
              : applySourceCommand(draft, { type: 'source.import', commandId: `${commandId}:import`, projectId: current.projectId, sourceId: current.sourceId, nodeId: item.nodeId })
            if (imported.status !== 'completed' || !imported.ref || !imported.task) { item.state = 'blocked'; item.reason = imported.status !== 'completed' ? imported.error.message : 'Issue import returned no task'; return undefined }
            const existing = draft.executions.find(execution => sameTask(execution.ref, imported.ref))
            if (existing) {
              if (existing.control?.action === 'end') return undefined
              const other = continuousOwner(draft, existing.ref)
              if (other && other.rule.id !== current.id) { item.state = 'waiting'; item.reason = `Canonical Task is owned by rule ${other.rule.id}; observe without advancing`; return undefined }
              const accepted = imported.task.progress?.stage === 'done' && imported.task.progress.specificationVersion === imported.task.specification.version
              const plan = current.queue ? undefined : current.planning?.plans.find(plan => plan.version === current.planning!.enabledPlanVersion)
              const step = plan && plan.steps.find(step => step.nodeId === item.nodeId)
              if (current.planning && !current.queue && (step?.mode !== 'existing' || !samePlannedExecution((plan || undefined)?.basis.candidates.find(candidate => candidate.issue.nodeId === item.nodeId)?.execution, existing))) { item.state = 'waiting'; item.reason = 'Canonical execution coordination changed after preview; preview again'; return undefined }
              if (((!current.planning || current.queue) && (!sameResource(existing.resource, current.resource) || existing.permissionPreset !== current.permissionPreset || existing.agentPreset !== current.agentPreset)) || existing.agentId !== imported.task.agentId) { item.state = 'waiting'; item.reason = 'Canonical execution uses another authorized resource or policy; observe without changing owner'; return undefined }
              if (!current.queue && (existing.state === 'paused' || existing.control?.action === 'pause')) { item.state = 'waiting'; item.reason = 'Canonical execution requires explicit resume'; return undefined }
              const reservedRule = draft.continuousRules!.find(rule => rule.id === ruleId)!
              const reserved = reservedRule.items.find(candidate => candidate.nodeId === item.nodeId)!
              reserved.ref = existing.ref; reserved.executionId = existing.id; reserved.state = accepted ? 'completed' : existing.error || existing.continuation?.error || existing.runtimeFailure && !existing.runtimeFailure.acknowledged || existing.continuationBlocked ? 'blocked' : existing.state === 'paused' || existing.control?.action === 'pause' ? 'paused' : existing.state === 'waiting' ? 'waiting' : 'active'
              reserved.reason = (existing.error ?? existing.continuation?.error ?? existing.continuationBlocked ?? existing.runtimeFailure)?.message
              if (!accepted || imported.task.completion?.closeout.status !== 'settled') continuousSetSlot(reservedRule, existing.ref, true)
              if (reserved.state === 'active' && step && plan) existing.events.push({ id: `continuous-plan:${current.id}:${plan.version}:${item.nodeId}`, text: `Continue the already authorized canonical Issue work. Planned next action: ${step.nextAction}\nReason: ${step.why}\nPreserve existing decisions and acceptance requirements. This grants no additional permissions.`, kind: 'input', delivery: 'accepted', acceptance: 'unassessed' })
              if (canonical && !canonical.sourceIds.includes(current.sourceId)) canonical.sourceIds.push(current.sourceId)
              Object.assign(state, draft)
              // Running/waiting/completed executions are observed through the same scheduler; never send another kickoff.
              return reserved.state === 'active' && host.status(existing) !== 'running' ? existing.id : undefined
            }
            if (isTaskCompleted(imported.task)) { item.state = 'completed'; item.reason = 'Canonical Task is already accepted'; return undefined }
            const result = await this.apply(draft, { type: 'task.start', commandId, ref: imported.ref, expectedVersion: imported.task.version, agentId: imported.task.agentId,
              resource: current.resource, model: current.model, agentPreset: current.agentPreset, permissionPreset: current.permissionPreset }, choices)
            if (result.status !== 'completed' || !result.execution) { continuousProblem(item, result.status !== 'completed' ? result.error.message : 'Start returned no execution'); return undefined }
            const reservedRule = draft.continuousRules!.find(rule => rule.id === ruleId)!
            const planned = reservedRule.queue ? undefined : reservedRule.planning?.plans.find(plan => plan.version === reservedRule.planning!.enabledPlanVersion)?.steps.find(step => step.nodeId === candidate.nodeId)
            if (planned) {
              const kickoff = result.execution.events.find(event => event.id === `kickoff:${result.execution!.id}`)!
              const suffix = `\nContinuous plan next action: ${planned.nextAction}\nReason: ${planned.why}\nPreserve the full accepted Issue requirements and existing permissions.`
              if (kickoff.text.length + suffix.length > 100_000) { item.state = 'blocked'; item.reason = 'Planned next action exceeds the bounded kickoff limit'; return undefined }
              kickoff.text += suffix
            }
            const reserved = reservedRule.items.find(item => item.nodeId === candidate.nodeId)!
            reserved.ref = imported.ref; reserved.executionId = result.execution.id; reserved.state = 'active'; delete reserved.reason; delete reserved.retryAt
            continuousSetSlot(reservedRule, imported.ref, true)
            Object.assign(state, draft)
            return result.execution.id
          })
          if (executionId) {
            const result = await this.ensureExecution(executionId, `continuous-start:${executionId}`)
            if (result.status === 'completed' && result.execution?.error) await this.sourceTransaction(async state => { continuousProblem(continuousOwner(state, result.execution!.ref)!.item, result.execution!.error!.message) })
          }
        }
      }
    }, { waitMs: 0 }).catch(error => {
      if (!(error instanceof Error) || error.message !== `atomic-write: timed out waiting for the writer lock at ${lease}.lock`) throw error
    })
  }
  async execute(input: unknown, actor: WorkActor): Promise<WorkResult> {
    if (!actor.operator && !actor.session) return failed('forbidden', 'Host operator or trusted Session authorization is required')
    const parsed = commandSchema.safeParse(input)
    if (!parsed.success) return failed('invalid-command', 'Invalid work command')
    const command = parsed.data
    if (command.type === 'github.logout') {
      if (!actor.operator) return failed('forbidden', 'Host operator authorization is required')
      if (!this.source?.logout) return failed('github-capability-unavailable', '当前宿主未提供 GitHub 退出能力')
      try { return { status: 'completed', githubAccount: await this.source.logout(command) } }
      catch (error) { return failed(error instanceof SourceError ? error.code : 'github-unavailable', error instanceof SourceError ? error.message : '退出 GitHub 失败') }
    }
    if (command.type === 'github.login') {
      if (!actor.operator) return failed('forbidden', 'Host operator authorization is required')
      if (!this.source?.login) return failed('github-capability-unavailable', 'GitHub 登录能力不可用')
      return { status: 'completed', githubLogin: this.source.login(command.action) }
    }
    let sourceCandidate: SourceCandidate | undefined
    if (!actor.operator && command.type === 'source.connect') return failed('forbidden', 'Host operator authorization is required')
    let admissionChoices: import('./work-types.ts').HostExecutionChoices | undefined
    if (!actor.operator && !('executionId' in command)) return failed('forbidden', 'Session actors can only control their current execution')
    const recorded = actor.operator ? (await this.load()).commands.find(item => item.commandId === command.commandId) : undefined
    if (recorded && recorded.fingerprint !== JSON.stringify(command)) return { status: 'conflict', error: { code: 'command-id-reused', message: 'Command ID already has different content' } }
    if (command.type === 'continuous.refresh') return this.refreshContinuous(command, command)
    if (command.type === 'continuous.preview') return this.previewContinuous(command)
    if (!recorded && command.type === 'continuous.set-enabled' && command.enabled) {
      const state = await this.load()
      const rule = state.continuousRules?.find(rule => rule.projectId === command.projectId && rule.sourceId === command.sourceId)
      if (rule?.planning && state.sources.find(source => source.id === command.sourceId)?.repository) {
        const scan = await refreshRepositoryCandidates(apply => this.sourceTransaction(apply), command, this.source)
        if (scan.status !== 'completed') return scan
      }
    }
    if (!recorded && command.type === 'source.connect' && command.url) {
      if (!this.source?.identify) return failed('github-capability-unavailable', 'Source identification is unavailable')
      try { sourceCandidate = await this.source.identify(command.url) } catch (error) { return failed(error instanceof SourceError ? error.code : 'github-unavailable', error instanceof Error ? error.message : 'Source could not be identified') }
    }
    if (!recorded && (command.type === 'task.start' || command.type === 'continuous.configure')) {
      if (!this.host.execution) return failed('host-capability-unavailable', 'This host has no managed execution capability')
      try { admissionChoices = await this.host.execution.check({ ...command, sessionMode: 'session' in command && command.session ? 'reuse' : 'create', session: ('session' in command ? command.session : undefined) ?? { runtimeId: command.resource.runtimeId, sessionId: `session-${randomUUID()}` } }) }
      catch (error) { return failed(error instanceof WorkExecutionError ? error.code : 'host-admission-failed', error instanceof WorkExecutionError ? error.message : 'Host execution admission failed') }
    }
    const receipt = await this.dao.transaction<WorkResult>(async state => {
      if (!actor.operator) {
        const execution = 'executionId' in command ? state.executions.find(item => item.id === command.executionId) : undefined
        if (!execution || actor.agentId !== execution.agentId || !actor.session || !sameSession(actor.session, execution.session)) return failed('forbidden', 'Caller is not the responsible current Session and Project Agent')
      }
      if (actor.operator) {
        const prior = state.commands.find(item => item.commandId === command.commandId)
        if (prior) return prior.fingerprint === JSON.stringify(command) ? prior.result : { status: 'conflict', error: { code: 'command-id-reused', message: 'Command ID already has different content' } }
      }
      const refusal = await this.authorize(state, command)
      if (refusal) return refusal
      const fingerprint = JSON.stringify(command)
      const previous = state.commands.find(item => item.commandId === command.commandId)
      if (previous) return previous.fingerprint === fingerprint ? previous.result : { status: 'conflict', error: { code: 'command-id-reused', message: 'Command ID already has different content' } }
      const result = await this.apply(state, command, admissionChoices, sourceCandidate, actor.reporter)
      if (result.status !== 'completed') return result
      // An explicit start from the existing Task page may resolve a pre-admission queue problem.
      // Attach the same canonical execution and let the queue reserve capacity before dispatch.
      if (command.type === 'task.start' && result.execution && !continuousOwner(state, result.execution.ref)) {
        const binding = state.externalBindings.find(binding => sameTask(binding.ref, result.execution!.ref))
        const rule = state.continuousRules?.find(rule => rule.projectId === command.ref.projectId)
        const item = rule?.items.find(item => item.nodeId === binding?.nodeId && !item.ref && item.state !== 'completed')
        if (rule?.queue && item && sameResource(rule.resource, result.execution.resource) && rule.agentPreset === result.execution.agentPreset && rule.permissionPreset === result.execution.permissionPreset) {
          item.ref = result.execution.ref; item.executionId = result.execution.id
          item.resumeRequested = true; item.explicitResumeRequested = true; item.attempts = 0; delete item.retryAt; delete item.recoveryBlocked
          if (this.host.execution?.status(result.execution) === 'running') { continuousSetSlot(rule, result.execution.ref, true); item.state = 'active'; delete item.resumeRequested; delete item.explicitResumeRequested }
        }
      }
      // Receipt owns a detached snapshot: subsequent commands must not alter retry results.
      this.dao.recordCommand(state, command.commandId, fingerprint, result)
      return result
    }, result => result.status === 'completed')
    if (receipt.status === 'completed' && ['task.associate-session', 'task.link-child', 'source.link', 'source.import'].includes(command.type)) await this.refreshSessionTitles()
    if ((command.type === 'continuous.configure' || command.type === 'continuous.set-enabled') && receipt.status === 'completed') {
      if (!recorded && command.type === 'continuous.configure' && receipt.continuousRule?.queue) await this.refreshContinuous({ projectId: command.projectId, sourceId: command.sourceId, expectedVersion: receipt.continuousRule.version })
      await this.reconcileContinuous()
      return this.query({ type: 'continuous.status', projectId: command.projectId, sourceId: command.sourceId }, actor)
    }
    if (receipt.status === 'completed' && (command.type === 'task.completion-sync' || command.type === 'task.reconcile') && receipt.execution && isTaskCompleted(taskAt(await this.load(), receipt.execution.ref))) {
      await this.reconcileCompletions(command.type === 'task.completion-sync')
      if (command.type === 'task.completion-sync') await this.synchronizeCompletion(command.ref, command.commandId)
      const state = await this.load()
      return { status: 'completed', task: taskAt(state, receipt.execution.ref), execution: state.executions.find(item => item.id === receipt.execution!.id) }
    }
    if (command.type === 'continuous.end' && receipt.status === 'completed') {
      if (receipt.execution) await this.ensureExecution(receipt.execution.id, command.commandId)
      return this.query({ type: 'continuous.status', projectId: command.projectId, sourceId: command.sourceId }, actor)
    }
    if (command.type === 'task.continuation-material' || command.type === 'task.organize' || command.type === 'task.report' || command.type === 'task.configure-continuation') return receipt
    if (command.type === 'task.continue' && !actor.operator) return receipt
    if (command.type === 'task.control' && (!actor.operator || command.action === 'progress')) return receipt
    if ((command.type === 'task.start' || 'executionId' in command) && receipt.status === 'completed' && receipt.execution) {
      if (command.type === 'task.input' && (['accepted', 'creating'].includes(receipt.execution.state) || continuationInFlight(receipt.execution))) return receipt
      return this.ensureExecution(receipt.execution.id, command.commandId)
    }
    return receipt
  }
  private async synchronizeCompletion(ref: TaskRef, retryCommandId?: string): Promise<void> {
    const task = taskAt(await this.load(), ref)
    if (!task?.completion?.external) return
    const lease = join(this.directory, `${task.completion.operationId}.completion`)
    await withFileLock(lease, () => synchronizeClose(apply => this.sourceTransaction(apply), ref, this.source, retryCommandId), { waitMs: 0 }).catch(error => {
      if (!(error instanceof Error) || error.message !== `atomic-write: timed out waiting for the writer lock at ${lease}.lock`) throw error
    })
  }
  /** Completion recovery never creates an execution or wakes a model. */
  async reconcileCompletions(skipExternal = false): Promise<void> {
    const snapshot = await this.load()
    for (const task of snapshot.tasks) {
      if (!skipExternal && task.completion?.external) await this.synchronizeCompletion({ projectId: task.projectId, taskId: task.id })
      if (!task.completion || task.completion.closeout.status === 'settled' || task.completion.closeout.status === 'error'
        || (task.completion.closeout.retryAt && Date.parse(task.completion.closeout.retryAt) > Date.now())) continue
      const execution = snapshot.executions.find(item => item.id === task.completion!.executionId)
      const host = this.host.execution
      const save = (status: 'pending' | 'settled' | 'error', error?: string) => this.sourceTransaction(async state => {
        const current = taskAt(state, { projectId: task.projectId, taskId: task.id })!
        current.completion!.closeout = { ...current.completion!.closeout, status, error }
        if (status === 'settled') {
          const execution = state.executions.find(item => item.id === current.completion!.executionId)!
          execution.state = 'waiting'
          if (execution.control?.action === 'wait') execution.control.status = 'applied'
        }
      })
      if (!execution || execution.owner !== task.completion.owner || execution.epoch !== task.completion.epoch) { await save('error', 'completion-authority-changed'); continue }
      if (!host?.observation || !host.maintain) { await save('pending', 'host-settlement-capability-unavailable'); continue }
      try {
        const observed = await host.observation(execution, task.sessions)
        if (observed.settlement !== 'settled') { await save('pending', `host-settlement-${observed.settlement}`); continue }
        await host.maintain(execution, async () => {
          const current = await this.load()
          if (taskAt(current, execution.ref)?.completion?.closeout.status === 'settled') return
          const latest = current.executions.find(item => item.id === execution.id)
          if (!latest || latest.owner !== task.completion!.owner || latest.epoch !== task.completion!.epoch) throw new Error('completion-authority-changed')
          const fresh = await host.observation!(latest, taskAt(current, execution.ref)!.sessions)
          if (fresh.settlement !== 'settled') { await save('pending', `host-settlement-${fresh.settlement}`); return }
          // maintain owns the settled-and-flushed host barrier. Re-entering
          // settle here would wait for the maintenance lock we already hold.
          await save('settled')
        })
      } catch (error) {
        await save('pending', error instanceof Error ? error.message : 'host-settlement-unknown')
        await this.sourceTransaction(async state => {
          const operation = taskAt(state, execution.ref)!.completion!
          operation.closeout.attempts = (operation.closeout.attempts ?? 0) + 1
          operation.closeout.retryAt = new Date(Date.now() + 30_000).toISOString()
          if (operation.closeout.attempts >= MAX_CONTINUOUS_ATTEMPTS) operation.closeout.status = 'error'
          const managed = continuousOwner(state, execution.ref)
          if (managed) { continuousRetry(managed.item, operation.closeout.error!); if (managed.item.attempts >= MAX_CONTINUOUS_ATTEMPTS) managed.item.recoveryBlocked = true }
        })
      }
    }
  }
  private titleUpdates: Promise<void> = Promise.resolve()
  private async refreshSessionTitles(session?: import('./work-types.ts').SessionRef, pending?: import('./work-types.ts').WorkExecution): Promise<void> {
    if (!this.host.nameSession) return
    // Read after preceding writes finish so concurrent bindings cannot restore stale names.
    const operation = this.titleUpdates.catch(() => {}).then(async () => {
      for (const item of workSessionTitles(await this.load(), pending)) {
        if (!session || sameSession(item.session, session)) await this.host.nameSession!(item.session, item.title)
      }
    })
    this.titleUpdates = operation
    await operation
  }
  /** Host lifecycle recovery includes starts, handoffs, controls and task-owned titles. */
  async reconcileControls(): Promise<void> {
    const before = await this.load()
    if (before.executions.some(execution => execution.events.some(event => pendingEvent(event) && lifecycleOwned(event.nativeMessage)))) {
      await this.sourceTransaction(async state => { for (const execution of state.executions) discardLifecycleEvents(execution) })
    }
    await this.refreshSessionTitles()
    await this.reconcileCompletions()
    if (!this.host.execution) return
    // Explicit ends also recover items that already released a pause/blocked slot.
    for (const execution of (await this.load()).executions) {
      if (execution.control?.action === 'end' && execution.control.status === 'accepted' && this.host.execution.status(execution) !== 'running') await this.ensureExecution(execution.id, execution.control.commandId)
    }
    await this.reconcileContinuous()
    const snapshot = await this.load()
    for (const initial of snapshot.executions) {
      if (isTaskCompleted(taskAt(snapshot, initial.ref)) || (continuousOwner(snapshot, initial.ref) && !continuationInFlight(initial))) continue
      if (this.host.execution.status(initial) === 'running') continue
      await this.observeRuntimeFailure(initial.id)
      await this.observeContinuation(initial.id)
      const execution = (await this.load()).executions.find(item => item.id === initial.id)!
      if (execution.control?.status === 'accepted' || continuationInFlight(execution) || ['accepted', 'creating', 'failed'].includes(execution.state)
        || execution.events.some(event => pendingEvent(event) && !['waiting', 'paused'].includes(execution.state))) {
        await this.ensureExecution(execution.id, execution.control?.commandId ?? execution.continuation?.commandId ?? this.dao.firstHistory(execution)!.commandId)
      }
    }
  }
  private async observeRuntimeFailure(id: string): Promise<void> {
    if (!this.host.execution?.failure) return
    const execution = (await this.load()).executions.find(item => item.id === id)!
    const failure = await this.host.execution.failure(execution)
    if (failure?.id === execution.runtimeFailure?.id) return
    await this.sourceTransaction(async state => {
      const current = state.executions.find(item => item.id === id)!
      if (current.epoch !== execution.epoch) return
      if (failure) current.runtimeFailure = failure
      else delete current.runtimeFailure
    })
  }
  private async observeContinuation(id: string): Promise<void> {
    const state = await this.load()
    const execution = state.executions.find(item => item.id === id)!
    if (isTaskCompleted(taskAt(state, execution.ref)) || !continuousMayAdvance(state, execution)) return
    const policy = execution.continuationPolicy
    if (!policy?.enabled || (execution.runtimeFailure && !execution.runtimeFailure.acknowledged) || execution.continuationBlocked || continuationInFlight(execution) || !['ready', 'running'].includes(execution.state)
      || (execution.control?.status === 'accepted' && execution.control.action !== 'resume')) return
    let observation: import('./work-types.ts').ContinuationObservation | undefined
    let error: { code: string; message: string } | undefined
    try {
      if (!this.host.execution?.measure) throw new WorkExecutionError('continuation-meter-unavailable', 'Automatic continuation requires public host token measurement')
      observation = await this.host.execution.measure(execution)
      if (!execution.continuationObservation && execution.continuation && ['received', 'delivered'].includes(execution.continuation.phase) && execution.continuation.sourceEpoch + 1 === execution.epoch && observation.totalTokens >= policy.targetTokens) throw new WorkExecutionError('continuation-target-too-small', 'The first measured successor context already reaches this soft target; increase the target or continue manually instead of repeatedly rotating the same material')
      if (policy.targetTokens + policy.reserveTokens + observation.outputReserve > observation.capacity) throw new WorkExecutionError('continuation-policy-invalid', 'Context target plus handoff reserve and model output reserve exceeds exact model capacity')
      if (execution.continuationObservation && observation.routeKey !== execution.continuationObservation.routeKey) throw new WorkExecutionError('continuation-route-changed', 'Exact model route or capacity changed; explicitly reconfigure continuation before advancing')
    } catch (cause) { error = { code: cause instanceof WorkExecutionError ? cause.code : 'continuation-observation-failed', message: cause instanceof Error ? cause.message : 'Continuation observation failed' } }
    await this.sourceTransaction(async state => {
      const current = state.executions.find(item => item.id === id)!
      if (isTaskCompleted(taskAt(state, current.ref)) || current.epoch !== execution.epoch || current.continuationPolicy?.version !== policy.version || continuationInFlight(current)) return
      if (observation) current.continuationObservation = observation
      if (error) current.continuationBlocked = error
      else if (observation!.totalTokens >= policy.targetTokens) reserveContinuation(current, taskAt(state, current.ref)!, `auto:${current.id}:${current.epoch}:${policy.version}`, true)
    })
  }
  private async advanceContinuation(execution: import('./work-types.ts').WorkExecution): Promise<import('./work-types.ts').WorkExecution> {
    const host = this.host.execution!
    const operationId = execution.continuation!.operationId
    const save = async (change: (current: import('./work-types.ts').WorkExecution) => void) => this.sourceTransaction(async state => {
      const current = state.executions.find(item => item.id === execution.id)!
      if (current.continuation?.operationId !== operationId) throw new WorkExecutionError('stale-continuation', 'Continuation operation changed')
      change(current)
      return current
    })
    // Only unfinished legacy operations adopt the new barrier. Historical
    // delivered records remain terminal and never enter this recovery path.
    if (execution.continuation!.protocolVersion === undefined && execution.continuation!.phase !== 'delivered') execution = await save(current => { current.continuation!.protocolVersion = 1 })
    const sealInput = async () => {
      if (!host.sealInput) throw new WorkExecutionError('host-capability-unavailable', 'Durable source intake sealing is unavailable')
      const operation = execution.continuation!
      const source = { ...execution, session: operation.source, epoch: operation.sourceEpoch }
      const sealed = await host.sealInput(source, operationId)
      execution = await save(current => {
        if (current.continuation!.inputSeal !== undefined && current.continuation!.inputSeal !== sealed.seq) throw new WorkExecutionError('continuation-seal-conflict', 'Source intake seal changed')
        for (const message of sealed.messages) {
          if (lifecycleOwned(message) || message.id === operation.materialRequestId || operation.collections?.some(step => step.requestId === message.id) || current.events.some(item => item.id === message.id)) continue
          current.events.push({ id: message.id, text: 'Input accepted before source intake was sealed', kind: 'input', delivery: 'accepted', acceptance: 'unassessed', nativeMessage: message })
        }
        current.continuation!.inputSeal = sealed.seq
      })
    }
    if (execution.control?.status === 'accepted' && execution.control.action !== 'resume') return execution
    if (execution.epoch === execution.continuation!.sourceEpoch && execution.continuation!.automatic && execution.runtimeFailure && !execution.runtimeFailure.acknowledged) return save(current => { current.continuation!.error = { code: 'continuation-source-failed', message: 'The source model turn failed or was cancelled; explicit resume, input or manual continuation is required' } })
    if (execution.epoch === execution.continuation!.sourceEpoch && execution.continuation!.automatic && !execution.continuationPolicy?.enabled) return save(current => { current.continuation!.error = { code: 'continuation-disabled', message: 'Automatic continuation is disabled; explicit manual continuation can resume this same operation' } })
    let kickoffText: string | undefined
    try {
      if (!host.maintain || !host.profile) throw new WorkExecutionError('host-capability-unavailable', 'Safe continuation host boundary is unavailable')
      if (execution.continuation!.phase === 'delivered') {
        if (!host.received) throw new WorkExecutionError('host-capability-unavailable', 'Committed successor read receipts are unavailable')
        if (await host.received(execution)) {
          return save(current => {
            current.continuation!.phase = 'received'
            delete current.continuation!.error
            if (!['waiting', 'paused'].includes(current.state)) current.events.push({ id: `continuation-business:${operationId}`, text: 'Continue the same Task using the received material and its accepted next step, under the current Task control and permissions.', kind: 'input', delivery: 'accepted', acceptance: 'unassessed' })
          })
        }
        const op = execution.continuation!
        const request = maintenanceEvent(op, 'receive', op.readRequestId ?? op.kickoffId, successorMessage(op, execution.policy.instructions))
        const observed = await host.observe(execution, request)
        if (observed === 'consumed') return save(current => { current.continuation!.kickoffDelivery = observed; current.continuation!.error = { code: 'continuation-read-unconfirmed', message: 'The successor consumed material without a committed readable receipt; explicitly retry this operation to request acknowledgement again' } })
        const delivered = await host.deliver(execution, request)
        return save(current => { current.continuation!.kickoffDelivery = delivered })
      }
      // Collection runs outside every executor maintenance lock. Its only proof
      // is a fresh formal observation after exact-owner Session persistence.
      if (execution.continuation!.phase !== 'taken') {
        if (!host.observation || !host.flushSession) throw new WorkExecutionError('host-capability-unavailable', 'Formal collection observation and exact-owner flush are required')
        for (const step of execution.continuation!.collections ?? []) await host.flushSession(step.session)
        const facts = await host.observation(execution)
        const jobs = facts.sessions.flatMap(row => row.jobs)
        for (const step of execution.continuation!.collections ?? []) {
          const delivered = step.jobs.every(expected => jobs.some(job => sameSession(job.owner, step.session) && job.id === expected.id && job.registryEpoch === expected.registryEpoch && job.instanceId === expected.instanceId && job.delivery === 'delivered'))
          if (delivered && step.status !== 'collected') execution = await save(current => { current.continuation!.collections!.find(item => item.requestId === step.requestId)!.status = 'collected'; delete current.continuation!.error })
        }
        for (const step of execution.continuation!.settlements ?? []) {
          await host.flushSession(step.parent)
          const delivery = await host.observe({ ...execution, session: step.parent }, { id: step.messageId, text: 'Native child settlement', kind: 'result', delivery: step.delivery, acceptance: 'unassessed' })
          execution = await save(current => {
            current.continuation!.settlements!.find(item => item.messageId === step.messageId)!.delivery = delivery
            if (delivery === 'consumed') for (const event of current.events) if (event.id === step.messageId) event.delivery = 'consumed'
          })
        }
        if (facts.settlement !== 'settled') {
          const notices = facts.sessions.flatMap(parent => parent.children.flatMap(child => child.settlement ? [{ parent: parent.session, child: child.session, ...child.settlement }] : []))
          if (notices.length) {
            execution = await save(current => {
              const op = current.continuation!
              for (const notice of notices) if (!op.settlements?.some(step => step.messageId === notice.message.id)) (op.settlements ??= []).push({ parent: notice.parent, child: notice.child, endSeq: notice.endSeq, messageId: notice.message.id, delivery: 'accepted' })
            })
            for (const notice of notices) {
              const delivery = await host.deliver({ ...execution, session: notice.parent }, { id: notice.message.id, text: 'Native child settlement', kind: 'result', delivery: 'accepted', acceptance: 'unassessed', nativeMessage: notice.message })
              execution = await save(current => { current.continuation!.settlements!.find(step => step.messageId === notice.message.id)!.delivery = delivery })
            }
            return execution
          }
          const pending = facts.blockers.filter(blocker => blocker.code === 'job-unsettled')
          if (!pending.length || facts.blockers.length !== pending.length) throw new WorkExecutionError('continuation-waiting-executions', `Lifecycle prerequisites remain unresolved: ${facts.blockers.map(blocker => `${blocker.code}:${blocker.session.sessionId}:${blocker.jobId ?? ''}`).join(', ')}`)
          for (const blocker of pending) {
            const job = jobs.find(job => sameSession(job.owner, blocker.session) && job.id === blocker.jobId)
            if (!job || job.availability !== 'live' || !['completed', 'failed', 'killed'].includes(job.status) || job.delivery !== 'pending') throw new WorkExecutionError('continuation-collection-unavailable', 'Only reachable terminal jobs with pending formal output can be collected')
          }
          execution = await save(current => {
            const op = current.continuation!
            for (const blocker of pending) {
              const job = jobs.find(job => sameSession(job.owner, blocker.session) && job.id === blocker.jobId)!
              let step = op.collections?.find(step => step.status === 'requested' && sameSession(step.session, job.owner))
              if (!step) { step = { session: job.owner, jobs: [], requestId: `collection:${op.operationId}:${randomUUID()}`, delivery: 'accepted', status: 'requested' }; (op.collections ??= []).push(step) }
              if (!step.jobs.some(item => item.id === job.id && item.registryEpoch === job.registryEpoch && item.instanceId === job.instanceId)) step.jobs.push({ id: job.id, ...(job.registryEpoch ? { registryEpoch: job.registryEpoch } : {}), ...(job.instanceId ? { instanceId: job.instanceId } : {}) })
            }
            // Any collection after saved material invalidates that snapshot.
            if (op.material) {
              delete op.material
              op.phase = 'reserved'
              op.materialRequestId = `material-request:${op.operationId}:${randomUUID()}`
              op.requestDelivery = 'accepted'
              delete op.materialFactsKey
            }
          })
          for (const step of execution.continuation!.collections!.filter(step => step.status === 'requested')) {
            const owner = { ...execution, session: step.session }
            const event = maintenanceEvent(execution.continuation!, 'collect', step.requestId, collectionRequest(execution.continuation!, step))
            const observed = await host.observe(owner, event)
            if (observed === 'consumed') {
              execution = await save(current => { current.continuation!.collections!.find(item => item.requestId === step.requestId)!.delivery = observed })
              throw new WorkExecutionError('continuation-collection-unconfirmed', `Owner ${step.session.sessionId} consumed the collection request without formal output delivery; inspect the tool result and explicitly retry this same operation after repairing the concrete host failure`)
            }
            const delivery = await host.deliver(owner, event)
            execution = await save(current => { current.continuation!.collections!.find(item => item.requestId === step.requestId)!.delivery = delivery })
          }
          return execution
        }
        const key = continuationFactsKey(facts)
        if (execution.continuation!.material && execution.continuation!.material.settlementKey !== key) execution = await save(current => {
          const op = current.continuation!
          delete op.material
          op.phase = 'material-requested'
          op.materialRequestId = `material-request:${op.operationId}:${randomUUID()}`
          op.requestDelivery = 'accepted'
        })
        execution = await save(current => { current.continuation!.materialFactsKey = key })
      }
      if (execution.continuation!.phase !== 'taken') await host.maintain(execution, async () => {
        execution = (await this.load()).executions.find(item => item.id === execution.id)!
        if (execution.control?.status === 'accepted' && execution.control.action !== 'resume') return
        let operation = execution.continuation!
        const actual = await host.profile!(execution)
        if (operation.automatic) {
          if (!host.measure) throw new WorkExecutionError('continuation-meter-unavailable', 'Automatic handoff requires current public token measurement')
          const observed = await host.measure(execution)
          if (execution.continuationObservation && observed.routeKey !== execution.continuationObservation.routeKey) throw new WorkExecutionError('continuation-route-changed', 'Source route metadata changed during automatic handoff')
          if (operation.phase === 'reserved' && observed.totalTokens + observed.outputReserve + execution.continuationPolicy!.reserveTokens > observed.capacity) throw new WorkExecutionError('continuation-reserve-exhausted', 'The source passed the soft target before reaching idle and lacks the configured handoff reserve')
        }
        if (operation.phase === 'reserved') {
          execution = await save(current => {
            current.continuation!.profile = actual
            current.continuation!.phase = 'material-requested'
            delete current.continuation!.error
          })
          operation = execution.continuation!
        } else if (JSON.stringify(actual) !== JSON.stringify(operation.profile)) throw new WorkExecutionError('continuation-profile-changed', 'Source model, preset, permissions or workspace changed during handoff')
        if (operation.phase === 'material-requested') {
          const request = maintenanceEvent(operation, 'material', operation.materialRequestId, materialRequest(operation))
          const observed = await host.observe(execution, request)
          if (observed === 'consumed') {
            execution = await save(current => { current.continuation!.requestDelivery = observed; current.continuation!.error = { code: 'continuation-material-missing', message: 'The source consumed the material request but did not save material; no successor will be created' } })
          } else {
            const delivered = await host.deliver(execution, request, true)
            execution = await save(current => { current.continuation!.requestDelivery = delivered })
          }
          return
        }
        const fresh = await host.observation!(execution)
        if (continuationFactsKey(fresh) !== operation.materialFactsKey) throw new WorkExecutionError('continuation-material-stale', 'Execution results changed after material preparation; the plugin will collect and refresh material before takeover')
        if (!operation.material || operation.material.executionId !== execution.id || !sameTask(operation.material.ref, execution.ref) || operation.material.specificationVersion !== operation.specification.version || !sameSession(operation.material.source, operation.source) || operation.material.epoch !== operation.sourceEpoch || operation.material.settlementKey !== operation.materialFactsKey) throw new WorkExecutionError('continuation-material-missing', 'Saved source material is required before creating a successor')
        // Validate message preparation before any successor creation or authority transfer.
        kickoffText = successorMessage(operation, execution.policy.instructions)
        if (operation.phase === 'material-saved' || operation.phase === 'successor-created') {
          const profile = operation.profile!
          const successor = { ...execution, session: operation.successor, sessionMode: 'create' as const, epoch: operation.sourceEpoch + 1,
            agentPreset: profile.agentPreset, model: { provider: profile.provider, model: profile.model, ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}) }, permissionPreset: profile.permissionPreset, actual: profile }
          const created = await host.ensure(successor, async () => {
            const current = (await this.load()).executions.find(item => item.id === execution.id)!
            return sameSession(current.session, successor.session) && current.epoch === successor.epoch
          })
          await this.refreshSessionTitles(successor.session, successor)
          if (JSON.stringify(created) !== JSON.stringify(profile)) throw new WorkExecutionError('continuation-profile-mismatch', 'Successor did not inherit the saved source execution context')
          execution = await save(current => { current.continuation!.phase = 'successor-created' })
          // Read source consumption before transferring outstanding events to the successor.
          for (const event of execution.events) {
            if (!pendingEvent(event)) continue
            const delivery = await host.observe(execution, event)
            execution = await save(current => { current.events.find(item => item.id === event.id)!.delivery = delivery === 'consumed' ? 'consumed' : 'accepted' })
          }
          if (!host.disarmSource) throw new WorkExecutionError('host-capability-unavailable', 'Exact source Goal lifecycle retirement is unavailable')
          const goalActivation = await host.disarmSource(execution)
          execution = await this.sourceTransaction(async state => {
            const current = state.executions.find(item => item.id === execution.id)!
            const op = current.continuation!
            if (op.operationId !== operationId || current.epoch !== op.sourceEpoch || !sameSession(current.session, op.source)) throw new WorkExecutionError('stale-execution-authority', 'Source lost authority before takeover')
            const task = taskAt(state, current.ref)!
            if (task.specification.version !== op.specification.version || task.goal !== op.goal || op.material?.specificationVersion !== op.specification.version) throw new WorkExecutionError('continuation-specification-changed', 'Task specification changed during handoff; source material must be refreshed before takeover')
            if (current.control?.status === 'accepted' && current.control.action !== 'resume') return current
            if (state.executions.some(item => item.id !== current.id && (sameSession(item.session, op.successor) || item.retired?.some(old => sameSession(old.session, op.successor))))) throw new WorkExecutionError('session-in-use', 'Reserved successor belongs to another execution')
            ;(current.retired ??= []).push({ session: op.source, epoch: op.sourceEpoch, operationId })
            current.session = op.successor
            current.sessionMode = 'create'
            current.epoch = op.sourceEpoch + 1
            current.actual = profile
            current.agentPreset = profile.agentPreset
            current.model = { provider: profile.provider, model: profile.model, ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {}) }
            current.permissionPreset = profile.permissionPreset
            if (!['waiting', 'paused'].includes(current.state)) current.state = 'ready'
            op.goalActivation = goalActivation
            op.phase = 'taken'
            delete op.error
            delete current.continuationObservation
            delete current.continuationBlocked
            return current
          })
        }
        if (execution.continuation!.phase === 'taken' && execution.continuation!.inputSeal === undefined) await sealInput()
      })
      if (execution.continuation!.phase === 'taken') {
        if (execution.continuation!.inputSeal === undefined) {
          const source = { ...execution, session: execution.continuation!.source, epoch: execution.continuation!.sourceEpoch }
          await host.maintain(source, sealInput)
        }
        const op = execution.continuation!
        const event = maintenanceEvent(op, 'receive', op.kickoffId, kickoffText ?? successorMessage(op, execution.policy.instructions))
        // Source authority was retired in the same transaction as the epoch change.
        const delivered = await host.deliver(execution, event)
        execution = await save(current => { current.continuation!.kickoffDelivery = delivered; current.continuation!.phase = 'delivered'; delete current.continuation!.error })
      }
    } catch (error) {
      execution = await save(current => {
        const detail = { code: error instanceof WorkExecutionError ? error.code : 'continuation-outcome-unknown', message: error instanceof Error ? error.message : 'Continuation outcome unknown; recovery retains the reserved identities' }
        current.continuation!.error = detail
        if (current.continuation!.automatic && /^continuation-(metadata|meter|route|reserve|profile|policy)/.test(detail.code)) current.continuationBlocked = detail
      })
    }
    return execution
  }
  private async ensureExecution(id: string, commandId: string): Promise<WorkResult> {
    const lease = join(this.directory, `${id}.execution`)
    return withFileLock<WorkResult>(lease, async () => {
      const save = async (change: (execution: import('./work-types.ts').WorkExecution) => void) => this.dao.transaction(async state => {
        const execution = state.executions.find(item => item.id === id)!
        change(execution)
        return execution
      })
      const state = await this.load()
      let execution = state.executions.find(item => item.id === id)!
      if (execution.control?.action === 'end') {
        if (execution.control.status === 'applied') return { status: 'completed', execution }
        const control = execution.control
        try {
          if (!this.host.execution?.end) throw new WorkExecutionError('queue-end-capability-unavailable', '宿主不支持安全结束；请在能力恢复后重试结束')
          await this.host.execution.end(execution)
          execution = await this.dao.transaction(async state => {
            const current = state.executions.find(item => item.id === id)!
            if (current.control?.commandId !== control.commandId || current.epoch !== execution.epoch) return current
            const owner = continuousOwner(state, current.ref)!
            current.state = 'paused'; current.control.status = 'applied'; delete current.error
            owner.item.end = { commandId: control.commandId, status: 'applied' }
            owner.rule.version++
            owner.item.state = 'completed'; owner.item.reason = `${control.reason || '明确结束本项队列处理'}；队列已结束，业务验收未确认，历史结果保留`
            delete owner.item.resumeRequested; delete owner.item.explicitResumeRequested; delete owner.item.retryAt; delete owner.item.recoveryBlocked
            continuousSetSlot(owner.rule, current.ref, false)
            this.dao.appendHistory(current, { state: 'paused', commandId: control.commandId })
            return current
          })
        } catch (error) {
          execution = await this.dao.transaction(async state => {
            const current = state.executions.find(item => item.id === id)!
            current.error = { code: error instanceof WorkExecutionError ? error.code : 'queue-end-unknown', message: error instanceof Error ? error.message : '停止结果未知，请重试结束' }
            continuousOwner(state, current.ref)!.item.reason = `结束尚未完成：${current.error.message}；可重试结束`
            return current
          })
        }
        return { status: 'completed', execution }
      }
      if (execution.events.some(event => pendingEvent(event) && lifecycleOwned(event.nativeMessage))) execution = await save(discardLifecycleEvents)
      if (isTaskCompleted(taskAt(state, execution.ref))) return { status: 'completed', execution }
      const owner = continuousOwner(state, execution.ref)
      const stopping = owner && continuousHasSlot(owner.rule, execution.ref) && execution.control?.status === 'accepted' && execution.control.action !== 'resume'
      if (owner && !continuousMayAdvance(state, execution) && !stopping && !continuationInFlight(execution)) return { status: 'completed', execution }
      try {
        if (continuationInFlight(execution) && execution.control?.status !== 'accepted') {
          execution = await this.advanceContinuation(execution)
          if (continuationInFlight(execution) || ['waiting', 'paused'].includes(execution.state) || !continuousMayAdvance(state, execution)) return { status: 'completed', execution }
        }
        if (['accepted', 'creating', 'failed'].includes(execution.state)) execution = await save(item => { item.state = 'creating'; delete item.error; this.dao.appendHistory(item, { state: 'creating', commandId }) })
        const actual = await this.host.execution!.ensure(execution, async () => {
          const snapshot = await this.load()
          const current = snapshot.executions.find(item => item.id === id)
          return !!current && !isTaskCompleted(taskAt(snapshot, current.ref)) && continuousMayAdvance(snapshot, current) && current.owner === execution.owner && current.epoch === execution.epoch
            && !['paused', 'waiting', 'failed', 'creating', 'accepted'].includes(current.state)
            && !(current.control?.status === 'accepted' && current.control.action !== 'resume')
        })
        await this.refreshSessionTitles(execution.session)
        execution = await save(item => {
          item.actual = actual
          item.permissionPreset = actual.permissionPreset
          item.model = { provider: actual.provider, model: actual.model, ...(actual.reasoningEffort ? { reasoningEffort: actual.reasoningEffort } : {}) }
          if (item.state === 'creating') { item.state = 'ready'; this.dao.appendHistory(item, { state: 'ready', commandId }) }
        })
        const control = execution.control
        if (control?.status === 'accepted') {
          await this.host.execution!.settle(execution)
          execution = await save(item => {
            if (item.control?.commandId !== control.commandId) return
            item.state = control.action === 'pause' ? 'paused' : control.action === 'wait' ? 'waiting' : 'ready'
            item.control!.status = 'applied'
            this.dao.appendHistory(item, { state: item.state, commandId })
          })
          if (control.action === 'resume' && execution.control?.commandId === control.commandId) await this.host.execution!.wake(execution)
        }
        for (const event of execution.events) {
          if (!pendingEvent(event)) continue
          const delivery = ['waiting', 'paused'].includes(execution.state)
            ? await this.host.execution!.observe(execution, event)
            : await this.host.execution!.deliver(execution, event)
          execution = await save(item => { item.events.find(value => value.id === event.id)!.delivery = delivery })
        }
      } catch (error) {
        execution = await save(item => { item.state = 'failed'; item.error = { code: error instanceof WorkExecutionError ? error.code : 'host-create-unknown',
          message: error instanceof WorkExecutionError ? error.message : 'Host outcome is unknown; retry recovers the reserved Session and message identities' }; this.dao.appendHistory(item, { state: 'failed', commandId }) })
      }
      return { status: 'completed', execution }
    }, { waitMs: 0 }).catch(async error => {
      // The published atomic-write API exposes contention as this named Error, not an errno.
      if (!(error instanceof Error) || error.message !== `atomic-write: timed out waiting for the writer lock at ${lease}.lock`) throw error
      const execution = (await this.load()).executions.find(item => item.id === id)!
      return { status: 'completed' as const, execution }
    })
  }
  private async candidates(project: Project): Promise<SessionCandidate[]> {
    const resources = (await this.host.resources()).filter(item => project.resources.some(ref => sameResource(ref, item.ref)))
    const candidates = (await Promise.all(resources.map(resource => this.host.sessions(resource)))).flat()
    return candidates.filter(item => resources.some(resource => sameResource(resource.ref, item.resource)
      && item.ref.runtimeId === resource.ref.runtimeId))
  }
  private async authorize(state: WorkSnapshot, command: WorkCommand): Promise<WorkResult | undefined> {
    if ('ref' in command && !taskAt(state, command.ref)) return failed('unknown-task', 'Task does not belong to this project')
    if ('child' in command && command.child.projectId !== command.ref.projectId) return failed('cross-project-reference', 'Parent and child must belong to the same project')
    if ('executionId' in command) {
      const execution = state.executions.find(item => item.id === command.executionId && item.ref.taskId === command.ref.taskId && item.ref.projectId === command.ref.projectId)
      if (!execution || execution.owner !== command.owner || execution.epoch !== command.epoch) return failed('stale-execution-authority', 'Execution identity, owner or epoch is stale')
    }
    if ('resource' in command && command.resource && !(await this.host.resources()).some(item => sameResource(item.ref, command.resource!))) {
      return failed('unavailable-resource', 'Resource is not allowed by this host')
    }
    if (command.type === 'task.associate-session') {
      const project = state.projects.find(item => item.id === command.ref.projectId)
      if (!project || !(await this.candidates(project)).some(item => sameSession(item.ref, command.session))) {
        return failed('incompatible-session', 'Session is not a compatible member of this project resource')
      }
    }
  }
  private newTask(state: WorkSnapshot, command: Extract<WorkCommand, { type: 'task.create' | 'task.create-child' }>, project: Project): WorkTask {
    const task: WorkTask = { id: randomUUID(), projectId: project.id, title: command.title, goal: command.goal, version: 1,
      specification: { version: 1, text: command.specification, acceptance: command.acceptance }, agentId: project.defaultAgentId,
      specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [{ commandId: command.commandId, type: command.type, version: 1 }] }
    state.tasks.push(task)
    return task
  }
  private changed(task: WorkTask, command: WorkCommand): void {
    task.version++
    task.activity.push({ commandId: command.commandId, type: command.type, version: task.version })
  }
  private async apply(state: WorkSnapshot, command: Exclude<WorkCommand, { type: 'github.login' | 'github.logout' }>, admissionChoices?: import('./work-types.ts').HostExecutionChoices, candidate?: SourceCandidate, reporter?: import('@deepseek-ai/dsh-tools').ToolExecutionToken): Promise<WorkResult> {
    if (command.type === 'source.connect') {
      const target = candidate?.githubProject ?? command.githubProject, repository = candidate?.repository
      if (!target && !repository) return failed('github-invalid-scope', 'Source identification did not return a scope')
      const existing = state.sources.find(source => candidate?.nodeId && source.nodeId === candidate.nodeId || (target ? source.githubProject?.type === target.type && source.githubProject.number === target.number && source.githubProject.owner.toLowerCase() === target.owner.toLowerCase() : source.repository?.owner.toLowerCase() === repository!.owner.toLowerCase() && source.repository.repository.toLowerCase() === repository!.repository.toLowerCase()))
      const remember = (source: import('./work-sources/types.ts').WorkSource) => {
        if (!candidate) return
        const scopeChanged = candidate.repository ? source.repository?.owner.toLowerCase() !== candidate.repository.owner.toLowerCase() || source.repository.repository.toLowerCase() !== candidate.repository.repository.toLowerCase() : candidate.githubProject ? source.githubProject?.owner.toLowerCase() !== candidate.githubProject.owner.toLowerCase() || source.githubProject.type !== candidate.githubProject.type || source.githubProject.number !== candidate.githubProject.number : false
        if (scopeChanged) {
          source.repository = candidate.repository; source.githubProject = candidate.githubProject; source.version++
          if (source.discovery) { delete source.discovery.checkpoint; delete source.discovery.inFlight; source.discovery.state = 'idle'; source.discovery.nextAttemptAt = new Date().toISOString() }
        }
        source.title = candidate.title; source.nodeId = candidate.nodeId; source.identity = candidate.identity
        source.entryUrls = [...new Set([...(source.entryUrls ?? []), candidate.entryUrl])]
      }
      if (existing) {
        remember(existing)
        const project = state.projects.find(project => project.id === existing.projectId)!
        if (command.resource && !project.resources.some(ref => sameResource(ref, command.resource!))) {
          const attached = await this.apply(state, { type: 'project.attach-resource', commandId: command.commandId, projectId: project.id, expectedVersion: project.version, resource: command.resource })
          if (attached.status !== 'completed') return attached
        }
        return { status: 'completed', project, source: existing }
      }
      const created = await this.apply(state, { type: 'project.create', commandId: command.commandId, name: candidate?.title ?? `${target!.owner} / Project #${target!.number}`, ...(command.resource ? { resource: command.resource } : {}) })
      if (created.status !== 'completed' || !created.project) return created
      const configured = applySourceCommand(state, target ? { type: 'source.configure-project', commandId: command.commandId, projectId: created.project.id, githubProject: target } : { type: 'source.configure', commandId: command.commandId, projectId: created.project.id, repository: repository! })
      if (configured.status === 'completed' && configured.source) remember(configured.source)
      return configured.status === 'completed' ? { ...configured, project: created.project } : configured
    }
    if (command.type === 'continuous.end') {
      const rule = state.continuousRules?.find(rule => rule.projectId === command.projectId && rule.sourceId === command.sourceId)
      if (!rule) return failed('continuous-unconfigured', '队列尚未配置')
      const item = rule.items.find(item => item.nodeId === command.nodeId)
      if (!item) return failed('continuous-item-missing', '队列中没有本项工作')
      if (item.state === 'completed') return { status: 'completed', continuousRule: rule }
      if (rule.version !== command.expectedVersion) return conflict(rule.version)
      const execution = state.executions.find(execution => execution.id === item.executionId && sameTask(execution.ref, item.ref))
      if (execution) {
        const result = await this.apply(state, { type: 'task.control', commandId: command.commandId, ref: execution.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch, action: 'end', text: '用户明确结束本项队列处理' })
        return result.status === 'completed' ? { ...result, continuousRule: rule } : result
      }
      if (item.ref || item.executionId) return failed('continuous-execution-missing', '关联执行缺失，无法核实安全结束')
      item.end = { commandId: command.commandId, status: 'applied' }; item.state = 'completed'; item.reason = '用户明确结束本项队列处理；业务验收未确认'
      delete item.resumeRequested; delete item.explicitResumeRequested; delete item.retryAt; delete item.recoveryBlocked
      rule.version++
      return { status: 'completed', continuousRule: rule }
    }
    if (command.type === 'continuous.refresh') return failed('unsupported-command', 'Refresh requires source observation')
    if (command.type === 'continuous.instruct' || command.type === 'continuous.block') {
      const rule = state.continuousRules?.find(rule => rule.projectId === command.projectId && rule.sourceId === command.sourceId)
      if (!rule) return failed('continuous-unconfigured', 'Configure authorized scope and resources first')
      if (rule.version !== command.expectedVersion) return conflict(rule.version)
      if (command.type === 'continuous.instruct') {
        if (!rule.planning) rule.planning = { instruction: command.text, supplements: [], scopeVersion: 1, draftVersion: 1, blocks: [], plans: [] }
        else { rule.planning.supplements.push(command.text); rule.planning.draftVersion++; delete rule.planning.error }
        rule.enabled = false
      } else {
        if (!rule.planning) return failed('planning-instruction-required', 'Save an instruction before modifying Block')
        const source = state.sources.find(source => source.id === rule.sourceId)!
        if (!source.observations.some(item => item.issue.nodeId === command.nodeId) && !rule.planning.blocks.includes(command.nodeId)) return failed('planning-unknown-issue', `Issue ${command.nodeId} is not an observed stable identity`)
        rule.planning.blocks = rule.planning.blocks.filter(nodeId => nodeId !== command.nodeId)
        if (command.blocked) rule.planning.blocks.push(command.nodeId)
        else {
          const item = rule.items.find(item => item.nodeId === command.nodeId && !item.ref && item.reason === 'Issue is excluded by the persistent Block list')
          if (item) { item.state = 'queued'; item.attempts = 0; delete item.reason }
        }
        rule.planning.draftVersion++
      }
      rule.version++
      return { status: 'completed', continuousRule: rule }
    }
    if (command.type === 'continuous.configure' || command.type === 'continuous.set-enabled') return this.configureContinuous(state, command, admissionChoices)
    if (command.type === 'source.link' && isTaskCompleted(taskAt(state, command.ref))) return failed('task-completed', 'Accepted Task external binding is immutable')
    if (command.type === 'source.configure-project' || command.type === 'source.configure' || command.type === 'source.set-enabled' || command.type === 'source.import' || command.type === 'source.link') return applySourceCommand(state, command)
    if (command.type === 'project.create') {
      if (command.resource && state.projects.some(item => item.resources.some(ref => sameResource(ref, command.resource!)))) {
        return { status: 'conflict', error: { code: 'resource-in-use', message: 'Resource already belongs to another project' } }
      }
      const project: Project = { id: randomUUID(), name: command.name, version: 1, defaultAgentId: randomUUID(), resources: command.resource ? [command.resource] : [] }
      state.projects.push(project)
      state.agents.push({ id: project.defaultAgentId, projectId: project.id, role: 'coordinator',
        policy: { version: 1, modelCandidates: [], instructions: 'Coordinate accepted work and its acceptance criteria.', capabilities: ['coordination'] } })
      return { status: 'completed', project }
    }
    const projectId = 'projectId' in command ? command.projectId : command.ref.projectId
    const project = state.projects.find(item => item.id === projectId)
    if (!project) return failed('unknown-project', 'Project does not exist')
    if (command.type === 'project.configure-continuation') {
      if (project.version !== command.expectedVersion) return conflict(project.version)
      if (command.policy.version !== (project.continuationPolicy?.version ?? 0) + 1) return failed('continuation-policy-version', 'Policy version must advance by one')
      project.continuationPolicy = structuredClone(command.policy)
      project.version++
      return { status: 'completed', project }
    }
    if (command.type === 'project.attach-resource') {
      if (project.version !== command.expectedVersion) return conflict(project.version)
      if (state.projects.some(item => item.id !== project.id && item.resources.some(ref => sameResource(ref, command.resource)))) {
        return { status: 'conflict', error: { code: 'resource-in-use', message: 'Resource already belongs to another project' } }
      }
      if (!project.resources.some(ref => sameResource(ref, command.resource))) { project.resources.push(command.resource); project.version++ }
      return { status: 'completed', project }
    }
    if (command.type === 'task.create') return { status: 'completed', task: this.newTask(state, command, project) }
    if (!('ref' in command)) return failed('unsupported-command', 'Command is not implemented')
    const task = taskAt(state, command.ref)
    if (!task) return failed('unknown-task', 'Task does not belong to this project')
    if (isTaskCompleted(task) && command.type !== 'task.reconcile' && command.type !== 'task.completion-sync' && command.type !== 'task.associate-session') return failed(continuousOwner(state, command.ref) ? 'continuous-completed' : 'task-completed', 'Accepted Task is terminal; additional work requires a new Task')
    const active = state.executions.find(item => item.ref.taskId === task.id && item.ref.projectId === task.projectId)
    if (active && continuousCompleted(state, active) && ['task.update-spec', 'task.replace-breakdown', 'task.create-child', 'task.link-child', 'task.report', 'task.organize'].includes(command.type)) return failed('continuous-completed', 'Completed continuous work is immutable; create a separately authorized Issue for additional work')
    if (active && continuationInFlight(active) && ['task.update-spec', 'task.replace-breakdown', 'task.create-child', 'task.link-child', 'task.report', 'task.organize'].includes(command.type)) return failed('continuation-in-progress', 'Task specifications, structure and acceptance reports are frozen until the reserved handoff completes')
    if ('executionId' in command) {
      const execution = state.executions.find(item => item.id === command.executionId && item.ref.taskId === task.id)
      if (!execution || execution.owner !== command.owner || execution.epoch !== command.epoch) return failed('stale-execution-authority', 'Execution identity, owner or epoch is stale')
      if ((command.type === 'task.reconcile' || command.type === 'task.completion-sync') && task.completion && task.completion.closeout.status !== 'settled') {
        task.completion.closeout.status = 'pending'; task.completion.closeout.attempts = 0; delete task.completion.closeout.retryAt
        const managed = continuousOwner(state, execution.ref)
        if (managed) { managed.item.attempts = 0; delete managed.item.retryAt; delete managed.item.recoveryBlocked }
      }
      if (command.type === 'task.completion-sync') return task.completion ? { status: 'completed', task, execution } : failed('completion-required', 'Only an accepted Task can synchronize completion')
      const managed = continuousOwner(state, execution.ref)
      if (command.type === 'task.control' && command.action === 'end' && managed?.item.state === 'completed') return { status: 'completed', execution }
      if (command.type === 'task.control' && command.action === 'end' && !managed) return failed('continuous-required', '只有持续队列中的工作可以结束队列处理')
      if (execution.control?.action === 'end') {
        if (command.type === 'task.control' && command.action === 'end') return { status: 'completed', execution }
        if (command.type !== 'task.reconcile') return failed('continuous-ended', '本项队列已明确结束，不能恢复业务处理；历史记录仍可查看')
      }
      if (command.type === 'task.organize') return applyTaskOrganization(state, execution, command.organization, command.commandId, randomUUID)
      if (managed && command.type === 'task.reconcile' && execution.control?.action !== 'end') { managed.item.resumeRequested = true; managed.item.explicitResumeRequested = true; managed.item.attempts = 0; delete managed.item.retryAt; delete managed.item.recoveryBlocked }
      if (managed && continuousCompleted(state, execution) && (command.type === 'task.input' || command.type === 'task.continue' || (command.type === 'task.control' && command.action === 'resume'))) return failed('continuous-completed', 'Completed continuous work cannot restart')
      if (command.type === 'task.report') {
        let reminders: string[] | undefined
        if (command.report.stage === 'done') {
          // Read only: work_report may itself be executing on this Agent. Never
          // enter maintenance/whenIdle before accepting its business conclusion.
          let facts: ExecutionObservation | undefined
          try { facts = await this.host.execution?.observation?.(execution, task.sessions, reporter) }
          catch { return failed('completion-results-unsettled', '完成前须收取并核验必要执行结果：execution-observation-unavailable') }
          if (facts?.settlement !== 'settled') return failed('completion-results-unsettled', `完成前须收取并核验必要执行结果：${facts?.blockers.map(item => `${item.code}:${item.session.sessionId}${item.jobId ? `:${item.jobId}` : ''}`).join(', ') || facts?.settlement || 'execution-observation-unavailable'}`)
          // Unreachable jobs cannot be collected; they return as non-blocking
          // reminders. reminders is an optional public capability, so an older
          // or third-party adapter may omit it instead of supplying an array.
          const unreachable = facts.reminders ?? []
          if (unreachable.length) reminders = [...unreachable]
        }
        const result = applyTaskReport(state, execution, command.report, command.commandId)
        if (result.status === 'completed' && managed && command.report.stage === 'done') managed.item.state = 'completed'
        return result.status === 'completed' && reminders ? { ...result, reminders } : result
      }
      if (command.type === 'task.configure-continuation') {
        if (command.policy.version !== (execution.continuationPolicy?.version ?? 0) + 1) return failed('continuation-policy-version', 'Policy version must advance by one')
        execution.continuationPolicy = structuredClone(command.policy)
        delete execution.continuationObservation
        delete execution.continuationBlocked
      }
      if (command.type === 'task.continue') {
        if (['accepted', 'creating', 'failed'].includes(execution.state) || (execution.control?.status === 'accepted' && execution.control.action !== 'resume')) return failed('continuation-not-ready', 'Resume or recover the current execution before requesting continuation')
        if (!this.host.execution?.maintain || !this.host.execution.profile || !this.host.execution.sealInput || !this.host.execution.received) return failed('host-capability-unavailable', 'Safe continuation maintenance is unavailable')
        reserveContinuation(execution, task, command.commandId, false)
        execution.continuation!.automatic = false
        delete execution.continuationBlocked
      }
      if (command.type === 'task.continuation-material') execution.continuationMaterial = { ...command.content,
        commandId: command.commandId, ref: execution.ref, executionId: execution.id, source: execution.session, epoch: execution.epoch,
        taskVersion: task.version, specificationVersion: task.specification.version, ...(execution.continuation?.materialFactsKey ? { settlementKey: execution.continuation.materialFactsKey } : {}) }
      if (command.type === 'task.continuation-material' && execution.continuation?.phase === 'material-requested') {
        execution.continuation.material = structuredClone(execution.continuationMaterial!)
        execution.continuation.phase = 'material-saved'
        delete execution.continuation.error
      }
      if (execution.runtimeFailure && ((command.type === 'task.input' && command.kind === 'input') || command.type === 'task.continue' || (command.type === 'task.control' && command.action === 'resume'))) execution.runtimeFailure.acknowledged = true
      if (managed && ((command.type === 'task.input' && (command.kind === 'input' || !(execution.error || execution.continuation?.error || execution.runtimeFailure || managed.item.recoveryBlocked))) || (command.type === 'task.control' && command.action === 'resume'))) {
        const ownsSlot = continuousHasSlot(managed.rule, execution.ref)
        const explicitlyPaused = execution.state === 'paused' || (execution.control?.action === 'pause' && execution.control.status === 'accepted')
        if (command.type === 'task.control') {
          managed.item.resumeRequested = !ownsSlot; managed.item.explicitResumeRequested = !ownsSlot
          if (ownsSlot) managed.item.state = 'active'
          execution.events.push({ id: `continuous-resume:${command.commandId}`, text: command.text, kind: 'input', delivery: 'accepted', acceptance: 'unassessed' })
        } else if (!explicitlyPaused && (!ownsSlot || ['waiting', 'failed'].includes(execution.state) || managed.item.state !== 'active')) managed.item.resumeRequested = true
        managed.item.attempts = 0; delete managed.item.retryAt; delete managed.item.recoveryBlocked
      }
      if (command.type === 'task.input') execution.events.push({ id: randomUUID(), text: command.text, kind: command.kind, delivery: 'accepted', acceptance: 'unassessed' })
      if (command.type === 'task.control') {
        if (command.action === 'progress') execution.progress = command.text
        else {
          execution.control = { commandId: command.commandId, action: command.action, status: 'accepted', reason: command.text }
          if (managed && command.action === 'end') { managed.item.end = { commandId: command.commandId, status: 'accepted' }; managed.item.reason = '结束中；等待本项执行安全停止'; managed.rule.version++ }
          if (managed && command.action !== 'resume') { delete managed.item.resumeRequested; delete managed.item.explicitResumeRequested }
        }
      }
      return { status: 'completed', execution }
    }
    if (command.type === 'task.start') {
      const previous = state.executions.find(item => item.ref.taskId === task.id)
      if (previous) {
        if (continuousCompleted(state, previous)) return failed('continuous-completed', 'Completed continuous work cannot restart')
        if (previous.agentId !== command.agentId || !sameResource(previous.resource, command.resource)
          || (command.session && !sameSession(previous.session, command.session)) || previous.agentPreset !== command.agentPreset
          || previous.permissionPreset !== command.permissionPreset || JSON.stringify(previous.model) !== JSON.stringify(command.model)) {
          return failed('execution-conflict', 'Task already has a different execution; use its existing execution identity')
        }
        return { status: 'completed', execution: previous }
      }
      if (task.version !== command.expectedVersion) return conflict(task.version)
      if (state.legacyMappings.some(item => item.ref.taskId === task.id)) return failed('legacy-authority-retained', 'Legacy mapped work requires an explicit safe migration before v3 execution')
      const agent = state.agents.find(item => item.id === command.agentId && item.projectId === project.id)
      if (!agent || !agent.policy.capabilities.includes('coordination')) return failed('ineligible-agent', 'Project Agent has no coordination capability')
      const choices = admissionChoices!
      if (!choices.agentPresets.includes(command.agentPreset)) return failed('disallowed-agent-preset', 'Only inherited preset choices are authorized for a new execution')
      if (!choices.permissionPresets.includes(command.permissionPreset)) return failed('disallowed-permission-preset', 'Only inherited permission choices are authorized for a new execution')
      if (agent.policy.modelCandidates.length && !agent.policy.modelCandidates.includes(`${command.model.provider}/${command.model.model}`)) return failed('disallowed-model', 'Model is not authorized by the Project Agent policy')
      if (!project.resources.some(item => sameResource(item, command.resource))) return failed('incompatible-resource', 'Execution resource does not belong to this project')
      const session = command.session ?? { runtimeId: command.resource.runtimeId, sessionId: `session-${randomUUID()}` }
      if (session.runtimeId !== command.resource.runtimeId) return failed('incompatible-session', 'Session and execution resource must share a runtime')
      if (state.executions.some(item => sameSession(item.session, session) || item.retired?.some(old => sameSession(old.session, session)) || (item.continuation && sameSession(item.continuation.successor, session)))) return failed('session-in-use', 'Session already coordinates another execution')
      if (state.tasks.some(item => item.sessions.some(binding => sameSession(binding.session, session)
        && (binding.purpose === 'review' || item.projectId !== task.projectId || item.id !== task.id)))) return failed('association-only-session', 'Review or another Task association cannot grant coordination')
      const executionId = randomUUID()
      const sourceContext = sourceIssuesAt(state, command.ref).map(issue => `GitHub Issue: ${issue.url}\nRepository: ${issue.repository.owner}/${issue.repository.repository}`).join('\n')
      const kickoff = `${agent.policy.instructions}\n\n${MANAGED_WORK_INSTRUCTIONS}\n\nTask ${task.id}: ${task.title}\nGoal: ${task.goal}\n${sourceContext ? `\nSource:\n${sourceContext}\n` : ''}\nSpecification version: ${task.specification.version}\nMissing material: ${JSON.stringify(task.specification.missing ?? [])}\nSpecification:\n${task.specification.text}\n\nAcceptance criteria:\n${task.specification.acceptance.map(item => `- ${item}`).join('\n')}`
      if (kickoff.length > 100_000) return failed('task-material-too-large', 'Task goal, specification and acceptance exceed the 100,000-character kickoff limit; organize a bounded accepted specification before starting')
      const execution = { id: executionId, ref: command.ref, agentId: agent.id, owner: randomUUID(), epoch: 1,
        resource: command.resource, session, sessionMode: command.session ? 'reuse' as const : 'create' as const, agentPreset: command.agentPreset, model: command.model, permissionPreset: command.permissionPreset,
        policy: structuredClone(agent.policy), ...(project.continuationPolicy ? { continuationPolicy: structuredClone(project.continuationPolicy) } : {}), events: [{ id: `kickoff:${executionId}`, text: kickoff, kind: 'input' as const, delivery: 'accepted' as const, acceptance: 'unassessed' as const }], state: 'accepted' as const, history: [{ state: 'accepted' as const, commandId: command.commandId }] }
      state.executions.push(execution)
      queueParentResults(state)
      task.agentId = agent.id
      this.changed(task, command)
      return { status: 'completed', execution }
    }
    if (task.version !== command.expectedVersion) return conflict(task.version)
    if (command.type === 'legacy.map') {
      if (!isAbsolute(command.address.projectRoot) || normalize(command.address.projectRoot) !== command.address.projectRoot) {
        return failed('noncanonical-legacy-address', 'Legacy project root must be an absolute normalized address')
      }
      const previous = state.legacyMappings.find(item => legacyKey(item.address) === legacyKey(command.address))
      if (previous && (previous.ref.projectId !== projectId || previous.ref.taskId !== task.id)) {
        return { status: 'conflict', error: { code: 'legacy-address-in-use', message: 'Legacy address already maps to another TaskRef' } }
      }
      if (!previous) { state.legacyMappings.push({ address: command.address, ref: command.ref }); this.changed(task, command) }
      return { status: 'completed', ref: command.ref, task }
    }
    if (command.type === 'task.associate-session') {
      const existing = task.sessions.find(item => sameSession(item.session, command.session))
      if (existing) {
        if (existing.purpose !== command.purpose) return failed('association-purpose-conflict', 'Session is already associated with another purpose')
        return { status: 'completed', task }
      }
      if (state.tasks.some(item => item.projectId !== projectId && item.sessions.some(binding => sameSession(binding.session, command.session)))) {
        return failed('cross-project-reference', 'Session is associated with work in another project')
      }
      task.sessions.push({ session: command.session, purpose: command.purpose })
      this.changed(task, command)
      return { status: 'completed', task }
    }
    if (command.type === 'task.replace-breakdown') {
      if (new Set(command.blocks.map(block => block.id)).size !== command.blocks.length) return failed('duplicate-block', 'Breakdown block IDs must be unique')
      task.breakdown = command.blocks
      this.changed(task, command)
      return { status: 'completed', task }
    }
    if (command.type === 'task.create-child') {
      // GitHub is the only primary store in this stage: a subtask is a native
      // sub-issue, never a local-only Task. Legacy local children are invalid cache.
      return failed('local-subtask-not-supported', '现阶段 GitHub 是主存：子任务必须创建为原生 sub-issue 并通过来源导入；本地子 Task 记录无效')
    }
    if (command.type === 'task.link-child') {
      if (command.child.projectId !== projectId) return failed('cross-project-reference', 'Parent and child must belong to the same project')
      const child = taskAt(state, command.child)
      if (!child) return failed('unknown-task', 'Child Task does not belong to this project')
      if (child.version !== command.childExpectedVersion) return conflict(child.version)
      let ancestor: WorkTask | undefined = task
      while (ancestor) {
        if (ancestor.id === child.id) return failed('task-cycle', 'Parent relationship would form a cycle')
        ancestor = ancestor.parent ? taskAt(state, ancestor.parent) : undefined
      }
      const blocked = taskStructureBlocker(state, child)
      if (blocked && !task.children.some(ref => sameTask(ref, command.child))) return failed(blocked.code, blocked.message)
      if (!isCanonicalChild(state, command.child)) return failed('subtask-not-in-primary-store', '只能关联已有主存 sub-issue 记录的子任务；本地 Task 不是业务子任务')
      if (child.parent && child.parent.taskId !== task.id) return failed('child-already-linked', 'Child already has another parent')
      if (task.children.some(ref => ref.taskId === child.id)) return { status: 'completed', task }
      child.parent = command.ref
      task.children.push(command.child)
      this.changed(child, command)
      this.changed(task, command)
      return { status: 'completed', task }
    }
    if (command.type === 'task.update-spec') {
      task.specificationHistory.push(task.specification)
      task.specification = { version: task.specification.version + 1, text: command.specification, acceptance: command.acceptance }
      task.goal = command.goal
      this.changed(task, command)
      return { status: 'completed', task }
    }
    return failed('unsupported-command', 'Command is not implemented')
  }
  async query(input: unknown, actor: WorkActor): Promise<WorkResult> {
    if (!actor.operator) return failed('forbidden', 'Host operator authorization is required')
    const parsed = querySchema.safeParse(input)
    if (!parsed.success) return failed('invalid-query', 'Invalid work query')
    const query = parsed.data
    if (query.type === 'github.account' || query.type === 'github.repositories') {
      try {
        if (query.type === 'github.account' && this.source?.account) return { status: 'completed', githubAccount: await this.source.account() }
        if (query.type === 'github.repositories' && this.source?.repositories) return { status: 'completed', githubRepositories: await this.source.repositories(query.page) }
        return failed('github-capability-unavailable', '当前宿主未提供 GitHub 账号和仓库目录能力')
      } catch (error) { return failed(error instanceof SourceError ? error.code : 'github-unavailable', error instanceof SourceError ? error.message : 'GitHub 暂时不可用') }
    }
    if (query.type === 'source.identify') {
      if (!this.source?.identify) return failed('github-capability-unavailable', 'Source identification is unavailable')
      try { return { status: 'completed', candidate: await this.source.identify(query.url) } } catch (error) { return failed(error instanceof SourceError ? error.code : 'github-unavailable', error instanceof Error ? error.message : 'Source could not be identified') }
    }
    if (query.type === 'work.capabilities') {
      let taskStart = false
      try { const choices = await this.host.execution?.choices(); taskStart = !!choices?.models.length && !!choices.agentPresets.length && !!choices.permissionPresets.length } catch {}
      return { status: 'completed', capabilities: { githubRead: Boolean(this.source), githubWrite: false, taskStart, projectViews: !!this.source?.project } }
    }
    if (query.type === 'source.catalog' && query.refresh) {
      const result = await refreshCatalog(apply => this.sourceTransaction(apply), query, this.source)
      const local = await this.query({ ...query, refresh: false }, actor)
      return tableResult({ ...result, ...(local.status === 'completed' ? { progressItems: local.progressItems } : {}) })
    }
    if ((query.type === 'source.issues' || query.type === 'source.issue') && query.refresh) {
      this.refreshCount++
      try { return tableResult(await refreshSource(apply => this.sourceTransaction(apply), query, this.source)) }
      finally { this.refreshCount-- }
    }
    const state = await this.load()
    if (query.type === 'source.catalog') {
      const source = state.sources.find(source => source.id === query.sourceId && source.projectId === query.projectId)
      if (!source) return failed('unknown-source', 'Source does not belong to this project')
      const members = new Set(source.projectSnapshot?.items.filter(item => !item.archived && item.kind === 'issue').map(item => item.issueNodeId) ?? [])
      const bindings = state.externalBindings.filter(binding => source.repository ? binding.lastObserved.repository.owner.toLowerCase() === source.repository.owner.toLowerCase() && binding.lastObserved.repository.repository.toLowerCase() === source.repository.repository.toLowerCase() : members.has(binding.nodeId))
      const progressItems = bindings.flatMap(binding => { const progress = taskProgressView(state, binding.ref, this.host.execution); return progress ? [progress] : [] })
      return source.catalog ? tableResult({ status: 'completed', source, catalog: source.catalog, progressItems }) : tableResult({ ...failed('source-catalog-unobserved', '目录尚无可读缓存，请刷新来源'), source })
    }
    if (query.type === 'source.list') return state.projects.some(item => item.id === query.projectId)
      ? { status: 'completed', sources: state.sources.filter(item => item.projectId === query.projectId).map(slimSource) } : failed('unknown-project', 'Project does not exist')
    if (query.type === 'source.progress') {
      const selected = state.sources.find(item => item.id === query.sourceId && item.projectId === query.projectId)
      if (!selected) return failed('unknown-source', 'Source does not belong to this project')
      const discovery = selected.discovery, checkpoint = discovery?.checkpoint
      return { status: 'completed', scan: {
        state: discovery?.state ?? 'idle', pages: checkpoint?.pages ?? 0, fetched: checkpoint?.items.length ?? 0,
        ...(checkpoint?.total === undefined ? {} : { total: checkpoint.total }),
        ...(checkpoint?.startedAt === undefined ? {} : { startedAt: checkpoint.startedAt }),
        ...(discovery?.lastSuccessAt === undefined ? {} : { lastSuccessAt: discovery.lastSuccessAt }),
      } }
    }
    if (query.type === 'source.issues' || query.type === 'source.issue') return tableResult(sourceResult(state, query))
    if (query.type === 'continuous.status') {
      const source = state.sources.find(source => source.id === query.sourceId && source.projectId === query.projectId)
      if (!source) return failed('unknown-source', 'Source does not belong to this project')
      const rule = structuredClone(state.continuousRules?.find(rule => rule.projectId === query.projectId))
      if (rule) observeContinuousTasks(state, rule)
      return { status: 'completed', continuousRule: rule }
    }
    if (query.type === 'task.execution-options' || query.type === 'source.execution-options') {
      const task = query.type === 'task.execution-options' ? taskAt(state, query.ref) : undefined
      if (query.type === 'task.execution-options' && !task) return failed('unknown-task', 'Task does not belong to this project')
      if (query.type === 'source.execution-options' && !state.sources.some(source => source.id === query.sourceId && source.projectId === query.projectId)) return failed('unknown-source', 'Source does not belong to this project')
      const project = state.projects.find(item => item.id === (query.type === 'source.execution-options' ? query.projectId : query.ref.projectId))!
      const agent = state.agents.find(item => item.id === (task?.agentId ?? project.defaultAgentId) && item.projectId === project.id)!
      if (!this.host.execution) return failed('host-capability-unavailable', 'This host has no managed execution capability')
      try {
        const choices = await this.host.execution.choices()
        const models = choices.models.filter(item => !agent.policy.modelCandidates.length || agent.policy.modelCandidates.includes(`${item.provider}/${item.model}`))
        const defaultModel = models.find(item => item.provider === choices.defaults.model.provider && item.model === choices.defaults.model.model) ?? models[0]
        if (!defaultModel) return failed('unavailable-model', 'Project Agent has no available allowed model')
        return { status: 'completed', executionOptions: { ...choices, agentId: agent.id, models,
          defaults: { ...choices.defaults, model: defaultModel }, resources: (await this.host.resources()).filter(item => project.resources.some(ref => sameResource(ref, item.ref)) || (query.type === 'source.execution-options' && !state.projects.some(other => other.resources.some(ref => sameResource(ref, item.ref))))) } }
      } catch (error) { return failed(error instanceof WorkExecutionError ? error.code : 'host-admission-failed', error instanceof WorkExecutionError ? error.message : 'Host execution catalogs could not be read') }
    }
    if (query.type === 'task.history') {
      const execution = state.executions.find(item => item.ref.taskId === query.ref.taskId && item.ref.projectId === query.ref.projectId)
      if (!execution || !execution.retired?.some(item => sameSession(item.session, query.session))) return failed('unrelated-history', 'Session is not retired history of this Task')
      if (!this.host.execution?.history) return failed('host-capability-unavailable', 'Read-only Session history is unavailable')
      try { return { status: 'completed', transcript: { session: query.session, ...await this.host.execution.history(execution, query.session, query.cursor, query.limit) } } }
      catch (error) { return failed(error instanceof WorkExecutionError ? error.code : 'history-unavailable', error instanceof Error ? error.message : 'History unavailable') }
    }
    if (query.type === 'task.execution') {
      if (!taskAt(state, query.ref)) return failed('unknown-task', 'Task does not belong to this project')
      const execution = state.executions.find(item => sameTask(item.ref, query.ref))
      return { status: 'completed', executionGraph: await this.executionGraph(state, taskAt(state, query.ref)!), ...(execution ? { execution, executionRuntime: this.host.execution?.status(execution) ?? 'inactive' as const } : {}) }
    }
    if (query.type === 'legacy.resolve') {
      const mapping = state.legacyMappings.find(item => legacyKey(item.address) === legacyKey(query.address))
      return mapping ? { status: 'completed', ref: mapping.ref } : failed('unknown-legacy-address', 'Legacy address has no accepted TaskRef mapping')
    }
    if (query.type === 'projects.list') return { status: 'completed', projects: state.projects }
    if (query.type === 'resources.list') return { status: 'completed', resources: (await this.host.resources()).map(resource => {
      const owner = state.projects.find(project => project.resources.some(ref => sameResource(ref, resource.ref)))
      return { ref: resource.ref, title: resource.title, ...(owner ? { owner: { projectId: owner.id, projectName: owner.name } } : {}) }
    }) }
    if (query.type === 'session.work') return { status: 'completed', work: [
      ...state.tasks.flatMap(task => task.sessions.filter(binding => sameSession(binding.session, query.session)
        && !state.executions.some(item => item.ref.taskId === task.id && (sameSession(item.session, query.session) || item.retired?.some(old => sameSession(old.session, query.session))))).map(binding => ({
        ref: { projectId: task.projectId, taskId: task.id }, title: task.title,
        projectName: state.projects.find(project => project.id === task.projectId)!.name, purpose: binding.purpose,
      }))),
      ...state.executions.filter(item => item.retired?.some(old => sameSession(old.session, query.session))).map(item => ({
        ref: item.ref, title: taskAt(state, item.ref)!.title, projectName: state.projects.find(project => project.id === item.ref.projectId)!.name, purpose: 'history' as const, executionId: item.id, epoch: item.retired!.find(old => sameSession(old.session, query.session))!.epoch, currentSession: item.session,
      })),
      ...state.executions.filter(item => sameSession(item.session, query.session)).map(item => ({
        ref: item.ref, title: taskAt(state, item.ref)!.title, projectName: state.projects.find(project => project.id === item.ref.projectId)!.name,
        purpose: 'control' as const, executionId: item.id, epoch: item.epoch,
      })),
    ] }
    if (query.type === 'session.candidates') {
      const project = state.projects.find(item => item.id === query.projectId)
      return project ? { status: 'completed', candidates: await this.candidates(project) } : failed('unknown-project', 'Project does not exist')
    }
    if (query.type !== 'project.detail' && query.type !== 'task.detail') return failed('unsupported-query', 'Query is not implemented')
    const projectId = query.type === 'project.detail' ? query.projectId : query.ref.projectId
    const project = state.projects.find(item => item.id === projectId)
    if (!project) return failed('unknown-project', 'Project does not exist')
    if (query.type === 'project.detail') return { status: 'completed', project, progressItems: projectProgress(state, projectId, this.host.execution),
      agents: state.agents.filter(item => item.projectId === projectId), tasks: state.tasks.filter(item => item.projectId === projectId) }
    const task = taskAt(state, query.ref)
    const execution = state.executions.find(item => sameTask(item.ref, query.ref))
    return task ? { status: 'completed', task, executionGraph: await this.executionGraph(state, task), progress: taskProgressView(state, query.ref, this.host.execution), bindings: state.externalBindings.filter(item => item.ref.taskId === task.id && item.ref.projectId === task.projectId),
      ...(execution ? { execution, executionRuntime: this.host.execution?.status(execution) ?? 'inactive' as const } : {}),
      ...(task.parent ? { parent: taskAt(state, task.parent) } : {}),
      children: task.children.map(ref => taskAt(state, ref)!).filter(Boolean),
    } : failed('unknown-task', 'Task does not belong to this project')
  }
}
