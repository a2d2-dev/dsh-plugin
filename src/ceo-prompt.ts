/**
 * Scoped CEO system prompt for A2D2 main sessions.
 *
 * The section is installed on the Agent scope of a session only while that
 * session is known as a task issue's main session. The text provider rereads the
 * method files and SOUL files on every assembly, so changed principles are used
 * by the next model request without restarting the session.
 *
 * @module @a2d2/dsh-a2d2/src/ceo-prompt
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from './index.ts'

/** Cordis plugin name of the CEO prompt half. */
export const name = 'a2d2-ceo-prompt'

/** Services needed to install scoped prompt sections on live Agents. */
export const inject = ['agents', 'systemPrompt', 'a2d2']

/** Prompt section name visible in system prompt assembly. */
export const CEO_PROMPT_SECTION = 'a2d2:ceo'

/** Plugin configuration for the CEO prompt mount row. */
export interface Config {
  /** Directory containing the shipped CEO method AGENTS.md and WAKE.md files. */
  readonly agentFilesDir?: string
  /** Directory containing the global CEO SOUL.md; defaults to ~/.dsh/a2d2. */
  readonly globalSoulDir?: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Emitted after a task issue's main session is bound or moved to another session. */
    'a2d2/main-session-changed'(payload: {
      cwd: string
      projectRoot: string
      issue: number
      previousMainSession?: SessionId
      mainSession: SessionId
    }): void
  }
}

interface AgentsService {
  list(): readonly Agent[]
}

interface ScopedSystemPrompt {
  section(section: { readonly name: string; readonly order: number; readonly text: () => string; readonly interpolate?: boolean }): () => void
  getSectionOrder(name: 'TEAM_POLICY'): number
}

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_AGENT_FILES_DIR = join(PACKAGE_ROOT, 'ceo')
const DEFAULT_GLOBAL_SOUL_DIR = join(homedir(), '.dsh', 'a2d2')

function readExisting(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  return readFileSync(path, 'utf8')
}

function requiredFile(title: string, path: string): string {
  return [`## ${title}`, readExisting(path) ?? `Missing ${title}: ${path}`].join('\n\n')
}

function soulFile(title: string, path: string): string {
  return [`## ${title}`, readExisting(path) ?? `Missing ${title}: ${path}`].join('\n\n')
}

function renderCeoPrompt(agentFilesDir: string, globalSoulDir: string, projectRoot: string): string {
  return [
    '# A2D2 CEO',
    'This scoped section applies only when this session is the main session of a task issue.',
    `CEO method files directory: ${agentFilesDir}`,
    'When AGENTS.md or WAKE.md names another CEO method file, read it with the file-read tool from that absolute directory.',
    requiredFile('AGENTS.md', join(agentFilesDir, 'AGENTS.md')),
    requiredFile('WAKE.md', join(agentFilesDir, 'WAKE.md')),
    soulFile('Global SOUL', join(globalSoulDir, 'SOUL.md')),
    soulFile('Project SOUL (priority over global SOUL)', join(projectRoot, '.dsh', 'a2d2', 'SOUL.md')),
  ].join('\n\n')
}

function sessionCwd(agent: Agent): string {
  return agent.session.header.cwd ?? ''
}

function agentSystemPrompt(agent: Agent): ScopedSystemPrompt {
  return (agent.ctx as unknown as { readonly systemPrompt: ScopedSystemPrompt }).systemPrompt
}

function install(agent: Agent, projectRoot: string, agentFilesDir: string, globalSoulDir: string): () => void {
  const systemPrompt = agentSystemPrompt(agent)
  return systemPrompt.section({
    name: CEO_PROMPT_SECTION,
    order: systemPrompt.getSectionOrder('TEAM_POLICY') + 10,
    text: () => renderCeoPrompt(agentFilesDir, globalSoulDir, projectRoot),
    interpolate: false,
  })
}

/**
 * Register scoped CEO prompt sections for main-session Agents.
 * @param ctx - context carrying live Agents, system prompt support, and A2D2.
 * @param config - optional file locations for tests and deployments.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const agentFilesDir = resolve(config.agentFilesDir ?? DEFAULT_AGENT_FILES_DIR)
  const globalSoulDir = resolve(config.globalSoulDir ?? DEFAULT_GLOBAL_SOUL_DIR)
  const installed = new Map<Agent, () => void>()
  const agents = ctx.get('agents') as unknown as AgentsService

  const installOnce = (agent: Agent, projectRoot: string): void => {
    if (installed.has(agent)) return
    installed.set(agent, install(agent, projectRoot, agentFilesDir, globalSoulDir))
  }

  const uninstallSession = (sessionId: SessionId): void => {
    const agent = agents.list().find(candidate => candidate.id === sessionId)
    if (agent === undefined) return
    installed.get(agent)?.()
    installed.delete(agent)
  }

  const maybeInstall = async (agent: Agent): Promise<void> => {
    if (installed.has(agent)) return
    const cwd = sessionCwd(agent)
    if (cwd === '') return
    const task = await ctx.a2d2.taskOfMainSession(cwd, agent.id)
    if (task === undefined) return
    installOnce(agent, await ctx.a2d2.projectRoot(cwd))
  }

  for (const agent of agents.list()) void maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => {
    void maybeInstall(agent)
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.on('a2d2/main-session-changed', ({ previousMainSession, mainSession, projectRoot }) => {
    if (previousMainSession !== undefined && previousMainSession !== mainSession) uninstallSession(previousMainSession)
    const agent = agents.list().find(candidate => candidate.id === mainSession)
    if (agent !== undefined) installOnce(agent, projectRoot)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'a2d2.ceoPrompt()')
}
