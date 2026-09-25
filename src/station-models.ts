/**
 * Host-side station model table.
 *
 * The station ids here are derived from the highway catalog. Not every highway
 * station receives model candidates: handoff, roadbed, and standalone stations
 * intentionally have no model switch in this ticket.
 *
 * @module @deepseek-ai/dsh-a2d2/src/station-models
 */

import z from '@deepseek-ai/schemastery'
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

const ROUTE_PATTERN = /^[^/\s]+\/[^/\s]+$/u
const STATION_SET = new Set<string>(STATION_MODEL_STATIONS)

const routeSchema = z.string().pattern(ROUTE_PATTERN)
const routeListSchema = z.array(routeSchema).min(1)

const stationsSchema = z.transform(
  z.dict(routeListSchema),
  (value) => {
    for (const station of Object.keys(value)) {
      if (!STATION_SET.has(station)) throw new Error(`a2d2: unknown station "${station}"`)
    }
    return { ...defaultStations, ...value }
  },
)

export const StationModelsSettingsSchema: z<StationModelsSettings> = z.object({
  stations: stationsSchema.default(defaultStations),
  consult: routeListSchema.default([...THINKING_MODEL_ROUTES]),
}).default({
  stations: defaultStations,
  consult: [...THINKING_MODEL_ROUTES],
}) as z<StationModelsSettings>

export function validateStationModelsSettings(value: unknown): StationModelsSettings {
  const settings = StationModelsSettingsSchema(structuredClone(value) as never)
  if (settings.consult.length === 0) {
    throw new Error('a2d2: consult must name at least one model route')
  }
  for (const [station, routes] of Object.entries(settings.stations)) {
    if (routes.length === 0) throw new Error(`a2d2: stations.${station} must name at least one model route`)
  }
  return settings
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
