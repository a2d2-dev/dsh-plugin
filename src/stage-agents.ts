/**
 * Host-side stage Agent table.
 *
 * The table has one chain for execution routing: stage -> Agent -> ordered
 * provider/model candidates. Standalone skills are intentionally not listed;
 * they use CEO by policy when a caller needs an Agent outside the closed highway.
 *
 * @module @a2d2/dsh-a2d2/src/stage-agents
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_STAGE_AGENTS,
  STAGE_AGENTS,
  STAGE_AGENT_STAGES,
  THINKING_MODEL_ROUTES,
  stageAgentDefaultAgents,
  stageAgentDefaultStages,
  isModelCandidate,
} from './stage-agent-data.ts'
import type { ModelCandidate, StageAgent, StageAgentsSettings } from './stage-agent-data.ts'

export {
  CODING_MODEL_ROUTES,
  DEFAULT_STAGE_AGENTS,
  STAGE_AGENTS,
  STAGE_AGENT_STAGES,
  THINKING_MODEL_ROUTES,
  agentForStage,
  modelCandidatesForStage,
  shortModelRoute,
  splitModelRoute,
  stageAgentWarnings,
  candidateRoute,
  candidateEffort,
  candidateSelection,
} from './stage-agent-data.ts'
export type { ModelCandidate, Stage, StageAgent, StageAgentsSettings } from './stage-agent-data.ts'

const STAGE_SET = new Set<string>(STAGE_AGENT_STAGES)
const AGENT_SET = new Set<string>(STAGE_AGENTS)
const SETTINGS_KEYS = new Set(['stages', 'agents', 'consult'])
const defaultStages = stageAgentDefaultStages()
const defaultAgents = stageAgentDefaultAgents()

const candidateSchema = z.transform(z.any(), value => {
  if (!isModelCandidate(value)) throw new Error('a2d2: candidate must match provider/model regexp or { route, reasoningEffort }')
  return value
})
const routeListSchema = z.array(candidateSchema).min(1)

const stagesSchema = z.transform(
  z.dict(z.string()),
  (value) => {
    for (const [stage, agent] of Object.entries(value)) {
      if (!STAGE_SET.has(stage)) throw new Error(`a2d2: unknown stage "${stage}"`)
      if (!AGENT_SET.has(agent)) throw new Error(`a2d2: unknown Agent "${agent}" for stage "${stage}"`)
    }
    return { ...defaultStages, ...(value as Partial<Record<keyof typeof defaultStages, StageAgent>>) }
  },
)

const agentsSchema = z.transform(
  z.dict(routeListSchema),
  (value) => {
    for (const agent of Object.keys(value)) {
      if (!AGENT_SET.has(agent)) throw new Error(`a2d2: unknown Agent "${agent}"`)
    }
    return { ...defaultAgents, ...(value as Partial<Record<StageAgent, ModelCandidate[]>>) }
  },
)

const InternalStageAgentsSettingsSchema: z<StageAgentsSettings> = z.object({
  stages: stagesSchema.default(defaultStages),
  agents: agentsSchema.default(defaultAgents),
  consult: routeListSchema.default([...THINKING_MODEL_ROUTES]),
}).default({
  stages: defaultStages,
  agents: defaultAgents,
  consult: [...THINKING_MODEL_ROUTES],
}) as z<StageAgentsSettings>

export const StageAgentsSettingsSchema = z.transform(z.any(), value =>
  InternalStageAgentsSettingsSchema(structuredClone(value) as never),
).default({}) as z<StageAgentsSettings>

function assertRouteList(path: string, routes: readonly unknown[]): void {
  for (const [index, route] of routes.entries()) {
    if (!isModelCandidate(route)) {
      throw new Error(`a2d2: ${path}[${index}] must be provider/model or { route, reasoningEffort } with a non-empty effort id`)
    }
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertOnlyKeys(path: string, value: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`a2d2: unknown ${path} key "${key}"`)
  }
}

function hasOwn(value: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function validateCompleteStageAgentsSettings(value: unknown): StageAgentsSettings {
  if (!isRecord(value)) throw new Error('a2d2: stageAgents settings must be an object')
  assertOnlyKeys('stageAgents', value, SETTINGS_KEYS)
  for (const key of SETTINGS_KEYS) {
    if (!hasOwn(value, key)) throw new Error(`a2d2: stageAgents.${key} is required`)
  }

  const stages = value.stages
  if (!isRecord(stages)) throw new Error('a2d2: stageAgents.stages must be an object')
  assertOnlyKeys('stageAgents.stages', stages, STAGE_SET)
  for (const stage of STAGE_AGENT_STAGES) {
    if (!hasOwn(stages, stage)) throw new Error(`a2d2: stageAgents.stages.${stage} is required`)
    const agent = stages[stage]
    if (typeof agent !== 'string' || !AGENT_SET.has(agent)) {
      throw new Error(`a2d2: unknown Agent "${String(agent)}" for stage "${stage}"`)
    }
  }

  const agents = value.agents
  if (!isRecord(agents)) throw new Error('a2d2: stageAgents.agents must be an object')
  assertOnlyKeys('stageAgents.agents', agents, AGENT_SET)
  for (const agent of STAGE_AGENTS) {
    if (!hasOwn(agents, agent)) throw new Error(`a2d2: stageAgents.agents.${agent} is required`)
    const routes = agents[agent]
    if (!Array.isArray(routes)) throw new Error(`a2d2: stageAgents.agents.${agent} must be an array`)
    if (routes.length === 0) throw new Error(`a2d2: agents.${agent} must name at least one model route`)
    assertRouteList(`agents.${agent}`, routes)
  }

  const consult = value.consult
  if (!Array.isArray(consult)) throw new Error('a2d2: stageAgents.consult must be an array')
  if (consult.length === 0) throw new Error('a2d2: consult must name at least one model route')
  assertRouteList('consult', consult)

  return {
    stages: Object.fromEntries(
      STAGE_AGENT_STAGES.map(stage => [stage, stages[stage] as StageAgent]),
    ) as Record<keyof typeof defaultStages, StageAgent>,
    agents: Object.fromEntries(
      STAGE_AGENTS.map(agent => [agent, structuredClone(agents[agent] as ModelCandidate[])]),
    ) as Record<StageAgent, ModelCandidate[]>,
    consult: structuredClone(consult as ModelCandidate[]),
  }
}

export function validateStageAgentsSettings(value: unknown): StageAgentsSettings {
  if (isRecord(value)) {
    if (Array.isArray(value.consult)) assertRouteList('consult', value.consult)
    if (isRecord(value.agents)) {
      for (const [agent, routes] of Object.entries(value.agents)) {
        if (Array.isArray(routes)) assertRouteList(`agents.${agent}`, routes)
      }
    }
  }
  const settings = StageAgentsSettingsSchema(structuredClone(value) as never)
  if (settings.consult.length === 0) {
    throw new Error('a2d2: consult must name at least one model route')
  }
  assertRouteList('consult', settings.consult)
  for (const [agent, routes] of Object.entries(settings.agents)) {
    if (routes.length === 0) throw new Error(`a2d2: agents.${agent} must name at least one model route`)
    assertRouteList(`agents.${agent}`, routes)
  }
  for (const [stage, agent] of Object.entries(settings.stages)) {
    if (!STAGE_SET.has(stage)) throw new Error(`a2d2: unknown stage "${stage}"`)
    if (!AGENT_SET.has(agent)) throw new Error(`a2d2: unknown Agent "${agent}" for stage "${stage}"`)
  }
  return settings
}
