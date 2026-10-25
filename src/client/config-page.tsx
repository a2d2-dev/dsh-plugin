/**
 * A2D2 settings section: edit the stage Agent table and run explicit probes.
 *
 * The component talks only to the plugin-owned authenticated host route. It never
 * calls DSH settings for arbitrary namespaces from the browser.
 *
 * @module @deepseek-ai/dsh-a2d2/client/config-page
 */

import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import {
  CLOSED_HIGHWAY_STATIONS,
  MAIN_STATION_ROLES,
  MAIN_STATIONS,
  RAMP_MERGES,
  RAMP_STATIONS,
  ROADBED_STATIONS,
  SERVICE_STATIONS,
} from '../highway.ts'
import type { ClosedHighwayStation } from '../highway.ts'
import {
  DEFAULT_STAGE_AGENTS,
  STAGE_AGENTS,
  agentForStage,
  modelCandidatesForStage,
  shortModelRoute,
  stageAgentLabel,
  stageAgentWarnings,
  candidateRoute,
  candidateEffort,
} from '../stage-agent-data.ts'
import type { ModelCandidate, ModelEffortCatalog, Stage, StageAgent, StageAgentsSettings } from '../stage-agent-data.ts'
import { HighwayMap } from './highway-map.tsx'
import type { HighwayView, HighwayViewStation } from './highway-view.ts'
import css from './orb.module.css'

const CONFIG_ROUTE_PATH = '/a2d2/api/config'

type ConfigResponse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly latest?: ConfigSnapshot } }

interface ConfigSnapshot {
  readonly settings: StageAgentsSettings
  readonly revision?: number
  readonly warnings: readonly string[]
  readonly catalog?: readonly string[]
  readonly efforts?: ModelEffortCatalog
}

export type ProbeResult = { readonly status: 'pending' | 'normal' | 'refusal' | 'rate-limited' | 'error'; readonly reason: string }

/** The narrow `remote` face that lists the host's model catalog. */
interface ModelCatalogApi {
  readonly session: {
    modelCatalog(): Promise<
      | { readonly ok: true; readonly value: { readonly groups: readonly { readonly id: string; readonly models: readonly { readonly id: string }[] }[] } }
      | { readonly ok: false; readonly error: { readonly message: string } }
    >
  }
}

export interface A2d2ConfigInjected {
  readonly fetch: typeof fetch
  readonly loadModelRoutes: () => Promise<readonly string[]>
}

export type A2d2ConfigSectionProps = Partial<InjectFace<A2d2ConfigInjected>>

const MAIN_STATION_SET = new Set<string>(MAIN_STATIONS)
const CONFIG_STAGE_ROW_ORDER = [
  ...MAIN_STATIONS,
  ...SERVICE_STATIONS,
  ...RAMP_STATIONS,
  ...ROADBED_STATIONS,
  'standalone',
] as const
const DEFAULT_LOAD_MODEL_ROUTES = async (): Promise<readonly string[]> => []

type ConfigStationId = ClosedHighwayStation | 'standalone'
type ConfigCandidateScope = StageAgent | 'consult'

export interface ConfigCandidateRow {
  readonly scope: ConfigCandidateScope
  readonly label: string
  readonly group: string
  readonly routes: readonly ModelCandidate[]
}

const STATION_LABELS: Readonly<Record<ConfigStationId, string>> = {
  grill: '/grill · 澄清目标与约束',
  'to-spec': '/to-spec · 沉淀规格与验收',
  'to-tickets': '/to-tickets · 拆成可实施工单',
  implement: '/implement · 实现与 TDD',
  'code-review': '/code-review · 独立评审与收口',
  prototype: '/prototype · 服务区：原型验证',
  handoff: '/handoff · 服务区：交接',
  'diagnosing-bugs': '/diagnosing-bugs · 匝道，并入 implement',
  triage: '/triage · 匝道，并入 implement',
  wayfinder: '/wayfinder · 匝道，并入 to-spec',
  'improve-codebase-architecture': '/improve-codebase-architecture · 匝道，并入 grill',
  'domain-modeling': '/domain-modeling · 路基：领域建模',
  'codebase-design': '/codebase-design · 路基：模块设计',
  standalone: '独立区 · 其他 skill',
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
  const response = await api.session.modelCatalog()
  if (!response.ok) throw new Error(response.error.message)
  return response.value.groups.flatMap(group => group.models.map(model => `${group.id}/${model.id}`))
}

function cloneSettings(settings: StageAgentsSettings): StageAgentsSettings {
  return {
    stages: Object.fromEntries(
      CLOSED_HIGHWAY_STATIONS.map(stage => [stage, settings.stages[stage]]),
    ) as Record<Stage, StageAgent>,
    agents: Object.fromEntries(
      STAGE_AGENTS.map(agent => [agent, [...settings.agents[agent]]]),
    ) as Record<StageAgent, ModelCandidate[]>,
    consult: [...settings.consult],
  }
}

function routeKey(scope: ConfigCandidateScope, candidate: ModelCandidate): string {
  return `${scope}\u0000${candidateRoute(candidate)}\u0000${candidateEffort(candidate) ?? ''}`
}

function replaceCandidateList(
  settings: StageAgentsSettings,
  scope: ConfigCandidateScope,
  routes: readonly ModelCandidate[],
): StageAgentsSettings {
  if (scope === 'consult') return { ...settings, consult: [...routes] }
  return {
    ...settings,
    agents: {
      ...settings.agents,
      [scope]: [...routes],
    },
  }
}

export function normalizeConfigInjected(props: A2d2ConfigSectionProps): A2d2ConfigInjected {
  return {
    fetch: props.fetch ?? fetch,
    loadModelRoutes: props.loadModelRoutes ?? DEFAULT_LOAD_MODEL_ROUTES,
  }
}

export function setConfigStageAgent(settings: StageAgentsSettings, stage: Stage, agent: StageAgent): StageAgentsSettings {
  return {
    ...settings,
    stages: {
      ...settings.stages,
      [stage]: agent,
    },
  }
}

export function configCandidateRows(settings: StageAgentsSettings): readonly ConfigCandidateRow[] {
  return [
    ...STAGE_AGENTS.map((agent): ConfigCandidateRow => ({
      scope: agent,
      label: stageAgentLabel(agent),
      group: 'Agent 模型候选',
      routes: settings.agents[agent],
    })),
    {
      scope: 'consult',
      label: '咨询',
      group: '下一步咨询',
      routes: settings.consult,
    },
  ]
}

export function addConfigCandidate(
  settings: StageAgentsSettings,
  scope: ConfigCandidateScope,
  route: string,
  catalog: readonly string[],
): StageAgentsSettings {
  if (!catalog.includes(route)) throw new Error('只能从模型目录添加候选')
  const routes = scope === 'consult' ? settings.consult : settings.agents[scope]
  if (routes.some(candidate => candidateRoute(candidate) === route)) return settings
  return replaceCandidateList(settings, scope, [...routes, route])
}

export function removeConfigCandidate(
  settings: StageAgentsSettings,
  scope: ConfigCandidateScope,
  route: string,
): StageAgentsSettings {
  const routes = scope === 'consult' ? settings.consult : settings.agents[scope]
  if (routes.length <= 1) throw new Error('至少保留一个模型候选')
  return replaceCandidateList(settings, scope, routes.filter(item => candidateRoute(item) !== route))
}

export function moveConfigCandidate(
  settings: StageAgentsSettings,
  scope: ConfigCandidateScope,
  index: number,
  delta: -1 | 1,
): StageAgentsSettings {
  const routes = [...(scope === 'consult' ? settings.consult : settings.agents[scope])]
  const target = index + delta
  if (index < 0 || index >= routes.length || target < 0 || target >= routes.length) return settings
  const route = routes[index]!
  routes[index] = routes[target]!
  routes[target] = route
  return replaceCandidateList(settings, scope, routes)
}

/** Move the existing candidate intact, including its saved reasoning effort. */
export function reorderConfigCandidate(
  settings: StageAgentsSettings,
  scope: ConfigCandidateScope,
  sourceRoute: string,
  targetRoute: string,
): StageAgentsSettings {
  const routes = [...(scope === 'consult' ? settings.consult : settings.agents[scope])]
  const source = routes.findIndex(candidate => candidateRoute(candidate) === sourceRoute)
  const target = routes.findIndex(candidate => candidateRoute(candidate) === targetRoute)
  if (source < 0 || target < 0 || source === target) return settings
  const [candidate] = routes.splice(source, 1)
  routes.splice(target, 0, candidate!)
  return replaceCandidateList(settings, scope, routes)
}

export function setConfigCandidateEffort(
  settings: StageAgentsSettings,
  scope: ConfigCandidateScope,
  route: string,
  effort: string,
  catalog: ModelEffortCatalog,
): StageAgentsSettings {
  if (effort !== '' && !catalog[route]?.some(option => option.id === effort)) {
    throw new Error(`${route} 不支持推理强度 ${effort}`)
  }
  const routes = scope === 'consult' ? settings.consult : settings.agents[scope]
  return replaceCandidateList(settings, scope, routes.map(candidate => candidateRoute(candidate) !== route
    ? candidate : effort === '' ? route : { route, reasoningEffort: effort }))
}

export function configWarnings(settings: StageAgentsSettings): readonly string[] {
  return stageAgentWarnings(settings)
}

export function configHasChanges(settings: StageAgentsSettings, saved?: StageAgentsSettings): boolean {
  if (!saved) return false
  const sameCandidates = (left: readonly ModelCandidate[], right: readonly ModelCandidate[]) =>
    left.length === right.length && left.every((candidate, index) =>
      candidateRoute(candidate) === candidateRoute(right[index]!)
      && candidateEffort(candidate) === candidateEffort(right[index]!))
  return CLOSED_HIGHWAY_STATIONS.some(stage => settings.stages[stage] !== saved.stages[stage])
    || STAGE_AGENTS.some(agent => !sameCandidates(settings.agents[agent], saved.agents[agent]))
    || !sameCandidates(settings.consult, saved.consult)
}

export function configUpdatePayload(settings: StageAgentsSettings, revision: number): { readonly settings: StageAgentsSettings; readonly expectedRevision: number } {
  return { settings, expectedRevision: revision }
}

export function configHighwayView(settings: StageAgentsSettings, catalog?: readonly string[]): HighwayView {
  return {
    aside: '服务区、匝道、路基、独立区均为 Matt 流程的一部分；匝道并入点由插件固定。',
    stations: CONFIG_STAGE_ROW_ORDER.map((station): HighwayViewStation => ({
      id: station,
      role: stationRole(station),
      ...configStationAgentField(settings, station, catalog),
      state: 'ahead' as const,
    })),
  }
}

function configStationAgentField(
  settings: StageAgentsSettings,
  station: ConfigStationId,
  catalog: readonly string[] | undefined,
): Pick<HighwayViewStation, 'agent' | 'agentKey' | 'models'> {
  if (station === 'standalone') {
    return {
      agent: 'CEO（任意 skill）',
      models: candidateModelLabel(settings.agents.ceo, catalog),
    }
  }
  const agent = agentForStage(settings, station)
  return {
    agent: stageAgentLabel(agent),
    agentKey: agent,
    models: candidateModelLabel(modelCandidatesForStage(settings, station), catalog),
  }
}

function candidateModelLabel(routes: readonly ModelCandidate[], catalog: readonly string[] | undefined): string {
  if (routes.length === 0) return '未配置'
  const route = candidateRoute(routes[0]!)
  const label = shortModelRoute(route)
  // A configured candidate may predate the current catalog; show it and say so
  // instead of replacing the user's choice with "无可用模型".
  return catalog !== undefined && !catalog.includes(route) ? `${label}（目录外）` : label
}

function stationRole(station: ConfigStationId): string {
  if (MAIN_STATION_SET.has(station)) return MAIN_STATION_ROLES[station as keyof typeof MAIN_STATION_ROLES]
  if (station === 'prototype') return '服务区：原型验证'
  if (station === 'handoff') return '服务区：交接'
  if (station === 'domain-modeling') return '路基：领域建模'
  if (station === 'codebase-design') return '路基：模块设计'
  if (station === 'standalone') return '独立区：其他 skill'
  return `匝道，并入 ${RAMP_MERGES[station as keyof typeof RAMP_MERGES]}`
}

function probeLabel(status: ProbeResult['status']): string {
  switch (status) {
    case 'pending': return '测试中'
    case 'normal': return '正常'
    case 'refusal': return '拒答'
    case 'rate-limited': return '限流'
    case 'error': return '报错'
  }
}

export function probeResultText(result: ProbeResult): string {
  if (result.status === 'pending') return '测试中…'
  return `${probeLabel(result.status)} · ${result.reason}`
}

export function A2d2ConfigSection(props: A2d2ConfigSectionProps): ReactNode {
  const injected = useMemo(() => normalizeConfigInjected(props), [props.fetch, props.loadModelRoutes])
  const fetchImpl = injected.fetch
  const loadRoutes = injected.loadModelRoutes
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null)
  const [draft, setDraft] = useState<StageAgentsSettings>(() => cloneSettings(DEFAULT_STAGE_AGENTS))
  const [catalog, setCatalog] = useState<readonly string[]>([])
  const [status, setStatus] = useState<string>('加载中')
  const [saving, setSaving] = useState(false)
  const dragSource = useRef<{ scope: ConfigCandidateScope; route: string } | null>(null)
  const [draggedRoute, setDraggedRoute] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const clearDrag = () => {
    dragSource.current = null
    setDraggedRoute(null)
    setDropTarget(null)
  }
  const [probes, setProbes] = useState<Readonly<Record<string, ProbeResult | undefined>>>(EMPTY_PROBES)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const warnings = useMemo(() => configWarnings(draft), [draft])
  const rows = useMemo(() => configCandidateRows(draft), [draft])
  const dirty = configHasChanges(draft, snapshot?.settings)

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
        // Offer everything the host can name, not just one catalog: the
        // plugin's model routes, the session catalog, and any candidate the
        // configuration already carries (a stale route must stay re-addable).
        const configured = [...Object.values(config.settings.agents).flat(), ...config.settings.consult].map(candidateRoute)
        setCatalog([...new Set([...(config.catalog ?? []), ...routes, ...configured])])
        setStatus('已加载')
      } catch (error) {
        if (!alive) return
        setStatus(error instanceof Error ? error.message : String(error))
      }
    }
    void load()
    return () => { alive = false }
  }, [fetchImpl, loadRoutes])

  const setRoutes = (scope: ConfigCandidateScope, routes: readonly ModelCandidate[]): void => {
    setDraft(current => replaceCandidateList(current, scope, routes))
  }
  const save = async (): Promise<void> => {
    if (!dirty || saving || snapshot?.revision === undefined) return
    setSaving(true)
    setStatus('保存中')
    try {
      const saved = await callConfig<ConfigSnapshot>(fetchImpl, 'settings.update', configUpdatePayload(draft, snapshot.revision))
      setSnapshot({ ...saved, efforts: snapshot.efforts })
      setDraft(cloneSettings(saved.settings))
      setStatus('已保存')
    } catch (error) {
      const latest = (error as { latest?: ConfigSnapshot }).latest
      if (latest !== undefined) {
        setSnapshot({ ...latest, efforts: snapshot.efforts })
        setDraft(cloneSettings(latest.settings))
        setStatus('配置已被其他页面更新，已重新读取')
      } else {
        setStatus(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setSaving(false)
    }
  }
  const probe = async (scope: ConfigCandidateScope, candidate: ModelCandidate): Promise<void> => {
    const key = routeKey(scope, candidate)
    setProbes(current => ({ ...current, [key]: { status: 'pending', reason: '测试中' } }))
    try {
      const result = await callConfig<ProbeResult>(fetchImpl, 'probe', {
        route: candidateRoute(candidate),
        ...(candidateEffort(candidate) === undefined ? {} : { reasoningEffort: candidateEffort(candidate) }),
      })
      setProbes(current => ({ ...current, [key]: result }))
    } catch (error) {
      setProbes(current => ({
        ...current,
        [key]: { status: 'error', reason: error instanceof Error ? error.message : String(error) },
      }))
    }
  }

  const renderStationControl = (station: HighwayViewStation): ReactNode => {
    if (station.id === 'standalone') return createElement('span', { className: css.configNoSwitch }, 'CEO')
    return createElement('select', {
      className: css.configSelect,
      disabled: saving,
      'aria-label': `/${station.id} 负责角色`,
      value: station.agentKey ?? draft.stages[station.id],
      onChange: (event: ChangeEvent<HTMLSelectElement>) => {
        setDraft(current => setConfigStageAgent(current, station.id as Stage, event.currentTarget.value as StageAgent))
      },
    },
      ...STAGE_AGENTS.map(agent => createElement('option', { key: agent, value: agent }, stageAgentLabel(agent))),
    )
  }

  const renderRoutes = (row: ConfigCandidateRow): ReactNode => {
    const scope = row.scope
    const routes = row.routes
    const available = catalog.filter(route => !routes.some(candidate => candidateRoute(candidate) === route))
    const selectedRoute = selected[scope] ?? available[0] ?? ''
    return createElement('div', { className: css.configRoutes },
      ...routes.map((candidate, index) => {
        const route = candidateRoute(candidate)
        const effort = candidateEffort(candidate) ?? ''
        const metadataUnavailable = snapshot?.efforts === undefined || !Object.hasOwn(snapshot.efforts, route)
        const options = snapshot?.efforts?.[route] ?? []
        const unsupported = effort !== '' && !options.some(option => option.id === effort)
        const result = probes[routeKey(scope, candidate)]
        const separator = route.indexOf('/')
        const provider = separator < 0 ? '' : route.slice(0, separator)
        const model = separator < 0 ? route : route.slice(separator + 1)
        const dragKey = `${scope}:${route}`
        const sourceIndex = routes.findIndex(item => candidateRoute(item) === dragSource.current?.route)
        const canDrop = !saving && dragSource.current?.scope === scope && sourceIndex >= 0 && sourceIndex !== index
        return createElement('div', {
          className: `${css.configRoute} ${draggedRoute === dragKey ? css.configDragging : ''} ${dropTarget === dragKey && canDrop ? sourceIndex < index ? css.configDropAfter : css.configDropBefore : ''}`,
          key: route,
          'data-config-route': route,
          onDragOver: (event: DragEvent<HTMLDivElement>) => {
            if (!canDrop) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setDropTarget(dragKey)
          },
          onDragLeave: (event: DragEvent<HTMLDivElement>) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
            setDropTarget(current => current === dragKey ? null : current)
          },
          onDrop: (event: DragEvent<HTMLDivElement>) => {
            if (!canDrop || !dragSource.current) return
            event.preventDefault()
            const source = dragSource.current
            setDraft(current => reorderConfigCandidate(current, scope, source.route, route))
            setStatus('优先级已调整，保存后生效')
            clearDrag()
          },
        },
          createElement('div', { className: css.configRouteName, title: route },
            createElement('button', {
              className: css.configDragHandle,
              type: 'button',
              draggable: !saving && routes.length > 1,
              disabled: saving || routes.length <= 1,
              title: '拖动排序，或聚焦后按 ↑ / ↓ 调整优先级',
              'aria-label': `${row.label} ${route} 拖动排序，当前第 ${index + 1} 位`,
              onDragStart: (event: DragEvent<HTMLButtonElement>) => {
                if (saving || routes.length <= 1) { event.preventDefault(); return }
                dragSource.current = { scope, route }
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', route)
                const element = event.currentTarget.closest('[data-config-route]')
                if (element instanceof HTMLElement) event.dataTransfer.setDragImage(element, 16, 16)
                setDraggedRoute(dragKey)
              },
              onDragEnd: clearDrag,
              onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
                if (saving || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
                event.preventDefault()
                const delta = event.key === 'ArrowUp' ? -1 : 1
                if (index + delta < 0 || index + delta >= routes.length) return
                setDraft(current => moveConfigCandidate(current, scope, index, delta))
                setStatus(`${row.label} ${model} 已移至第 ${index + delta + 1} 位，保存后生效`)
              },
            }, createElement('span', { 'aria-hidden': true }, '⠿')),
            createElement('span', { className: css.configCandidateOrder, 'aria-label': `优先级 ${index + 1}` }, index + 1),
            createElement('div', { className: css.configModelIdentity },
              createElement('span', { className: css.configModelName }, model),
              createElement('div', { className: css.configModelDetails },
                createElement('span', { className: css.configProvider }, provider),
                options.length === 0 && effort === ''
                  ? createElement('span', {
                    className: css.configEffortNote,
                    title: metadataUnavailable ? '未能获取该模型的推理强度信息，当前保留宿主默认设置。' : '宿主未为该模型声明可选推理强度。',
                  }, metadataUnavailable ? '推理强度暂不可设置' : '未声明推理强度')
                  : createElement('select', {
                    className: css.configSelect,
                    'aria-label': `${row.label} ${route} 推理强度`,
                    value: effort,
                    disabled: saving || (options.length === 0 && effort === ''),
                    onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                      const value = event.currentTarget.value
                      setDraft(current => setConfigCandidateEffort(current, scope, route, value, snapshot?.efforts ?? {}))
                    },
                  },
                    createElement('option', { value: '' }, metadataUnavailable ? '默认（信息不可用）' : options.length === 0 ? '未声明推理强度' : '默认（未指定）'),
                    unsupported ? createElement('option', { value: effort }, `${effort}（${metadataUnavailable ? '元数据不可用' : '不受支持'}）`) : null,
                    ...options.map(option => createElement('option', { key: option.id, value: option.id }, option.name)),
                  ),
              ),
            ),
          ),
          createElement('div', { className: css.configRouteActions },
            createElement('button', {
              className: css.configButton,
              type: 'button',
              onClick: () => { void probe(scope, candidate) },
            }, '测试'),
            createElement('button', {
              className: css.configIconButton,
              type: 'button',
              title: '删除',
              'aria-label': `${row.label} ${route} 删除`,
              disabled: saving || routes.length <= 1,
              onClick: () => setRoutes(scope, routes.filter(item => candidateRoute(item) !== route)),
            }, '×'),
          ),
          result === undefined ? null : createElement('span', { className: css.configProbe }, probeResultText(result)),
        )
      }),
      createElement('div', { className: css.configAddRow },
        createElement('select', {
          className: css.configSelect,
          'aria-label': `${row.label} 添加模型候选`,
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
          disabled: saving || selectedRoute === '',
          onClick: () => {
            if (selectedRoute === '') return
            setDraft(current => addConfigCandidate(current, scope, selectedRoute, catalog))
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
        createElement('p', { className: css.configSubtitle, role: 'status', 'aria-live': 'polite' }, `状态：${status}`),
      ),
      dirty || saving ? createElement('button', { className: css.configSave, type: 'button', disabled: saving || snapshot?.revision === undefined, onClick: () => { void save() } }, saving ? '保存中…' : '保存') : null,
    ),
    createElement('section', { className: css.configSection },
      createElement('h3', { className: css.configSectionTitle }, 'Matt 工作流'),
      createElement(HighwayMap, { view: configHighwayView(draft, catalog), mode: 'editable', renderStationControl }),
      warnings.length === 0 ? null : createElement('div', { className: css.configWarning }, warnings.join('\n')),
      createElement('h3', { className: css.configSectionTitle }, '模型候选'),
      createElement('p', { className: css.configHelp }, '按顺序尝试模型。拖动左侧手柄排序，也可聚焦手柄后按 ↑ / ↓；保存后生效。'),
      createElement('div', { className: css.configRows },
        ...rows.map(row => createElement('article', { className: css.configRow, key: row.scope },
          createElement('div', { className: css.configRowHead },
            createElement('strong', null, row.label),
            row.scope === 'consult' ? createElement('span', null, row.group) : null,
          ),
          renderRoutes(row),
        )),
      ),
    ),
  )
}
