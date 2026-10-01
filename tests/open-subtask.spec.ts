/**
 * Opening a subtask: the parent task's main session creates a new root session
 * that becomes the subtask's main session.
 *
 * @module dsh-a2d2/tests/open-subtask
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type { LlmModelInfo, LlmProviderInfo } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service from '../src/index.ts'
import * as openSubtaskToolsPlugin from '../src/open-subtask-tools.ts'
import { tasksDirectory } from '../src/store.ts'
import { StubTools, stubAgent, toolRunContext } from './stubs.ts'

const roots: string[] = []
const parentSession = SessionId('session-parent')

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-open-subtask-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class StubAgents extends Service {
  readonly created: CreateAgentOptions[] = []
  readonly followups: Array<{ readonly sessionId: SessionId; readonly text: string }> = []

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  async create(options: CreateAgentOptions): Promise<AgentHandle> {
    this.created.push(options)
    const agent = {
      id: options.sessionId,
      options: options.agentOptions ?? {},
      session: { header: { version: 0, id: options.sessionId, createdAt: 1_758_412_800_000, cwd: options.meta?.cwd }, id: options.sessionId },
      followup: vi.fn((message: { readonly content: readonly { readonly type: string; readonly text?: string }[] }) => {
        const text = message.content.map(part => part.type === 'text' ? part.text ?? '' : '').join('')
        this.followups.push({ sessionId: options.sessionId, text })
      }),
    } as unknown as Agent
    return { agent, dispose: async () => {} }
  }
}

class StubLlm extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  listProviders(): readonly LlmProviderInfo[] {
    return [{ id: 'claude-bray', name: 'Claude Bray' }, { id: 'codex', name: 'Codex' }]
  }

  async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    if (provider === 'claude-bray') return []
    if (provider === 'codex') return [{ provider, id: 'gpt-6', name: 'GPT-6' }]
    return []
  }
}

async function mount(root: string): Promise<{ readonly ctx: Context; readonly service: A2d2Service; readonly agents: StubAgents }> {
  const ctx = new Context()
  await ctx.plugin(StubAgents)
  await ctx.plugin(StubLlm)
  await ctx.plugin(A2d2Service, { root })
  return { ctx, service: ctx.a2d2, agents: ctx.get('agents') as unknown as StubAgents }
}

describe('openSubtask', () => {
  it('creates a root session in the project on the first available grill model, sends only issue links and the instruction, and binds it as subtask main session', async () => {
    const root = await tempRoot()
    const { service, agents } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 41, mainSession: parentSession, now: new Date('2026-10-01T10:00:00.000Z') })

    const opened = await service.openSubtask({ cwd: root, caller: parentSession, issue: 49, now: new Date('2026-10-01T11:00:00.000Z') })

    expect(opened.model).toEqual({ provider: 'codex', model: 'gpt-6' })
    expect(agents.created).toHaveLength(1)
    expect(agents.created[0]).toMatchObject({
      sessionId: opened.session,
      meta: { cwd: root },
      agentOptions: { provider: 'codex', model: 'gpt-6' },
    })
    expect(agents.created[0]).not.toHaveProperty('parentAgent')
    expect(agents.followups).toEqual([{
      sessionId: opened.session,
      text: [
        '子任务 issue：https://github.com/a2d2-dev/dsh-plugin/issues/49',
        '父任务 issue（spec 在其中）：https://github.com/a2d2-dev/dsh-plugin/issues/41',
        '',
        '用 /grill-with-docs 推进；你是该任务的主会话。',
      ].join('\n'),
    }])
    expect(agents.followups[0]?.text).not.toContain('Problem Statement')
    expect(agents.followups[0]?.text).not.toContain('Implementation Decisions')

    const child = await service.taskOfMainSession(root, opened.session)
    expect(child).toMatchObject({
      id: 'issue-49',
      issue: { number: 49, parent: 41, mainSession: opened.session },
      members: [{ sessionId: opened.session }],
    })
    expect(await readFile(join(tasksDirectory(root), 'issue-49.yaml'), 'utf8')).toContain('parent: 41')
  })

  it('refuses a caller that is not the main session of a task issue', async () => {
    const root = await tempRoot()
    const { service, agents } = await mount(root)

    await expect(service.openSubtask({ cwd: root, caller: parentSession, issue: 49, now: new Date() }))
      .rejects.toThrow(/only a task issue main session can open a subtask/)
    expect(agents.created).toEqual([])
  })

  it('refuses to open a subtask that already has a main session', async () => {
    const root = await tempRoot()
    const { service, agents } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 41, mainSession: parentSession, now: new Date() })
    await service.bindMainSession({ cwd: root, issue: 49, parentIssue: 41, mainSession: SessionId('session-existing'), now: new Date() })

    await expect(service.openSubtask({ cwd: root, caller: parentSession, issue: 49, now: new Date() }))
      .rejects.toThrow(/task issue #49 already has main session "session-existing"/)
    expect(agents.created).toEqual([])
  })
})

describe('open_subtask tool', () => {
  it('hands the subtask issue to the service with the calling main session and returns the new session and model', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(StubTools)
    await ctx.plugin(StubAgents)
    await ctx.plugin(StubLlm)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(openSubtaskToolsPlugin)
    await ctx.a2d2.bindMainSession({ cwd: root, issue: 41, mainSession: parentSession, now: new Date('2026-10-01T10:00:00.000Z') })
    const tool = (ctx.get('tools') as unknown as StubTools).find('open_subtask')
    if (tool === undefined) throw new Error('the tool did not register')
    const args = { issue: 49 }

    const value = await tool.execute(args, toolRunContext(stubAgent(root, parentSession), tool.name, args)) as {
      readonly session: string
      readonly issue: number
      readonly parent_issue: number
      readonly provider: string
      readonly model: string
      readonly task: string
    }

    expect(value).toMatchObject({ issue: 49, parent_issue: 41, provider: 'codex', model: 'gpt-6' })
    expect(typeof value.session).toBe('string')
    expect(await ctx.a2d2.taskOfMainSession(root, SessionId(value.session))).toMatchObject({
      id: 'issue-49',
      issue: { number: 49, parent: 41, mainSession: value.session },
    })
  })
})
