/**
 * Client-safe stage Agent table data and helpers.
 *
 * Keep schema code out of this module: the browser bundle imports it directly,
 * and the client purity guard rejects host-only validation dependencies.
 *
 * @module @deepseek-ai/dsh-a2d2/src/stage-agent-data
 */

import { CLOSED_HIGHWAY_STATIONS } from './highway.ts'
import type { ClosedHighwayStation } from './highway.ts'

export const THINKING_MODEL_ROUTES = [
  'claude-bray/claude-fable-5-1',
  'codex/gpt-6',
] as const

export const CODING_MODEL_ROUTES = [
  'codex/gpt-5.5',
  'claude-bray/claude-opus-5-5',
] as const

export const STAGE_AGENTS = ['ceo', 'engineer', 'reviewer'] as const

export type StageAgent = typeof STAGE_AGENTS[number]

export const STAGE_AGENT_LABELS: Readonly<Record<StageAgent, string>> = {
  ceo: 'CEO',
  engineer: '工程师',
  reviewer: '评审',
}

export const STAGE_AGENT_STAGES = CLOSED_HIGHWAY_STATIONS

export type Stage = ClosedHighwayStation

export interface StageAgentRouteSettings {
  readonly stages: Readonly<Record<Stage, StageAgent>>
  readonly agents: Readonly<Record<StageAgent, readonly string[]>>
}

export interface StageAgentsSettings extends StageAgentRouteSettings {
  readonly consult: readonly string[]
}

const DEFAULT_STAGE_BY_AGENT: Record<StageAgent, readonly Stage[]> = {
  ceo: STAGE_AGENT_STAGES.filter(stage => stage !== 'implement' && stage !== 'code-review'),
  engineer: ['implement'],
  reviewer: ['code-review'],
}

const defaultStages = Object.fromEntries(
  STAGE_AGENTS.flatMap(agent => DEFAULT_STAGE_BY_AGENT[agent].map(stage => [stage, agent])),
) as Record<Stage, StageAgent>

const defaultAgents: Record<StageAgent, readonly string[]> = {
  ceo: THINKING_MODEL_ROUTES,
  engineer: CODING_MODEL_ROUTES,
  reviewer: THINKING_MODEL_ROUTES,
}

export const DEFAULT_STAGE_AGENTS: StageAgentsSettings = Object.freeze({
  stages: Object.freeze(Object.fromEntries(
    Object.entries(defaultStages).map(([stage, agent]) => [stage, agent]),
  ) as Record<Stage, StageAgent>),
  agents: Object.freeze(Object.fromEntries(
    Object.entries(defaultAgents).map(([agent, routes]) => [agent, Object.freeze([...routes])]),
  ) as Record<StageAgent, readonly string[]>),
  consult: Object.freeze([...THINKING_MODEL_ROUTES]),
})

export function stageAgentDefaultStages(): Record<Stage, StageAgent> {
  return Object.fromEntries(
    STAGE_AGENT_STAGES.map(stage => [stage, defaultStages[stage]]),
  ) as Record<Stage, StageAgent>
}

export function stageAgentDefaultAgents(): Record<StageAgent, string[]> {
  return Object.fromEntries(
    STAGE_AGENTS.map(agent => [agent, [...defaultAgents[agent]]]),
  ) as Record<StageAgent, string[]>
}

export function stageAgentWarnings(settings: StageAgentsSettings): readonly string[] {
  const reviewer = settings.agents.reviewer[0]
  const engineer = settings.agents.engineer[0]
  if (reviewer !== undefined && reviewer === engineer) {
    return [`a2d2: 评审和工程师的首选模型同为 ${reviewer}；通常应为评审配置不同的首选模型`]
  }
  return []
}

export function stageAgentLabel(agent: StageAgent): string {
  return STAGE_AGENT_LABELS[agent]
}

export function agentForStage(settings: StageAgentRouteSettings, stage: Stage): StageAgent {
  return settings.stages[stage]
}

export function modelCandidatesForStage(settings: StageAgentRouteSettings, stage: Stage): readonly string[] {
  return settings.agents[agentForStage(settings, stage)]
}

export function splitModelRoute(route: string): { readonly provider: string; readonly model: string } {
  const slash = route.indexOf('/')
  return { provider: route.slice(0, slash), model: route.slice(slash + 1) }
}

export function shortModelRoute(route: string): string {
  const slash = route.indexOf('/')
  return slash < 0 ? route : route.slice(slash + 1)
}
