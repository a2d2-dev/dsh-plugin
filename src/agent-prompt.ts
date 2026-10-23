/**
 * Scoped engineer/reviewer system prompt sections for A2D2 Agent sessions.
 *
 * CEO sessions keep their dedicated prompt module. This module covers the other
 * two A2D2 Agents: it installs a section only for sessions recorded as engineer
 * or reviewer, rereading the global and project Agent configuration files on
 * every system prompt assembly.
 *
 * @module @a2d2/dsh-a2d2/src/agent-prompt
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { StageAgent } from './stage-agents.ts'
import type {} from './index.ts'

/** Cordis plugin name of the engineer/reviewer prompt half. */
export const name = 'a2d2-agent-prompt'

/** Services needed to install scoped prompt sections on live Agents. */
export const inject = ['agents', 'systemPrompt', 'a2d2']

/** Prompt section name visible in system prompt assembly. */
export const AGENT_PROMPT_SECTION = 'a2d2:agent'

/** Plugin configuration for tests and deployments. */
export interface Config {
  /** Directory containing global engineer.md and reviewer.md; defaults to ~/.dsh/a2d2/agents. */
  readonly globalAgentsDir?: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Emitted after a non-main session is recorded as an A2D2 Agent. */
    'a2d2/session-agent-recorded'(payload: {
      cwd: string
      projectRoot: string
      session: SessionId
      agent: StageAgent
    }): void | Promise<void>
  }
}

interface AgentsService {
  list(): readonly Agent[]
}

interface ScopedSystemPrompt {
  section(section: { readonly name: string; readonly order: number; readonly text: () => string; readonly interpolate?: boolean }): () => void
  getSectionOrder(name: 'TEAM_POLICY'): number
}

const DEFAULT_GLOBAL_AGENTS_DIR = join(homedir(), '.dsh', 'a2d2', 'agents')

type ConfiguredAgent = Extract<StageAgent, 'engineer' | 'reviewer'>

function readExisting(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  const text = readFileSync(path, 'utf8')
  return text.trim() === '' ? undefined : text
}

function titleOf(agent: ConfiguredAgent): string {
  return agent === 'engineer' ? 'Engineer' : 'Reviewer'
}

function renderAgentPrompt(globalAgentsDir: string, projectRoot: string, agent: ConfiguredAgent): string {
  const globalText = readExisting(join(globalAgentsDir, `${agent}.md`))
  const projectText = readExisting(join(projectRoot, '.dsh', 'a2d2', 'agents', `${agent}.md`))
  if (globalText === undefined && projectText === undefined) return ''
  const sections = [
    `# A2D2 ${titleOf(agent)}`,
    'This scoped section applies only when this session is recorded as this A2D2 Agent.',
  ]
  if (globalText !== undefined) sections.push('## Global Agent configuration', globalText)
  if (projectText !== undefined) sections.push('## Project Agent configuration (priority over global Agent configuration)', projectText)
  return sections.join('\n\n')
}

function sessionCwd(agent: Agent): string {
  return agent.session.header.cwd ?? ''
}

function agentSystemPrompt(agent: Agent): ScopedSystemPrompt {
  return (agent.ctx as unknown as { readonly systemPrompt: ScopedSystemPrompt }).systemPrompt
}

function install(agent: Agent, projectRoot: string, globalAgentsDir: string, configuredAgent: ConfiguredAgent): () => void {
  const systemPrompt = agentSystemPrompt(agent)
  return systemPrompt.section({
    name: AGENT_PROMPT_SECTION,
    order: systemPrompt.getSectionOrder('TEAM_POLICY') + 20,
    text: () => renderAgentPrompt(globalAgentsDir, projectRoot, configuredAgent),
    interpolate: false,
  })
}

function isConfiguredAgent(agent: StageAgent | undefined): agent is ConfiguredAgent {
  return agent === 'engineer' || agent === 'reviewer'
}

/** Register scoped prompt sections for engineer and reviewer sessions. */
export function apply(ctx: Context, config: Config = {}): void {
  const globalAgentsDir = resolve(config.globalAgentsDir ?? DEFAULT_GLOBAL_AGENTS_DIR)
  const installed = new Map<Agent, () => void>()
  const agents = ctx.get('agents') as unknown as AgentsService

  const uninstall = (agent: Agent): void => {
    installed.get(agent)?.()
    installed.delete(agent)
  }

  const installOnce = (agent: Agent, projectRoot: string, configuredAgent: ConfiguredAgent): void => {
    if (installed.has(agent)) return
    installed.set(agent, install(agent, projectRoot, globalAgentsDir, configuredAgent))
  }

  const maybeInstall = async (agent: Agent): Promise<void> => {
    if (installed.has(agent)) return
    const cwd = sessionCwd(agent)
    if (cwd === '') return
    const configuredAgent = await ctx.a2d2.agentOfSession(cwd, agent.id)
    if (!isConfiguredAgent(configuredAgent)) return
    installOnce(agent, await ctx.a2d2.projectRoot(cwd), configuredAgent)
  }

  const logInstallError = (agent: Agent, error: unknown): void => {
    ctx.logger.error(`a2d2: failed to install Agent prompt section for session "${agent.id}": ${String(error)}`)
  }

  for (const agent of agents.list()) void maybeInstall(agent).catch(error => { logInstallError(agent, error) })
  ctx.on('agent/created', async ({ agent }) => {
    try {
      await maybeInstall(agent)
    } catch (error) {
      logInstallError(agent, error)
    }
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => {
    uninstall(agent)
  })
  ctx.on('a2d2/session-agent-recorded', ({ session }) => {
    const agent = agents.list().find(candidate => candidate.id === session)
    if (agent === undefined) return undefined
    return maybeInstall(agent).catch(error => {
      logInstallError(agent, error)
      return undefined
    })
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'a2d2.agentPrompt()')
}
