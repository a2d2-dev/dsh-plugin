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

import { basename, isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Fiber, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TaskId } from './brand.ts'
import { CONFIG_ROUTE_PATH, createConfigHandler } from './config-page.ts'
import { CONSULT_ROUTE_PATH, consultContextFactsFromProjectionValues, createConsultHandler } from './consult.ts'
import { handedOff, memberOf, successorsOf } from './derive.ts'
import type { HandoffDocument, HandoffFacts } from './handoff-document.ts'
import {
  parseHandoffDocument,
  renderHandoffDocument,
  renderHandoffSkeleton,
} from './handoff-document.ts'
import { handoffInstruction } from './handoff-instruction.ts'
import { handoffPrompt } from './handoff-prompt.ts'
import { indicatorProjectionDefinition } from './indicator-projection.ts'
import type { HandoffThresholds, ModelPrice } from './indicator-projection.ts'
import { PANEL_ROUTE_PATH, createPanelHandler } from './panel.ts'
import { parseSessionId, redactText } from './handoff.ts'
import { DEFAULT_SKILLS_ROOT, readSkillSource, resolveSkillsRoot } from './skill-source.ts'
import {
  DEFAULT_STATION_MODELS,
  STATION_MODEL_SETTINGS_NAMESPACE,
  StationModelsSettingsSchema,
  stationModelWarnings,
  validateStationModelsSettings,
} from './station-models.ts'
import type { StationModelsSettings } from './station-models.ts'
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
import type { CreateTaskRequest, Task } from './types.ts'

export { TaskId } from './brand.ts'
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
  isTrustedConsultRequest,
  loadOrchestratorSkill,
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
  ConsultValue,
  OrchestratorSkill,
} from './consult.ts'
export {
  CODING_MODEL_ROUTES,
  DEFAULT_STATION_MODELS,
  STATION_MODEL_SETTINGS_NAMESPACE,
  STATION_MODEL_STATIONS,
  StationModelsSettingsSchema,
  THINKING_MODEL_ROUTES,
  shortModelRoute,
  splitModelRoute,
  stationModelWarnings,
  validateStationModelsSettings,
} from './station-models.ts'
export type { Station, StationModelsSettings } from './station-models.ts'
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
} from './panel.ts'
export {
  TASK_DOCUMENT_VERSION,
  TaskDocumentError,
  parseTaskDocument,
  renderTaskDocument,
  taskIdFromFilename,
} from './document.ts'
export type { TaskDocumentErrorCode } from './document.ts'
export type { CreateTaskRequest, Task, TaskMember, TaskState } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    a2d2: A2d2Service
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
   * Model routes per highway station and for the next-step consult. A volatile
   * field: edits through the settings service apply without a reload. Absent
   * only where no loader composes the plugin (tests), which reads the defaults.
   */
  stationModels?: Volatile<StationModelsSettings>
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
    stationModels: StationModelsSettingsSchema.volatile(),
  }) as z<Config>

  private readonly store: TaskDocumentStore
  private readonly projectMarkers: readonly string[]
  private readonly skillsRoot: string
  private readonly thresholds: HandoffThresholds
  private readonly prices: ReadonlyMap<string, ModelPrice>
  private readonly currency: string
  private readonly stationModelsConfig: Volatile<StationModelsSettings> | undefined
  private readonly entryFiber: Fiber

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
    this.projectMarkers = [...projectMarkers]
    this.prices = new Map(Object.entries(config.modelPrices ?? {}))
    for (const [route, price] of this.prices) {
      if (!Number.isFinite(price.inputPerMillion) || price.inputPerMillion < 0
        || !Number.isFinite(price.outputPerMillion) || price.outputPerMillion < 0) {
        throw new Error(`a2d2: modelPrices["${route}"] must carry non-negative finite rates`)
      }
    }
    this.currency = config.currency ?? DEFAULT_CURRENCY
    this.stationModelsConfig = config.stationModels
    this.entryFiber = ctx.fiber
    this.publishStationModels()
    this.publishIndicator()
    this.publishConsult()
    this.publishConfig()
    this.publishPanel()
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
   * The live station model table, validated on every read: the volatile field
   * changes in place when the settings service writes it.
   */
  private get stationModels(): StationModelsSettings {
    if (this.stationModelsConfig === undefined) return DEFAULT_STATION_MODELS
    return validateStationModelsSettings(this.stationModelsConfig.get())
  }

  /**
   * State the table's warnings once at load, and turn off the generated
   * settings page: the plugin contributes its own station model page.
   */
  private publishStationModels(): void {
    for (const warning of stationModelWarnings(this.stationModels)) this.ctx.logger.warn(warning)
    this.ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(
        () => settingsCtx.settings.configure({ auto: false }, this.entryFiber),
        'a2d2 settings presentation',
      )
    })
  }

  /** Publish the optional Web host's one-shot next-step consultation route. */
  private publishConsult(): void {
    this.ctx.inject(['webServer'], (routeCtx) => {
      type WebServer = {
        register(route: {
          kind: 'exact'
          path: string
          handler: ReturnType<typeof createConsultHandler>
        }): () => void
      }
      type WebRuntime = { readonly trustedHosts: readonly string[] }
      const getService = <T>(name: string): T | undefined => (
        (routeCtx.get as unknown as (name: string) => T | undefined).call(routeCtx, name)
      )
      const server = getService<WebServer>('webServer')
      if (server === undefined) return
      type ProjectionReader = {
        snapshot(session: unknown): { readonly values: Readonly<Record<string, unknown>> }
      }
      const handler = createConsultHandler({
        trustedHosts: () => getService<WebRuntime>('webRuntime')?.trustedHosts ?? [],
        getSession: id => routeCtx.get('sessions')?.get(id),
        listTasks: cwd => this.store.list(cwd),
        projectRoot: cwd => resolveProjectRoot(cwd, this.projectMarkers),
        readAskMatt: () => readSkillSource('ask-matt', this.skillsRoot),
        readOrchestrator: async () => {
          const current = await readSkillSource('a2d2-orchestrator', this.skillsRoot)
          return current.status === 'loaded'
            ? current
            : await readSkillSource('ceo-team', this.skillsRoot)
        },
        getStationModels: () => this.stationModels,
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

  /** Publish the trusted browser route backing the A2D2 settings page. */
  private publishConfig(): void {
    this.ctx.inject(['webServer'], (routeCtx) => {
      type WebServer = {
        register(route: {
          kind: 'exact'
          path: string
          handler: ReturnType<typeof createConfigHandler>
        }): () => void
      }
      type WebRuntime = { readonly trustedHosts: readonly string[] }
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
      if (server === undefined) return
      // The loader stamps its entry on the fiber (a type merge this plugin does not import).
      const ns = (this.entryFiber as { readonly entry?: { readonly id: string } }).entry?.id
      const readSettings = () => {
        const settings = getService<SettingsRuntime>('settings')
        const descriptor = ns === undefined ? undefined : settings?.describe().find(entry => entry.ns === ns)
        if (descriptor === undefined) return { value: this.stationModels, revision: undefined }
        return {
          value: validateStationModelsSettings((descriptor.value as { stationModels?: unknown }).stationModels),
          revision: descriptor.revision,
        }
      }
      const handler = createConfigHandler({
        trustedHosts: () => getService<WebRuntime>('webRuntime')?.trustedHosts ?? [],
        getSettings: readSettings,
        updateSettings: async (value, expectedRevision) => {
          const settings = getService<SettingsRuntime>('settings')
          if (settings === undefined) throw new Error('a2d2: settings service is unavailable')
          if (ns === undefined) throw new Error('a2d2: no profile entry to store settings in')
          await settings.replace(ns, { stationModels: validateStationModelsSettings(value) }, expectedRevision)
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

  /** Publish the optional Web host's trusted read route for the A²D² panel. */
  private publishPanel(): void {
    this.ctx.inject(['webServer'], (routeCtx) => {
      type WebServer = {
        register(route: {
          kind: 'exact'
          path: string
          handler: ReturnType<typeof createPanelHandler>
        }): () => void
      }
      type WebRuntime = { readonly trustedHosts: readonly string[] }
      const getService = <T>(name: string): T | undefined => (
        (routeCtx.get as unknown as (name: string) => T | undefined).call(routeCtx, name)
      )
      const server = getService<WebServer>('webServer')
      if (server === undefined) return
      const handler = createPanelHandler({
        trustedHosts: () => getService<WebRuntime>('webRuntime')?.trustedHosts ?? [],
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
    const facts: HandoffFacts = {
      source,
      task: registered.id,
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
    return { task: registered, source, path, instruction: handoffInstruction(path, request.focus, skillSource) }
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
    return { task: registered, document, prompt: handoffPrompt(document) }
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
