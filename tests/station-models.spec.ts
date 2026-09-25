import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STATION_MODELS,
  STATION_MODEL_SETTINGS_NAMESPACE,
  StationModelsSettingsSchema,
  stationModelWarnings,
  validateStationModelsSettings,
} from '../src/station-models.ts'

describe('station model settings', () => {
  it('provides the documented settings namespace and factory defaults', () => {
    expect(STATION_MODEL_SETTINGS_NAMESPACE).toBe('a2d2-station-models')
    expect(StationModelsSettingsSchema()).toEqual(DEFAULT_STATION_MODELS)
    expect(DEFAULT_STATION_MODELS.consult).toEqual([
      'claude-bray/claude-fable-5-1',
      'codex/gpt-6',
    ])
    expect(DEFAULT_STATION_MODELS.stations['grill']).toEqual([
      'claude-bray/claude-fable-5-1',
      'codex/gpt-6',
    ])
    expect(DEFAULT_STATION_MODELS.stations['implement']).toEqual([
      'codex/gpt-5.5',
      'claude-bray/claude-opus-5-5',
    ])
    expect(DEFAULT_STATION_MODELS.stations).not.toHaveProperty('handoff')
    expect(DEFAULT_STATION_MODELS.stations).not.toHaveProperty('domain-modeling')
  })

  it('rejects empty candidate lists and non provider/model routes', () => {
    expect(() => StationModelsSettingsSchema({
      stations: { grill: [] },
    } as never)).toThrow(/array length >= 1/u)
    expect(() => StationModelsSettingsSchema({
      consult: ['gpt-6'],
    } as never)).toThrow(/regexp/u)
    expect(() => StationModelsSettingsSchema({
      stations: { 'not-a-station': ['codex/gpt-6'] },
    } as never)).toThrow(/not-a-station/u)
  })

  it('keeps ordered candidate lists and lets schema reject empty consult lists', () => {
    const settings = validateStationModelsSettings({
      ...DEFAULT_STATION_MODELS,
      consult: ['codex/gpt-6', 'claude-bray/claude-fable-5-1'],
    })
    expect(settings.consult).toEqual(['codex/gpt-6', 'claude-bray/claude-fable-5-1'])
    expect(() => validateStationModelsSettings({
      ...DEFAULT_STATION_MODELS,
      consult: [],
    })).toThrow(/array length >= 1/u)
  })

  it('warns when code-review and implement share the same first candidate', () => {
    expect(stationModelWarnings({
      ...DEFAULT_STATION_MODELS,
      stations: {
        ...DEFAULT_STATION_MODELS.stations,
        implement: ['codex/gpt-6'],
        'code-review': ['codex/gpt-6', 'claude-bray/claude-fable-5-1'],
      },
    })).toEqual([
      'a2d2: code-review and implement both prefer codex/gpt-6; review should normally use a different first model',
    ])
  })
})
