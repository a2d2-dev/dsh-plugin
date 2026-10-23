import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import { mountExecution } from './work-execution-fixture.ts'
import * as plugin from '../src/work-plugin.ts'
import { WORK_ROUTE_PATH } from '../src/work-types.ts'
import type { WorkCompleted, WorkRequest, WorkResult } from '../src/work-types.ts'
import type { GitHubSourcePort } from '../src/work-sources/types.ts'
import { SourceError } from '../src/work-sources/github.ts'
const githubPort: GitHubSourcePort = {
  list: async () => ({ identity: { login: 'imneov', nodeId: 'U_1', name: 'LiuFeng' }, items: [], observedAt: '2026-10-20T00:00:00Z' }),
  detail: async (repository, number) => ({ identity: { login: 'imneov', nodeId: 'U_1', name: 'LiuFeng' }, issue: { nodeId: 'I_112', url: `https://github.com/${repository.owner}/${repository.repository}/issues/${number}`, number, repository, title: 'Existing issue', body: 'External source body', labels: [], assignees: ['imneov'], state: 'open', updatedAt: '2026-10-19T00:00:00Z', observedAt: '2026-10-20T00:00:00Z' } }),
}

const roots: string[] = []
const contexts: Context[] = []
type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>
class WebServer extends Service {
  readonly routes = new Map<string, Handler>()
  constructor(ctx: Context) { super(ctx, 'webServer') }
  register(route: { path: string; handler: Handler }): () => void {
    this.routes.set(route.path, route.handler)
    return () => { this.routes.delete(route.path) }
  }
}
class Connection extends Service {
  constructor(ctx: Context) { super(ctx, 'connection') }
  requestRejection(request: IncomingMessage): 401 | 403 | undefined {
    if (request.headers.host !== 'trusted.test' || (request.headers.origin && request.headers.origin !== 'http://trusted.test')) return 403
    return request.headers.cookie === 'operator=logged-in' ? undefined : 401
  }
}
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), 'a2d2-work-host-'))) throw new Error('Unexpected cleanup target')
    await rm(root, { recursive: true, force: true })
  }
})
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'a2d2-work-host-'))
  roots.push(path)
  return path
}
async function mount(path: string, source?: GitHubSourcePort, github = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: join(path, 'sessions') })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(path, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  if (source) ctx.provide('a2d2GitHubSource', source)
  await ctx.plugin(plugin, { directory: join(path, 'work-v3'), github })
  await new Promise(resolve => setTimeout(resolve, 0))
  const server = ctx.get('webServer') as unknown as WebServer
  return { ctx, server }
}
async function call(server: WebServer, body: WorkRequest | unknown, overrides: Record<string, string> = {}) {
  let bodyRead = false
  const request = Object.assign(new Readable({ read() { bodyRead = true; this.push(JSON.stringify(body)); this.push(null) } }), {
    method: 'POST', url: WORK_ROUTE_PATH,
    headers: { host: 'trusted.test', origin: 'http://trusted.test', cookie: 'operator=logged-in', 'content-type': 'application/json', ...overrides },
  }) as unknown as IncomingMessage
  let status = 0
  let payload = ''
  const response = { writeHead(code: number) { status = code }, end(text: string) { payload = text } } as unknown as ServerResponse
  const handler = server.routes.get(WORK_ROUTE_PATH)
  expect(handler).toBeTypeOf('function')
  await handler!(request, response)
  return { status, body: JSON.parse(payload) as WorkResult, bodyRead }
}
function completed(result: WorkResult): WorkCompleted {
  expect(result.status).toBe('completed')
  if (result.status !== 'completed') throw new Error(JSON.stringify(result))
  return result
}

it('exposes real local commands and trusted persisted host Sessions through the production plugin without a live Session or model', async () => {
  const path = await root()
  const { ctx, server } = await mount(path, githubPort)
  const directory = await root()
  const workspace = await ctx.workspaceRegistry.create(directory)
  const sessionId = SessionId('persisted-existing-session')
  const handle = await ctx.sessionPersistence.create({ version: 4, isSeeded: false, delegationDepth: 0, id: sessionId, createdAt: 1234, cwd: directory, agentPreset: 'existing-user-preset' })
  await handle.flush()
  await handle.close()
  await workspace.attachSession(sessionId)
  const before = await ctx.sessionPersistence.stat(sessionId)
  expect(ctx.sessions.list()).toHaveLength(0)
  const resources = completed((await call(server, { kind: 'query', value: { type: 'resources.list' } })).body).resources!
  expect(resources).toHaveLength(1)
  const project = completed((await call(server, { kind: 'command', value: { type: 'project.create', commandId: 'project', name: 'Existing work', resource: resources[0]!.ref } })).body).project!
  const task = completed((await call(server, { kind: 'command', value: { type: 'task.create', commandId: 'task', projectId: project.id,
    title: 'Accepted local work', goal: 'Retain work offline', specification: 'Trusted existing session', acceptance: ['No session configuration changes'] } })).body).task!
  const ref = { projectId: project.id, taskId: task.id }
  const candidates = completed((await call(server, { kind: 'query', value: { type: 'session.candidates', projectId: project.id } })).body).candidates!
  expect(candidates).toMatchObject([{ ref: { runtimeId: resources[0]!.ref.runtimeId, sessionId }, resource: resources[0]!.ref }])
  expect((await call(server, { kind: 'command', value: { type: 'task.associate-session', commandId: 'associate', ref, expectedVersion: 1,
    session: candidates[0]!.ref, purpose: 'related' } })).body).toMatchObject({ status: 'completed', task: { version: 2 } })
  expect((await ctx.sessionPersistence.stat(sessionId))?.header).toEqual(before?.header)
  const named = await ctx.sessionPersistence.open(sessionId, 'read')
  try {
    expect((await named.read()).events).toMatchObject([{ type: 'session/title', data: { title: `T:${task.id.replaceAll('-', '').slice(0, 8)} · 关联 1 · Accepted local work`, source: { kind: 'user' } } }])
  } finally { await named.close() }
  expect(ctx.sessions.list()).toHaveLength(0)
  expect(ctx.get('agents')).toBeUndefined()
  expect(ctx.get('llm')).toBeUndefined()
  expect((await call(server, { kind: 'query', value: { type: 'work.capabilities' } })).body).toMatchObject({ status: 'completed', capabilities: { githubRead: true, githubWrite: false, taskStart: false } })
  const source = completed((await call(server, { kind: 'command', value: { type: 'source.configure', commandId: 'source', projectId: project.id, repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' } } })).body).source!
  expect((await call(server, { kind: 'query', value: { type: 'source.issue', projectId: project.id, sourceId: source.id, number: 112, refresh: true } })).body).toMatchObject({ status: 'completed', issue: { nodeId: 'I_112', body: 'External source body' } })
  expect((await call(server, { kind: 'command', value: { type: 'source.link', commandId: 'link', sourceId: source.id, ref, expectedVersion: 2, nodeId: 'I_112' } })).body).toMatchObject({ status: 'completed', task: { specification: task.specification, sessions: [{ session: candidates[0]!.ref }] } })
  await ctx.fiber.dispose()
  contexts.splice(contexts.indexOf(ctx), 1)
  const reload = await mount(path, undefined, false)
  expect((await call(reload.server, { kind: 'query', value: { type: 'work.capabilities' } })).body).toMatchObject({ capabilities: { githubRead: false } })
  expect((await call(reload.server, { kind: 'query', value: { type: 'session.candidates', projectId: project.id } })).body).toMatchObject({ status: 'completed', candidates })
  expect((await call(reload.server, { kind: 'query', value: { type: 'task.detail', ref } })).body)
    .toMatchObject({ status: 'completed', task: { id: task.id, sessions: [{ session: candidates[0]!.ref }] } })
  expect(completed((await call(reload.server, { kind: 'query', value: { type: 'resources.list' } })).body).resources?.[0]?.ref.runtimeId)
    .toBe(resources[0]!.ref.runtimeId)
})

it('rejects browser host/path/credential input and separates upstream 401 from DSH login before source I/O', async () => {
  let sourceCalls = 0
  const { server } = await mount(await root(), { ...githubPort, list: async () => { sourceCalls++; throw new SourceError('github-unauthorized', 'GitHub credentials were rejected (401)') } })
  const project = completed((await call(server, { kind: 'command', value: { type: 'project.create', commandId: 'auth-project', name: 'Source work' } })).body).project!
  const source = completed((await call(server, { kind: 'command', value: { type: 'source.configure', commandId: 'auth-source', projectId: project.id, repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' } } })).body).source!
  const value = { type: 'source.issues', projectId: project.id, sourceId: source.id, page: 1, perPage: 20, assignee: '@me', state: 'open', refresh: true }
  const request = { kind: 'query', value }
  expect(await call(server, request, { cookie: '' })).toMatchObject({ status: 401, bodyRead: false, body: { error: { code: 'unauthenticated' } } })
  expect(await call(server, request, { origin: 'http://evil.test' })).toMatchObject({ status: 403, bodyRead: false })
  for (const forbidden of [{ host: 'evil.test' }, { path: '/user' }, { credentialDirectory: '/root/.config/gh' }, { token: 'browser-token' }]) {
    expect(await call(server, { kind: 'query', value: { ...value, ...forbidden } })).toMatchObject({ status: 400, body: { error: { code: 'invalid-request' } } })
  }
  expect(sourceCalls).toBe(0)
  expect(await call(server, request)).toMatchObject({ status: 424, body: { status: 'failed', error: { code: 'github-unauthorized' } } })
  expect(sourceCalls).toBe(1)
  expect(await call(server, { kind: 'query', value: { type: 'project.detail', projectId: project.id } })).toMatchObject({ status: 200, body: { tasks: [] } })
})

it('registers the production model tool when ToolRuntime arrives without adding configuration or requiring an Agent for queries', async () => {
  const { ctx, server } = await mount(await root())
  expect(ctx.get('tools')).toBeUndefined()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await vi.waitFor(() => expect(ctx.tools.get('work_control')).toBeDefined())
  expect(ctx.tools.get('work_continuation_material')).toBeDefined()
  expect(await ctx.tools.execute({ callId: ToolCallId('unbound-production-call'), name: 'work_control', arguments: { action: 'status' }, signal: new AbortController().signal }))
    .toMatchObject({ isError: true })
  expect(await call(server, { kind: 'query', value: { type: 'projects.list' } })).toMatchObject({ status: 200, body: { status: 'completed', projects: [] } })
  expect(ctx.get('agents')).toBeUndefined()
  expect(ctx.get('llm')).toBeUndefined()
})

it('starts through the production plugin Context with real execution services and one deterministic kickoff', async () => {
  const path = await root()
  const { ctx, model } = await mountExecution(path, 'read-only')
  contexts.push(ctx)
  await ctx.plugin(WebServer)
  await ctx.plugin(Connection)
  await ctx.plugin(plugin, { directory: join(path, 'production-work') })
  const server = ctx.get('webServer') as unknown as WebServer
  const resources = completed((await call(server, { kind: 'query', value: { type: 'resources.list' } })).body).resources!
  const resource = resources[0]!.ref
  const project = completed((await call(server, { kind: 'command', value: { type: 'project.create', commandId: 'project', name: 'Production execution', resource } })).body).project!
  const task = completed((await call(server, { kind: 'command', value: { type: 'task.create', commandId: 'task', projectId: project.id,
    title: 'Start with real services', goal: 'Admit from the production Context', specification: 'Resolve services through the mounted plugin', acceptance: ['One deterministic kickoff'] } })).body).task!
  const ref = { projectId: project.id, taskId: task.id }
  const command = { kind: 'command', value: { type: 'task.start', commandId: 'start', ref, expectedVersion: 1,
    agentId: project.defaultAgentId, resource, agentPreset: 'contract', model: { provider: 'contract', model: 'selected' }, permissionPreset: 'read-only' } } as const
  const controller = ctx.get('sessionController')!
  for (const method of ['create', 'modelCatalog'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(controller, method)
    Object.defineProperty(controller, method, { value: undefined, configurable: true })
    try {
      expect(await call(server, command)).toMatchObject({ status: 400, body: { status: 'failed', error: { code: 'host-capability-unavailable' } } })
      expect((await call(server, { kind: 'query', value: { type: 'task.execution', ref } })).body).not.toHaveProperty('execution')
      expect(await ctx.sessionPersistence.list()).toHaveLength(0)
      expect(model.requests).toHaveLength(0)
    } finally {
      if (descriptor) Object.defineProperty(controller, method, descriptor)
      else Reflect.deleteProperty(controller, method)
    }
  }
  const started = await call(server, command)
  expect(started, JSON.stringify(started)).toMatchObject({ status: 200, body: { status: 'completed', execution: { state: 'ready', actual: { cwd: path, permissionPreset: 'read-only', provider: 'contract', model: 'selected' } } } })
  const execution = completed(started.body).execution!
  const agent = ctx.agents.get(SessionId(execution.session.sessionId))!
  await agent.whenIdle()
  expect(model.requests).toHaveLength(1)
  expect(model.requests[0]).toMatchObject({ provider: 'contract', model: 'selected' })
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'contract', model: 'default' })
  expect((await call(server, command)).body).toMatchObject({ execution: { id: execution.id, session: execution.session } })
  await agent.whenIdle()
  expect(model.requests).toHaveLength(1)
  expect(await ctx.sessionPersistence.list()).toHaveLength(1)
})

it('uses host operator authentication for reads, writes and retry receipts before reading request bodies', async () => {
  const { server } = await mount(await root())
  const command = { kind: 'command', value: { type: 'project.create', commandId: 'authenticated-create', name: 'Private work' } }
  expect((await call(server, command)).status).toBe(200)
  for (const body of [command, { kind: 'query', value: { type: 'projects.list' } }]) {
    const refused = await call(server, body, { cookie: '' })
    expect(refused).toMatchObject({ status: 401, bodyRead: false, body: { status: 'failed', error: { code: 'unauthenticated' } } })
    const untrusted = await call(server, body, { origin: 'http://evil.test' })
    expect(untrusted).toMatchObject({ status: 403, bodyRead: false, body: { error: { code: 'untrusted' } } })
  }
  expect(await call(server, command, { 'content-type': 'text/plain' })).toMatchObject({ status: 415, bodyRead: false })
  expect(await call(server, { ...command, cwd: '/browser-supplied' })).toMatchObject({ status: 400, body: { error: { code: 'invalid-request' } } })
  expect(await call(server, { kind: 'query', value: { type: 'projects.list', cwd: '/browser-supplied' } }))
    .toMatchObject({ status: 400, body: { error: { code: 'invalid-request' } } })
  expect(completed((await call(server, { kind: 'query', value: { type: 'projects.list' } })).body).projects).toHaveLength(1)
})
