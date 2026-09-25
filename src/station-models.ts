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
import {
  DEFAULT_STATION_MODELS,
  STATION_MODEL_STATIONS,
  THINKING_MODEL_ROUTES,
  stationModelDefaultStations,
} from './station-model-data.ts'
import type { StationModelsSettings } from './station-model-data.ts'

export {
  CODING_MODEL_ROUTES,
  DEFAULT_STATION_MODELS,
  STATION_MODEL_SETTINGS_NAMESPACE,
  STATION_MODEL_STATIONS,
  THINKING_MODEL_ROUTES,
  shortModelRoute,
  splitModelRoute,
  stationModelWarnings,
} from './station-model-data.ts'
export type { Station, StationModelsSettings } from './station-model-data.ts'

const ROUTE_PATTERN = /^[^/\s]+\/[^/\s]+$/u
const STATION_SET = new Set<string>(STATION_MODEL_STATIONS)
const defaultStations = stationModelDefaultStations()

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
