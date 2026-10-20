import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQuery from '@deepseek-ai/dsh-session-query'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import BashLocal from '@deepseek-ai/dsh-bash-local'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import Approval from '@deepseek-ai/dsh-user-approval'
import { StubCommands } from './stubs.ts'
import { DshWorkHost } from '../src/work-host.ts'
import { DshWorkExecutionHost } from '../src/work-execution/dsh-host.ts'
import { WorkApplication } from '../src/work.ts'
import type { WorkHost } from '../src/work.ts'

export class ExecutionFixtures {
  private readonly contexts = new Set<Context>()
  private readonly roots = new Set<string>()
  constructor(readonly signal?: AbortSignal) {}
  async root() {
    const path = await mkdtemp(join(tmpdir(), 'a2d2-execution-'))
    this.roots.add(path)
    return path
  }
  async mount(path: string) {
    return mountExecution(path, ctx => this.contexts.add(ctx))
  }
  application(directory: string, host: WorkHost) { return new WorkApplication(directory, host) }
  run<T>(operation: () => Promise<T>): Promise<T> { return operation() }
  async dispose(ctx: Context) {
    await ctx.fiber.dispose()
    this.contexts.delete(ctx)
  }
  async close() {
    for (const ctx of [...this.contexts].reverse()) await ctx.fiber.dispose()
    for (const path of this.roots) {
      if (!path.startsWith(join(tmpdir(), 'a2d2-execution-'))) throw new Error('Unexpected cleanup path')
      await rm(path, { recursive: true, force: true })
    }
  }
}

class Query extends SessionQuery {
  async searchSessions(): Promise<never> { throw new Error('Search is not part of the execution contract') }
  async searchEvents(): Promise<never> { throw new Error('Search is not part of the execution contract') }
}
class Shell extends BashLocal { override get sandboxMode() { return 'danger-full-access' as const } }
export class Model extends LlmAdapter {
  requests: GenerateOptions[] = []
  async listModels(provider: string) { return ['default', 'selected'].map(id => ({ provider, id, name: id })) }
  async resolveModel(provider: string, model: string) { if (!['default', 'selected'].includes(model)) throw new Error('Unavailable model'); return { provider, id: model, name: model } }
  async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Recorded work progress' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Recorded work progress' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
export async function mountExecution(path: string, register: (ctx: Context) => void = () => {}) {
  const ctx = new Context()
  register(ctx)
  await ctx.plugin(LlmRuntime)
  const model = new Model()
  ctx.llm.registerAdapter(['contract'], model)
  await ctx.plugin(DefaultModel, { provider: 'contract', model: 'default' })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root: join(path, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Query)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(path, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(StubCommands)
  ctx.baseUrl = new URL('../', import.meta.url).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  // Transport registration and attachment catalog are outside the execution seam.
  ctx.provide('typert', { lookups: { configure: () => () => {} }, contexts: { configureHost: () => () => {} } } as never)
  ctx.provide('fileUploads', { registerAgentResolver: () => () => {} } as never)
  ctx.provide('attachments', { imageLimits: { maxImageBytes: 5242880, maxImagesPerMessage: 20, maxMessageImageBytes: 41943040, maxImagePixels: 40000000, maxImageDimension: 2000, mediaTypes: ['image/png'] } } as never)
  await ctx.plugin(LocalFileSystem, { cwd: path })
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(Shell, { cwd: path })
  await ctx.plugin(ShellEnvRegistry)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: path })
  await ctx.plugin(Approval, { policy: 'never' })
  await ctx.plugin(PermissionPresets, { defaultPreset: 'workspace-write' })
  await ctx.plugin(AgentPresets, { default: 'contract' })
  await ctx.agentPresets.register({ id: 'contract', plugins: [{ name: import.meta.resolve('@deepseek-ai/dsh-tool-fs') }] })
  new SessionController(ctx, { nativeOpen: false })
  const workspace = await ctx.workspaceRegistry.create(path)
  const host = new DshWorkHost(ctx, 'runtime')
  host.execution = new DshWorkExecutionHost(ctx, 'runtime')
  const app = new WorkApplication(join(path, 'work'), host)
  return { ctx, model, host, app, workspace }
}
