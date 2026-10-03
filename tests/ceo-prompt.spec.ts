/**
 * CEO prompt section: main sessions receive the scoped Agent definition, wake
 * checklist, and SOUL files that define the CEO for a task issue.
 *
 * @module dsh-a2d2/tests/ceo-prompt
 */

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service from '../src/index.ts'
import * as ceoPromptPlugin from '../src/ceo-prompt.ts'
import { HANDOFF_SUMMARY_PLACEHOLDER } from '../src/handoff-document.ts'
import { accessCount, resetAccesses } from './fs-access.ts'

vi.mock('node:fs', async importOriginal => (await import('./fs-access.ts')).spyFs(await importOriginal()))

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
  private readonly sections = new Map<string, { readonly text: string | (() => string); readonly interpolate?: boolean }>()

  section(section: { readonly name: string; readonly text: string | (() => string); readonly interpolate?: boolean }): () => void {
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

  renderModelPrompt(name: string): string | undefined {
    const section = this.sections.get(name)
    if (section === undefined) return undefined
    const text = typeof section.text === 'function' ? section.text() : section.text
    if (section.interpolate === false) return text
    if (text.includes('{{')) throw new Error('prompt interpolation attempted')
    return text
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

  async create(options: CreateAgentOptions): Promise<AgentHandle> {
    const created = agent(options.meta?.cwd ?? '', options.sessionId)
    this.agents.push(created)
    this.ctx.emit('agent/created', { agent: created, source: 'resume' })
    return { agent: created, dispose: async () => {} }
  }
}

class StubLlm extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  listProviders(): readonly { readonly id: string }[] {
    return [{ id: 'claude-bray' }, { id: 'codex' }]
  }

  async listModels(provider: string): Promise<readonly { readonly id: string }[]> {
    if (provider === 'claude-bray') return []
    if (provider === 'codex') return [{ id: 'gpt-6' }]
    return []
  }
}

function agent(root: string, id: string): Agent & { readonly prompt: PromptSections } {
  const prompt = new PromptSections()
  return {
    id: SessionId(id),
    session: { header: { cwd: root, id: SessionId(id) } },
    ctx: { systemPrompt: prompt },
    prompt,
    followup: vi.fn(),
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

  it('preserves prompt variable-looking SOUL text literally', async () => {
    const root = await tempRoot()
    const { agentFilesDir, globalSoulDir } = await writeAgentFiles(root, {
      agents: 'CEO duties',
      wake: 'Wake checklist',
      globalSoul: 'Keep literal examples such as ${{ secrets.TOKEN }} unchanged.',
    })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(ceoPromptPlugin, { agentFilesDir, globalSoulDir })
    const main = agent(root, 'session-main')
    ;(ctx.get('agents') as unknown as StubAgents).add(main)

    await ctx.a2d2.bindMainSession({ cwd: root, issue: 46, mainSession: main.id, now: new Date() })

    expect(main.prompt.renderModelPrompt('a2d2:ceo')).toContain('${{ secrets.TOKEN }}')
  })

  it('exposes the absolute CEO method directory that contains dispatch templates', async () => {
    const root = await tempRoot()
    const { agentFilesDir, globalSoulDir } = await writeAgentFiles(root, {
      agents: 'CEO duties with dispatch pointer',
      wake: 'Wake checklist with dispatch pointer',
    })
    await writeFile(join(agentFilesDir, 'DISPATCH_TEMPLATES.md'), 'Dispatch prompt templates', 'utf8')
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(ceoPromptPlugin, { agentFilesDir, globalSoulDir })
    const main = agent(root, 'session-main')
    ;(ctx.get('agents') as unknown as StubAgents).add(main)

    await ctx.a2d2.bindMainSession({ cwd: root, issue: 46, mainSession: main.id, now: new Date() })

    const section = main.prompt.render('a2d2:ceo')
    expect(section).toContain(agentFilesDir)
    expect(await readFile(join(agentFilesDir, 'DISPATCH_TEMPLATES.md'), 'utf8')).toBe('Dispatch prompt templates')
  })

  it('installs on a subtask main session opened through openSubtask', async () => {
    const root = await tempRoot()
    const { agentFilesDir, globalSoulDir } = await writeAgentFiles(root, {
      agents: 'CEO duties for opened subtask',
      wake: 'Wake checklist for opened subtask',
      globalSoul: 'Global principle for opened subtask',
      projectSoul: 'Project principle for opened subtask',
    })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(StubLlm)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(ceoPromptPlugin, { agentFilesDir, globalSoulDir })
    const parent = agent(root, 'session-parent')
    ;(ctx.get('agents') as unknown as StubAgents).add(parent)
    await ctx.a2d2.bindMainSession({ cwd: root, issue: 41, mainSession: parent.id, now: new Date('2026-10-01T10:00:00.000Z') })

    const opened = await ctx.a2d2.openSubtask({ cwd: root, caller: parent.id, issue: 49, now: new Date('2026-10-01T11:00:00.000Z') })

    const child = (ctx.get('agents') as unknown as StubAgents).list()
      .find(candidate => candidate.id === opened.session) as (Agent & { readonly prompt: PromptSections }) | undefined
    expect(child).toBeDefined()
    expect(child?.prompt.render('a2d2:ceo')).toContain('CEO duties for opened subtask')
    expect(child?.prompt.render('a2d2:ceo')).toContain('Project principle for opened subtask')
    expect(await readFile(join(root, '.dsh', 'a2d2', 'tasks', 'issue-49.yaml'), 'utf8')).toContain('mainSession: session-')
  })

  it('moves the CEO prompt section when handoff take changes the main session', async () => {
    const root = await tempRoot()
    const { agentFilesDir, globalSoulDir } = await writeAgentFiles(root, {
      agents: 'CEO duties after take',
      wake: 'Wake checklist after take',
      globalSoul: 'Global principle after take',
      projectSoul: 'Project principle after take',
    })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(ceoPromptPlugin, { agentFilesDir, globalSoulDir })
    const source = agent(root, 'session-source')
    const successor = agent(root, 'session-successor')
    ;(ctx.get('agents') as unknown as StubAgents).add(source)
    ;(ctx.get('agents') as unknown as StubAgents).add(successor)

    await ctx.a2d2.bindMainSession({ cwd: root, issue: 46, mainSession: source.id, now: new Date('2026-10-01T10:00:00.000Z') })
    expect(source.prompt.render('a2d2:ceo')).toContain('CEO duties after take')
    expect(successor.prompt.render('a2d2:ceo')).toBeUndefined()

    const prepared = await ctx.a2d2.prepareHandoff({
      source: source.id,
      cwd: root,
      focus: 'continue as CEO',
      taskId: undefined,
      now: new Date('2026-10-01T10:05:00.000Z'),
    })
    const skeleton = await readFile(prepared.path, 'utf8')
    await writeFile(prepared.path, skeleton.replace(HANDOFF_SUMMARY_PLACEHOLDER, 'Continue as the CEO of task issue #46.'), 'utf8')

    await ctx.a2d2.takeHandoff({ source: source.id, successor: successor.id, cwd: root })

    expect(successor.prompt.render('a2d2:ceo')).toContain('CEO duties after take')
    expect(source.prompt.render('a2d2:ceo')).toBeUndefined()
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

  it('loads packaged CEO method files from the dedicated directory by default, not repository guidance', async () => {
    const root = await tempRoot()
    const globalSoulDir = join(root, 'global-soul')
    await mkdir(globalSoulDir, { recursive: true })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(ceoPromptPlugin, { globalSoulDir })
    const main = agent(root, 'session-main')
    ;(ctx.get('agents') as unknown as StubAgents).add(main)

    await ctx.a2d2.bindMainSession({ cwd: root, issue: 46, mainSession: main.id, now: new Date() })

    const section = main.prompt.render('a2d2:ceo')
    expect(section).toContain('CEO Duties')
    expect(section).toContain('Wake Checklist')
    for (const tool of ['bind_main_session', 'dispatch_subagent', 'open_subtask', 'complete_task']) {
      expect(section).toContain(tool)
    }
    expect(section).not.toMatch(/claude|codex|gpt|sonnet|opus|fable/i)
    expect(section).not.toContain('Issue tracker')
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

  it('touches each CEO method and SOUL file exactly once per assembly', async () => {
    const root = await tempRoot()
    const { agentFilesDir, globalSoulDir } = await writeAgentFiles(root, {
      agents: 'CEO duties',
      wake: 'Wake checklist',
      globalSoul: 'Global principle',
      projectSoul: 'Project principle',
    })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(ceoPromptPlugin, { agentFilesDir, globalSoulDir })
    const main = agent(root, 'session-main')
    ;(ctx.get('agents') as unknown as StubAgents).add(main)
    await ctx.a2d2.bindMainSession({ cwd: root, issue: 46, mainSession: main.id, now: new Date() })

    resetAccesses()
    expect(main.prompt.render('a2d2:ceo')).toContain('Project principle')

    for (const path of [
      join(agentFilesDir, 'AGENTS.md'),
      join(agentFilesDir, 'WAKE.md'),
      join(globalSoulDir, 'SOUL.md'),
      join(root, '.dsh', 'a2d2', 'SOUL.md'),
    ]) {
      expect(accessCount(path), path).toBe(1)
    }
  })

  it('names a SOUL path that is a directory or a symbolic link in the section instead of failing assembly', async () => {
    const root = await tempRoot()
    const { agentFilesDir, globalSoulDir } = await writeAgentFiles(root, {
      agents: 'CEO duties',
      wake: 'Wake checklist',
    })
    const projectSoul = join(root, '.dsh', 'a2d2', 'SOUL.md')
    await mkdir(projectSoul, { recursive: true })
    await writeFile(join(root, 'elsewhere.md'), 'Principle from elsewhere', 'utf8')
    await symlink(join(root, 'elsewhere.md'), join(globalSoulDir, 'SOUL.md'))
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(ceoPromptPlugin, { agentFilesDir, globalSoulDir })
    const main = agent(root, 'session-main')
    ;(ctx.get('agents') as unknown as StubAgents).add(main)
    await ctx.a2d2.bindMainSession({ cwd: root, issue: 46, mainSession: main.id, now: new Date() })

    const section = main.prompt.render('a2d2:ceo')
    expect(section).toContain('CEO duties')
    expect(section).toContain(`Unreadable Project SOUL (priority over global SOUL): ${projectSoul} (path is a directory`)
    expect(section).toContain(`Unreadable Global SOUL: ${join(globalSoulDir, 'SOUL.md')} (path is a symbolic link`)
    expect(section).not.toContain('Principle from elsewhere')
  })
})
