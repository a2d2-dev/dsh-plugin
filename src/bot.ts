/** Optional A2D2 integration for the separate DSH Grok Bot tool plugin. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { BoundTask } from './types.ts'
import type {} from './index.ts'
import { createBotConfigHandler } from './bot-config.ts'
import { BOT_CONFIG_ROUTE_PATH, GROK_BOT_TOOLS } from './bot-contract.ts'
import type { BotSettings } from './bot-contract.ts'

/** Cordis plugin name of the optional A2D2 Bot configuration and prompt half. */
export const name = 'a2d2-bot'

/** DSH services needed for settings, tool detection, and A²D² task ownership. */
export const inject = ['tools', 'settings', 'a2d2']

const SETTINGS_NAMESPACE = 'a2d2-bot'

export interface Config {
  readonly enabled: Volatile<boolean>
  readonly defaultBot: Volatile<string>
}

export const Config = z.object({
  enabled: z.boolean().default(false).volatile(),
  defaultBot: z.string().default('').volatile(),
}) as z<Config>

interface ToolCatalog {
  get(name: string): { readonly name: string } | undefined
}

interface SettingsRuntime {
  describe(): readonly { readonly ns: string; readonly value: unknown; readonly revision: number }[]
  replace(ns: string, section: object, expectedRevision?: number): Promise<void>
  configure(options: { auto?: boolean }, owner?: unknown): () => void
}

interface WebServer {
  register(route: {
    readonly kind: 'exact'
    readonly path: string
    readonly handler: ReturnType<typeof createBotConfigHandler>
  }): () => void
}

interface RouteConnection {
  requestRejection(request: Parameters<Parameters<typeof createBotConfigHandler>[0]['requestRejection']>[0]): 401 | 403 | undefined
}

interface ScopedSystemPrompt {
  section(section: { readonly name: string; readonly order: number; readonly text: () => string; readonly interpolate?: boolean }): () => void
  getSectionOrder(name: 'TEAM_POLICY'): number
}

function missingTools(tools: ToolCatalog): string[] {
  return GROK_BOT_TOOLS.filter(tool => tools.get(tool) === undefined)
}

function savedSettings(config: Config, value: unknown): BotSettings {
  const record = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : config.enabled.get(),
    defaultBot: typeof record.defaultBot === 'string' ? record.defaultBot : config.defaultBot.get(),
  }
}

export function botPromptText(settings: BotSettings, missing: readonly string[], task?: Pick<BoundTask, 'state'>): string {
  const defaultBot = settings.defaultBot.trim()
  if (!settings.enabled || missing.length > 0 || task?.state !== 'active') return ''
  return [
    '## External Grok Bot collaboration',
    defaultBot === ''
      ? 'For a bounded independent check, find an available target with `grok_bot_list` before calling it.'
      : `Preferred external Bot name or id (literal): ${JSON.stringify(defaultBot)}. Use another target only when the task calls for it.`,
    'Use `grok_bot_ask` to send a bounded request and `grok_bot_wait` to collect its reply; the request returns a wait id, so continue other authorized work while it is pending.',
    'A Grok Bot is an external collaborator, not a DSH Session, Project Agent, child session, or task acceptance. Its cloud computer and memory are separate from this project. Share only the context needed for the request, then verify its reply before using it as evidence.',
  ].join('\n')
}

function promptForAgent(agent: Agent): ScopedSystemPrompt {
  return (agent.ctx as unknown as { readonly systemPrompt: ScopedSystemPrompt }).systemPrompt
}

/** Install optional Bot settings and scoped CEO guidance. */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], settingsCtx => {
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      'a2d2 bot settings presentation',
    )
  })

  ctx.inject(['webServer', 'connection', 'settings'], routeCtx => {
    const server = routeCtx.get('webServer') as unknown as WebServer | undefined
    const connection = routeCtx.get('connection') as unknown as RouteConnection | undefined
    const settings = routeCtx.get('settings') as unknown as SettingsRuntime | undefined
    if (server === undefined || connection === undefined || settings === undefined) return

    const getSettings = () => {
      const descriptor = settings.describe().find(entry => entry.ns === SETTINGS_NAMESPACE)
      return {
        settings: savedSettings(config, descriptor?.value),
        revision: descriptor?.revision,
      }
    }
    const tools = ctx.tools as unknown as ToolCatalog
    const handler = createBotConfigHandler({
      requestRejection: request => connection.requestRejection(request),
      getSettings,
      updateSettings: async (value, expectedRevision) => {
        await settings.replace(SETTINGS_NAMESPACE, value, expectedRevision)
        return getSettings()
      },
      missingTools: () => missingTools(tools),
    })
    routeCtx.effect(
      () => server.register({ kind: 'exact', path: BOT_CONFIG_ROUTE_PATH, handler }),
      'a2d2 bot settings route',
    )
  })

  ctx.inject(['systemPrompt'], promptCtx => {
    const tools = ctx.tools as unknown as ToolCatalog
    const installed = new Map<Agent, () => void>()

    const install = (agent: Agent, task: BoundTask): void => {
      if (installed.has(agent)) return
      const systemPrompt = promptForAgent(agent)
      installed.set(agent, systemPrompt.section({
        name: 'a2d2:bot',
        order: systemPrompt.getSectionOrder('TEAM_POLICY') + 11,
        text: () => botPromptText({ enabled: config.enabled.get(), defaultBot: config.defaultBot.get() }, missingTools(tools), task),
        interpolate: false,
      }))
    }
    const uninstall = (agent: Agent): void => {
      installed.get(agent)?.()
      installed.delete(agent)
    }
    promptCtx.on('agent/pre-step', async ({ agent }, next) => {
      const cwd = agent.session.header.cwd ?? ''
      const task = config.enabled.get() && missingTools(tools).length === 0
        ? await ctx.a2d2.taskOfMainSession(cwd, agent.id)
        : undefined
      if (task?.state === 'active') install(agent, task)
      else uninstall(agent)
      return await next()
    }, { prepend: true })
    promptCtx.on('agent/disposed', ({ agent }) => {
      uninstall(agent)
      return undefined
    })
    promptCtx.effect(() => () => {
      for (const dispose of installed.values()) dispose()
      installed.clear()
    }, 'a2d2 bot CEO prompt')
  })
}
