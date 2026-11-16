/** Browser-safe contract shared by the A2D2 Bot host route and settings page. */

export const BOT_CONFIG_ROUTE_PATH = '/a2d2/api/bot'
export const GROK_BOT_TOOLS = ['grok_bot_list', 'grok_bot_ask', 'grok_bot_wait'] as const

export interface BotSettings {
  readonly enabled: boolean
  readonly defaultBot: string
}

export interface BotSettingsState {
  readonly settings: BotSettings
  readonly revision: number | undefined
}

export interface BotSettingsSnapshot extends BotSettingsState {
  readonly missingTools: readonly string[]
}
