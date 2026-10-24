import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Projections from '@deepseek-ai/dsh-session-projection'
import SessionQuery from '@deepseek-ai/dsh-session-query'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import Workspaces from '@deepseek-ai/dsh-workspace'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import Presets from '@deepseek-ai/dsh-agent-preset-registry'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import FileSystem from '@deepseek-ai/dsh-fs-sandbox'
import Bash from '@deepseek-ai/dsh-bash-sandbox'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import { ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import Permissions from '@deepseek-ai/dsh-permission-presets'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import Approval from '@deepseek-ai/dsh-user-approval'
import { Model } from './work-execution-fixture.ts'
import { StubCommands } from './stubs.ts'
import { createRootSession } from '../src/root-session.ts'
import { selectSessionModel } from '../src/official-session.ts'
import { DshWorkExecutionHost } from '../src/work-execution/dsh-host.ts'
import type { WorkExecution } from '../src/work-types.ts'

async function events(ctx: Context, id: ReturnType<typeof SessionId>) {
  using observation = await ctx.sessionQuery.observeSession(id)
  return observation.events.slice()
}

class Query extends SessionQuery {
  async searchSessions(): Promise<never> { throw new Error('Search is outside this fixture') }
  async searchEvents(): Promise<never> { throw new Error('Search is outside this fixture') }
}
const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) {
    if (!root.startsWith(resolve(tmpdir()) + '/a2d2-official-') || await realpath(root) !== root) throw new Error('Unexpected fixture cleanup path')
    await rm(root, { recursive: true, force: true })
  }
})
async function mount(existingRoot?: string) {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'a2d2-official-'))
  if (!existingRoot) roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  const model = new Model()
  ctx.llm.registerAdapter(['contract'], model)
  await ctx.plugin(DefaultModel, { provider: 'contract', model: 'default' })
  await ctx.plugin(SessionStore)
  await ctx.plugin(Projections)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const nativeExecutor = await import(pathToFileURL(join(process.env.DSH_OFFICIAL_HOST_ROOT!, 'packages/core/tool-executor-native/lib/index.js')).href)
  await ctx.plugin(nativeExecutor)
  await ctx.plugin(AgentRegistry)
  const persistencePlugin = JsonlPersistence as unknown as { apply(ctx: Context, config: { root: string }): Promise<void> }
  await ctx.plugin(persistencePlugin, { root: join(root, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Query)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(Workspaces)
  await ctx.plugin(StubCommands)
  ctx.baseUrl = pathToFileURL(process.env.DSH_OFFICIAL_HOST_ROOT! + '/').href
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  // Transport/authentication/catalog I/O are outside the Session composition seam.
  // SessionController, Agent, presets, model validation and persistence are real rc.3.
  ctx.provide('typert', { resources: { register: () => () => {} }, lookups: { configure: () => () => {} }, contexts: { configureHost: () => () => {} } } as never)
  const remoteAccess = await import(pathToFileURL(join(process.env.DSH_OFFICIAL_HOST_ROOT!, 'packages/api/remote-access/lib/index.js')).href)
  await ctx.plugin(remoteAccess.default)
  ctx.provide('fileUploads', { registerAgentResolver: () => () => {} } as never)
  ctx.provide('attachments', { imageLimits: { maxImageBytes: 5242880, maxImagesPerMessage: 20, maxMessageImageBytes: 41943040, maxImagePixels: 40000000, maxImageDimension: 2000, mediaTypes: ['image/png'] } } as never)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: root })
  await ctx.plugin(Sandbox)
  await ctx.plugin(FileSystem, { cwd: root })
  await ctx.plugin(Subprocess)
  await ctx.plugin(Bash, { cwd: root })
  await ctx.plugin(ShellEnvRegistry)
  await ctx.plugin(Approval, { policy: 'never' })
  await ctx.plugin(Permissions, { defaultPreset: 'workspace-write', presets: {
    'read-only': { sandbox: 'read-only', approval: 'never' },
    'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
  } })
  await ctx.plugin(Presets, { default: 'contract' })
  await ctx.agentPresets.register({ id: 'contract', plugins: [] })
  await ctx.plugin(SessionController, { nativeOpen: false })
  expect(ctx.get('sessionController')).toBeDefined()
  const workspace = await ctx.workspaceRegistry.create(root)
  return { ctx, root, workspace, model }
}

it('official public startup preflight accepts declared rc.2 and rc.3 support without exemptions', async () => {
  const boot = await import(pathToFileURL(join(process.env.DSH_OFFICIAL_HOST_ROOT!, 'packages/boot/app-boot/lib/index.js')).href)
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>
  for (const version of ['0.2.0-rc.2', '0.2.1-rc.2', '0.2.1-rc.3']) {
    expect(boot.evaluatePluginCompatibility(pkg, {}, version)).toBeUndefined()
  }
  const { engines: _engines, ...peerOnly } = pkg
  expect(boot.evaluatePluginCompatibility(peerOnly, {}, '0.2.1-rc.3')).toBeUndefined()
  expect(boot.evaluatePluginCompatibility(pkg, {}, '0.2.1-rc.4')).toMatchObject({ exempted: false, requirements: { 'engines.dsh': '0.2.0-rc.2 || 0.2.1-rc.2 || 0.2.1-rc.3' } })
})

it('official rc.3 records Agent local selection without changing the global default and recovers the same root after a lost receipt', async () => {
  const h = await mount()
  expect((h.ctx.sessionController as unknown as { selectLocalModel?: unknown }).selectLocalModel).toBeUndefined()
  await h.ctx.agentPresets.register({ id: 'restricted-parent', plugins: [] })
  const source = await h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'restricted-parent' })
  h.ctx.permissionPresets.set(h.ctx.agents.get(source.sessionId)!.session, 'read-only')
  const saveDefault = vi.spyOn(h.ctx.agentDefaultModel, 'saveSelection')
  await selectSessionModel(h.ctx, source.sessionId, { provider: 'contract', model: 'selected' })
  const agent = h.ctx.agents.get(source.sessionId)!
  expect((agent as unknown as { model: { current(): unknown } }).model.current()).toEqual({ provider: 'contract', model: 'selected' })
  await h.ctx.sessions.flush(agent.session)
  expect((await events(h.ctx, source.sessionId)).findLast(event => event.type === 'model/selection')?.data).toEqual({ provider: 'contract', model: 'selected' })
  expect(saveDefault).not.toHaveBeenCalled()
  expect(h.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'contract', model: 'default' })
  await expect(selectSessionModel(h.ctx, source.sessionId, { provider: 'contract', model: 'missing' })).rejects.toThrow('Host catalog')
  await expect(selectSessionModel(h.ctx, source.sessionId, { provider: 'contract', model: 'selected', reasoningEffort: ReasoningEffortId('high') })).rejects.toThrow('reasoning effort')
  const resolve = vi.spyOn(h.ctx.llm, 'resolveCallConfig').mockRejectedValueOnce(new Error('Adapter rejected configuration'))
  await expect(selectSessionModel(h.ctx, source.sessionId, { provider: 'contract', model: 'default' })).rejects.toThrow('Adapter rejected configuration')
  resolve.mockRestore()
  expect((agent as unknown as { model: { current(): unknown } }).model.current()).toEqual({ provider: 'contract', model: 'selected' })
  expect(saveDefault).not.toHaveBeenCalled()
  const create = h.ctx.sessionController.create.bind(h.ctx.sessionController)
  const calls = vi.spyOn(h.ctx.sessionController, 'create').mockImplementation(async request => { await create(request); throw new Error('Lost create receipt') })
  const request = { source: source.sessionId, sessionId: SessionId('official-reserved-root'), cwd: h.root, workspaceId: h.workspace.id }
  const publishedPresets: (string | undefined)[] = []
  h.ctx.on('agent/created', ({ agent: created }) => {
    if (created.id === request.sessionId) publishedPresets.push(h.ctx.agentPresets.composedPreset(created.ctx))
    return undefined
  })
  await expect(createRootSession(h.ctx, request)).rejects.toThrow('Lost create receipt')
  calls.mockImplementation(create)
  const successor = await createRootSession(h.ctx, request)
  expect(successor.id).toBe(request.sessionId)
  expect(calls).toHaveBeenCalledTimes(1)
  expect(publishedPresets).toEqual(['restricted-parent'])
  expect(h.ctx.agentPresets.composedPreset(successor.ctx)).toBe('restricted-parent')
  expect(h.ctx.permissionPresets.current(successor.session)).toBe('read-only')
  expect(h.workspace.sessionIds).toContain(request.sessionId)
  expect(await h.ctx.sessionPersistence.list()).toHaveLength(2)
  expect(h.model.requests).toHaveLength(0)
})

it('official rc.3 preserves a started user Session model and permissions when root recovery is incompatible', async () => {
  const h = await mount()
  const source = await h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' })
  h.ctx.permissionPresets.set(h.ctx.agents.get(source.sessionId)!.session, 'read-only')
  const target = await h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' })
  const modelInfo = { provider: 'contract', id: 'selected', name: 'selected', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }
  vi.spyOn(h.model, 'resolveModel').mockImplementation(async (provider, model) => ({ ...modelInfo, provider, id: model, name: model }))
  await selectSessionModel(h.ctx, target.sessionId, { provider: 'contract', model: 'selected' })
  const agent = h.ctx.agents.get(target.sessionId)!
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Existing user conversation' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  await h.ctx.sessions.flush(agent.session)
  const before = await events(h.ctx, target.sessionId)
  expect(h.model.requests, JSON.stringify(before.filter(event => event.type === 'turn/end' || event.type === 'request/header'))).toHaveLength(1)
  expect(h.model.requests[0]).toMatchObject({ provider: 'contract', model: 'selected', reasoningEffort: 'high' })
  await expect(new DshWorkExecutionHost(h.ctx, 'runtime').check({
    resource: { runtimeId: 'runtime', workspaceId: h.workspace.id }, session: { runtimeId: 'runtime', sessionId: target.sessionId },
    sessionMode: 'create', agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'workspace-write',
  })).resolves.toMatchObject({ models: expect.arrayContaining([{ provider: 'contract', model: 'selected' }]) })
  await expect(createRootSession(h.ctx, { source: source.sessionId, sessionId: target.sessionId, cwd: h.root, workspaceId: h.workspace.id, repairLegacy: true })).rejects.toThrow('already started with different permissions')
  await expect(selectSessionModel(h.ctx, target.sessionId, { provider: 'contract', model: 'default' })).rejects.toThrow('already started')
  expect(await events(h.ctx, target.sessionId)).toEqual(before)
  expect(h.ctx.permissionPresets.current(agent.session)).toBe('workspace-write')
  expect(h.ctx.sandboxPolicy.resolve({ session: agent.session }).mode).toBe('workspace-write')
  expect(h.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'contract', model: 'default' })
})

it('official rc.3 restores and attaches the exact precreated execution with no create substitution', async () => {
  const h = await mount()
  const execution: WorkExecution = { id: 'official-execution', ref: { projectId: 'project', taskId: 'task' }, agentId: 'agent', owner: 'owner', epoch: 1,
    resource: { runtimeId: 'runtime', workspaceId: h.workspace.id }, session: { runtimeId: 'runtime', sessionId: 'official-exact-execution' }, sessionMode: 'create',
    agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'read-only',
    policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] }, state: 'ready', history: [], events: [] }
  const create = vi.spyOn(h.ctx.sessionController, 'create')
  const host = new DshWorkExecutionHost(h.ctx, 'runtime')
  vi.spyOn(h.ctx.sessionController, 'resolveAgent').mockResolvedValueOnce({ error: { code: 'session/writer-held', message: 'Fixture writer unavailable' } } as never)
  await expect(host.ensure(execution)).rejects.toThrow('Fixture writer unavailable')
  expect(h.ctx.agents.get(SessionId(execution.session.sessionId))).toBeUndefined()
  expect(await h.ctx.sessionPersistence.list()).toHaveLength(1)
  await host.ensure(execution)
  await host.ensure(execution)
  expect(create).not.toHaveBeenCalled()
  const id = SessionId(execution.session.sessionId)
  expect(h.ctx.agents.get(id)?.id).toBe(id)
  expect(h.workspace.sessionIds).toContain(id)
  expect((await events(h.ctx, id)).filter(event => event.type === 'model/selection')).toHaveLength(1)
  expect(h.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'contract', model: 'default' })
  expect(await h.ctx.sessionPersistence.list()).toHaveLength(1)
  expect(h.model.requests).toHaveLength(0)
  await h.ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(h.ctx), 1)
  const restored = await mount(h.root)
  const restoreCreate = vi.spyOn(restored.ctx.sessionController, 'create')
  await new DshWorkExecutionHost(restored.ctx, 'runtime').ensure(execution)
  expect(restoreCreate).not.toHaveBeenCalled()
  expect(restored.ctx.agents.get(id)?.id).toBe(id)
  expect(restored.workspace.sessionIds).toContain(id)
  expect((await events(restored.ctx, id)).filter(event => event.type === 'model/selection')).toHaveLength(1)
  expect(await restored.ctx.sessionPersistence.list()).toHaveLength(1)
  expect(restored.model.requests).toHaveLength(0)
})
