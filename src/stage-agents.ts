/**
 * Host-side stage Agent table.
 *
 * The table has one chain for execution routing: stage -> Agent -> ordered
 * provider/model candidates. Standalone skills are intentionally not listed;
 * they use CEO by policy when a caller needs an Agent outside the closed highway.
 *
 * @module @deepseek-ai/dsh-a2d2/src/stage-agents
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_STAGE_AGENTS,
  STAGE_AGENTS,
  STAGE_AGENT_STAGES,
  THINKING_MODEL_ROUTES,
  stageAgentDefaultAgents,
  stageAgentDefaultStages,
} from './stage-agent-data.ts'
import type { StageAgent, StageAgentsSettings } from './stage-agent-data.ts'

export {
  CODING_MODEL_ROUTES,
  DEFAULT_STAGE_AGENTS,
  STAGE_AGENTS,
  STAGE_AGENT_SETTINGS_NAMESPACE,
  STAGE_AGENT_STAGES,
  THINKING_MODEL_ROUTES,
  agentForStage,
  modelCandidatesForStage,
  shortModelRoute,
  splitModelRoute,
  stageAgentWarnings,
} from './stage-agent-data.ts'
export type { Stage, StageAgent, StageAgentsSettings } from './stage-agent-data.ts'

const ROUTE_PATTERN = /^[^/\s]+\/[^/\s]+$/u
const STAGE_SET = new Set<string>(STAGE_AGENT_STAGES)
const AGENT_SET = new Set<string>(STAGE_AGENTS)
const defaultStages = stageAgentDefaultStages()
const defaultAgents = stageAgentDefaultAgents()

const routeSchema = z.string().pattern(ROUTE_PATTERN)
const routeListSchema = z.array(routeSchema).min(1)

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
    return { ...defaultAgents, ...(value as Partial<Record<StageAgent, string[]>>) }
  },
)

export const StageAgentsSettingsSchema: z<StageAgentsSettings> = z.object({
  stages: stagesSchema.default(defaultStages),
  agents: agentsSchema.default(defaultAgents),
  consult: routeListSchema.default([...THINKING_MODEL_ROUTES]),
}).default({
  stages: defaultStages,
  agents: defaultAgents,
  consult: [...THINKING_MODEL_ROUTES],
}) as z<StageAgentsSettings>

export function validateStageAgentsSettings(value: unknown): StageAgentsSettings {
  const settings = StageAgentsSettingsSchema(structuredClone(value) as never)
  if (settings.consult.length === 0) {
    throw new Error('a2d2: consult must name at least one model route')
  }
  for (const [agent, routes] of Object.entries(settings.agents)) {
    if (routes.length === 0) throw new Error(`a2d2: agents.${agent} must name at least one model route`)
  }
  for (const [stage, agent] of Object.entries(settings.stages)) {
    if (!STAGE_SET.has(stage)) throw new Error(`a2d2: unknown stage "${stage}"`)
    if (!AGENT_SET.has(agent)) throw new Error(`a2d2: unknown Agent "${agent}" for stage "${stage}"`)
  }
  return settings
}
