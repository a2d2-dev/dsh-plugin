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
import type { ClientSessionsService, ClientWorkspacesService } from './context.ts'

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
  select(selection: ClientModelSelection): Promise<void>
}

export interface ClientModelDirectoryService {
  directoryFor(sessionId: string): ClientModelDirectory
}

export type StationRouteDecision =
  | {
      readonly kind: 'switch'
      readonly route: string
      readonly selection: ClientModelSelection
      readonly label: string
    }
  | {
      readonly kind: 'keep'
      readonly route?: string
      readonly label: string
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
      readonly stationModels?: Readonly<Record<string, readonly string[]>>
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
  readonly modelDirectories?: ClientModelDirectoryService
  readonly notify?: (message: string) => void
}

export interface ConsultSelectionContext {
  readonly sessionId?: string
  readonly phase?: ConsultPhase
}

export interface ConsultNewSessionModelTarget {
  readonly station?: string
  readonly stationModels?: Readonly<Record<string, readonly string[]>>
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
        readonly stationModels?: Readonly<Record<string, readonly string[]>>
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

function parseMove(value: unknown, legacyKind?: unknown): Move | undefined {
  if (typeof value === 'string') return isMove(value) ? value : undefined
  if (typeof legacyKind === 'string' && legacyKind in LEGACY_KIND_MOVES) {
    return LEGACY_KIND_MOVES[legacyKind as keyof typeof LEGACY_KIND_MOVES]
  }
  return undefined
}

function parseCandidate(value: unknown): ConsultCandidate | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.label !== 'string' || value.label.trim() === '') return undefined
  if (typeof value.input !== 'string' || value.input.trim() === '') return undefined
  const move = parseMove(value.move, value.kind)
  if (move === undefined) return undefined
  if (value.station !== undefined && (typeof value.station !== 'string' || !isClosedHighwayStation(value.station))) return undefined
  return {
    label: value.label,
    input: value.input,
    move,
    ...(value.station === undefined ? {} : { station: value.station.trim() }),
  }
}

function parseLocation(value: unknown): ConsultLocation | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return undefined
  if (typeof value.zone !== 'string' || !isHighwayZone(value.zone)) return undefined
  if (typeof value.phaseDone !== 'boolean') return undefined
  const station = value.station
  const returnTo = value.returnTo
  if (returnTo !== undefined && (typeof returnTo !== 'string' || !isMainStation(returnTo))) return undefined
  switch (value.zone) {
    case 'main':
      if (typeof station !== 'string' || !isMainStation(station) || returnTo !== undefined) return undefined
      break
    case 'service':
      if (typeof station !== 'string' || !isServiceStation(station) || returnTo === undefined) return undefined
      break
    case 'ramp':
      if (typeof station !== 'string' || !isRampStation(station) || returnTo !== undefined) return undefined
      break
    case 'standalone':
      if (typeof station !== 'string' || station.trim() === '' || returnTo !== undefined) return undefined
      break
    case 'roadbed':
      if (typeof station !== 'string' || !isRoadbedStation(station) || returnTo !== undefined) return undefined
      break
    case 'off-road':
      if (station !== undefined || returnTo !== undefined) return undefined
      break
  }
  return {
    zone: value.zone,
    ...(station === undefined ? {} : { station: station.trim() }),
    ...(returnTo === undefined ? {} : { returnTo }),
    phaseDone: value.phaseDone,
  }
}

function parseNext(value: unknown): ConsultNext | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return undefined
  if (typeof value.station !== 'string' || !isClosedHighwayStation(value.station)) return undefined
  if (typeof value.move !== 'string' || !isMove(value.move)) return undefined
  if (typeof value.reason !== 'string' || value.reason.trim() === '') return undefined
  return { station: value.station.trim(), move: value.move, reason: value.reason.trim() }
}

function parseFallback(value: unknown): ConsultFallback | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.route !== 'string' || value.route.trim() === '') return undefined
  if (typeof value.reason !== 'string' || value.reason.trim() === '') return undefined
  return { route: value.route, reason: value.reason }
}

function parseStationModels(value: unknown): Readonly<Record<string, readonly string[]>> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return undefined
  const result: Record<string, readonly string[]> = {}
  for (const [station, routes] of Object.entries(value)) {
    if (!Array.isArray(routes) || routes.some(route => typeof route !== 'string' || route.trim() === '')) {
      return undefined
    }
    result[station] = routes
  }
  return result
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
  const stationModels = parseStationModels(value.value.stationModels)
  if (value.value.stationModels !== undefined && stationModels === undefined) {
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
      ...(stationModels === undefined ? {} : { stationModels }),
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
      ...(result.value.stationModels === undefined ? {} : { stationModels: result.value.stationModels }),
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

function routeOf(selection: ClientModelSelection | undefined): string | undefined {
  return selection === undefined ? undefined : `${selection.provider}/${selection.model}`
}

function splitRoute(route: string): ClientModelSelection {
  const slash = route.indexOf('/')
  return { provider: route.slice(0, slash), model: route.slice(slash + 1) }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Pick the station route that is available in the session model directory.
 *
 * The host returns the station model table unchanged. The browser decides
 * against the session directory because catalog membership is per session.
 */
export function stationRouteDecision(input: {
  readonly station?: string
  readonly stationModels?: Readonly<Record<string, readonly string[]>>
  readonly catalog: readonly string[]
  readonly current?: ClientModelSelection
}): StationRouteDecision {
  const currentRoute = routeOf(input.current)
  const routes = input.station === undefined ? undefined : input.stationModels?.[input.station]
  const available = routes?.find(route => input.catalog.includes(route))
  if (available === undefined) {
    return {
      kind: 'keep',
      ...(currentRoute === undefined ? {} : { route: currentRoute }),
      label: '保持当前模型',
    }
  }
  if (available === currentRoute) {
    return { kind: 'keep', route: available, label: '保持当前模型' }
  }
  return {
    kind: 'switch',
    route: available,
    selection: splitRoute(available),
    label: `切到 ${shortRoute(available)}`,
  }
}

function displayReason(reason: string): string {
  return /refus/u.test(reason) || /拒/u.test(reason)
    ? '拒答'
    : reason
}

export function consultAttributionLine(phase: ConsultPhase): string | undefined {
  if (phase.kind !== 'ready' || phase.answeredBy === undefined) return undefined
  const answered = shortRoute(phase.answeredBy)
  const fallback = phase.fallbacks?.[0]
  if (fallback === undefined) return `由 ${answered} 生成`
  return `由 ${answered} 生成（${shortRoute(fallback.route)} ${displayReason(fallback.reason)}，改用 ${answered}）`
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

function newSessionModelTarget(
  candidate: ConsultCandidate,
  phase: ConsultPhase | undefined,
): ConsultNewSessionModelTarget | undefined {
  const station = candidateStation(candidate, phase)
  if (phase?.kind !== 'ready') return station === undefined ? undefined : { station }
  const target = {
    ...(station === undefined ? {} : { station }),
    ...(phase.stationModels === undefined ? {} : { stationModels: phase.stationModels }),
  }
  return target.station === undefined && target.stationModels === undefined ? undefined : target
}

function newSessionEffectLabel(
  candidate: ConsultCandidate,
  phase: ConsultPhase | undefined,
  directory: ClientModelDirectorySnapshot | undefined,
): string {
  if (directory === undefined) return '新会话 · 默认模型'
  const station = candidateStation(candidate, phase)
  if (station === undefined || phase?.kind !== 'ready') return '新会话 · 默认模型'
  const decision = stationRouteDecision({
    station,
    stationModels: phase.stationModels,
    catalog: modelCatalogRoutes(directory),
    current: undefined,
  })
  return decision.route === undefined ? '新会话 · 默认模型' : `新会话 · ${shortRoute(decision.route)}`
}

export function candidateModelEffect(
  candidate: ConsultCandidate,
  phase: ConsultPhase | undefined,
  directory: ClientModelDirectorySnapshot | undefined,
): string | undefined {
  if (candidate.move === 'clear') return newSessionEffectLabel(candidate, phase, directory)
  if (candidate.move !== 'continue') return undefined
  const station = candidateStation(candidate, phase)
  if (station === undefined || phase?.kind !== 'ready') return undefined
  if (directory === undefined) return '保持当前模型'
  return stationRouteDecision({
    station,
    stationModels: phase.stationModels,
    catalog: modelCatalogRoutes(directory),
    current: directory.current,
  }).label
}

function subagentInput(input: string, route: string | undefined): string {
  if (route === undefined || /子代理使用\s+\S+/u.test(input)) return input
  return `${input}\n\n子代理使用 ${route}`
}

function workspaceOf(workspaces: ClientWorkspacesService, sessionId: string): string | undefined {
  return workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(sessionId))?.workspaceId
}

function targetNeedsModelSelection(target: ConsultNewSessionModelTarget | undefined): boolean {
  return target?.station !== undefined && target.stationModels?.[target.station] !== undefined
}

async function selectNewSessionModel(
  deps: Pick<ConsultSelectionDeps, 'modelDirectories' | 'notify'>,
  sessionId: string,
  target: ConsultNewSessionModelTarget | undefined,
  messagePrefix: string,
): Promise<void> {
  if (target?.station === undefined || target.stationModels === undefined) return
  if (target.stationModels[target.station] === undefined) return
  if (deps.modelDirectories === undefined) {
    deps.notify?.(`${messagePrefix}模型目录服务不可用`)
    return
  }
  try {
    const face = deps.modelDirectories.directoryFor(sessionId)
    const directory = await face.load()
    const decision = stationRouteDecision({
      station: target.station,
      stationModels: target.stationModels,
      catalog: modelCatalogRoutes(directory),
      current: directory.current,
    })
    if (decision.kind === 'switch') await face.select(decision.selection)
  } catch (error) {
    deps.notify?.(`${messagePrefix}${errorMessage(error)}`)
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

async function selectClearCandidate(
  deps: ConsultSelectionDeps,
  input: string,
  context: ConsultSelectionContext | undefined,
  target: ConsultNewSessionModelTarget | undefined,
): Promise<boolean> {
  const sessionId = context?.sessionId
  if (sessionId === undefined || deps.sessions === undefined || deps.workspaces === undefined) {
    deps.notify?.('创建新会话能力不可用，已只填入本会话输入框')
    return fillCurrentSession(deps, input)
  }
  if (targetNeedsModelSelection(target) && deps.modelDirectories === undefined) {
    deps.notify?.('模型目录服务不可用，已只填入本会话输入框')
    return fillCurrentSession(deps, input)
  }

  const workspaceId = workspaceOf(deps.workspaces, sessionId)
  if (workspaceId === undefined) {
    deps.notify?.('当前会话不属于任何工作区，已只填入本会话输入框')
    return fillCurrentSession(deps, input)
  }

  let successor: string
  try {
    successor = await deps.workspaces.connectWorkspace(workspaceId)
  } catch (error) {
    deps.notify?.(`创建新会话失败：${errorMessage(error)}，已只填入本会话输入框`)
    return fillCurrentSession(deps, input)
  }

  await selectNewSessionModel(deps, successor, target, '选择新会话模型失败：')
  deps.sessions.open(successor)
  if (!deps.appendToDraft(input, successor)) return false
  deps.closeConsult()
  deps.focusComposer()
  return true
}

async function prepareCandidateInput(
  deps: ConsultSelectionDeps,
  candidate: ConsultCandidate,
  context: ConsultSelectionContext | undefined,
): Promise<string> {
  if (candidate.move !== 'continue' && candidate.move !== 'subagent') return candidate.input
  const phase = context?.phase
  const station = candidateStation(candidate, phase)
  if (station === undefined || phase?.kind !== 'ready' || phase.stationModels === undefined) return candidate.input
  const sessionId = context?.sessionId
  if (sessionId === undefined || deps.modelDirectories === undefined) {
    deps.notify?.('模型目录服务不可用，已只填入输入框')
    return candidate.input
  }

  let directory: ClientModelDirectorySnapshot
  let face: ClientModelDirectory
  try {
    face = deps.modelDirectories.directoryFor(sessionId)
    directory = await face.load()
  } catch (error) {
    deps.notify?.(`读取模型目录失败：${errorMessage(error)}`)
    return candidate.input
  }

  const decision = stationRouteDecision({
    station,
    stationModels: phase.stationModels,
    catalog: modelCatalogRoutes(directory),
    current: directory.current,
  })

  if (candidate.move === 'subagent') return subagentInput(candidate.input, decision.route)
  if (decision.kind === 'switch') {
    try {
      await face.select(decision.selection)
    } catch (error) {
      deps.notify?.(`切换模型失败：${errorMessage(error)}`)
    }
  }
  return candidate.input
}

/**
 * Apply one candidate without ever sending it.
 *
 * Non-handoff candidates only write and focus the composer. Handoff candidates
 * only open the existing confirmation card with their input as its focus.
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
    return selectClearCandidate(deps, candidate.input, context, newSessionModelTarget(candidate, context?.phase))
  }
  return prepareCandidateInput(deps, candidate, context).then((input) => {
    return fillCurrentSession(deps, input)
  })
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
