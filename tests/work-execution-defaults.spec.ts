import { mkdtemp, cp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkApplication, WorkDao } from '../src/work.ts'
import type { WorkHost } from '../src/work.ts'
import { WorkExecutionError } from '../src/work-execution/host.ts'
import type { HostExecutionChoices, Project, WorkCommand, WorkCompleted, WorkExecutionSelection, WorkResult } from '../src/work-types.ts'
import type { GitHubIssue, GitHubSourcePort } from '../src/work-sources/types.ts'
import { ExecutionFixtures } from './work-execution-fixture.ts'

const roots: string[] = []
const fixtures: ExecutionFixtures[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.close()
  for (const root of roots.splice(0)) {
    const target = resolve(root)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('execution-defaults-')) throw new Error('Unexpected temporary test root')
    await rm(target, { recursive: true, force: true })
  }
})
const operator = { operator: true }
const resource = { runtimeId: 'host', workspaceId: 'attached' }
const freeResource = { runtimeId: 'host', workspaceId: 'free' }
const otherResource = { runtimeId: 'host', workspaceId: 'other' }
const model = { provider: 'catalog', model: 'host', reasoningEffort: 'high' }
const confirmed: WorkExecutionSelection = { resource, model: { provider: 'catalog', model: 'confirmed', reasoningEffort: 'medium' }, agentPreset: 'confirmed-agent', permissionPreset: 'confirmed-permission' }
const ruleSelection: WorkExecutionSelection = { resource, model: { provider: 'catalog', model: 'rule', reasoningEffort: 'low' }, agentPreset: 'rule-agent', permissionPreset: 'rule-permission' }
function completed(result: WorkResult): WorkCompleted { expect(result, JSON.stringify(result)).toHaveProperty('status', 'completed'); return result as WorkCompleted }
class Host implements WorkHost {
  catalog: HostExecutionChoices = { models: [model, confirmed.model, ruleSelection.model, { provider: 'catalog', model: 'policy' }], agentPresets: ['host-agent', confirmed.agentPreset, ruleSelection.agentPreset], permissionPresets: ['host-permission', confirmed.permissionPreset, ruleSelection.permissionPreset], defaults: { model, agentPreset: 'host-agent', permissionPreset: 'host-permission' } }
  availableResources = [freeResource, resource, otherResource]
  failAdmission?: string
  resources = async () => this.availableResources.map(ref => ({ ref, title: ref.workspaceId }))
  sessions = async () => []
  execution: NonNullable<WorkHost['execution']> = {
    connect: () => {}, choices: async () => structuredClone(this.catalog),
    check: async request => {
      if (this.failAdmission) throw new WorkExecutionError(this.failAdmission, 'Host rejected exact request')
      if (!this.catalog.permissionPresets.includes(request.permissionPreset)) throw new WorkExecutionError('invalid-permission-preset', 'Permission preset is unavailable')
      if (request.session.runtimeId !== request.resource.runtimeId) throw new WorkExecutionError('incompatible-session', 'Session belongs to another runtime')
      if (!this.catalog.models.some(item => item.provider === request.model.provider && item.model === request.model.model)) throw new WorkExecutionError('unavailable-model', 'Model unavailable')
      return structuredClone(this.catalog)
    },
    status: () => 'idle',
    ensure: async execution => ({ runtimeId: execution.resource.runtimeId, cwd: '/workspace', agentPreset: execution.agentPreset, ...execution.model, permissionPreset: execution.permissionPreset, sandbox: 'workspace-write', approval: 'never' }),
    settle: async () => {}, wake: async () => {}, observe: async () => 'consumed', deliver: async () => 'consumed',
  }
}
const issue: GitHubIssue = { nodeId: 'ISSUE_1', number: 1, title: 'Queued Issue', url: 'https://github.com/acme/repo/issues/1', body: 'Accepted implementation scope', repository: { owner: 'acme', repository: 'repo' }, assignees: [], labels: [], state: 'open', updatedAt: '2026-01-01T00:00:00.000Z', observedAt: '2026-01-01T00:00:00.000Z', parent: null, dependencies: { availability: 'available', blockedBy: { items: [], totalCount: 0, hasNextPage: false } }, subIssues: { items: [], totalCount: 0, hasNextPage: false } }
const source: GitHubSourcePort = {
  list: async () => { throw new Error('Project only') }, detail: async () => { throw new Error('Project only') },
  project: async () => ({ identity: { login: 'alice', nodeId: 'ALICE', name: null }, project: { nodeId: 'PROJECT', title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/1', closed: false }, items: [{ id: 'ITEM_1', kind: 'issue', archived: false, issueNodeId: issue.nodeId, fields: [], fieldsPartial: false }], issues: [issue], observedAt: issue.observedAt }),
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'execution-defaults-')); roots.push(directory)
  const host = new Host(), app = new WorkApplication(directory, host, source)
  const connection = completed(await app.execute({ type: 'source.connect', commandId: 'connect', githubProject: { owner: 'acme', type: 'org', number: 1 }, resource }, operator))
  const project = connection.project!, scope = { projectId: project.id, sourceId: connection.source!.id }
  const createTask = async (id: string) => {
    const task = completed(await app.execute({ type: 'task.create', commandId: id, projectId: project.id, title: id, goal: 'Implement agreed scope', specification: 'Agreed scope', acceptance: ['Pass acceptance'] }, operator)).task!
    return { projectId: project.id, taskId: task.id }
  }
  const ref = await createTask('task')
  const start = (selection = confirmed, extra: Record<string, unknown> = {}) => ({ type: 'task.start' as const, commandId: 'start', ref, expectedVersion: 1, agentId: project.defaultAgentId, ...selection, ...extra })
  const configure = (selection = ruleSelection, extra: Record<string, unknown> = {}) => ({ type: 'continuous.configure' as const, commandId: 'configure', ...scope, expectedVersion: 0, assignee: '*' as const, labels: [], enabled: false, ...selection, ...extra })
  const options = async (current = app) => completed(await current.query({ type: 'task.execution-options', ref }, operator)).executionOptions!
  const storedProject = async (current = app) => completed(await current.query({ type: 'project.detail', projectId: project.id }, operator)).project!
  const mutate = async (fn: (p: Project) => void) => WorkDao.forDirectory(directory).transaction(async state => fn(state.projects.find(p => p.id === project.id)!))
  return { directory, app, host, project, scope, ref, createTask, start, configure, options, storedProject, mutate }
}

it('prefers attached project resources before unowned catalog entries and keeps host reasoning effort', async () => {
  const h = await setup()
  const options = completed(await h.app.query({ type: 'source.execution-options', ...h.scope }, operator)).executionOptions!
  expect(options.resources.map(item => item.ref)).toEqual([freeResource, resource, otherResource])
  expect(options.selection).toEqual({ resource, model, agentPreset: 'host-agent', permissionPreset: 'host-permission' })
  expect(options.defaults.model.reasoningEffort).toBe('high')
  expect(options.fallbackReasons).toEqual([])
  expect((await h.options()).resources.map(item => item.ref)).toEqual([resource])
  expect((await h.storedProject()).executionDefaults).toBeUndefined()
})

it('persists all four confirmed fields across a new service and cold store without leaking across projects', async () => {
  const h = await setup()
  completed(await h.app.execute(h.start(), operator))
  expect((await h.storedProject()).executionDefaults).toEqual(confirmed)
  const disk = JSON.parse(await readFile(join(h.directory, 'work-v3.json'), 'utf8'))
  expect(disk.projects[0].executionDefaults).toEqual(confirmed)
  const coldDirectory = await mkdtemp(join(tmpdir(), 'execution-defaults-cold-')); roots.push(coldDirectory)
  await cp(h.directory, coldDirectory, { recursive: true })
  const restored = new WorkApplication(coldDirectory, h.host, source)
  expect(await h.options(restored)).toMatchObject({ selection: confirmed, selectionSource: 'remembered', defaults: { model: confirmed.model, agentPreset: confirmed.agentPreset, permissionPreset: confirmed.permissionPreset }, fallbackReasons: [] })
  const other = completed(await restored.execute({ type: 'source.connect', commandId: 'other-project', githubProject: { owner: 'acme', type: 'org', number: 2 }, resource: otherResource }, operator))
  const options = completed(await restored.query({ type: 'source.execution-options', projectId: other.project!.id, sourceId: other.source!.id }, operator)).executionOptions!
  expect(options.selection).toEqual({ resource: otherResource, model, agentPreset: 'host-agent', permissionPreset: 'host-permission' })
  expect(options.resources.map(item => item.ref)).not.toContainEqual(resource)
})

it('supports remember opt-out on task.start and continuous.configure', async () => {
  const h = await setup()
  completed(await h.app.execute(h.start(confirmed, { rememberExecutionDefaults: false }), operator))
  expect((await h.storedProject()).executionDefaults).toBeUndefined()
  completed(await h.app.execute(h.configure(ruleSelection, { rememberExecutionDefaults: false }), operator))
  expect((await h.storedProject()).executionDefaults).toBeUndefined()
  expect((await h.options()).selection).toEqual(ruleSelection)
  expect((await h.options()).selectionSource).toBe('project')
})

it('remembers continuous.configure by default and does not overwrite newer history on command replay', async () => {
  const h = await setup(), command = h.configure()
  completed(await h.app.execute(command, operator))
  expect((await h.storedProject()).executionDefaults).toEqual(ruleSelection)
  completed(await h.app.execute(h.start(), operator))
  completed(await h.app.execute(command, operator))
  expect((await h.storedProject()).executionDefaults).toEqual(confirmed)
})

it('does not overwrite newer history on replay or on an existing execution with a fresh command id', async () => {
  const h = await setup(), command = h.start()
  const first = completed(await h.app.execute(command, operator)).execution!
  const secondRef = await h.createTask('second-task')
  completed(await h.app.execute({ ...h.start(ruleSelection), commandId: 'second-start', ref: secondRef }, operator))
  expect((await h.storedProject()).executionDefaults).toEqual(ruleSelection)
  expect(completed(await h.app.execute(command, operator)).execution!.id).toBe(first.id)
  completed(await h.app.execute({ ...command, commandId: 'existing-start' }, operator))
  expect((await h.storedProject()).executionDefaults).toEqual(ruleSelection)
})

it.each(['resource', 'model', 'agentPreset', 'permissionPreset'] as const)('falls back only an unavailable remembered %s and exposes a Chinese reason', async field => {
  const h = await setup()
  const bad = { resource: { runtimeId: 'missing', workspaceId: 'deleted' }, model: { provider: 'missing', model: 'deleted', reasoningEffort: 'high' }, agentPreset: 'deleted-agent', permissionPreset: 'deleted-permission' }
  await h.mutate(p => { p.executionDefaults = { ...confirmed, [field]: bad[field] } })
  const options = await h.options()
  expect(options.selection).toEqual({ ...confirmed, [field]: field === 'resource' ? resource : field === 'model' ? model : field === 'agentPreset' ? 'host-agent' : 'host-permission' })
  expect(options.fallbackReasons).toHaveLength(1)
  expect(options.fallbackReasons![0]).toMatch(/上次确认的.*已不可用或不再被允许.*请确认后启动/)
  expect((await h.storedProject()).executionDefaults).toEqual({ ...confirmed, [field]: bad[field] })
})

it('uses history before the continuous rule, rule before Agent policy, and policy before host model order', async () => {
  const h = await setup()
  completed(await h.app.execute(h.configure(ruleSelection, { rememberExecutionDefaults: false }), operator))
  await WorkDao.forDirectory(h.directory).transaction(async state => { state.agents[0]!.policy.modelCandidates = ['catalog/policy', 'catalog/rule', 'catalog/confirmed', 'catalog/host'] })
  expect((await h.options()).selection).toEqual(ruleSelection)
  await h.mutate(p => { p.executionDefaults = structuredClone(confirmed) })
  expect((await h.options()).selection).toEqual(confirmed)
  await h.mutate(p => { p.executionDefaults = { permissionPreset: confirmed.permissionPreset } })
  expect((await h.options()).selection).toEqual({ ...ruleSelection, permissionPreset: confirmed.permissionPreset })
  await WorkDao.forDirectory(h.directory).transaction(async state => { delete state.continuousRules; delete state.projects[0]!.executionDefaults })
  expect((await h.options()).selection!.model).toEqual({ provider: 'catalog', model: 'policy' })
  expect((await h.options()).fallbackReasons).toEqual([])
})

it('rejects remembered models excluded by policy and skips unavailable rule fields with visible reasons', async () => {
  const h = await setup()
  completed(await h.app.execute(h.configure(), operator))
  await WorkDao.forDirectory(h.directory).transaction(async state => {
    state.projects[0]!.executionDefaults = structuredClone(confirmed)
    state.agents[0]!.policy.modelCandidates = ['catalog/policy', 'catalog/host']
    state.continuousRules![0]!.agentPreset = 'removed-rule-agent'
    state.continuousRules![0]!.permissionPreset = 'removed-rule-permission'
    state.projects[0]!.executionDefaults!.agentPreset = 'removed-agent'
    state.projects[0]!.executionDefaults!.permissionPreset = 'removed-permission'
  })
  const options = await h.options()
  expect(options.selection).toEqual({ resource, model: { provider: 'catalog', model: 'policy' }, agentPreset: 'host-agent', permissionPreset: 'host-permission' })
  expect(options.models.map(item => item.model)).toEqual(['host', 'policy'])
  expect(options.fallbackReasons).toEqual(expect.arrayContaining([expect.stringContaining('上次确认的模型'), expect.stringContaining('项目配置的模型'), expect.stringContaining('项目配置的Agent 预设'), expect.stringContaining('项目配置的权限预设')]))
})

it('does not mutate remembered defaults on host rejection, stale version, invalid policy, or invalid session', async () => {
  const h = await setup()
  await h.mutate(p => { p.executionDefaults = structuredClone(ruleSelection) })
  for (const [id, extra, code] of [
    ['permission', { permissionPreset: 'removed-permission' }, 'invalid-permission-preset'],
    ['session', { session: { runtimeId: 'foreign', sessionId: 'existing' } }, 'incompatible-session'],
    ['version', { expectedVersion: 99 }, 'version-conflict'],
    ['preset', { agentPreset: 'removed-agent' }, 'disallowed-agent-preset'],
  ] as const) {
    expect(await h.app.execute(h.start(confirmed, { commandId: id, ...extra }), operator)).toMatchObject({ error: { code } })
    expect((await h.storedProject()).executionDefaults).toEqual(ruleSelection)
  }
  h.host.failAdmission = 'invalid-permission-preset'
  expect(await h.app.execute(h.configure(), operator)).toMatchObject({ error: { code: 'invalid-permission-preset' } })
  expect((await h.storedProject()).executionDefaults).toEqual(ruleSelection)
  h.host.failAdmission = undefined
  await WorkDao.forDirectory(h.directory).transaction(async state => { state.agents[0]!.policy.modelCandidates = ['catalog/rule'] })
  expect(await h.app.execute(h.start(), operator)).toMatchObject({ error: { code: 'disallowed-model' } })
  expect((await h.storedProject()).executionDefaults).toEqual(ruleSelection)
})

it('preserves host reasoning effort when explicit Agent policy selects that model', async () => {
  const h = await setup()
  await WorkDao.forDirectory(h.directory).transaction(async state => { state.agents[0]!.policy.modelCandidates = ['catalog/host'] })
  expect((await h.options()).selection!.model).toEqual(model)
})

it('falls back all four fields when a previously admitted selection disappears from live catalogs', async () => {
  const h = await setup()
  completed(await h.app.execute(h.start(), operator))
  await h.mutate(p => { p.resources.push(freeResource) })
  h.host.availableResources = [freeResource, otherResource]
  h.host.catalog.models = [model]
  h.host.catalog.agentPresets = ['host-agent']
  h.host.catalog.permissionPresets = ['host-permission']
  const options = await h.options()
  expect(options.selection).toEqual({ resource: freeResource, model, agentPreset: 'host-agent', permissionPreset: 'host-permission' })
  expect(options.fallbackReasons).toEqual(expect.arrayContaining(['资源', '模型', 'Agent 预设', '权限预设'].map(field => expect.stringContaining(`上次确认的${field}`))))
  expect((await h.storedProject()).executionDefaults).toEqual(confirmed)
})

it('keeps manually remembered defaults when the continuous scheduler admits automatic starts', async () => {
  const h = await setup()
  completed(await h.app.query({ type: 'source.issues', ...h.scope, page: 1, perPage: 100, state: 'open', assignee: '*', refresh: true }, operator))
  const configured = completed(await h.app.execute(h.configure(), operator)).continuousRule!
  completed(await h.app.execute(h.start(), operator))
  const enabled = completed(await h.app.execute({ type: 'continuous.set-enabled', commandId: 'enable', ...h.scope, expectedVersion: configured.version, enabled: true }, operator)).continuousRule!
  expect(enabled.items[0]!.executionId).toBeDefined()
  const queued = completed(await h.app.query({ type: 'task.execution', ref: enabled.items[0]!.ref! }, operator)).execution!
  expect(queued.model).toEqual(ruleSelection.model)
  expect((await h.storedProject()).executionDefaults).toEqual(confirmed)
})

it('falls back when remembered reasoning effort is retired and keeps catalog metadata out of model selections', async () => {
  const h = await setup()
  const saved = { ...confirmed, model: { ...model, reasoningEffort: 'retired' } }
  await h.mutate(p => { p.executionDefaults = saved })
  h.host.catalog.models = h.host.catalog.models.map(item => ({ provider: item.provider, model: item.model, reasoningEfforts: ['high'] }))
  const options = await h.options()
  expect(options.selection!.model).toEqual(model)
  expect(options.fallbackReasons).toEqual([expect.stringContaining('上次确认的模型')])
  expect((await h.storedProject()).executionDefaults!.model!.reasoningEffort).toBe('retired')
  await h.mutate(p => { p.executionDefaults = { permissionPreset: confirmed.permissionPreset } })
  expect((await h.options()).selectionSource).toBe('project')
})

it('preserves real host invalid-permission and incompatible-session checks while remembering is enabled', async ({ signal }) => {
  const fixture = new ExecutionFixtures(signal); fixtures.push(fixture)
  const h = await fixture.mount(await fixture.root())
  const refResource = { runtimeId: 'runtime', workspaceId: h.workspace.id }
  const project = completed(await h.app.execute({ type: 'project.create', commandId: 'real-project', name: 'Real boundary', resource: refResource }, operator)).project!
  const task = completed(await h.app.execute({ type: 'task.create', commandId: 'real-task', projectId: project.id, title: 'Boundary', goal: 'Keep host validation', specification: 'Keep existing permissions', acceptance: ['Reject unsafe selection'] }, operator)).task!
  const command: Extract<WorkCommand, { type: 'task.start' }> = { type: 'task.start', commandId: 'bad-permission', ref: { projectId: project.id, taskId: task.id }, expectedVersion: task.version, agentId: project.defaultAgentId, resource: refResource, model: { provider: 'contract', model: 'selected' }, agentPreset: 'contract', permissionPreset: 'missing', rememberExecutionDefaults: true }
  expect(await h.app.execute(command, operator)).toMatchObject({ status: 'failed', error: { code: 'invalid-permission-preset' } })
  expect(await h.app.execute({ ...command, commandId: 'bad-session', permissionPreset: 'workspace-write', session: { runtimeId: 'runtime', sessionId: 'missing-session' } }, operator)).toMatchObject({ status: 'failed', error: { code: 'incompatible-session' } })
  expect(completed(await h.app.query({ type: 'project.detail', projectId: project.id }, operator)).project!.executionDefaults).toBeUndefined()
})
