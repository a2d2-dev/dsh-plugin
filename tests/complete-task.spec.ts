/**
 * Completing a task issue from its main session, and notifying the parent task's
 * main session when one exists.
 *
 * @module dsh-a2d2/tests/complete-task
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service, { panelPayload } from '../src/index.ts'
import { tasksDirectory } from '../src/store.ts'
import * as completeTaskToolsPlugin from '../src/complete-task-tools.ts'
import { StubTools, stubAgent, toolRunContext } from './stubs.ts'

const roots: string[] = []
const parentSession = SessionId('session-parent')
const childSession = SessionId('session-child')
const ordinarySession = SessionId('session-ordinary')

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-complete-task-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class StubAgents extends Service {
  readonly resumed: ResumeAgentOptions[] = []
  readonly followups: Array<{ readonly sessionId: SessionId; readonly text: string; readonly sourceKind: string }> = []
  private readonly live = new Map<SessionId, Agent>()

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  addLive(root: string, id: SessionId): Agent {
    const agent = this.makeAgent(root, id)
    this.live.set(id, agent)
    return agent
  }

  get(id: SessionId): Agent | undefined {
    return this.live.get(id)
  }

  async resume(options: ResumeAgentOptions): Promise<AgentHandle> {
    this.resumed.push(options)
    const agent = this.addLive('', options.resumeSessionId)
    return { agent, dispose: async () => {} }
  }

  private makeAgent(root: string, id: SessionId): Agent {
    return {
      id,
      options: {},
      session: { header: { version: 0, id, createdAt: 1_758_412_800_000, cwd: root }, id },
      followup: vi.fn((message: { readonly content: readonly { readonly type: string; readonly text?: string }[]; readonly source: { readonly kind: string } }) => {
        const text = message.content.map(part => part.type === 'text' ? part.text ?? '' : '').join('')
        this.followups.push({ sessionId: id, text, sourceKind: message.source.kind })
      }),
    } as unknown as Agent
  }
}

async function mount(root: string): Promise<{ readonly ctx: Context; readonly service: A2d2Service; readonly agents: StubAgents }> {
  const ctx = new Context()
  await ctx.plugin(StubAgents)
  await ctx.plugin(A2d2Service, { root })
  return { ctx, service: ctx.a2d2, agents: ctx.get('agents') as unknown as StubAgents }
}

describe('completeTask', () => {
  it('marks a child task issue done and notifies the loaded parent main session with only the child issue and completion summary', async () => {
    const root = await tempRoot()
    const { service, agents } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 41, mainSession: parentSession, now: new Date('2026-10-01T10:00:00.000Z') })
    await service.bindMainSession({ cwd: root, issue: 50, parentIssue: 41, mainSession: childSession, now: new Date('2026-10-01T11:00:00.000Z') })
    agents.addLive(root, parentSession)

    const completed = await service.completeTask({ cwd: root, caller: childSession, summary: '验收通过，PR 已开。' })

    expect(completed.task.state).toBe('done')
    expect(await readFile(join(tasksDirectory(root), 'issue-50.yaml'), 'utf8')).toContain('state: done')
    expect(agents.resumed).toEqual([])
    expect(agents.followups).toEqual([{
      sessionId: parentSession,
      sourceKind: 'a2d2-complete-task',
      text: '子任务 #50 已完成。\n\n完成说明：验收通过，PR 已开。',
    }])
    expect(agents.followups[0]?.text).not.toContain('https://')
    expect(agents.followups[0]?.text).not.toContain('#41')
  })

  it('resumes an unloaded parent main session before notifying it', async () => {
    const root = await tempRoot()
    const { service, agents } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 41, mainSession: parentSession, now: new Date() })
    await service.bindMainSession({ cwd: root, issue: 50, parentIssue: 41, mainSession: childSession, now: new Date() })

    await service.completeTask({ cwd: root, caller: childSession, summary: '全部验证通过。' })

    expect(agents.resumed).toEqual([{ resumeSessionId: parentSession }])
    expect(agents.followups).toEqual([{
      sessionId: parentSession,
      sourceKind: 'a2d2-complete-task',
      text: '子任务 #50 已完成。\n\n完成说明：全部验证通过。',
    }])
  })

  it('marks a task with no parent done without notifying or resuming another session', async () => {
    const root = await tempRoot()
    const { service, agents } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 41, mainSession: parentSession, now: new Date() })

    const completed = await service.completeTask({ cwd: root, caller: parentSession, summary: '主任务完成。' })

    expect(completed.task.state).toBe('done')
    expect(agents.resumed).toEqual([])
    expect(agents.followups).toEqual([])
  })

  it('refuses a session that is not the task issue main session', async () => {
    const root = await tempRoot()
    const { service, agents } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 50, mainSession: childSession, now: new Date() })

    await expect(service.completeTask({ cwd: root, caller: ordinarySession, summary: 'Done.' }))
      .rejects.toThrow(/only a task issue main session can complete its task/)
    expect((await service.taskOfMainSession(root, childSession))?.state).toBe('active')
    expect(agents.followups).toEqual([])
  })

  it('exposes done state through the panel payload so the panel can show 已完成', async () => {
    const root = await tempRoot()
    const { service } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 50, mainSession: childSession, now: new Date() })

    await service.completeTask({ cwd: root, caller: childSession, summary: '已完成。' })

    expect(panelPayload(root, await service.list(root)).tasks).toEqual([
      expect.objectContaining({ id: 'issue-50', state: 'done' }),
    ])
  })
})

describe('complete_task tool', () => {
  it('hands the completion summary to the service with the calling main session and returns the done task issue', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(StubTools)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(completeTaskToolsPlugin)
    await ctx.a2d2.bindMainSession({ cwd: root, issue: 50, mainSession: childSession, now: new Date('2026-10-01T10:00:00.000Z') })
    const tool = (ctx.get('tools') as unknown as StubTools).find('complete_task')
    if (tool === undefined) throw new Error('the tool did not register')
    const args = { summary: '验证通过，准备关闭 issue。' }

    const value = await tool.execute(args, toolRunContext(stubAgent(root, childSession), tool.name, args))

    expect(value).toEqual({ task: 'issue-50', issue: 50, state: 'done', notified_parent: false })
    expect((await ctx.a2d2.taskOfMainSession(root, childSession))?.state).toBe('done')
  })
})
