/**
 * A2D2 settings section: edit the station model table and run explicit probes.
 *
 * The component talks only to the plugin-owned trusted host route. It never
 * calls DSH settings for arbitrary namespaces from the browser.
 *
 * @module @deepseek-ai/dsh-a2d2/client/config-page
 */

import { createElement, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { MAIN_STATION_ROLES, MAIN_STATIONS, RAMP_MERGES, ROADBED_STATIONS, SERVICE_STATIONS } from '../highway.ts'
import type { MainStation } from '../highway.ts'
import {
  DEFAULT_STATION_MODELS,
  STATION_MODEL_STATIONS,
  shortModelRoute,
  stationModelWarnings,
} from '../station-model-data.ts'
import type { Station, StationModelsSettings } from '../station-model-data.ts'
import { HighwayMap } from './highway-map.tsx'
import css from './orb.module.css'

const CONFIG_ROUTE_PATH = '/a2d2/api/config'

type ConfigResponse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly latest?: ConfigSnapshot } }

interface ConfigSnapshot {
  readonly settings: StationModelsSettings
  readonly revision?: number
  readonly warnings: readonly string[]
}

type ProbeResult = { readonly status: 'normal' | 'refusal' | 'rate-limited' | 'error'; readonly reason: string }

interface ModelCatalogApi {
  readonly llm: {
    models(payload: Record<string, never>): Promise<{
      readonly result:
        | { readonly ok: true; readonly value: { readonly groups: readonly { readonly id: string; readonly models: readonly { readonly id: string }[] }[] } }
        | { readonly ok: false; readonly error: { readonly message: string } }
    }>
  }
}

export interface A2d2ConfigInjected {
  readonly fetch: typeof fetch
  readonly loadModelRoutes: () => Promise<readonly string[]>
}

export type A2d2ConfigSectionProps = Partial<InjectFace<A2d2ConfigInjected>>

const MAIN_STATION_SET = new Set<string>(MAIN_STATIONS)

const STATION_LABELS: Readonly<Record<Station, string>> = {
  grill: '/grill · 澄清目标与约束',
  'to-spec': '/to-spec · 沉淀规格与验收',
  'to-tickets': '/to-tickets · 拆成可实施工单',
  implement: '/implement · 实现与 TDD',
  'code-review': '/code-review · 独立评审与收口',
  prototype: '/prototype · 服务区：原型验证',
  'diagnosing-bugs': '/diagnosing-bugs · 匝道，并入 implement',
  triage: '/triage · 匝道，并入 implement',
  wayfinder: '/wayfinder · 匝道，并入 to-spec',
  'improve-codebase-architecture': '/improve-codebase-architecture · 匝道，并入 grill',
}

const EMPTY_PROBES: Readonly<Record<string, ProbeResult | undefined>> = Object.freeze({})

function isConfigResponse<T>(value: unknown): value is ConfigResponse<T> {
  return value !== null && typeof value === 'object' && 'ok' in value
}

async function callConfig<T>(fetchImpl: typeof fetch, method: string, payload: unknown): Promise<T> {
  const response = await fetchImpl(CONFIG_ROUTE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, payload }),
  })
  const body: unknown = await response.json()
  if (!isConfigResponse<T>(body)) throw new Error('A2D2 配置路由返回了无效响应')
  if (body.ok) return body.value
  const error = new Error(body.error.message) as Error & { code?: string; latest?: ConfigSnapshot }
  error.code = body.error.code
  error.latest = body.error.latest
  throw error
}

export async function loadModelRouteCatalog(api: ModelCatalogApi | undefined): Promise<readonly string[]> {
  if (api === undefined) return []
  const response = await api.llm.models({})
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value.groups.flatMap(group => group.models.map(model => `${group.id}/${model.id}`))
}

function cloneSettings(settings: StationModelsSettings): StationModelsSettings {
  return {
    stations: Object.fromEntries(
      STATION_MODEL_STATIONS.map(station => [station, [...settings.stations[station]]]),
    ) as Record<Station, string[]>,
    consult: [...settings.consult],
  }
}

function routeKey(scope: 'consult' | Station, route: string): string {
  return `${scope}\u0000${route}`
}

function replaceList(settings: StationModelsSettings, scope: 'consult' | Station, routes: readonly string[]): StationModelsSettings {
  if (scope === 'consult') return { ...settings, consult: [...routes] }
  return {
    ...settings,
    stations: {
      ...settings.stations,
      [scope]: [...routes],
    },
  }
}

function routesOf(settings: StationModelsSettings, scope: 'consult' | Station): readonly string[] {
  return scope === 'consult' ? settings.consult : settings.stations[scope]
}

function mainHighwayView(settings: StationModelsSettings) {
  return {
    stations: MAIN_STATIONS.map(station => ({
      id: station,
      role: MAIN_STATION_ROLES[station],
      models: shortModelRoute(settings.stations[station][0] ?? ''),
      state: 'ahead' as const,
    })),
  }
}

function probeLabel(status: ProbeResult['status']): string {
  switch (status) {
    case 'normal': return '正常'
    case 'refusal': return '拒答'
    case 'rate-limited': return '限流'
    case 'error': return '报错'
  }
}

function groupLabel(station: Station): string {
  if (MAIN_STATION_SET.has(station)) return '主干'
  if (station === 'prototype') return '服务区'
  return '匝道'
}

export function A2d2ConfigSection(props: A2d2ConfigSectionProps): ReactNode {
  const fetchImpl = props.fetch ?? fetch
  const loadRoutes = props.loadModelRoutes ?? (async () => [])
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null)
  const [draft, setDraft] = useState<StationModelsSettings>(() => cloneSettings(DEFAULT_STATION_MODELS))
  const [catalog, setCatalog] = useState<readonly string[]>([])
  const [status, setStatus] = useState<string>('加载中')
  const [saving, setSaving] = useState(false)
  const [probes, setProbes] = useState<Readonly<Record<string, ProbeResult | undefined>>>(EMPTY_PROBES)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const warnings = useMemo(() => stationModelWarnings(draft), [draft])

  useEffect(() => {
    let alive = true
    async function load(): Promise<void> {
      setStatus('加载中')
      try {
        const [config, routes] = await Promise.all([
          callConfig<ConfigSnapshot>(fetchImpl, 'settings.get', {}),
          loadRoutes(),
        ])
        if (!alive) return
        setSnapshot(config)
        setDraft(cloneSettings(config.settings))
        setCatalog(routes)
        setStatus('已加载')
      } catch (error) {
        if (!alive) return
        setStatus(error instanceof Error ? error.message : String(error))
      }
    }
    void load()
    return () => { alive = false }
  }, [fetchImpl, loadRoutes])

  const setRoutes = (scope: 'consult' | Station, routes: readonly string[]): void => {
    setDraft(current => replaceList(current, scope, routes))
  }
  const save = async (): Promise<void> => {
    setSaving(true)
    setStatus('保存中')
    try {
      const saved = await callConfig<ConfigSnapshot>(fetchImpl, 'settings.update', {
        settings: draft,
        expectedRevision: snapshot?.revision,
      })
      setSnapshot(saved)
      setDraft(cloneSettings(saved.settings))
      setStatus('已保存')
    } catch (error) {
      const latest = (error as { latest?: ConfigSnapshot }).latest
      if (latest !== undefined) {
        setSnapshot(latest)
        setDraft(cloneSettings(latest.settings))
        setStatus('配置已被其他页面更新，已重新读取')
      } else {
        setStatus(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setSaving(false)
    }
  }
  const probe = async (scope: 'consult' | Station, route: string): Promise<void> => {
    const key = routeKey(scope, route)
    setProbes(current => ({ ...current, [key]: { status: 'normal', reason: '测试中' } }))
    try {
      const result = await callConfig<ProbeResult>(fetchImpl, 'probe', { route })
      setProbes(current => ({ ...current, [key]: result }))
    } catch (error) {
      setProbes(current => ({
        ...current,
        [key]: { status: 'error', reason: error instanceof Error ? error.message : String(error) },
      }))
    }
  }

  const renderRoutes = (scope: 'consult' | Station): ReactNode => {
    const routes = routesOf(draft, scope)
    const available = catalog.filter(route => !routes.includes(route))
    const selectedRoute = selected[scope] ?? available[0] ?? ''
    return createElement('div', { className: css.configRoutes },
      ...routes.map((route, index) => {
        const result = probes[routeKey(scope, route)]
        return createElement('div', { className: css.configRoute, key: route },
          createElement('span', { className: css.configRouteName }, route),
          createElement('button', {
            className: css.configIconButton,
            type: 'button',
            title: '上移',
            disabled: index === 0,
            onClick: () => setRoutes(scope, [...routes.slice(0, index - 1), route, routes[index - 1]!, ...routes.slice(index + 1)]),
          }, '↑'),
          createElement('button', {
            className: css.configIconButton,
            type: 'button',
            title: '下移',
            disabled: index === routes.length - 1,
            onClick: () => setRoutes(scope, [...routes.slice(0, index), routes[index + 1]!, route, ...routes.slice(index + 2)]),
          }, '↓'),
          createElement('button', {
            className: css.configButton,
            type: 'button',
            onClick: () => { void probe(scope, route) },
          }, '测试'),
          createElement('button', {
            className: css.configIconButton,
            type: 'button',
            title: '删除',
            disabled: routes.length <= 1,
            onClick: () => setRoutes(scope, routes.filter(item => item !== route)),
          }, '×'),
          result === undefined ? null : createElement('span', { className: css.configProbe }, `${probeLabel(result.status)} · ${result.reason}`),
        )
      }),
      createElement('div', { className: css.configAddRow },
        createElement('select', {
          className: css.configSelect,
          value: selectedRoute,
          onChange: (event: ChangeEvent<HTMLSelectElement>) => setSelected(current => ({ ...current, [scope]: event.currentTarget.value })),
        },
          available.length === 0
            ? createElement('option', { value: '' }, '模型目录没有更多候选')
            : available.map(route => createElement('option', { key: route, value: route }, route)),
        ),
        createElement('button', {
          className: css.configButton,
          type: 'button',
          disabled: selectedRoute === '',
          onClick: () => {
            if (selectedRoute === '') return
            setRoutes(scope, [...routes, selectedRoute])
            setSelected(current => ({ ...current, [scope]: '' }))
          },
        }, '添加'),
      ),
    )
  }

  return createElement('section', { className: css.configPage },
    createElement('header', { className: css.configHeader },
      createElement('div', null,
        createElement('h2', { className: css.configTitle }, 'A2D2 配置'),
        createElement('p', { className: css.configSubtitle }, `状态：${status}`),
      ),
      createElement('button', { className: css.configSave, type: 'button', disabled: saving, onClick: () => { void save() } }, '保存'),
    ),
    createElement('section', { className: css.configSection },
      createElement('h3', { className: css.configSectionTitle }, 'Matt 流程'),
      createElement(HighwayMap, { view: mainHighwayView(draft), mode: 'editable' }),
      warnings.length === 0 ? null : createElement('div', { className: css.configWarning }, warnings.join('\n')),
      createElement('div', { className: css.configRoadExtras },
        createElement('span', null, `服务区：${SERVICE_STATIONS.join(' / ')}`),
        createElement('span', null, `路基：${ROADBED_STATIONS.join(' / ')}`),
        createElement('span', null, `匝道：${Object.entries(RAMP_MERGES).map(([station, merge]) => `${station} → ${merge}`).join(' / ')}`),
        createElement('span', null, '独立区：任意独立 skill'),
      ),
      createElement('div', { className: css.configRows },
        createElement('article', { className: css.configRow },
          createElement('div', { className: css.configRowHead },
            createElement('strong', null, '咨询'),
            createElement('span', null, '下一步咨询自身使用的模型候选'),
          ),
          renderRoutes('consult'),
        ),
        ...STATION_MODEL_STATIONS.map(station => createElement('article', { className: css.configRow, key: station },
          createElement('div', { className: css.configRowHead },
            createElement('strong', null, STATION_LABELS[station]),
            createElement('span', null, groupLabel(station)),
          ),
          renderRoutes(station),
        )),
      ),
    ),
  )
}
