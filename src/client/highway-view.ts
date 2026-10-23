/**
 * Client-side projection from a consult response to the read-only mini highway.
 *
 * It is a pure function so the boundary card and the future settings page can
 * reuse the same highway semantics without sharing React state.
 *
 * @module @a2d2-dev/dsh-a2d2/client/highway-view
 */

import {
  type ClosedHighwayStation,
  MAIN_STATION_ROLES,
  MAIN_STATIONS,
  RAMP_MERGES,
} from '../highway.ts'
import {
  modelCandidatesForStage,
  shortModelRoute,
  stageAgentLabel,
  candidateRoute,
} from '../stage-agent-data.ts'
import type { ModelCandidate, Stage, StageAgentRouteSettings } from '../stage-agent-data.ts'
import type { MainStation, Move } from '../highway.ts'
import { chipAgentTarget } from './consult-actions.ts'
import type { ConsultLocation, ConsultNext, ConsultPhase } from './consult-actions.ts'

export type HighwayStationState = 'passed' | 'current' | 'next' | 'ahead'

export interface HighwayViewStation {
  readonly id: ClosedHighwayStation | 'standalone'
  readonly role: string
  readonly agent?: string
  readonly agentKey?: string
  readonly models?: string
  readonly state: HighwayStationState
}

export interface HighwayView {
  readonly preconditionPlacard?: {
    readonly title: string
    readonly missing: readonly string[]
  }
  readonly stations: readonly HighwayViewStation[]
  readonly aside?: string
  readonly placard?: string
  readonly nextLine?: string
}

type ReadyConsult = Extract<ConsultPhase, { readonly kind: 'ready' }>

const MOVE_LABELS: Readonly<Record<Move, string>> = {
  continue: 'Continue',
  clear: 'Clear',
  handoff: 'Handoff',
  subagent: 'Subagent',
  compact: 'Compact',
}

export function highwayView(
  response: ReadyConsult,
  catalog?: readonly string[],
): HighwayView {
  const location = response.location
  const next = response.next
  const stations = MAIN_STATIONS.map((station): HighwayViewStation => ({
    id: station,
    role: MAIN_STATION_ROLES[station],
    ...agentField(response.stageAgents, station, catalog),
    state: stationState(station, location, next),
  }))
  return {
    ...preconditionPlacardField(response),
    stations,
    ...noteField(location),
    ...nextLineField(response),
  }
}

function preconditionPlacardField(response: ReadyConsult): Pick<HighwayView, 'preconditionPlacard'> {
  const missing = response.preconditions?.missing
  if (missing === undefined || missing.length === 0) return {}
  return {
    preconditionPlacard: {
      title: '首次使用前：/setup-matt-pocock-skills',
      missing: missing.map(item => item.label),
    },
  }
}

function stationState(
  station: MainStation,
  location: ConsultLocation | undefined,
  next: ConsultNext | undefined,
): HighwayStationState {
  if (location?.zone !== 'main') return 'ahead'
  if (station === location.station) return 'current'
  const currentIndex = MAIN_STATIONS.indexOf(location.station as MainStation)
  const stationIndex = MAIN_STATIONS.indexOf(station)
  if (stationIndex >= 0 && currentIndex >= 0 && stationIndex < currentIndex) return 'passed'
  if (location.phaseDone && next?.station === station) return 'next'
  return 'ahead'
}

function noteField(location: ConsultLocation | undefined): Pick<HighwayView, 'aside' | 'placard'> {
  if (location === undefined) return {}
  if (location.zone === 'service' && location.station !== undefined && location.returnTo !== undefined) {
    return { aside: `绕道中：${location.station}，完成后 handoff 回 ${location.returnTo}` }
  }
  if (location.zone === 'ramp' && location.station !== undefined && location.station in RAMP_MERGES) {
    return { aside: `匝道：${location.station}，并入 ${RAMP_MERGES[location.station as keyof typeof RAMP_MERGES]}` }
  }
  if (location.zone === 'standalone' && location.station !== undefined) {
    return { placard: `独立：${location.station}` }
  }
  if (location.zone === 'roadbed' && location.station !== undefined) {
    return { placard: `路基：${location.station}` }
  }
  if (location.zone === 'off-road') return { placard: '不在公路上' }
  return {}
}

function nextLineField(
  response: ReadyConsult,
): Pick<HighwayView, 'nextLine'> {
  if (response.location?.phaseDone === false) return { nextLine: '本阶段未完成 · 继续' }
  const next = response.next
  if (next === undefined) return {}
  const agent = chipAgentTarget(next.station, response.stageAgents)?.label
  return {
    nextLine: `→ /${next.station} · ${MOVE_LABELS[next.move]}（${next.reason}）${agent === undefined ? '' : `· ${agent}`}`,
  }
}

function agentField(
  settings: StageAgentRouteSettings | undefined,
  stage: Stage,
  catalog: readonly string[] | undefined,
): Pick<HighwayViewStation, 'agent' | 'agentKey' | 'models'> {
  if (settings === undefined) return {}
  const agent = settings.stages[stage]
  return {
    agent: stageAgentLabel(agent),
    agentKey: agent,
    models: modelLabel(modelCandidatesForStage(settings, stage), catalog),
  }
}

function modelLabel(
  routes: readonly ModelCandidate[],
  catalog: readonly string[] | undefined,
): string {
  if (catalog === undefined) return shortModelRoute(candidateRoute(routes[0] ?? '')) || '无可用模型'
  const selected = routes.find(route => catalog.includes(candidateRoute(route)))
  return selected === undefined ? '无可用模型' : shortModelRoute(candidateRoute(selected))
}
