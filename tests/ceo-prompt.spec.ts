/**
 * CEO prompt section: main sessions receive the scoped Agent definition, wake
 * checklist, and SOUL files that define the CEO for a task issue.
 *
 * @module dsh-a2d2/tests/ceo-prompt
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service from '../src/index.ts'
import * as ceoPromptPlugin from '../src/ceo-prompt.ts'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-ceo-prompt-'))
  roots.push(root)
  return root
}

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
    if (section === undefined) return undefined
    return typeof section.text === 'function' ? section.text() : section.text
  }
}

class StubSystemPrompt extends Service {
  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  section(): () => void {
    return () => {}
  }

  getSectionOrder(name: string): number {
    if (name === 'TEAM_POLICY') return 600
    throw new Error(`unexpected order ${name}`)
  }
}

class StubAgents extends Service {
  private readonly agents: Agent[] = []

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  list(): readonly Agent[] {
    return this.agents
  }

  add(agent: Agent): void {
    this.agents.push(agent)
    this.ctx.emit('agent/created', { agent, source: 'resume' })
  }
}

function agent(root: string, id: string): Agent & { readonly prompt: PromptSections } {
  const prompt = new PromptSections()
  return {
    id: SessionId(id),
    session: { header: { cwd: root, id: SessionId(id) } },
    ctx: { systemPrompt: prompt },
    prompt,
  } as unknown as Agent & { readonly prompt: PromptSections }
}

async function writeAgentFiles(root: string, files: { agents: string; wake: string; globalSoul?: string; projectSoul?: string }): Promise<{ agentFilesDir: string; globalSoulDir: string }> {
  const agentFilesDir = join(root, 'method')
  const globalSoulDir = join(root, 'global-soul')
  await mkdir(agentFilesDir, { recursive: true })
  await mkdir(globalSoulDir, { recursive: true })
  await writeFile(join(agentFilesDir, 'AGENTS.md'), files.agents, 'utf8')
  await writeFile(join(agentFilesDir, 'WAKE.md'), files.wake, 'utf8')
  if (files.globalSoul !== undefined) await writeFile(join(globalSoulDir, 'SOUL.md'), files.globalSoul, 'utf8')
  if (files.projectSoul !== undefined) {
    const projectSoulDir = join(root, '.dsh', 'a2d2')
    await mkdir(projectSoulDir, { recursive: true })
    await writeFile(join(projectSoulDir, 'SOUL.md'), files.projectSoul, 'utf8')
  }
  return { agentFilesDir, globalSoulDir }
}

describe('CEO prompt section', () => {
  it('installs only on a running session that was just bound as a main session and rereads SOUL on every assembly', async () => {
    const root = await tempRoot()
    const { agentFilesDir, globalSoulDir } = await writeAgentFiles(root, {
      agents: 'CEO duties v1',
      wake: 'Wake checklist v1',
      globalSoul: 'Global principle v1',
      projectSoul: 'Project principle v1',
    })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(ceoPromptPlugin, { agentFilesDir, globalSoulDir })
    const main = agent(root, 'session-main')
    const ordinary = agent(root, 'session-ordinary')
    ;(ctx.get('agents') as unknown as StubAgents).add(main)
    ;(ctx.get('agents') as unknown as StubAgents).add(ordinary)

    await ctx.a2d2.bindMainSession({ cwd: root, issue: 46, parentIssue: 41, mainSession: main.id, now: new Date() })

    expect(ordinary.prompt.render('a2d2:ceo')).toBeUndefined()
    const first = main.prompt.render('a2d2:ceo')
    expect(first).toContain('CEO duties v1')
    expect(first).toContain('Wake checklist v1')
    expect(first).toContain('Global principle v1')
    expect(first).toContain('Project SOUL (priority over global SOUL)')
    expect(first).toContain('Project principle v1')

    await writeFile(join(globalSoulDir, 'SOUL.md'), 'Global principle v2', 'utf8')
    await writeFile(join(root, '.dsh', 'a2d2', 'SOUL.md'), 'Project principle v2', 'utf8')

    const second = main.prompt.render('a2d2:ceo')
    expect(second).toContain('Global principle v2')
    expect(second).toContain('Project principle v2')
    expect(second).not.toContain('Global principle v1')
    expect(second).not.toContain('Project principle v1')
    expect(await readFile(join(root, '.dsh', 'a2d2', 'tasks', 'issue-46.yaml'), 'utf8')).toContain('mainSession: session-main')
  })

  it('installs when a main-session Agent is created after the task was already bound', async () => {
    const root = await tempRoot()
    const { agentFilesDir, globalSoulDir } = await writeAgentFiles(root, {
      agents: 'CEO duties on restore',
      wake: 'Wake checklist on restore',
      globalSoul: 'Global principle on restore',
      projectSoul: 'Project principle on restore',
    })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.a2d2.bindMainSession({ cwd: root, issue: 46, mainSession: SessionId('session-main'), now: new Date() })
    await ctx.plugin(ceoPromptPlugin, { agentFilesDir, globalSoulDir })
    const main = agent(root, 'session-main')

    ;(ctx.get('agents') as unknown as StubAgents).add(main)

    await vi.waitFor(() => {
      expect(main.prompt.render('a2d2:ceo')).toContain('CEO duties on restore')
    })
  })

  it('names every missing SOUL file in the section instead of silently skipping it', async () => {
    const root = await tempRoot()
    const { agentFilesDir, globalSoulDir } = await writeAgentFiles(root, {
      agents: 'CEO duties',
      wake: 'Wake checklist',
    })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(ceoPromptPlugin, { agentFilesDir, globalSoulDir })
    const main = agent(root, 'session-main')
    ;(ctx.get('agents') as unknown as StubAgents).add(main)

    await ctx.a2d2.bindMainSession({ cwd: root, issue: 46, mainSession: main.id, now: new Date() })

    const section = main.prompt.render('a2d2:ceo')
    expect(section).toContain(`Missing Global SOUL: ${join(globalSoulDir, 'SOUL.md')}`)
    expect(section).toContain(`Missing Project SOUL (priority over global SOUL): ${join(root, '.dsh', 'a2d2', 'SOUL.md')}`)
  })
})
