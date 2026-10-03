/**
 * Task aggregation for Agentic Agile Driven Development (`ctx.a2d2`).
 *
 * A task groups the sessions belonging to one piece of work and records the
 * handoff edges between them. Its data lives entirely in project-local
 * documents under `<projectRoot>/.dsh/a2d2/tasks/`, so no session's durable
 * format changes and the relationship between handed-off sessions survives as
 * committed, reviewable files.
 *
 * The [A²D² design note](../../../../.agents/notes/implemented/feature/2026-09-20-a2d2-task-aggregation.md)
 * owns why membership and edges are stored here rather than on `SessionHeader`,
 * and why handing off is not a terminal state.
 * @module @deepseek-ai/dsh-a2d2
 */

import { randomUUID } from 'node:crypto'
import { basename, isAbsolute, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, MessageSource } from '@deepseek-ai/dsh-llm'
import type { Fiber, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskId, taskIdForIssue } from './brand.ts'
import { CONFIG_ROUTE_PATH, createConfigHandler } from './config-page.ts'
import { CONSULT_ROUTE_PATH, consultContextFactsFromProjectionValues, createConsultHandler } from './consult.ts'
import { handedOff, memberOf, successorsOf } from './derive.ts'
import { repoOfCwd } from './github-remote.ts'
import type { HandoffDocument, HandoffFacts } from './handoff-document.ts'
import {
  parseHandoffDocument,
  renderHandoffDocument,
  renderHandoffSkeleton,
} from './handoff-document.ts'
import { handoffInstruction } from './handoff-instruction.ts'
import { handoffPrompt } from './handoff-prompt.ts'
import { isClosedHighwayStation } from './highway.ts'
import { indicatorProjectionDefinition } from './indicator-projection.ts'
import type { HandoffThresholds, ModelPrice } from './indicator-projection.ts'
import { PANEL_ROUTE_PATH, createPanelHandler } from './panel.ts'
import type { RequestRejection } from './route-auth.ts'
import { SESSION_AGENT_ROUTE_PATH, createSessionAgentHandler } from './session-agent-route.ts'
import { SessionAgentStore } from './session-agents.ts'
import { parseSessionId, redactText } from './handoff.ts'
import { DEFAULT_SKILLS_ROOT, readSkillSource, resolveSkillsRoot } from './skill-source.ts'
import {
  DEFAULT_STAGE_AGENTS,
  StageAgentsSettingsSchema,
  modelCandidatesForStage,
  splitModelRoute,
  stageAgentWarnings,
  validateCompleteStageAgentsSettings,
  validateStageAgentsSettings,
} from './stage-agents.ts'
import type { Stage, StageAgent, StageAgentsSettings } from './stage-agents.ts'
import {
  DEFAULT_PROJECT_MARKERS,
  TaskDocumentStore,
  handoffsDirectory,
  newTask,
  readHandoffDocument,
  resolveProjectRoot,
  withMember,
  writeHandoffDocument,
} from './store.ts'
import type { BoundTask, CreateTaskRequest, Task } from './types.ts'
import { WaitNotices } from './wait-notice.ts'
import type { Notifier } from './wait-notice.ts'

export { TaskId, taskIdForIssue } from './brand.ts'
export type { TaskId as TaskIdType } from './brand.ts'
export {
  CONFIG_ROUTE_PATH,
  classifyModelProbe,
  createConfigHandler,
} from './config-page.ts'
export type { ConfigDependencies, ConfigMethod, ConfigSettingsView, ModelProbeResult, ModelProbeStatus } from './config-page.ts'
export {
  CONSULT_MAX_OUTPUT_TOKENS,
  CONSULT_MESSAGE_LIMIT,
  CONSULT_ROUTE_PATH,
  MalformedCandidatesError,
  buildConsultPrompt,
  checkProjectPreconditions,
  collectConsultMaterial,
  consultContextFactsFromProjectionValues,
  createConsultHandler,
  currentConsultRoute,
  generateConsultWithFallback,
  generateConsultOutput,
  parseConsultOutput,
  statusOf,
} from './consult.ts'
export type {
  ConsultCandidate,
  ConsultContextFacts,
  ConsultDependencies,
  ConsultErrorCode,
  ConsultFallback,
  ConsultMaterial,
  ConsultMessageExcerpt,
  ConsultOutput,
  ConsultPreconditionId,
  ConsultPreconditionMissing,
  ConsultPreconditions,
  ConsultRoute,
  ConsultSession,
  ConsultValidationContext,
  ConsultValue,
} from './consult.ts'
export {
  CODING_MODEL_ROUTES,
  DEFAULT_STAGE_AGENTS,
  STAGE_AGENTS,
  STAGE_AGENT_STAGES,
  StageAgentsSettingsSchema,
  THINKING_MODEL_ROUTES,
  agentForStage,
  modelCandidatesForStage,
  shortModelRoute,
  splitModelRoute,
  stageAgentWarnings,
  validateStageAgentsSettings,
} from './stage-agents.ts'
export type { Stage, StageAgent, StageAgentsSettings } from './stage-agents.ts'
export { handedOff, memberOf, successorsOf } from './derive.ts'
export {
  DEFAULT_PROJECT_MARKERS,
  HANDOFFS_DIRECTORY_SEGMENTS,
  TASKS_DIRECTORY_SEGMENTS,
  TASK_DOCUMENT_EXTENSION,
  TaskDocumentStore,
  handoffsDirectory,
  readHandoffDocument,
  resolveProjectRoot,
  tasksDirectory,
  writeHandoffDocument,
} from './store.ts'
export {
  HANDOFF_DOCUMENT_EXTENSION,
  HANDOFF_DOCUMENT_VERSION,
  HANDOFF_SUMMARY_END,
  HANDOFF_SUMMARY_PLACEHOLDER,
  HANDOFF_SUMMARY_START,
  HandoffDocumentError,
  handoffDocumentName,
  parseHandoffDocument,
  renderHandoffDocument,
  renderHandoffSkeleton,
} from './handoff-document.ts'
export type { HandoffDocument, HandoffDocumentErrorCode, HandoffFacts } from './handoff-document.ts'
export { HANDOFF_SUMMARY_MAX_CHARS, handoffInstruction } from './handoff-instruction.ts'
export { DEFAULT_SKILLS_ROOT, readSkillSource, skillDescription } from './skill-source.ts'
export type { LoadedSkillSource, MissingSkillSource, SkillResource, SkillSource } from './skill-source.ts'
export { handoffPrompt } from './handoff-prompt.ts'
export {
  HANDOFF_USAGE,
  parseHandoffCommand,
  parseSessionId,
  parseTaskId,
  redactText,
} from './handoff.ts'
export type { HandoffCommand, RedactedText, RedactionLabel } from './handoff.ts'
export type { TaskDocumentStoreConfig } from './store.ts'
export {
  PANEL_ROUTE_PATH,
  createPanelHandler,
  panelPayload,
} from './panel.ts'
export type {
  PanelDependencies,
  PanelErrorCode,
  PanelMember,
  PanelPayload,
  PanelRequest,
  PanelResponse,
  PanelResponseWriter,
  PanelSession,
  PanelTask,
  PanelTaskIssue,
} from './panel.ts'
export { rejectionError } from './route-auth.ts'
export type { RequestRejection, RouteRejection } from './route-auth.ts'
export {
  SESSION_AGENT_ROUTE_PATH,
  createSessionAgentHandler,
} from './session-agent-route.ts'
export type { SessionAgentDependencies, SessionAgentSession } from './session-agent-route.ts'
export {
  SESSION_AGENTS_DOCUMENT_VERSION,
  SESSION_AGENTS_FILE_SEGMENTS,
  SessionAgentStore,
  SessionAgentsDocumentError,
  parseSessionAgentsDocument,
  renderSessionAgentsDocument,
  sessionAgentsFile,
} from './session-agents.ts'
export type { SessionAgentRecord, SessionAgentsDocument, SessionAgentsDocumentErrorCode } from './session-agents.ts'
export {
  LEGACY_TASK_DOCUMENT_VERSION,
  TASK_DOCUMENT_VERSION,
  TaskDocumentError,
  parseTaskDocument,
  renderTaskDocument,
  taskIdFromFilename,
} from './document.ts'
export type { TaskDocumentErrorCode } from './document.ts'
export type { BoundTask, CreateTaskRequest, Task, TaskIssue, TaskIssueHandoff, TaskMember, TaskState } from './types.ts'
export { WAIT_NOTICE_GRACE_MS, WAIT_NOTICE_SOURCE, WAIT_NOTICE_SUMMARY_MAX_CHARS } from './wait-notice.ts'
export type { Notifier, NotifierMessage, NotifierPushOptions, NotifierPushResult } from './wait-notice.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'a2d2-open-subtask': { kind: 'a2d2-open-subtask' } & ContextFormed
    'a2d2-complete-task': { kind: 'a2d2-complete-task' } & ContextFormed
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    a2d2: A2d2Service
  }

  interface Events {
    /** Emitted after a task issue's main session is bound or moved to another session. */
    'a2d2/main-session-changed'(payload: {
      cwd: string
      projectRoot: string
      issue: number
      previousMainSession?: SessionId
      mainSession: SessionId
    }): void
    /** Emitted after a non-main session is recorded as an A2D2 Agent. */
    'a2d2/session-agent-recorded'(payload: {
      cwd: string
      projectRoot: string
      session: SessionId
      agent: StageAgent
    }): void | Promise<void>
  }
}

/** @deprecated Handoff documents no longer render suggested skills. */
export const DEFAULT_SUGGESTED_SKILLS: readonly string[] = ['implement', 'tdd', 'code-review']

/**
 * Context length at which the floating indicator starts warning, when a
 * deployment configures none.
 *
 * A length rather than a ratio: the indicator reports how much context a session
 * is carrying. The design baseline is the smart zone at about 150k; reaching it
 * signals that the next phase boundary should choose among the five workflow
 * outcomes, of which changing sessions is only one.
 */
export const DEFAULT_HANDOFF_WARN_TOKENS = 150_000

/** Context length at which the floating indicator is critical, when a deployment configures none. */
export const DEFAULT_HANDOFF_CRITICAL_TOKENS = 1_000_000

/** Currency the indicator quotes a configured rate in, when a deployment configures none. */
export const DEFAULT_CURRENCY = '¥'

const A2D2_OPEN_SUBTASK_MESSAGE_SOURCE: MessageSource = { kind: 'a2d2-open-subtask' }
const A2D2_COMPLETE_TASK_MESSAGE_SOURCE: MessageSource = { kind: 'a2d2-complete-task' }

function completeTaskNotification(issue: number, summary: string): string {
  return `子任务 #${String(issue)} 已完成。\n\n完成说明：${summary}`
}

function openSubtaskPrompt(issue: number, parentIssue: number): string {
  return [
    `子任务 issue：#${String(issue)}（在本项目目录里用 \`gh issue view ${String(issue)} --comments\` 读取）`,
    `父任务 issue（spec 在其中）：#${String(parentIssue)}（在本项目目录里用 \`gh issue view ${String(parentIssue)} --comments\` 读取）`,
    '',
    '用 /grill-with-docs 推进；你是该任务的主会话。',
  ].join('\n')
}

/** Plugin configuration. */
export interface Config {
  /** Fixed project root; when set, the session cwd no longer selects the store. */
  root?: string
  /** Directory entries that identify a project root while walking upward from a session cwd. */
  projectMarkers?: string[]
  /** Explicit root containing installed skills; omitted to probe conventional locations. */
  skillsRoot?: string
  /** @deprecated Accepted for compatibility; handoff documents no longer render this list. */
  suggestedSkills?: string[]
  /** Context length, in tokens, at which the floating indicator warns. */
  handoffWarnTokens?: number
  /** Context length, in tokens, at which the floating indicator is critical. */
  handoffCriticalTokens?: number
  /**
   * Per-million-token rates for the floating indicator's cost line, keyed
   * `provider/model` and then bare `model`.
   *
   * DSH itself carries no price data — `dsh-token-meter` measures tokens and is
   * explicit that it is not a billing record — so a deployment that wants a cost
   * figure supplies the rates. A route with no entry shows no cost rather than a
   * guessed one.
   */
  modelPrices?: Record<string, { inputPerMillion: number; outputPerMillion: number }>
  /** Currency the rates are quoted in, shown beside the computed cost. */
  currency?: string
  /**
   * Stage-to-Agent assignments, each Agent's model candidates, and consult
   * model candidates. A volatile field: edits through the settings service apply
   * without a reload. Absent only where no loader composes the plugin (tests),
   * which reads the defaults.
   */
  stageAgents?: Volatile<StageAgentsSettings>
}

/** Everything one prepared handoff produced. */
export interface PreparedHandoff {
  /** The task the source session now belongs to. */
  readonly task: Task
  /** The handed-off session. */
  readonly source: SessionId
  /** Absolute path of the skeleton document the handing-off agent fills in. */
  readonly path: string
  /** The turn that asks that agent to write the continuation content. */
  readonly instruction: string
}

/** Everything one taken handoff produced. */
export interface TakenHandoff {
  /** The task, as persisted after the successor joined it. */
  readonly task: Task
  /** The document the successor read. */
  readonly document: HandoffDocument
  /** The successor's first prompt, rendered from the document. */
  readonly prompt: string
}

/** Input of {@link A2d2Service.prepareHandoff}. */
export interface PrepareHandoffRequest {
  /** The session being handed off. */
  readonly source: SessionId
  /** The source session's working directory, which locates the project. */
  readonly cwd: string
  /** What the next session is for, absent for a generic handoff. */
  readonly focus: string | undefined
  /** The task to hand off within; the resolved default when absent. */
  readonly taskId: TaskId | undefined
  /** Injection point for the document's timestamp. */
  readonly now: Date
}

/** Input of {@link A2d2Service.takeHandoff}. */
export interface TakeHandoffRequest {
  /** The session that was handed off; its membership names the task. */
  readonly source: SessionId
  /** The session taking the handoff. */
  readonly successor: SessionId
  /** The successor's working directory, which locates the project. */
  readonly cwd: string
}

/** Input of {@link A2d2Service.bindMainSession}. */
export interface BindMainSessionRequest {
  /** The binding session's working directory, which locates the project. */
  readonly cwd: string
  /** The task issue number the session will execute. */
  readonly issue: number
  /** The parent task issue number, when the task issue is a subtask. */
  readonly parentIssue?: number
  /** The task issue's title, which names a newly created task. */
  readonly title?: string
  /** The session becoming the task issue's main session. */
  readonly mainSession: SessionId
  /** Injection point for a new task's creation timestamp. */
  readonly now: Date
}

/** Input of {@link A2d2Service.openSubtask}. */
export interface OpenSubtaskRequest {
  /** The caller session's working directory, which locates the project. */
  readonly cwd: string
  /** The session calling the tool; it must be a task issue's main session. */
  readonly caller: SessionId
  /** The subtask issue number to open. */
  readonly issue: number
  /** Injection point for a new task's creation timestamp. */
  readonly now: Date
}

/** Result of opening a subtask main session. */
export interface OpenedSubtask {
  /** The new root session that is now the subtask's main session. */
  readonly session: SessionId
  /** The model route selected from the grill stage. */
  readonly model: { readonly provider: string; readonly model: string }
  /** The persisted task document bound to the subtask issue. */
  readonly task: BoundTask
}

/** Input of {@link A2d2Service.completeTask}. */
export interface CompleteTaskRequest {
  /** The caller session's working directory, which locates the project. */
  readonly cwd: string
  /** The session declaring its task complete; it must be that task issue's main session. */
  readonly caller: SessionId
  /** Completion summary delivered to the parent task's main session when one exists. */
  readonly summary: string
}

/** Result of completing a task issue. */
export interface CompletedTask {
  /** The persisted task document after its state became done. */
  readonly task: BoundTask
  /** Parent task issue number, when this completed task is a subtask. */
  readonly parentIssue?: number
  /** Parent main session that received the completion notification, when any. */
  readonly parentMainSession?: SessionId
  /** Whether a parent main session was notified. */
  readonly notifiedParent: boolean
  /** Whether the parent main session had to be resumed before notification. */
  readonly resumedParent: boolean
}

/** Input of {@link A2d2Service.dispatchSubagent}. */
export interface DispatchSubagentRequest {
  /** The calling session's working directory, which locates the project. */
  readonly cwd: string
  /** Matt highway stage whose stage Agent table chooses the child Agent and model. */
  readonly stage: Stage
  /** Task issue number the child is dispatched to implement or review. */
  readonly issue: number
  /** Prompt delivered as the child subagent's initial user message. */
  readonly prompt: string
  /** The live main-session Agent dispatching the child. */
  readonly parent: Agent
  /** Caller cancellation before DSH accepts the continuable child prompt. */
  readonly signal: AbortSignal
}

/** Result of one subagent dispatch. */
export interface DispatchedSubagent {
  /** Durable child session id returned by DSH. */
  readonly session: SessionId
  /** Effective `provider/model` route selected from the stage Agent table. */
  readonly model: string
  /** Stage Agent used for the dispatch. */
  readonly agent: StageAgent
}

/**
 * The slice of DSH's `connection` service the browser routes ask before doing
 * anything: its Host/Origin fence plus browser (login-cookie) authentication.
 * Typed here because its package is browser-side. The routes are injected
 * with `webServer` *and* `connection`, so a composition without the service
 * registers none of them rather than serving them unauthenticated.
 */
type RouteConnection = { readonly requestRejection: RequestRejection }

type LlmRuntime = {
  listProviders(): readonly { readonly id: string }[]
  listModels(provider: string): Promise<readonly { readonly id: string }[]>
}

type SubagentsRuntime = {
  startContinuable(spec: {
    readonly provider: string
    readonly label: string
    readonly childId?: SessionId
    readonly request: {
      readonly prompt: readonly { readonly type: 'text'; readonly text: string }[]
      readonly parent: Agent
      readonly agentOptions: { readonly provider: string; readonly model: string }
    }
    readonly signal: AbortSignal
  }): Promise<{ readonly childId: SessionId }>
}

/**
 * Task aggregation over project-local documents.
 *
 * `resolve` picks the task a new session inherits. It currently reads the
 * newest `active` task of the project, because a task document carries no
 * activity timestamp of its own; deriving recency from member sessions is the
 * intended refinement once the store is consumed by session creation.
 */
export class A2d2Service extends Service {
  static Config: z<Config> = z.object({
    root: z.string(),
    projectMarkers: z.array(z.string()).default([...DEFAULT_PROJECT_MARKERS]),
    skillsRoot: z.string(),
    suggestedSkills: z.array(z.string()).default([...DEFAULT_SUGGESTED_SKILLS]),
    handoffWarnTokens: z.number().default(DEFAULT_HANDOFF_WARN_TOKENS),
    handoffCriticalTokens: z.number().default(DEFAULT_HANDOFF_CRITICAL_TOKENS),
    modelPrices: z.dict(z.object({
      inputPerMillion: z.number(),
      outputPerMillion: z.number(),
    })).default({}),
    currency: z.string().default(DEFAULT_CURRENCY),
    stageAgents: StageAgentsSettingsSchema.volatile(),
  }) as z<Config>

  private readonly store: TaskDocumentStore
  private readonly sessionAgents: SessionAgentStore
  private readonly projectMarkers: readonly string[]
  private readonly skillsRoot: string
  private readonly thresholds: HandoffThresholds
  private readonly prices: ReadonlyMap<string, ModelPrice>
  private readonly currency: string
  private readonly stageAgentsConfig: Volatile<StageAgentsSettings> | undefined
  private readonly entryFiber: Fiber
  /** Wait notices, present while some plugin provides `notifier`. */
  private waitNotices: WaitNotices | undefined

  /**
   * Create the service over a resolved store configuration.
   * @param ctx - the owning cordis context.
   * @param config - plugin configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'a2d2')
    const root = config.root
    if (root !== undefined && !isAbsolute(root)) {
      throw new Error(`a2d2: root must be an absolute path, received "${root}"`)
    }
    const projectMarkers = config.projectMarkers ?? [...DEFAULT_PROJECT_MARKERS]
    if (projectMarkers.length === 0) {
      throw new Error('a2d2: projectMarkers must name at least one directory entry')
    }
    this.skillsRoot = resolveSkillsRoot(config.skillsRoot)
    if (!isAbsolute(this.skillsRoot)) {
      throw new Error(`a2d2: skillsRoot must be an absolute path, received "${this.skillsRoot}"`)
    }
    this.thresholds = {
      warnAtTokens: config.handoffWarnTokens ?? DEFAULT_HANDOFF_WARN_TOKENS,
      criticalAtTokens: config.handoffCriticalTokens ?? DEFAULT_HANDOFF_CRITICAL_TOKENS,
    }
    for (const [field, value] of [['handoffWarnTokens', this.thresholds.warnAtTokens], ['handoffCriticalTokens', this.thresholds.criticalAtTokens]] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`a2d2: ${field} must be a positive integer token count, received ${String(value)}`)
      }
    }
    if (this.thresholds.warnAtTokens > this.thresholds.criticalAtTokens) {
      throw new Error(
        `a2d2: handoffWarnTokens (${this.thresholds.warnAtTokens}) must not exceed handoffCriticalTokens (${this.thresholds.criticalAtTokens})`,
      )
    }
    this.store = new TaskDocumentStore({
      ...(root === undefined ? {} : { root }),
      projectMarkers: [...projectMarkers],
    })
    this.sessionAgents = new SessionAgentStore()
    this.projectMarkers = [...projectMarkers]
    this.prices = new Map(Object.entries(config.modelPrices ?? {}))
    for (const [route, price] of this.prices) {
      if (!Number.isFinite(price.inputPerMillion) || price.inputPerMillion < 0
        || !Number.isFinite(price.outputPerMillion) || price.outputPerMillion < 0) {
        throw new Error(`a2d2: modelPrices["${route}"] must carry non-negative finite rates`)
      }
    }
    this.currency = config.currency ?? DEFAULT_CURRENCY
    this.stageAgentsConfig = config.stageAgents
    this.entryFiber = ctx.fiber
    this.publishStageAgents()
    this.publishIndicator()
    this.publishConsult()
    this.publishConfig()
    this.publishSessionAgent()
    this.publishPanel()
    this.publishWaitNotices()
    // Stated once at load: whether the browser half received these is otherwise
    // only visible by looking at the indicator, which never reports absence.
    this.ctx.logger.info(
      `a2d2: indicator thresholds warn at ${this.thresholds.warnAtTokens} tokens, `
      + `critical at ${this.thresholds.criticalAtTokens}; ${this.prices.size} priced route(s)`,
    )
  }

  /**
   * Every task of the session's project, in filename order.
   * @param cwd - absolute session working directory.
   * @returns the project's tasks.
   */
  async list(cwd: string): Promise<readonly Task[]> {
    return await this.store.list(cwd)
  }

  /**
   * The task a new session in this directory inherits.
   * @param cwd - absolute session working directory.
   * @returns the newest active task, or `undefined` when the project has none.
   */
  async resolve(cwd: string): Promise<Task | undefined> {
    const active = (await this.store.list(cwd)).filter(task => task.state === 'active')
    return active.reduce<Task | undefined>(
      (newest, task) => (newest === undefined || task.createdAt > newest.createdAt ? task : newest),
      undefined,
    )
  }

  /**
   * Create a task and write its document.
   * @param cwd - absolute session working directory.
   * @param request - the new task's name and optional goal.
   * @returns the persisted task.
   */
  async create(cwd: string, request: CreateTaskRequest): Promise<Task> {
    const id = await this.store.mintId(cwd, request.name)
    const task = newTask(id, request, new Date())
    await this.store.write(cwd, task)
    return task
  }

  /**
   * Bind a session as the main session of a task issue.
   *
   * The task issue's task is identified by the issue number, so a project holds
   * at most one task document per task issue; the main session joins it as a
   * member, keeping the handoff edges recorded the way any member's are.
   * @param request - the task issue, its optional parent, and the binding session.
   * @returns the task as persisted after the call.
   */
  async bindMainSession(request: BindMainSessionRequest): Promise<BoundTask> {
    const { cwd, issue, parentIssue, mainSession } = request
    if (cwd === '') {
      throw new Error('a2d2: the binding session records no working directory, so no project holds its task')
    }
    const id = taskIdForIssue(issue)
    if (parentIssue !== undefined) taskIdForIssue(parentIssue)
    const updated = await this.store.updateLocked(cwd, id, async existing => {
      if (existing !== undefined) {
        const bound = existing.issue
        if (bound === undefined) {
          throw new Error(`a2d2: task "${id}" exists but is bound to no task issue; rename its document before binding task issue #${issue}`)
        }
        const current = bound.mainSession
        if (current !== mainSession) {
          throw new Error(
            `a2d2: task issue #${issue} already has main session "${current}"; `
            + 'a task issue has one main session at a time, and another session takes over only through a handoff',
          )
        }
        if (bound.parent !== parentIssue) {
          const named = (parent: number | undefined): string => (parent === undefined ? 'none' : `#${parent}`)
          throw new Error(`a2d2: task issue #${issue} records parent ${named(bound.parent)}, not ${named(parentIssue)}`)
        }
        return { task: { ...existing, issue: bound }, write: false }
      }
      // One task per main session keeps "which task does this session execute"
      // a single answer.
      const held = await this.taskOfMainSession(cwd, mainSession)
      if (held !== undefined) {
        throw new Error(`a2d2: session "${mainSession}" is already the main session of task issue #${held.issue.number}`)
      }
      const name = request.title?.trim() || `Task issue #${issue}`
      const task: BoundTask = {
        id,
        issue: { number: issue, ...(parentIssue === undefined ? {} : { parent: parentIssue }), mainSession },
        name,
        state: 'active',
        createdAt: request.now.toISOString(),
        members: [{ sessionId: mainSession }],
      }
      return { task, write: true }
    })
    if (updated.written) await this.emitMainSessionChanged(cwd, issue, mainSession)
    return updated.task as BoundTask
  }

  /**
   * The task a session is the main session of.
   * @param cwd - absolute session working directory.
   * @param sessionId - the session to look up.
   * @returns the task whose task issue it executes, or `undefined` when it is no main session.
   */
  async taskOfMainSession(cwd: string, sessionId: SessionId): Promise<BoundTask | undefined> {
    return (await this.store.list(cwd))
      .find((task): task is BoundTask => task.issue?.mainSession === sessionId)
  }

  /**
   * The main session of a task issue.
   * @param cwd - absolute session working directory.
   * @param issue - the task issue number.
   * @returns the main session, or `undefined` when no task is bound to that task issue.
   */
  async mainSessionOfIssue(cwd: string, issue: number): Promise<SessionId | undefined> {
    return (await this.store.read(cwd, taskIdForIssue(issue)))?.issue?.mainSession
  }

  /**
   * Open a subtask as its own root main session.
   *
   * Only a task issue's main session may call this: the caller's task becomes
   * the subtask's parent issue. The new Session is a root Agent, not a subagent,
   * because ADR 0005 treats design-heavy subtasks as their own main sessions.
   * @param request - caller, subtask issue, and timestamp.
   * @returns the new main session, selected grill model, and bound task.
   */
  async openSubtask(request: OpenSubtaskRequest): Promise<OpenedSubtask> {
    if (request.cwd === '') {
      throw new Error('a2d2: the calling session records no working directory, so no project can hold the subtask')
    }
    const parent = await this.taskOfMainSession(request.cwd, request.caller)
    if (parent === undefined) {
      throw new Error('a2d2: only a task issue main session can open a subtask')
    }
    taskIdForIssue(request.issue)
    const existing = await this.mainSessionOfIssue(request.cwd, request.issue)
    if (existing !== undefined) {
      throw new Error(`a2d2: task issue #${request.issue} already has main session "${existing}"`)
    }

    const projectRoot = await this.store.projectRoot(request.cwd)
    const selected = await this.selectStageModel('grill')
    const model = splitModelRoute(selected)
    const session = brandString<SessionId>(`session-${randomUUID()}`)
    const agents = this.ctx.get('agents') as AgentRegistry | undefined
    if (agents === undefined) throw new Error('a2d2: agents service is unavailable, so no subtask session can be created')
    const handle = await agents.create({
      sessionId: session,
      meta: { cwd: projectRoot },
      agentOptions: model,
    })
    const task = await this.bindMainSession({
      cwd: projectRoot,
      issue: request.issue,
      parentIssue: parent.issue.number,
      mainSession: session,
      now: request.now,
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: openSubtaskPrompt(request.issue, parent.issue.number) }],
      source: A2D2_OPEN_SUBTASK_MESSAGE_SOURCE,
    }))
    return { session, model, task }
  }

  /**
   * Mark the caller's task issue done and wake the parent task's main session.
   *
   * ADR 0003 keeps tracker changes in the CEO's hands: this method writes only
   * the project-local task document and sends the parent notification, never the
   * GitHub issue.
   * @param request - caller main session and completion summary.
   * @returns the completed task plus notification details.
   */
  async completeTask(request: CompleteTaskRequest): Promise<CompletedTask> {
    if (request.cwd === '') {
      throw new Error('a2d2: the completing session records no working directory, so no project holds its task')
    }
    const summary = request.summary.trim()
    if (summary === '') throw new Error('a2d2: complete_task requires a non-empty completion summary')
    const task = await this.taskOfMainSession(request.cwd, request.caller)
    if (task === undefined) {
      throw new Error('a2d2: only a task issue main session can complete its task')
    }

    const completed: BoundTask = task.state === 'done' ? task : { ...task, state: 'done' }
    if (completed !== task) await this.store.write(request.cwd, completed)
    this.waitNotices?.completed(request.caller, completed.issue.number, summary)

    const parentIssue = completed.issue.parent
    if (parentIssue === undefined) {
      return { task: completed, notifiedParent: false, resumedParent: false }
    }
    const parentMainSession = await this.mainSessionOfIssue(request.cwd, parentIssue)
    if (parentMainSession === undefined) {
      return { task: completed, parentIssue, notifiedParent: false, resumedParent: false }
    }

    const agents = this.ctx.get('agents') as AgentRegistry | undefined
    if (agents === undefined) throw new Error('a2d2: agents service is unavailable, so no parent main session can be notified')
    let parentAgent = agents.get(parentMainSession)
    let resumedParent = false
    if (parentAgent === undefined) {
      parentAgent = (await agents.resume({ resumeSessionId: parentMainSession })).agent
      resumedParent = true
    }
    parentAgent.followup(createUserMessage({
      content: [{ type: 'text', text: completeTaskNotification(completed.issue.number, summary) }],
      source: A2D2_COMPLETE_TASK_MESSAGE_SOURCE,
    }))
    return { task: completed, parentIssue, parentMainSession, notifiedParent: true, resumedParent }
  }

  /**
   * Resolve the project root that owns a session cwd.
   * @param cwd - absolute session working directory.
   * @returns the owning project root.
   */
  async projectRoot(cwd: string): Promise<string> {
    return await this.store.projectRoot(cwd)
  }

  /**
   * Record the Agent assigned to a non-main session created as an A2D2 Agent.
   * @param cwd - absolute session working directory, locating the project ledger.
   * @param sessionId - the session to record.
   * @param agent - the Agent the session runs as.
   */
  async recordSessionAgent(cwd: string, sessionId: SessionId, agent: StageAgent): Promise<void> {
    if (cwd === '') throw new Error('a2d2: the session records no working directory, so no project holds its Agent')
    if (await this.taskOfMainSession(cwd, sessionId) !== undefined) {
      throw new Error(`a2d2: session "${sessionId}" is a task issue main session and already runs as ceo`)
    }
    const projectRoot = await this.store.projectRoot(cwd)
    await this.sessionAgents.record(projectRoot, sessionId, agent)
    await this.ctx.serial('a2d2/session-agent-recorded', { cwd, projectRoot, session: sessionId, agent })
  }

  /**
   * The A2D2 Agent assigned to one session, if any.
   *
   * Main sessions are CEO by task binding and are never stored in the session
   * Agent ledger; non-main sessions are read from the project-local ledger.
   * @param cwd - absolute session working directory, locating the project.
   * @param sessionId - the session to query.
   * @returns the session Agent, or `undefined` when the session has none.
   */
  async agentOfSession(cwd: string, sessionId: SessionId): Promise<StageAgent | undefined> {
    if (cwd === '') throw new Error('a2d2: the session records no working directory, so no project holds its Agent')
    if (await this.taskOfMainSession(cwd, sessionId) !== undefined) return 'ceo'
    return await this.sessionAgents.agentOf(await this.store.projectRoot(cwd), sessionId)
  }

  /**
   * Dispatch a continuable child subagent from a task's main session.
   * @param request - stage, target task issue, prompt, and parent Agent.
   * @returns the child session id plus the effective model and Agent identity.
   */
  async dispatchSubagent(request: DispatchSubagentRequest): Promise<DispatchedSubagent> {
    const { cwd, issue, parent } = request
    if (cwd === '') {
      throw new Error('a2d2: the dispatching session records no working directory, so no project holds its task')
    }
    taskIdForIssue(issue)
    const task = await this.taskOfMainSession(cwd, parent.id)
    if (task === undefined) {
      throw new Error(`a2d2: session "${parent.id}" is not the main session of a task issue and cannot dispatch subagents`)
    }
    if (!isClosedHighwayStation(request.stage)) throw new Error(`a2d2: unknown stage "${request.stage}"`)
    const settings = this.stageAgents
    const configuredAgent = settings.stages[request.stage]
    const model = await this.selectModelCandidate(
      `stage "${request.stage}" Agent "${configuredAgent}"`,
      modelCandidatesForStage(settings, request.stage),
    )
    const route = splitModelRoute(model)
    const childId = brandString<SessionId>(`session-${randomUUID()}`)
    await this.recordSessionAgent(cwd, childId, configuredAgent)
    const subagents = this.getService<SubagentsRuntime>('subagents')
    if (subagents === undefined) throw new Error('a2d2: subagents service is unavailable')
    const started = await subagents.startContinuable({
      provider: 'spawn',
      label: `${request.stage} #${issue}`,
      childId,
      request: {
        prompt: [{ type: 'text', text: request.prompt }],
        parent,
        agentOptions: { provider: route.provider, model: route.model },
      },
      signal: request.signal,
    })
    return { session: started.childId, model, agent: configuredAgent }
  }

  /**
   * Record one session as a member of a task.
   *
   * Registering the same session twice is a no-op, so a retried handoff cannot
   * duplicate a member or replace the edge recorded by the first attempt.
   * @param cwd - absolute session working directory.
   * @param id - the task receiving the member.
   * @param sessionId - the session joining the task.
   * @param handoffFrom - the member this session was handed off from, when any.
   * @returns the task as persisted after the call.
   */
  async registerMember(
    cwd: string,
    id: TaskId,
    sessionId: SessionId,
    handoffFrom?: SessionId,
  ): Promise<Task> {
    const task = await this.store.read(cwd, id)
    if (task === undefined) throw new Error(`a2d2: task "${id}" does not exist`)
    const extended = withMember(task, sessionId, handoffFrom)
    if (extended !== task) await this.store.write(cwd, extended)
    return extended
  }

  /**
   * Every session handed off from the given one, in document order.
   * @param task - the task holding the edge.
   * @param sessionId - the session the successors were handed off from.
   * @returns the successor session ids.
   */
  successors(task: Task, sessionId: SessionId): readonly SessionId[] {
    return successorsOf(task, sessionId)
  }

  /**
   * Whether a session currently has a handed-off successor.
   *
   * This reports a continuation, never that the session is finished: handing off
   * is not terminal, and the source session stays usable.
   * @param task - the task holding the edge.
   * @param sessionId - the session to test.
   * @returns true when a member records this session as its `handoffFrom`.
   */
  handedOff(task: Task, sessionId: SessionId): boolean {
    return handedOff(task, sessionId)
  }

  /**
   * The member entry naming one session.
   * @param task - the task to search.
   * @param sessionId - the member session.
   * @returns the member entry, or `undefined` when the session is not a member.
   */
  memberOf(task: Task, sessionId: SessionId): ReturnType<typeof memberOf> {
    return memberOf(task, sessionId)
  }

  /**
   * Publish the indicator's inputs to the browser as the `a2d2Indicator`
   * projection.
   *
   * The browser half cannot read this plugin's configuration, cannot see which
   * model the session is routed to, and a number compiled into its bundle would
   * not be configurable per deployment; the ratios, the route's capacity, and its
   * resolved price therefore travel together the way every other client-visible
   * session fact does. The unit is registered on an optional child fiber: a
   * profile without a projection registry keeps the whole plugin and leaves the
   * key absent, which the client reads as the same package defaults this
   * constructor applies.
   */
  private publishIndicator(): void {
    const definition = indicatorProjectionDefinition({
      thresholds: this.thresholds,
      prices: this.prices,
      currency: this.currency,
    })
    this.ctx.inject(['sessionProjections'], projectionCtx => {
      projectionCtx.sessionProjections.register(definition)
    })
  }

  /**
   * The live stage Agent table, validated on every read: the volatile field
   * changes in place when the settings service writes it.
   */
  private get stageAgents(): StageAgentsSettings {
    if (this.stageAgentsConfig === undefined) return DEFAULT_STAGE_AGENTS
    return validateStageAgentsSettings(this.stageAgentsConfig.get())
  }

  private getService<T>(name: string): T | undefined {
    return (this.ctx.get as unknown as (name: string) => T | undefined).call(this.ctx, name)
  }

  private async selectStageModel(stage: string): Promise<string> {
    if (!isClosedHighwayStation(stage)) throw new Error(`a2d2: unknown stage "${stage}"`)
    const settings = this.stageAgents
    const agent = settings.stages[stage]
    return await this.selectModelCandidate(`stage "${stage}" Agent "${agent}"`, modelCandidatesForStage(settings, stage))
  }

  private async selectModelCandidate(subject: string, candidates: readonly string[]): Promise<string> {
    const llm = this.getService<LlmRuntime>('llm')
    if (llm === undefined) throw new Error('a2d2: llm service is unavailable')
    const providers = new Set(llm.listProviders().map(provider => provider.id))
    const modelCache = new Map<string, readonly { readonly id: string }[]>()
    for (const candidate of candidates) {
      const route = splitModelRoute(candidate)
      if (!providers.has(route.provider)) continue
      let models = modelCache.get(route.provider)
      if (models === undefined) {
        try {
          models = await llm.listModels(route.provider)
        } catch {
          models = []
        }
        modelCache.set(route.provider, models)
      }
      if (models.some(model => model.id === route.model)) return candidate
    }
    throw new Error(`a2d2: ${subject} has no model candidate present in the model catalog`)
  }

  /**
   * State the table's warnings once at load, and turn off the generated
   * settings page: the plugin contributes its own A2D2 configuration page.
   */
  private publishStageAgents(): void {
    for (const warning of stageAgentWarnings(this.stageAgents)) this.ctx.logger.warn(warning)
    this.ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(
        () => settingsCtx.settings.configure({ auto: false }, this.entryFiber),
        'a2d2 settings presentation',
      )
    })
  }

  /** Publish the optional Web host's one-shot next-step consultation route, behind DSH browser authentication. */
  private publishConsult(): void {
    this.ctx.inject(['webServer', 'connection'], (routeCtx) => {
      type WebServer = {
        register(route: {
          kind: 'exact'
          path: string
          handler: ReturnType<typeof createConsultHandler>
        }): () => void
      }
      const getService = <T>(name: string): T | undefined => (
        (routeCtx.get as unknown as (name: string) => T | undefined).call(routeCtx, name)
      )
      const server = getService<WebServer>('webServer')
      const connection = getService<RouteConnection>('connection')
      if (server === undefined || connection === undefined) return
      type ProjectionReader = {
        snapshot(session: unknown): { readonly values: Readonly<Record<string, unknown>> }
      }
      const handler = createConsultHandler({
        requestRejection: request => connection.requestRejection(request),
        getSession: id => routeCtx.get('sessions')?.get(id),
        listTasks: cwd => this.store.list(cwd),
        projectRoot: cwd => resolveProjectRoot(cwd, this.projectMarkers),
        readAskMatt: () => readSkillSource('ask-matt', this.skillsRoot),
        getStageAgents: () => this.stageAgents,
        agentOfSession: (cwd, sessionId) => this.agentOfSession(cwd, sessionId),
        contextFacts: (session) => {
          const projections = getService<ProjectionReader>('sessionProjections')
          return consultContextFactsFromProjectionValues(projections?.snapshot(session).values, this.thresholds)
        },
        stream: (options) => {
          const llm = routeCtx.get('llm')
          if (llm === undefined) throw new Error('a2d2 consult: llm service is unavailable')
          return llm.stream(options)
        },
      })
      routeCtx.effect(
        () => server.register({ kind: 'exact', path: CONSULT_ROUTE_PATH, handler }),
        'a2d2 consult route',
      )
    })
  }

  /** Publish the authenticated browser route backing the A2D2 settings page. */
  private publishConfig(): void {
    this.ctx.inject(['webServer', 'connection'], (routeCtx) => {
      type WebServer = {
        register(route: {
          kind: 'exact'
          path: string
          handler: ReturnType<typeof createConfigHandler>
        }): () => void
      }
      type LlmModel = { readonly id: string }
      type LlmProvider = { readonly id: string }
      type LlmRuntime = {
        listProviders(): readonly LlmProvider[]
        listModels(provider: string): Promise<readonly LlmModel[]>
        stream(options: Parameters<Parameters<typeof createConfigHandler>[0]['stream']>[0]): ReturnType<Parameters<typeof createConfigHandler>[0]['stream']>
      }
      // Settings are keyed by the plugin's profile entry id; the form value
      // holds only the volatile Config fields.
      type SettingsRuntime = {
        describe(): readonly { readonly ns: string; readonly value: unknown; readonly revision: number }[]
        replace(ns: string, section: object, expectedRevision?: number): Promise<void>
      }
      const getService = <T>(name: string): T | undefined => (
        (routeCtx.get as unknown as (name: string) => T | undefined).call(routeCtx, name)
      )
      const server = getService<WebServer>('webServer')
      const connection = getService<RouteConnection>('connection')
      if (server === undefined || connection === undefined) return
      // The loader stamps its entry on the fiber (a type merge this plugin does not import).
      const ns = (this.entryFiber as { readonly entry?: { readonly id: string } }).entry?.id
      const readSettings = () => {
        const settings = getService<SettingsRuntime>('settings')
        const descriptor = ns === undefined ? undefined : settings?.describe().find(entry => entry.ns === ns)
        if (descriptor === undefined) return { value: this.stageAgents, revision: undefined }
        return {
          value: validateStageAgentsSettings((descriptor.value as { stageAgents?: unknown }).stageAgents),
          revision: descriptor.revision,
        }
      }
      const handler = createConfigHandler({
        requestRejection: request => connection.requestRejection(request),
        getSettings: readSettings,
        updateSettings: async (value, expectedRevision) => {
          const settings = getService<SettingsRuntime>('settings')
          if (settings === undefined) throw new Error('a2d2: settings service is unavailable')
          if (ns === undefined) throw new Error('a2d2: no profile entry to store settings in')
          await settings.replace(ns, { stageAgents: validateCompleteStageAgentsSettings(value) }, expectedRevision)
          return readSettings()
        },
        modelRoutes: async () => {
          const llm = getService<LlmRuntime>('llm')
          if (llm === undefined) return []
          const routes = await Promise.all(llm.listProviders().map(async provider => {
            try {
              return (await llm.listModels(provider.id)).map(model => `${provider.id}/${model.id}`)
            } catch {
              return []
            }
          }))
          return routes.flat()
        },
        stream: (options) => {
          const llm = getService<LlmRuntime>('llm')
          if (llm === undefined) throw new Error('a2d2: llm service is unavailable')
          return llm.stream(options)
        },
      })
      routeCtx.effect(
        () => server.register({ kind: 'exact', path: CONFIG_ROUTE_PATH, handler }),
        'a2d2 config route',
      )
    })
  }

  /** Publish the authenticated browser route that records a session's A2D2 Agent. */
  private publishSessionAgent(): void {
    this.ctx.inject(['webServer', 'connection'], (routeCtx) => {
      type WebServer = {
        register(route: {
          kind: 'exact'
          path: string
          handler: ReturnType<typeof createSessionAgentHandler>
        }): () => void
      }
      const getService = <T>(name: string): T | undefined => (
        (routeCtx.get as unknown as (name: string) => T | undefined).call(routeCtx, name)
      )
      const server = getService<WebServer>('webServer')
      const connection = getService<RouteConnection>('connection')
      if (server === undefined || connection === undefined) return
      const handler = createSessionAgentHandler({
        requestRejection: request => connection.requestRejection(request),
        getSession: id => routeCtx.get('sessions')?.get(id),
        recordSessionAgent: (cwd, sessionId, agent) => this.recordSessionAgent(cwd, sessionId, agent),
      })
      routeCtx.effect(
        () => server.register({ kind: 'exact', path: SESSION_AGENT_ROUTE_PATH, handler }),
        'a2d2 session Agent route',
      )
    })
  }

  /** Publish the optional Web host's authenticated read route for the A²D² panel. */
  private publishPanel(): void {
    this.ctx.inject(['webServer', 'connection'], (routeCtx) => {
      type WebServer = {
        register(route: {
          kind: 'exact'
          path: string
          handler: ReturnType<typeof createPanelHandler>
        }): () => void
      }
      const getService = <T>(name: string): T | undefined => (
        (routeCtx.get as unknown as (name: string) => T | undefined).call(routeCtx, name)
      )
      const server = getService<WebServer>('webServer')
      const connection = getService<RouteConnection>('connection')
      if (server === undefined || connection === undefined) return
      const handler = createPanelHandler({
        requestRejection: request => connection.requestRejection(request),
        getSession: id => routeCtx.get('sessions')?.get(id),
        listTasks: cwd => this.store.list(cwd),
        projectRoot: cwd => this.store.projectRoot(cwd),
      })
      routeCtx.effect(
        () => server.register({ kind: 'exact', path: PANEL_ROUTE_PATH, handler }),
        'a2d2 panel route',
      )
    })
  }

  /**
   * Push wait notices through the `notifier` service when some plugin provides
   * it (ADR 0010). The dependency is optional: injected by callback, so a
   * profile without a provider starts as before and sends nothing; a static
   * `inject` would hold the whole plugin until a provider appears.
   */
  private publishWaitNotices(): void {
    this.ctx.inject(['notifier'], (notifierCtx) => {
      const notifier = (notifierCtx.get as unknown as (name: string) => Notifier | undefined).call(notifierCtx, 'notifier')
      if (notifier === undefined) return
      const notices = new WaitNotices({
        notifier,
        mainTaskIssue: async (cwd, sessionId) => (await this.taskOfMainSession(cwd, sessionId))?.issue.number,
        issueUrl: async (cwd, issue) => {
          const repo = await repoOfCwd(cwd)
          return repo === undefined ? undefined : `https://github.com/${repo}/issues/${String(issue)}`
        },
        log: this.ctx.logger,
      })
      // `global`: DSH publishes session events through a scope carrier, which
      // admits a listener tagged with this plugin's scope only for its own sessions.
      notifierCtx.on('session/event', (session, event) => notices.observe(session, event), { global: true })
      notifierCtx.effect(() => {
        this.waitNotices = notices
        return () => {
          notices.dispose()
          if (this.waitNotices === notices) this.waitNotices = undefined
        }
      }, 'a2d2 wait notices')
    })
  }

  /**
   * The ratios the indicator applies.
   * @returns the configured thresholds.
   */
  handoffThresholds(): HandoffThresholds {
    return this.thresholds
  }

  /**
   * The configured per-million rates, keyed as the price table declares them.
   * @returns the price table.
   */
  modelPrices(): ReadonlyMap<string, ModelPrice> {
    return this.prices
  }

  /**
   * One task document by id.
   * @param cwd - absolute session working directory.
   * @param id - the task to read.
   * @returns the task, or `undefined` when no document carries that id.
   */
  async readTask(cwd: string, id: TaskId): Promise<Task | undefined> {
    return await this.store.read(cwd, id)
  }

  /**
   * Record a handoff, write the skeleton its document starts from, and render
   * the turn that writes the continuation content.
   *
   * The source session joins the task now; the successor joins when it takes the
   * handoff, because a session that never opens leaves no edge behind and the
   * document stays the only record of the intent. Nothing here writes the
   * continuation content: only the handing-off session holds the conversation,
   * so the caller queues `instruction` as one of that session's own turns, and
   * the document stays unreadable — `unwritten` — until that turn finishes.
   * @param request - the handed-off session, its cwd, focus, and target task.
   * @returns the task, document path, and turn that fills the continuation content in.
   * @throws when the session id is unusable as a filename, the session records no
   *   working directory, or an explicit task does not exist.
   */
  async prepareHandoff(request: PrepareHandoffRequest): Promise<PreparedHandoff> {
    const source = parseSessionId(request.source)
    if (source === undefined) {
      throw new Error(`a2d2: "${request.source}" is not a usable session id`)
    }
    const cwd = request.cwd
    if (cwd === undefined || cwd === '') {
      throw new Error('a2d2: the handed-off session records no working directory, so no project owns its handoff')
    }

    const skillSource = await readSkillSource('handoff', this.skillsRoot)

    const task = request.taskId === undefined
      ? await this.resolveOrCreateTask(cwd, request)
      : await this.existingTask(cwd, request.taskId)
    const registered = await this.registerMember(cwd, task.id, source)
    const preparedTask = registered.issue?.mainSession === source
      ? { ...registered, issue: { ...registered.issue, handoff: { source } } }
      : registered
    if (preparedTask !== registered) await this.store.write(cwd, preparedTask)
    const facts: HandoffFacts = {
      source,
      task: preparedTask.id,
      createdAt: request.now.toISOString(),
      focus: request.focus,
      ...(skillSource.status === 'missing' ? { skillSource: 'unavailable' as const } : {}),
    }
    const directory = handoffsDirectory(await this.store.projectRoot(cwd))
    const path = await writeHandoffDocument(
      directory,
      source,
      renderHandoffSkeleton(facts),
    )
    return { task: preparedTask, source, path, instruction: handoffInstruction(path, request.focus, skillSource) }
  }

  /**
   * Continue from a handoff: join the successor to the task and render its prompt.
   *
   * The task comes from the handed-off session's own membership rather than from
   * the caller, because the session taking a handoff knows which session it
   * continues and nothing else about it. The summary passes the plugin's own
   * redaction pass on the way into the prompt, and the document is rewritten when
   * that pass changed anything, so the committed file and the successor's prompt
   * never disagree about what was carried and no recognized secret is left in
   * either.
   *
   * Registering the same successor twice is a no-op, so a retried take neither
   * duplicates the member nor replaces the edge.
   * @param request - the handed-off session, the successor, and the successor's cwd.
   * @returns the task, the document, and the prompt the successor receives.
   * @throws HandoffDocumentError when the document is missing or invalid, when its
   *   summary is not written yet, and when the session belongs to no task.
   */
  async takeHandoff(request: TakeHandoffRequest): Promise<TakenHandoff> {
    const task = await this.taskOf(request.cwd, request.source)
    const directory = handoffsDirectory(await this.store.projectRoot(request.cwd))
    const parsed = parseHandoffDocument(
      await readHandoffDocument(directory, request.source),
      request.source,
    )
    const redacted = redactText(parsed.body)
    const document: HandoffDocument = redacted.count === 0 ? parsed : { ...parsed, body: redacted.text }
    if (redacted.count > 0) {
      await writeHandoffDocument(directory, request.source, renderHandoffDocument(document))
    }
    const registered = await this.registerMember(
      request.cwd,
      task.id,
      request.successor,
      request.source,
    )
    const issue = registered.issue
    const takenTask = issue?.mainSession === request.source && issue.handoff?.source === request.source
      ? { ...registered, issue: { ...issue, mainSession: request.successor, handoff: undefined } }
      : registered
    if (takenTask !== registered) {
      await this.store.write(request.cwd, takenTask)
      if (takenTask.issue !== undefined) {
        await this.emitMainSessionChanged(request.cwd, takenTask.issue.number, request.successor, request.source)
      }
    }
    return { task: takenTask, document, prompt: handoffPrompt(document) }
  }

  /**
   * The task one session belongs to, in this project.
   *
   * A session may belong to more than one task, so this picks by the rule
   * {@link A2d2Service.resolve} uses — newest active membership first — and a
   * session in no task is a loud failure rather than an empty handoff.
   * @param cwd - absolute session working directory.
   * @param sessionId - the session to place.
   * @returns the task holding the session as a member.
   */
  private async taskOf(cwd: string, sessionId: SessionId): Promise<Task> {
    const memberships = (await this.store.list(cwd))
      .filter(task => memberOf(task, sessionId) !== undefined)
    const active = memberships.filter(task => task.state === 'active')
    const candidates = active.length > 0 ? active : memberships
    const found = candidates.reduce<Task | undefined>(
      (newest, task) => (newest === undefined || task.createdAt > newest.createdAt ? task : newest),
      undefined,
    )
    if (found === undefined) {
      throw new Error(
        `a2d2: session "${sessionId}" belongs to no task in this project, so it has no handoff to take`,
      )
    }
    return found
  }

  /** Notify optional integrations that a task issue's main session is now this session. */
  private async emitMainSessionChanged(
    cwd: string,
    issue: number,
    mainSession: SessionId,
    previousMainSession?: SessionId,
  ): Promise<void> {
    this.ctx.emit('a2d2/main-session-changed', {
      cwd,
      projectRoot: await this.store.projectRoot(cwd),
      issue,
      ...(previousMainSession === undefined ? {} : { previousMainSession }),
      mainSession,
    })
  }

  /** The named task, or a loud failure naming it. */
  private async existingTask(cwd: string, id: TaskId): Promise<Task> {
    const task = await this.store.read(cwd, id)
    if (task === undefined) throw new Error(`a2d2: task "${id}" does not exist`)
    return task
  }

  /**
   * The task a handoff joins, creating the project's first one when it has none.
   *
   * A handoff writes a document versioned with the project, so it needs a task to
   * belong to; requiring a person to create that file by hand first would make
   * the command unusable until they did, and the task it creates is the same file
   * they would have written.
   */
  private async resolveOrCreateTask(cwd: string, request: PrepareHandoffRequest): Promise<Task> {
    const resolved = await this.resolve(cwd)
    if (resolved !== undefined) return resolved
    return await this.create(cwd, { name: request.focus ?? basename(cwd) })
  }
}

export default A2d2Service
