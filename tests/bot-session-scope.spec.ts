import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { GROK_BOT_TOOLS } from '../src/bot-contract.ts'
import A2d2Service from '../src/index.ts'
import * as botPlugin from '../src/bot.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class PromptSections {
  private readonly sections = new Map<string, { readonly text: string | (() => string) }>()

  section(section: { readonly name: string; readonly text: string | (() => string) }): () => void {
    this.sections.set(section.name, section)
    return () => { this.sections.delete(section.name) }
  }

  getSectionOrder(name: string): number {
    if (name === 'TEAM_POLICY') return 600
    throw new Error(`unexpected order ${name}`)
  }

  render(name: string): string | undefined {
    const section = this.sections.get(name)
    return section === undefined ? undefined : typeof section.text === 'function' ? section.text() : section.text
  }
}

class StubAgents extends Service {
  constructor(ctx: Context) { super(ctx, 'agents') }
  list(): readonly Agent[] { return [] }
}

class StubTools extends Service {
  constructor(ctx: Context) { super(ctx, 'tools') }
  get(name: string): { readonly name: string } | undefined {
    return GROK_BOT_TOOLS.includes(name as never) ? { name } : undefined
  }
}

class StubSettings extends Service {
  constructor(ctx: Context) { super(ctx, 'settings') }
  configure(): () => void { return () => {} }
}

class StubSystemPrompt extends Service {
  constructor(ctx: Context) { super(ctx, 'systemPrompt') }
  section(): () => void { return () => {} }
  getSectionOrder(name: string): number {
    if (name === 'TEAM_POLICY') return 600
    throw new Error(`unexpected order ${name}`)
  }
}

function agent(ctx: Context, root: string, id: string): Agent & { readonly prompt: PromptSections } {
  const sessionId = SessionId(id)
  const prompt = new PromptSections()
  return {
    id: sessionId,
    session: { header: { cwd: root, id: sessionId } },
    ctx: ctx.extend({ systemPrompt: prompt }),
    prompt,
  } as unknown as Agent & { readonly prompt: PromptSections }
}

describe('A2D2 Bot session scope', () => {
  it('adds guidance to a Feishu chat only after it becomes an active task issue main session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'a2d2-bot-session-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(StubAgents)
    await ctx.plugin(StubTools)
    await ctx.plugin(StubSettings)
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(botPlugin, { enabled: true, defaultBot: 'grok-reviewer' } as never)

    const feishuMain = agent(ctx, root, 'feishu-chat-main')
    const ordinaryChat = agent(ctx, root, 'feishu-chat-ordinary')
    const next = async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] })
    const preStep = async (current: Agent): Promise<unknown> => await ctx.events.waterfall(
      current.ctx as never,
      'agent/pre-step',
      { agent: current, messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      next,
    )

    await preStep(ordinaryChat)
    expect(ordinaryChat.prompt.render('a2d2:bot')).toBeUndefined()

    await ctx.a2d2.bindMainSession({ cwd: root, issue: 42, mainSession: feishuMain.id, now: new Date() })
    await preStep(feishuMain)
    expect(feishuMain.prompt.render('a2d2:bot')).toContain('"grok-reviewer"')

    await ctx.a2d2.completeTask({ cwd: root, caller: feishuMain.id, summary: 'Task issue accepted' })
    await preStep(feishuMain)
    expect(feishuMain.prompt.render('a2d2:bot')).toBeUndefined()
  })
})
