/** Settings page for the optional Grok Bot tools used by A2D2 CEOs. */

import { createElement, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { BotSettings, BotSettingsSnapshot } from '../bot-contract.ts'
import css from './orb.module.css'

const BOT_CONFIG_ROUTE_PATH = '/a2d2/api/bot'

type BotConfigResponse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly latest?: BotSettingsSnapshot } }

export interface BotSettingsInjected {
  readonly fetch: typeof fetch
}

export type BotSettingsSectionProps = Partial<InjectFace<BotSettingsInjected>>

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSnapshot(value: unknown): value is BotSettingsSnapshot {
  if (!isRecord(value) || !isRecord(value.settings) || !Array.isArray(value.missingTools)) return false
  return typeof value.settings.enabled === 'boolean'
    && typeof value.settings.defaultBot === 'string'
    && value.missingTools.every(tool => typeof tool === 'string')
    && (value.revision === undefined || typeof value.revision === 'number')
}

async function callBotConfig<T>(fetchImpl: typeof fetch, method: string, payload: unknown): Promise<T> {
  const response = await fetchImpl(BOT_CONFIG_ROUTE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, payload }),
  })
  const body: unknown = await response.json()
  if (!isRecord(body) || typeof body.ok !== 'boolean') throw new Error('A2D2 Bot 路由返回了无效响应')
  if (body.ok) return body.value as T
  const error = isRecord(body.error) ? body.error : {}
  const failure = new Error(typeof error.message === 'string' ? error.message : 'A2D2 Bot 设置请求失败') as Error & {
    latest?: BotSettingsSnapshot
  }
  if (isSnapshot(error.latest)) failure.latest = error.latest
  throw failure
}

function copySettings(settings: BotSettings): BotSettings {
  return { enabled: settings.enabled, defaultBot: settings.defaultBot }
}

export function BotSettingsSection(props: BotSettingsSectionProps): ReactNode {
  const fetchImpl = useMemo(() => props.fetch ?? globalThis.fetch.bind(globalThis), [props.fetch])
  const [snapshot, setSnapshot] = useState<BotSettingsSnapshot>()
  const [draft, setDraft] = useState<BotSettings>({ enabled: false, defaultBot: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('读取中')
  const [error, setError] = useState('')
  const dirty = snapshot !== undefined
    && (draft.enabled !== snapshot.settings.enabled || draft.defaultBot !== snapshot.settings.defaultBot)

  useEffect(() => {
    let active = true
    setLoading(true)
    void callBotConfig<BotSettingsSnapshot>(fetchImpl, 'settings.get', {}).then(value => {
      if (!active || !isSnapshot(value)) return
      setSnapshot(value)
      setDraft(copySettings(value.settings))
      setStatus('已读取')
      setError('')
    }).catch((reason: unknown) => {
      if (!active) return
      setStatus('读取失败')
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [fetchImpl])

  const save = async (): Promise<void> => {
    if (!snapshot || snapshot.revision === undefined) {
      setError('当前设置没有可用版本，无法保存。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const next = await callBotConfig<BotSettingsSnapshot>(fetchImpl, 'settings.update', {
        settings: copySettings(draft),
        expectedRevision: snapshot.revision,
      })
      if (!isSnapshot(next)) throw new Error('A2D2 Bot 路由返回了无效设置。')
      setSnapshot(next)
      setDraft(copySettings(next.settings))
      setStatus('已保存')
    } catch (reason) {
      const latest = reason instanceof Error ? (reason as Error & { latest?: BotSettingsSnapshot }).latest : undefined
      if (latest) setSnapshot(latest)
      setStatus(latest ? '设置已更新' : '保存失败')
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const missingTools = snapshot?.missingTools ?? []
  return createElement('section', { className: css.configPage },
    createElement('header', { className: css.configHeader },
      createElement('div', null,
        createElement('h2', { className: css.botTitle }, 'A²D² Bot'),
        createElement('p', { className: css.configSubtitle, role: 'status', 'aria-live': 'polite' }, `状态：${status}`),
      ),
      dirty || saving
        ? createElement('button', {
          className: css.configSave,
          type: 'button',
          disabled: saving || loading || snapshot?.revision === undefined,
          onClick: () => { void save() },
        }, saving ? '保存中…' : '保存')
        : null,
    ),
    snapshot === undefined
      ? createElement('p', { className: error ? css.configWarning : css.configHelp, role: error ? 'alert' : 'status' }, error || (loading ? '读取中…' : '设置不可用'))
      : createElement('div', { className: css.configSection },
        createElement('div', { className: missingTools.length > 0 ? css.configWarning : css.configHelp, role: 'status' },
          missingTools.length === 0
            ? 'Grok Bot 工具已挂载；账号未检查。'
            : createElement('span', null,
              createElement('span', { title: `缺少：${missingTools.join(', ')}` }, 'Grok Bot 工具不完整。'),
              ' ',
              createElement('a', { href: 'https://github.com/Lniosy/dsh-tool-grok-bot', target: '_blank', rel: 'noreferrer', 'aria-label': '安装 Grok Bot 插件' }, '安装'),
            ),
        ),
        createElement('div', { className: css.botSettingsRow },
          createElement('div', { className: css.botSettingsCopy },
            createElement('strong', null, '任务主会话可委派 Bot'),
            createElement('p', null, '飞书聊天绑定为任务主会话后即可委派。'),
          ),
          createElement('label', { className: css.botSwitchLabel },
            createElement('input', {
              type: 'checkbox',
              role: 'switch',
              'aria-label': '启用任务主会话的 Bot 委派',
              checked: draft.enabled,
              disabled: saving || loading,
              onChange: (event: { currentTarget: { checked: boolean } }) => {
                const enabled = event.currentTarget.checked
                setDraft(current => ({ ...current, enabled }))
              },
            }),
          ),
        ),
        createElement('label', { className: css.botSettingsRow },
          createElement('span', { className: css.botSettingsCopy },
            createElement('strong', null, '默认 Bot'),
            createElement('span', { className: css.configHelp }, '留空时由当前处理会话选择。'),
          ),
          createElement('input', {
            className: css.configSelect,
            type: 'text',
            'aria-label': '默认 Bot 名称或 ID',
            maxLength: 256,
            autoComplete: 'off',
            spellCheck: false,
            value: draft.defaultBot,
            disabled: saving || loading,
            placeholder: 'Bot 名称',
            onChange: (event: { currentTarget: { value: string } }) => {
              const defaultBot = event.currentTarget.value
              setDraft(current => ({ ...current, defaultBot }))
            },
          }),
        ),
        error === '' ? null : createElement('p', { className: css.configWarning, role: 'alert' }, error),
      ),
  )
}
