import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGE_AGENTS,
  STAGE_AGENT_SETTINGS_NAMESPACE,
  STAGE_AGENT_STAGES,
  StageAgentsSettingsSchema,
  stageAgentWarnings,
  validateStageAgentsSettings,
} from '../src/stage-agents.ts'

describe('stage agent settings', () => {
  it('provides the documented settings namespace and factory defaults', () => {
    expect(STAGE_AGENT_SETTINGS_NAMESPACE).toBe('a2d2-stage-agents')
    expect(StageAgentsSettingsSchema()).toEqual(DEFAULT_STAGE_AGENTS)
    expect(Object.keys(DEFAULT_STAGE_AGENTS.stages).sort()).toEqual([...STAGE_AGENT_STAGES].sort())
    expect(DEFAULT_STAGE_AGENTS.consult).toEqual([
      'claude-bray/claude-fable-5-1',
      'codex/gpt-6',
    ])
    expect(DEFAULT_STAGE_AGENTS.stages.grill).toBe('ceo')
    expect(DEFAULT_STAGE_AGENTS.stages.implement).toBe('engineer')
    expect(DEFAULT_STAGE_AGENTS.stages['code-review']).toBe('reviewer')
    expect(DEFAULT_STAGE_AGENTS.agents.ceo).toEqual([
      'claude-bray/claude-fable-5-1',
      'codex/gpt-6',
    ])
    expect(DEFAULT_STAGE_AGENTS.agents.reviewer).toEqual(DEFAULT_STAGE_AGENTS.agents.ceo)
    expect(DEFAULT_STAGE_AGENTS.agents.engineer).toEqual([
      'codex/gpt-5.5',
      'claude-bray/claude-opus-5-5',
    ])
    expect(DEFAULT_STAGE_AGENTS.stages).toHaveProperty('handoff', 'ceo')
    expect(DEFAULT_STAGE_AGENTS.stages).toHaveProperty('domain-modeling', 'ceo')
  })

  it('rejects empty candidate lists, non provider/model routes, unknown stages, and unknown agents', () => {
    expect(() => StageAgentsSettingsSchema({
      agents: { ceo: [] },
    } as never)).toThrow(/array length >= 1/u)
    expect(() => StageAgentsSettingsSchema({
      consult: ['gpt-6'],
    } as never)).toThrow(/regexp/u)
    expect(() => StageAgentsSettingsSchema({
      stages: { 'not-a-stage': 'ceo' },
    } as never)).toThrow(/not-a-stage/u)
    expect(() => StageAgentsSettingsSchema({
      stages: { implement: 'qa' },
    } as never)).toThrow(/qa/u)
  })

  it('keeps ordered candidate lists and lets schema reject empty consult lists', () => {
    const settings = validateStageAgentsSettings({
      ...DEFAULT_STAGE_AGENTS,
      consult: ['codex/gpt-6', 'claude-bray/claude-fable-5-1'],
    })
    expect(settings.consult).toEqual(['codex/gpt-6', 'claude-bray/claude-fable-5-1'])
    expect(() => validateStageAgentsSettings({
      ...DEFAULT_STAGE_AGENTS,
      consult: [],
    })).toThrow(/array length >= 1/u)
  })

  it('warns in Chinese when reviewer and engineer share the same first candidate', () => {
    expect(stageAgentWarnings({
      ...DEFAULT_STAGE_AGENTS,
      agents: {
        ...DEFAULT_STAGE_AGENTS.agents,
        engineer: ['codex/gpt-6'],
        reviewer: ['codex/gpt-6', 'claude-bray/claude-fable-5-1'],
      },
    })).toEqual([
      'a2d2: 评审和工程师的首选模型同为 codex/gpt-6；通常应为评审配置不同的首选模型',
    ])
  })
})
