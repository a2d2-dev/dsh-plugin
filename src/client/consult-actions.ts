/**
 * Client-side next-step consultation and candidate selection.
 *
 * Network, composer, and card capabilities are injected so this module stays
 * independent of React and cannot send a session command when a chip is picked.
 *
 * @module @deepseek-ai/dsh-a2d2/client/consult-actions
 */

import {
  isClosedHighwayStation,
  isHighwayZone,
  isMainStation,
  isMove,
  isRampStation,
  isRoadbedStation,
  isServiceStation,
} from '../highway.ts'
import type { HighwayZone, MainStation, Move } from '../highway.ts'
import type { StageAgent, StageAgentRouteSettings } from '../stage-agent-data.ts'
import {
  STAGE_AGENTS,
  STAGE_AGENT_STAGES,
  agentForStage,
  stageAgentLabel,
} from '../stage-agent-data.ts'
import type { FailureKind } from '../refusal.ts'
import type { ClientSessionsService, ClientWorkspaceNavigation, ClientWorkspacesService } from './context.ts'

/** Exact host route used for next-step consultation. */
export const CONSULT_ROUTE_PATH = '/a2d2/api/consult'

/** One candidate returned by the host consultation route. */
export interface ConsultCandidate {
  readonly label: string
  readonly input: string
  readonly move: Move
  readonly station?: string
}

export interface ConsultFallback {
  readonly route: string
  readonly kind?: FailureKind
  readonly reason: string
}

export interface ConsultLocation {
  readonly zone: HighwayZone
  readonly station?: string
  readonly returnTo?: MainStation
  readonly phaseDone: boolean
}

export interface ConsultNext {
  readonly station: string
  readonly move: Move
  readonly reason: string
}

export type ConsultPreconditionId = 'context' | 'issue-tracker'

export interface ConsultPreconditionMissing {
  readonly id: ConsultPreconditionId
  readonly label: string
  readonly paths: readonly string[]
}

export interface ConsultPreconditions {
  readonly missing: readonly ConsultPreconditionMissing[]
}

export interface ClientModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface ClientModelProviderGroup {
  readonly id: string
  readonly models: readonly { readonly id: string }[]
}

export interface ClientModelDirectorySnapshot {
  readonly current: ClientModelSelection
  readonly groups?: readonly ClientModelProviderGroup[]
  readonly catalog?: readonly string[]
}

export interface ClientModelDirectoryStoreSnapshot {
  readonly current: ClientModelSelection | null
  readonly groups?: readonly ClientModelProviderGroup[]
  readonly catalog?: readonly string[]
}

export interface ClientModelDirectory {
  readonly store?: {
    getSnapshot(): ClientModelDirectoryStoreSnapshot
    subscribe(listener: () => void): () => void
  }
  load(): Promise<ClientModelDirectorySnapshot>
  /** Resolves `{ ok: false, error }` for a refused selection (DSH 0.2) rather than rejecting; see {@link selectModel}. */
  select(selection: ClientModelSelection): Promise<unknown>
}

/**
 * Select a model and fail loudly: DSH 0.2 resolves a refused selection as a
 * `{ ok: false, error }` result instead of rejecting, which an `await` alone
 * would read as success.
 * @param face - the session's model directory.
 * @param selection - the route to select.
 */
export async function selectModel(face: ClientModelDirectory, selection: ClientModelSelection): Promise<void> {
  const result = await face.select(selection)
  if (result === null || typeof result !== 'object' || (result as { readonly ok?: unknown }).ok !== false) return
  const message = (result as { readonly error?: { readonly message?: unknown } }).error?.message
  throw new Error(typeof message === 'string' ? message : 'the model selection was refused')
}

export interface ClientModelDirectoryService {
  directoryFor(sessionId: string): ClientModelDirectory
}

/** The complete state of the next-step card. */
export type ConsultPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready'
      /** Where the work stands, shown above the chips; absent from an older host. */
      readonly position?: string
      readonly location?: ConsultLocation
      readonly next?: ConsultNext
      readonly candidates: readonly ConsultCandidate[]
      readonly degraded: boolean
      readonly answeredBy?: string
      readonly fallbacks?: readonly ConsultFallback[]
      readonly stageAgents?: StageAgentRouteSettings
      readonly sessionAgent?: StageAgent
      readonly preconditions?: ConsultPreconditions
    }
  | { readonly kind: 'error'; readonly message: string }

/** The small response face needed from an injected fetch implementation. */
export interface ConsultFetchResponse {
  json(): Promise<unknown>
}

/** Capabilities needed to run one consultation. */
export interface ConsultRequestDeps {
  readonly fetch: (
    input: string,
    init: { readonly method: 'POST' },
  ) => Promise<ConsultFetchResponse>
  readonly setPhase: (phase: ConsultPhase) => void
}

/** Capabilities a chip may invoke. Deliberately excludes session commands. */
export interface ConsultSelectionDeps {
  readonly appendToDraft: (input: string, sessionId?: string) => boolean
  readonly focusComposer: () => void
  readonly closeConsult: () => void
  readonly openHandoff: (focus: string, target?: ConsultNewSessionModelTarget) => void
  readonly sessions?: ClientSessionsService
  readonly workspaces?: ClientWorkspacesService
  /** `uiWorkspace`: creates the successor session and shows it. */
  readonly navigation?: ClientWorkspaceNavigation
  readonly modelDirectories?: ClientModelDirectoryService
  /** Records a session a chip created as an Agent; see {@link sessionAgentRegistrar}. */
  readonly registerSessionAgent?: RegisterSessionAgent
  readonly notify?: (message: string) => void
}

/** Exact host route that records the Agent of a session a chip created. */
export const SESSION_AGENT_ROUTE_PATH = '/a2d2/api/session-agent'

/** Record one session as an Agent; rejects with the host's reason. */
export type RegisterSessionAgent = (sessionId: string, agent: StageAgent) => Promise<void>

/** The fetch face the registrar needs. */
export type SessionAgentFetch = (
  input: string,
  init: { readonly method: 'POST'; readonly headers: Record<string, string>; readonly body: string },
) => Promise<ConsultFetchResponse>

/** Build the capability that records a chip-created session's Agent through the host route. */
export function sessionAgentRegistrar(fetch: SessionAgentFetch): RegisterSessionAgent {
  return async (sessionId, agent) => {
    const response = await fetch(SESSION_AGENT_ROUTE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: sessionId, agent }),
    })
    const body: unknown = await response.json()
    if (isRecord(body) && body.ok === true) return
    if (isRecord(body) && body.ok === false && isRecord(body.error) && typeof body.error.message === 'string') {
      throw new Error(body.error.message)
    }
    throw new Error('登记会话 Agent 返回了无效响应')
  }
}

export interface ConsultSelectionContext {
  readonly sessionId?: string
  readonly phase?: ConsultPhase
}

export interface ConsultNewSessionModelTarget {
  readonly station?: string
  readonly stageAgents?: StageAgentRouteSettings
}

export type OtherMove = Exclude<Move, 'continue'>

export interface OtherMoveOption {
  readonly move: OtherMove
  readonly label: string
  readonly hint: string
}

const COMPACT_FOCUS_PREFIX = '保留什么：'

const OTHER_MOVE_INPUTS: Readonly<Record<Exclude<OtherMove, 'compact' | 'handoff'>, string>> = {
  clear: '开空会话继续：',
  subagent: '派子代理处理：',
}

export const OTHER_MOVE_OPTIONS: readonly OtherMoveOption[] = [
  { move: 'clear', label: '新会话', hint: '开一条空会话承接下一步' },
  { move: 'subagent', label: '子代理', hint: '把一段独立工作交给子代理' },
  { move: 'compact', label: '压缩', hint: '先保留关键状态，再用交接序列开新会话' },
  { move: 'handoff', label: '交接', hint: '打开交接卡，填写 focus 后确认' },
]

type ConsultResponse =
  | {
      readonly ok: true
      readonly value: {
        readonly position?: string
        readonly location?: ConsultLocation
        readonly next?: ConsultNext
        readonly candidates: readonly ConsultCandidate[]
        readonly degraded: boolean
        readonly answeredBy?: string
        readonly fallbacks?: readonly ConsultFallback[]
        readonly stageAgents?: StageAgentRouteSettings
        readonly sessionAgent?: StageAgent
        readonly preconditions?: ConsultPreconditions
      }
    }
  | {
      readonly ok: false
      readonly error: { readonly code: string; readonly message: string }
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const LEGACY_KIND_MOVES = {
  stay: 'continue',
  handoff: 'handoff',
  other: 'continue',
} as const

const STANDALONE_STATION_PATTERN = /^[a-z0-9][a-z0-9-]*$/u

function parseMove(value: unknown, legacyKind?: unknown): Move | undefined {
  if (typeof value === 'string') return isMove(value) ? value : undefined
  if (typeof legacyKind === 'string' && legacyKind in LEGACY_KIND_MOVES) {
    return LEGACY_KIND_MOVES[legacyKind as keyof typeof LEGACY_KIND_MOVES]
  }
  return undefined
}

function parseStationId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const station = value.trim()
  if (station === '') return undefined
  const lowercase = station.toLowerCase()
  if (lowercase !== station && isClosedHighwayStation(lowercase)) return undefined
  if (isClosedHighwayStation(station)) return station
  if (!STANDALONE_STATION_PATTERN.test(station) || Object.prototype.hasOwnProperty.call(Object.prototype, station)) return undefined
  return station
}

function parseCandidate(value: unknown): ConsultCandidate | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.label !== 'string' || value.label.trim() === '') return undefined
  if (typeof value.input !== 'string' || value.input.trim() === '') return undefined
  const move = parseMove(value.move, value.kind)
  if (move === undefined) return undefined
  const station = value.station === undefined ? undefined : parseStationId(value.station)
  if (value.station !== undefined && station === undefined) return undefined
  return {
    label: value.label,
    input: value.input,
    move,
    ...(station === undefined ? {} : { station }),
  }
}

function parseLocation(value: unknown): ConsultLocation | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return undefined
  if (typeof value.zone !== 'string' || !isHighwayZone(value.zone)) return undefined
  if (typeof value.phaseDone !== 'boolean') return undefined
  const station = value.station
  const returnTo = value.returnTo
  const parsedStation = station === undefined ? undefined : parseStationId(station)
  if (returnTo !== undefined && (typeof returnTo !== 'string' || !isMainStation(returnTo))) return undefined
  switch (value.zone) {
    case 'main':
      if (parsedStation === undefined || !isMainStation(parsedStation) || returnTo !== undefined) return undefined
      break
    case 'service':
      if (parsedStation === undefined || !isServiceStation(parsedStation) || returnTo === undefined) return undefined
      break
    case 'ramp':
      if (parsedStation === undefined || !isRampStation(parsedStation) || returnTo !== undefined) return undefined
      break
    case 'standalone':
      if (parsedStation === undefined || isClosedHighwayStation(parsedStation) || returnTo !== undefined) return undefined
      break
    case 'roadbed':
      if (parsedStation === undefined || !isRoadbedStation(parsedStation) || returnTo !== undefined) return undefined
      break
    case 'off-road':
      if (station !== undefined || returnTo !== undefined) return undefined
      break
  }
  return {
    zone: value.zone,
    ...(parsedStation === undefined ? {} : { station: parsedStation }),
    ...(returnTo === undefined ? {} : { returnTo }),
    phaseDone: value.phaseDone,
  }
}

function parseNext(value: unknown): ConsultNext | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return undefined
  const station = parseStationId(value.station)
  if (station === undefined) return undefined
  if (typeof value.move !== 'string' || !isMove(value.move)) return undefined
  if (typeof value.reason !== 'string' || value.reason.trim() === '') return undefined
  return { station, move: value.move, reason: value.reason.trim() }
}

function parseFallback(value: unknown): ConsultFallback | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.route !== 'string' || value.route.trim() === '') return undefined
  if (typeof value.reason !== 'string' || value.reason.trim() === '') return undefined
  if (value.kind !== undefined
    && value.kind !== 'refusal'
    && value.kind !== 'rate-limited'
    && value.kind !== 'empty'
    && value.kind !== 'error') return undefined
  return {
    route: value.route,
    ...(value.kind === undefined ? {} : { kind: value.kind }),
    reason: value.reason,
  }
}

const STAGE_AGENT_SET = new Set<string>(STAGE_AGENTS)
const STAGE_AGENT_STAGE_SET = new Set<string>(STAGE_AGENT_STAGES)

function isStageAgent(value: unknown): value is StageAgent {
  return typeof value === 'string' && STAGE_AGENT_SET.has(value)
}

function parseRouteList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.some(route => typeof route !== 'string' || route.trim() === '')) return undefined
  return value.map(route => route.trim())
}

function parseStageAgents(value: unknown): StageAgentRouteSettings | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || !isRecord(value.stages) || !isRecord(value.agents)) return undefined
  if (Object.keys(value.stages).some(stage => !STAGE_AGENT_STAGE_SET.has(stage))) return undefined
  if (Object.keys(value.agents).some(agent => !STAGE_AGENT_SET.has(agent))) return undefined

  const stages: Partial<Record<(typeof STAGE_AGENT_STAGES)[number], StageAgent>> = {}
  for (const stage of STAGE_AGENT_STAGES) {
    const agent = value.stages[stage]
    if (!isStageAgent(agent)) return undefined
    stages[stage] = agent
  }

  const agents: Partial<Record<StageAgent, readonly string[]>> = {}
  for (const agent of STAGE_AGENTS) {
    const routes = parseRouteList(value.agents[agent])
    if (routes === undefined) return undefined
    agents[agent] = routes
  }
  return { stages: stages as Record<(typeof STAGE_AGENT_STAGES)[number], StageAgent>, agents: agents as Record<StageAgent, readonly string[]> }
}

function parsePreconditionMissing(value: unknown): ConsultPreconditionMissing | undefined {
  if (!isRecord(value)) return undefined
  if (value.id !== 'context' && value.id !== 'issue-tracker') return undefined
  if (typeof value.label !== 'string' || value.label.trim() === '') return undefined
  if (!Array.isArray(value.paths) || value.paths.length === 0) return undefined
  if (value.paths.some(path => typeof path !== 'string' || path.trim() === '')) return undefined
  return {
    id: value.id,
    label: value.label.trim(),
    paths: value.paths.map(path => path.trim()),
  }
}

function parsePreconditions(value: unknown): ConsultPreconditions | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || !Array.isArray(value.missing)) return undefined
  const missing = value.missing.map(parsePreconditionMissing)
  if (missing.some(item => item === undefined)) return undefined
  return { missing: missing as ConsultPreconditionMissing[] }
}

/** Parse the route's discriminated response before it reaches rendering state. */
export function parseConsultResponse(value: unknown): ConsultResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error('下一步咨询返回了无效响应')
  }
  if (!value.ok) {
    if (!isRecord(value.error) || typeof value.error.code !== 'string' || typeof value.error.message !== 'string') {
      throw new Error('下一步咨询返回了无效响应')
    }
    return { ok: false, error: { code: value.error.code, message: value.error.message } }
  }
  if (!isRecord(value.value) || !Array.isArray(value.value.candidates) || typeof value.value.degraded !== 'boolean') {
    throw new Error('下一步咨询返回了无效响应')
  }
  const position = value.value.position
  if (position !== undefined && typeof position !== 'string') {
    throw new Error('下一步咨询返回了无效响应')
  }
  const location = parseLocation(value.value.location)
  if (value.value.location !== undefined && location === undefined) {
    throw new Error('下一步咨询返回了无效响应')
  }
  const next = parseNext(value.value.next)
  if (value.value.next !== undefined && next === undefined) {
    throw new Error('下一步咨询返回了无效响应')
  }
  const answeredBy = value.value.answeredBy
  if (answeredBy !== undefined && (typeof answeredBy !== 'string' || answeredBy.trim() === '')) {
    throw new Error('下一步咨询返回了无效响应')
  }
  const fallbacks = value.value.fallbacks
  if (fallbacks !== undefined && !Array.isArray(fallbacks)) {
    throw new Error('下一步咨询返回了无效响应')
  }
  const parsedFallbacks = fallbacks?.map(parseFallback)
  if (parsedFallbacks?.some(fallback => fallback === undefined)) {
    throw new Error('下一步咨询返回了无效响应')
  }
  const stageAgents = parseStageAgents(value.value.stageAgents)
  if (value.value.stageAgents !== undefined && stageAgents === undefined) {
    throw new Error('下一步咨询返回了无效响应')
  }
  const sessionAgent = value.value.sessionAgent
  if (sessionAgent !== undefined && !isStageAgent(sessionAgent)) {
    throw new Error('下一步咨询返回了无效响应')
  }
  const preconditions = parsePreconditions(value.value.preconditions)
  if (value.value.preconditions !== undefined && preconditions === undefined) {
    throw new Error('下一步咨询返回了无效响应')
  }
  const candidates = value.value.candidates.map(parseCandidate)
  if (candidates.some(candidate => candidate === undefined)) {
    throw new Error('下一步咨询返回了无效响应')
  }
  return {
    ok: true,
    value: {
      ...(position === undefined || position.trim() === '' ? {} : { position: position.trim() }),
      ...(location === undefined ? {} : { location }),
      ...(next === undefined ? {} : { next }),
      candidates: candidates as ConsultCandidate[],
      degraded: value.value.degraded,
      ...(answeredBy === undefined ? {} : { answeredBy: answeredBy.trim() }),
      ...(parsedFallbacks === undefined ? {} : { fallbacks: parsedFallbacks as ConsultFallback[] }),
      ...(stageAgents === undefined ? {} : { stageAgents }),
      ...(sessionAgent === undefined ? {} : { sessionAgent }),
      ...(preconditions === undefined ? {} : { preconditions }),
    },
  }
}

/** Fetch one fresh candidate set, replacing every prior card state. */
export async function requestConsult(deps: ConsultRequestDeps, sessionId: string): Promise<void> {
  deps.setPhase({ kind: 'loading' })
  try {
    const response = await deps.fetch(
      `${CONSULT_ROUTE_PATH}?session=${encodeURIComponent(sessionId)}`,
      { method: 'POST' },
    )
    const result = parseConsultResponse(await response.json())
    if (!result.ok) {
      deps.setPhase({ kind: 'error', message: result.error.message })
      return
    }
    deps.setPhase({
      kind: 'ready',
      ...(result.value.position === undefined ? {} : { position: result.value.position }),
      ...(result.value.location === undefined ? {} : { location: result.value.location }),
      ...(result.value.next === undefined ? {} : { next: result.value.next }),
      candidates: result.value.candidates,
      degraded: result.value.degraded,
      ...(result.value.answeredBy === undefined ? {} : { answeredBy: result.value.answeredBy }),
      ...(result.value.fallbacks === undefined ? {} : { fallbacks: result.value.fallbacks }),
      ...(result.value.stageAgents === undefined ? {} : { stageAgents: result.value.stageAgents }),
      ...(result.value.sessionAgent === undefined ? {} : { sessionAgent: result.value.sessionAgent }),
      ...(result.value.preconditions === undefined ? {} : { preconditions: result.value.preconditions }),
    })
  } catch (error) {
    deps.setPhase({
      kind: 'error',
      message: error instanceof Error ? error.message : '下一步咨询失败',
    })
  }
}

function shortRoute(route: string): string {
  const slash = route.indexOf('/')
  return slash < 0 ? route : route.slice(slash + 1)
}

function splitRoute(route: string): ClientModelSelection {
  const slash = route.indexOf('/')
  return { provider: route.slice(0, slash), model: route.slice(slash + 1) }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** An Agent's usable model: its first candidate present in the session catalog. */
function firstAvailableRoute(routes: readonly string[], catalog: readonly string[]): string | undefined {
  return routes.find(route => catalog.includes(route))
}

function displayReason(reason: string, kind?: FailureKind): string {
  if (kind === 'refusal') return '拒答'
  if (kind === 'rate-limited') return '限流'
  if (kind === 'empty') return '空输出'
  return /refus/u.test(reason) || /拒/u.test(reason)
    ? '拒答'
    : reason
}

export function consultAttributionLine(phase: ConsultPhase): string | undefined {
  if (phase.kind !== 'ready' || phase.answeredBy === undefined) return undefined
  const answered = shortRoute(phase.answeredBy)
  const fallback = phase.fallbacks?.[0]
  if (fallback === undefined) return `由 ${answered} 生成`
  return `由 ${answered} 生成（${shortRoute(fallback.route)} ${displayReason(fallback.reason, fallback.kind)}，改用 ${answered}）`
}

export function modelCatalogRoutes(directory: ClientModelDirectorySnapshot | undefined): readonly string[] {
  if (directory === undefined) return []
  if (directory.catalog !== undefined) return directory.catalog
  return directory.groups?.flatMap(group => group.models.map(model => `${group.id}/${model.id}`)) ?? []
}

export function candidateStation(candidate: ConsultCandidate, phase: ConsultPhase | undefined): string | undefined {
  if (candidate.station !== undefined) return candidate.station
  return phase?.kind === 'ready' ? phase.next?.station : undefined
}

/** The Agent a chip prepares for, with that Agent's ordered model candidates. */
export interface ChipAgentTarget {
  readonly agent: StageAgent
  /** The Agent's display name, e.g. 工程师. */
  readonly label: string
  readonly routes: readonly string[]
}

/**
 * The Agent of a chip's target station: the stage Agent table decides every
 * closed station, and any standalone skill runs as CEO.
 * @returns `undefined` when no station is known or the host sent no table.
 */
export function chipAgentTarget(
  station: string | undefined,
  stageAgents: StageAgentRouteSettings | undefined,
): ChipAgentTarget | undefined {
  if (station === undefined || stageAgents === undefined) return undefined
  const agent: StageAgent = isClosedHighwayStation(station) ? agentForStage(stageAgents, station) : 'ceo'
  return { agent, label: stageAgentLabel(agent), routes: stageAgents.agents[agent] }
}

function stageAgentsOf(phase: ConsultPhase | undefined): StageAgentRouteSettings | undefined {
  return phase?.kind === 'ready' ? phase.stageAgents : undefined
}

function newSessionModelTarget(
  candidate: ConsultCandidate,
  phase: ConsultPhase | undefined,
): ConsultNewSessionModelTarget | undefined {
  const station = candidateStation(candidate, phase)
  if (phase?.kind !== 'ready') return station === undefined ? undefined : { station }
  const target = {
    ...(station === undefined ? {} : { station }),
    ...(phase.stageAgents === undefined ? {} : { stageAgents: phase.stageAgents }),
  }
  return target.station === undefined && target.stageAgents === undefined ? undefined : target
}

function noModelLabel(agent: ChipAgentTarget): string {
  return `${agent.label}无可用模型`
}

function newSessionEffectLabel(
  candidate: ConsultCandidate,
  phase: ConsultPhase | undefined,
  directory: ClientModelDirectorySnapshot | undefined,
): string {
  const agent = chipAgentTarget(candidateStation(candidate, phase), stageAgentsOf(phase))
  if (agent === undefined) return '新会话 · 默认模型'
  if (directory === undefined) return `新会话 · ${agent.label}`
  const route = firstAvailableRoute(agent.routes, modelCatalogRoutes(directory))
  return route === undefined ? noModelLabel(agent) : `新会话 · ${agent.label}（${shortRoute(route)}）`
}

export function candidateModelEffect(
  candidate: ConsultCandidate,
  phase: ConsultPhase | undefined,
  directory: ClientModelDirectorySnapshot | undefined,
): string | undefined {
  if (candidate.move === 'clear') return newSessionEffectLabel(candidate, phase, directory)
  if (candidate.move !== 'subagent') return undefined
  const target = chipAgentTarget(candidateStation(candidate, phase), stageAgentsOf(phase))
  return target === undefined ? undefined : subagentLine(target.label)
}

function subagentLine(label: string): string {
  return `子代理 · ${label}`
}

function subagentInput(input: string, label: string): string {
  const line = subagentLine(label)
  return input.includes(line) ? input : `${input}\n\n${line}`
}

function workspaceOf(workspaces: ClientWorkspacesService, sessionId: string): string | undefined {
  return workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(sessionId))?.workspaceId
}

/** Capabilities that start a freshly created session as an Agent. */
export type SessionAgentStartDeps = Pick<ConsultSelectionDeps, 'registerSessionAgent' | 'modelDirectories' | 'notify'>

/**
 * Start a freshly created session as an Agent: record the Agent through the
 * host route, then select the Agent's first candidate in that session's own
 * model directory. Neither failure stops the caller; each is reported.
 * @param subject - how messages name the session, e.g. 新会话 or 后继会话.
 */
export async function startSessionAsAgent(
  deps: SessionAgentStartDeps,
  sessionId: string,
  agent: ChipAgentTarget,
  subject: string,
): Promise<void> {
  try {
    if (deps.registerSessionAgent === undefined) throw new Error('登记能力不可用')
    await deps.registerSessionAgent(sessionId, agent.agent)
  } catch (error) {
    deps.notify?.(`登记${subject} Agent 失败：${errorMessage(error)}`)
  }
  try {
    if (deps.modelDirectories === undefined) throw new Error('模型目录服务不可用')
    const face = deps.modelDirectories.directoryFor(sessionId)
    const route = firstAvailableRoute(agent.routes, modelCatalogRoutes(await face.load()))
    if (route === undefined) throw new Error(noModelLabel(agent))
    await selectModel(face, splitRoute(route))
  } catch (error) {
    deps.notify?.(`选择${subject}模型失败：${errorMessage(error)}`)
  }
}

function fillCurrentSession(
  deps: ConsultSelectionDeps,
  input: string,
): boolean {
  if (!deps.appendToDraft(input)) return false
  deps.closeConsult()
  deps.focusComposer()
  return true
}

/**
 * Why a clear chip with a known Agent cannot start a new session, read before
 * anything is created; `undefined` when it can.
 */
async function newSessionBlocker(
  deps: ConsultSelectionDeps,
  sessionId: string,
  agent: ChipAgentTarget,
): Promise<string | undefined> {
  if (deps.modelDirectories === undefined) return '模型目录服务不可用'
  if (deps.registerSessionAgent === undefined) return '登记会话 Agent 的能力不可用'
  try {
    const directory = await deps.modelDirectories.directoryFor(sessionId).load()
    return firstAvailableRoute(agent.routes, modelCatalogRoutes(directory)) === undefined
      ? noModelLabel(agent)
      : undefined
  } catch (error) {
    return `读取模型目录失败：${errorMessage(error)}`
  }
}

async function selectClearCandidate(
  deps: ConsultSelectionDeps,
  input: string,
  context: ConsultSelectionContext | undefined,
  agent: ChipAgentTarget | undefined,
): Promise<boolean> {
  const sessionId = context?.sessionId
  if (sessionId === undefined || deps.navigation === undefined || deps.workspaces === undefined) {
    deps.notify?.('创建新会话能力不可用，已只填入本会话输入框')
    return fillCurrentSession(deps, input)
  }
  if (agent !== undefined) {
    const blocker = await newSessionBlocker(deps, sessionId, agent)
    if (blocker !== undefined) {
      deps.notify?.(`${blocker}，已只填入本会话输入框`)
      return fillCurrentSession(deps, input)
    }
  }

  const workspaceId = workspaceOf(deps.workspaces, sessionId)
  if (workspaceId === undefined) {
    deps.notify?.('当前会话不属于任何工作区，已只填入本会话输入框')
    return fillCurrentSession(deps, input)
  }

  let successor: string
  try {
    successor = await deps.navigation.connectWorkspace(workspaceId)
  } catch (error) {
    deps.notify?.(`创建新会话失败：${errorMessage(error)}，已只填入本会话输入框`)
    return fillCurrentSession(deps, input)
  }

  if (agent !== undefined) await startSessionAsAgent(deps, successor, agent, '新会话')
  deps.navigation.openSession(successor)
  if (!deps.appendToDraft(input, successor)) return false
  deps.closeConsult()
  deps.focusComposer()
  return true
}

/** The text a continue or subagent chip writes into this session's composer. */
function prepareCandidateInput(candidate: ConsultCandidate, phase: ConsultPhase | undefined): string {
  if (candidate.move !== 'subagent') return candidate.input
  const target = chipAgentTarget(candidateStation(candidate, phase), stageAgentsOf(phase))
  return target === undefined ? candidate.input : subagentInput(candidate.input, target.label)
}

/**
 * Apply one candidate without ever sending it.
 *
 * Continue and subagent candidates only write and focus this session's
 * composer; a clear candidate starts a new session as the next stage's Agent
 * and fills that session's composer; handoff and compact candidates only open
 * the confirmation card. No path selects a model on this session.
 * @returns whether the requested UI transition was completed.
 */
export function selectConsultCandidate(
  deps: ConsultSelectionDeps,
  candidate: ConsultCandidate,
  context?: ConsultSelectionContext,
): Promise<boolean> {
  if (candidate.move === 'handoff') {
    const target = newSessionModelTarget(candidate, context?.phase)
    if (target === undefined) deps.openHandoff(candidate.input)
    else deps.openHandoff(candidate.input, target)
    return Promise.resolve(true)
  }
  if (candidate.move === 'compact') {
    const target = newSessionModelTarget(candidate, context?.phase)
    if (target === undefined) deps.openHandoff(compactFocus(candidate.input))
    else deps.openHandoff(compactFocus(candidate.input), target)
    return Promise.resolve(true)
  }
  if (candidate.move === 'clear') {
    const agent = chipAgentTarget(candidateStation(candidate, context?.phase), stageAgentsOf(context?.phase))
    return selectClearCandidate(deps, candidate.input, context, agent)
  }
  return Promise.resolve(fillCurrentSession(deps, prepareCandidateInput(candidate, context?.phase)))
}

export function selectOtherMove(
  deps: ConsultSelectionDeps,
  move: OtherMove,
  context?: ConsultSelectionContext,
): Promise<boolean> {
  if (move === 'handoff') {
    deps.openHandoff('')
    return Promise.resolve(true)
  }
  if (move === 'compact') {
    deps.openHandoff(COMPACT_FOCUS_PREFIX)
    return Promise.resolve(true)
  }
  if (move === 'clear') return selectClearCandidate(deps, OTHER_MOVE_INPUTS.clear, context, undefined)
  return Promise.resolve(fillCurrentSession(deps, OTHER_MOVE_INPUTS[move]))
}

function compactFocus(input: string): string {
  const trimmed = input.trim()
  return trimmed === '' ? COMPACT_FOCUS_PREFIX : `${COMPACT_FOCUS_PREFIX}${trimmed}`
}
