/**
 * Pure Matt highway catalog shared by the host parser and browser bundle.
 *
 * This module has no Node dependency so it can be imported from client code.
 *
 * @module @a2d2/dsh-a2d2/src/highway
 */

export const HIGHWAY_ZONES = [
  'main',
  'service',
  'ramp',
  'standalone',
  'roadbed',
  'off-road',
] as const

export type HighwayZone = typeof HIGHWAY_ZONES[number]

export const MAIN_STATIONS = [
  'grill',
  'to-spec',
  'to-tickets',
  'implement',
  'code-review',
] as const

export type MainStation = typeof MAIN_STATIONS[number]

export const SERVICE_STATIONS = [
  'prototype',
  'handoff',
] as const

export type ServiceStation = typeof SERVICE_STATIONS[number]

export const RAMP_MERGES = {
  triage: 'implement',
  'diagnosing-bugs': 'implement',
  wayfinder: 'to-spec',
  'improve-codebase-architecture': 'grill',
} as const satisfies Readonly<Record<string, MainStation>>

export type RampStation = keyof typeof RAMP_MERGES

export const RAMP_STATIONS = Object.keys(RAMP_MERGES) as readonly RampStation[]

export const ROADBED_STATIONS = [
  'domain-modeling',
  'codebase-design',
] as const

export type RoadbedStation = typeof ROADBED_STATIONS[number]

export type ClosedHighwayStation =
  | MainStation
  | ServiceStation
  | RampStation
  | RoadbedStation

export const CLOSED_HIGHWAY_STATIONS = [
  ...MAIN_STATIONS,
  ...SERVICE_STATIONS,
  ...RAMP_STATIONS,
  ...ROADBED_STATIONS,
] as readonly ClosedHighwayStation[]

export type Move = 'continue' | 'clear' | 'handoff' | 'subagent' | 'compact'

export const MOVES = [
  'continue',
  'clear',
  'handoff',
  'subagent',
  'compact',
] as const satisfies readonly Move[]

export const MAIN_STATION_ROLES: Readonly<Record<MainStation, string>> = {
  grill: '澄清目标与约束',
  'to-spec': '沉淀规格与验收',
  'to-tickets': '拆成可实施工单',
  implement: '实现与 TDD',
  'code-review': '独立评审与收口',
}

export const HIGHWAY_PROMPT_CATALOG = Object.freeze({
  zones: HIGHWAY_ZONES,
  main: MAIN_STATIONS,
  service: SERVICE_STATIONS,
  ramp: RAMP_MERGES,
  roadbed: ROADBED_STATIONS,
})

const MAIN_SET = new Set<string>(MAIN_STATIONS)
const SERVICE_SET = new Set<string>(SERVICE_STATIONS)
const RAMP_SET = new Set<string>(RAMP_STATIONS)
const ROADBED_SET = new Set<string>(ROADBED_STATIONS)
const CLOSED_SET = new Set<string>(CLOSED_HIGHWAY_STATIONS)
const ZONE_SET = new Set<string>(HIGHWAY_ZONES)
const MOVE_SET = new Set<string>(MOVES)

export function isHighwayZone(value: string): value is HighwayZone {
  return ZONE_SET.has(value)
}

export function isMove(value: string): value is Move {
  return MOVE_SET.has(value)
}

export function isMainStation(value: string): value is MainStation {
  return MAIN_SET.has(value)
}

export function isServiceStation(value: string): value is ServiceStation {
  return SERVICE_SET.has(value)
}

export function isRampStation(value: string): value is RampStation {
  return RAMP_SET.has(value)
}

export function isRoadbedStation(value: string): value is RoadbedStation {
  return ROADBED_SET.has(value)
}

export function isClosedHighwayStation(value: string): value is ClosedHighwayStation {
  return CLOSED_SET.has(value)
}
