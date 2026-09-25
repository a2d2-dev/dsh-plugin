/**
 * Client-safe station model table data and helpers.
 *
 * Keep schema code out of this module: the browser bundle imports it directly,
 * and the client purity guard rejects host-only validation dependencies.
 *
 * @module @deepseek-ai/dsh-a2d2/src/station-model-data
 */

import type { MainStation, RampStation, ServiceStation } from './highway.ts'

export const STATION_MODEL_SETTINGS_NAMESPACE = 'a2d2-station-models'

export const THINKING_MODEL_ROUTES = [
  'claude-bray/claude-fable-5-1',
  'codex/gpt-6',
] as const

export const CODING_MODEL_ROUTES = [
  'codex/gpt-5.5',
  'claude-bray/claude-opus-5-5',
] as const

export const STATION_MODEL_STATIONS = [
  'grill',
  'to-spec',
  'to-tickets',
  'code-review',
  'implement',
  'prototype',
  'diagnosing-bugs',
  'triage',
  'wayfinder',
  'improve-codebase-architecture',
] as const

export type Station = MainStation | Extract<ServiceStation, 'prototype'> | RampStation

export interface StationModelsSettings {
  readonly stations: Readonly<Record<Station, readonly string[]>>
  readonly consult: readonly string[]
}

const THINKING_STATIONS = new Set<Station>([
  'grill',
  'to-spec',
  'to-tickets',
  'code-review',
  'triage',
  'wayfinder',
  'improve-codebase-architecture',
])

const defaultStations = Object.fromEntries(
  STATION_MODEL_STATIONS.map(station => [
    station,
    THINKING_STATIONS.has(station) ? [...THINKING_MODEL_ROUTES] : [...CODING_MODEL_ROUTES],
  ]),
) as Record<Station, string[]>

export const DEFAULT_STATION_MODELS: StationModelsSettings = Object.freeze({
  stations: Object.freeze(Object.fromEntries(
    Object.entries(defaultStations).map(([station, routes]) => [station, Object.freeze([...routes])]),
  ) as Record<Station, readonly string[]>),
  consult: Object.freeze([...THINKING_MODEL_ROUTES]),
})

export function stationModelDefaultStations(): Record<Station, string[]> {
  return Object.fromEntries(
    STATION_MODEL_STATIONS.map(station => [station, [...defaultStations[station]]]),
  ) as Record<Station, string[]>
}

export function stationModelWarnings(settings: StationModelsSettings): readonly string[] {
  const review = settings.stations['code-review'][0]
  const implement = settings.stations.implement[0]
  if (review !== undefined && review === implement) {
    return [`a2d2: code-review and implement both prefer ${review}; review should normally use a different first model`]
  }
  return []
}

export function splitModelRoute(route: string): { readonly provider: string; readonly model: string } {
  const slash = route.indexOf('/')
  return { provider: route.slice(0, slash), model: route.slice(slash + 1) }
}

export function shortModelRoute(route: string): string {
  const slash = route.indexOf('/')
  return slash < 0 ? route : route.slice(slash + 1)
}
