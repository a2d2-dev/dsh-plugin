import type { ContinuousWorkRule, HostExecutionChoices, HostResource, Project, ProjectAgent, WorkExecutionOptions, WorkExecutionSelection } from '../work-types.ts'
import { WorkExecutionError } from './host.ts'

type SelectionSource = NonNullable<WorkExecutionOptions['selectionSource']>
interface Preference<T> { value: T; source: SelectionSource }

/** Resolve stored preferences against current host catalogs and the Project Agent policy.
 * Reading options never changes remembered values; fallback requires human confirmation.
 */
export function resolveExecutionDefaults(project: Project, agent: ProjectAgent, rule: ContinuousWorkRule | undefined, choices: HostExecutionChoices, resources: HostResource[]): WorkExecutionOptions {
  const models = choices.models.filter(item => !agent.policy.modelCandidates.length || agent.policy.modelCandidates.includes(`${item.provider}/${item.model}`))
  const fallbackReasons: string[] = []
  const selectedSources: SelectionSource[] = []
  const labels = { remembered: '上次确认的', project: '项目配置的', host: '宿主默认的' }
  function select<T>(name: string, code: string, preferences: Preference<T>[], valid: (value: T) => boolean): T {
    for (const preference of preferences) {
      if (valid(preference.value)) { selectedSources.push(preference.source); return structuredClone(preference.value) }
      fallbackReasons.push(`${labels[preference.source]}${name}已不可用或不再被允许，已改用可用配置，请确认后启动。`)
    }
    throw new WorkExecutionError(code, `没有可用的${name}，请更新项目或宿主配置。`)
  }
  const preferred = <T>(remembered: T | undefined, configured: T | undefined, host: T | undefined): Preference<T>[] => [
    ...(remembered === undefined ? [] : [{ value: remembered, source: 'remembered' as const }]),
    ...(configured === undefined ? [] : [{ value: configured, source: 'project' as const }]),
    ...(host === undefined ? [] : [{ value: host, source: 'host' as const }]),
  ]
  const history = project.executionDefaults
  const resource = select('资源', 'unavailable-resource', [
    ...preferred(history?.resource, rule?.resource, undefined),
    ...project.resources.map(value => ({ value, source: 'project' as const })),
    ...resources.map(item => ({ value: item.ref, source: 'host' as const })),
  ], value => resources.some(item => item.ref.runtimeId === value.runtimeId && item.ref.workspaceId === value.workspaceId))
  const model = select<WorkExecutionSelection['model']>('模型', 'unavailable-model', [
    ...preferred(history?.model, rule?.model, undefined),
    ...agent.policy.modelCandidates.map(key => {
      const separator = key.indexOf('/')
      const value = `${choices.defaults.model.provider}/${choices.defaults.model.model}` === key ? choices.defaults.model
        : { provider: key.slice(0, separator), model: key.slice(separator + 1) }
      return { value, source: 'project' as const }
    }),
    ...preferred(undefined, undefined, choices.defaults.model),
    ...models.map(({ provider, model }) => ({ value: { provider, model }, source: 'host' as const })),
  ], value => models.some(item => item.provider === value.provider && item.model === value.model
    && (value.reasoningEffort === undefined || item.reasoningEfforts === undefined || item.reasoningEfforts.includes(value.reasoningEffort))))
  const agentPreset = select('Agent 预设', 'disallowed-agent-preset', [
    ...preferred(history?.agentPreset, rule?.agentPreset, choices.defaults.agentPreset),
    ...choices.agentPresets.map(value => ({ value, source: 'host' as const })),
  ], value => choices.agentPresets.includes(value))
  const permissionPreset = select('权限预设', 'disallowed-permission-preset', [
    ...preferred(history?.permissionPreset, rule?.permissionPreset, choices.defaults.permissionPreset),
    ...choices.permissionPresets.map(value => ({ value, source: 'host' as const })),
  ], value => choices.permissionPresets.includes(value))
  const selection = { resource, model, agentPreset, permissionPreset }
  return { ...choices, agentId: agent.id, models, resources, selection,
    defaults: { model, agentPreset, permissionPreset },
    selectionSource: selectedSources.every(source => source === 'remembered') ? 'remembered' : selectedSources.includes('project') || selectedSources.includes('remembered') ? 'project' : 'host',
    fallbackReasons: [...new Set(fallbackReasons)],
  }
}
