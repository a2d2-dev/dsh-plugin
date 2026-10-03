import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service from '../src/index.ts'
import * as agentPromptPlugin from '../src/agent-prompt.ts'
import { accessCount, resetAccesses } from './fs-access.ts'

vi.mock('node:fs', async importOriginal => (await import('./fs-access.ts')).spyFs(await importOriginal()))

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-agent-prompt-'))
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

  async addSerial(agent: Agent): Promise<void> {
    this.agents.push(agent)
    await this.ctx.serial('agent/created', { agent, source: 'resume' })
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

async function writeAgentConfig(root: string, agentName: 'engineer' | 'reviewer', files: { global?: string; project?: string }): Promise<{ globalAgentsDir: string }> {
  const globalAgentsDir = join(root, 'global-agents')
  await mkdir(globalAgentsDir, { recursive: true })
  if (files.global !== undefined) await writeFile(join(globalAgentsDir, `${agentName}.md`), files.global, 'utf8')
  if (files.project !== undefined) {
    const projectAgentsDir = join(root, '.dsh', 'a2d2', 'agents')
    await mkdir(projectAgentsDir, { recursive: true })
    await writeFile(join(projectAgentsDir, `${agentName}.md`), files.project, 'utf8')
  }
  return { globalAgentsDir }
}

describe('engineer and reviewer Agent prompt sections', () => {
  it('assembles global then project Agent configuration and rereads files on every render', async () => {
    const root = await tempRoot()
    const { globalAgentsDir } = await writeAgentConfig(root, 'engineer', {
      global: 'Global engineer instructions v1',
      project: 'Project engineer instructions v1',
    })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.a2d2.recordSessionAgent(root, SessionId('session-engineer'), 'engineer')
    await ctx.plugin(agentPromptPlugin, { globalAgentsDir })
    const child = agent(root, 'session-engineer')

    ;(ctx.get('agents') as unknown as StubAgents).add(child)

    await vi.waitFor(() => {
      expect(child.prompt.render('a2d2:agent')).toContain('# A2D2 Engineer')
    })
    const first = child.prompt.render('a2d2:agent')
    expect(first).toContain('Global Agent configuration')
    expect(first).toContain('Global engineer instructions v1')
    expect(first).toContain('Project Agent configuration (priority over global Agent configuration)')
    expect(first).toContain('Project engineer instructions v1')
    expect(first?.indexOf('Global engineer instructions v1')).toBeLessThan(first?.indexOf('Project engineer instructions v1') ?? -1)

    await writeFile(join(globalAgentsDir, 'engineer.md'), 'Global engineer instructions v2', 'utf8')
    await writeFile(join(root, '.dsh', 'a2d2', 'agents', 'engineer.md'), 'Project engineer instructions v2', 'utf8')

    const second = child.prompt.render('a2d2:agent')
    expect(second).toContain('Global engineer instructions v2')
    expect(second).toContain('Project engineer instructions v2')
    expect(second).not.toContain('Global engineer instructions v1')
    expect(second).not.toContain('Project engineer instructions v1')
  })

  it('finishes prompt installation before the serial agent-created event resolves', async () => {
    const root = await tempRoot()
    const { globalAgentsDir } = await writeAgentConfig(root, 'engineer', { global: 'Ready before first assembly' })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.a2d2.recordSessionAgent(root, SessionId('session-engineer'), 'engineer')
    await ctx.plugin(agentPromptPlugin, { globalAgentsDir })
    const child = agent(root, 'session-engineer')

    await (ctx.get('agents') as unknown as StubAgents).addSerial(child)

    expect(child.prompt.render('a2d2:agent')).toContain('Ready before first assembly')
  })

  it('installs when a browser route records the Agent after the session was created', async () => {
    const root = await tempRoot()
    const { globalAgentsDir } = await writeAgentConfig(root, 'reviewer', { global: 'Reviewer guidance' })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.plugin(agentPromptPlugin, { globalAgentsDir })
    const child = agent(root, 'session-reviewer')
    ;(ctx.get('agents') as unknown as StubAgents).add(child)
    expect(child.prompt.render('a2d2:agent')).toBeUndefined()

    await ctx.a2d2.recordSessionAgent(root, child.id, 'reviewer')

    expect(child.prompt.render('a2d2:agent')).toContain('Reviewer guidance')
  })

  it('installs an empty section when both levels are absent and picks up a later file write', async () => {
    const root = await tempRoot()
    const { globalAgentsDir } = await writeAgentConfig(root, 'engineer', {})
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.a2d2.recordSessionAgent(root, SessionId('session-engineer'), 'engineer')
    await ctx.plugin(agentPromptPlugin, { globalAgentsDir })
    const child = agent(root, 'session-engineer')

    ;(ctx.get('agents') as unknown as StubAgents).add(child)

    await vi.waitFor(() => {
      expect(child.prompt.render('a2d2:agent')).toBe('')
    })

    await writeFile(join(globalAgentsDir, 'engineer.md'), 'Engineer guidance added after session creation', 'utf8')

    expect(child.prompt.render('a2d2:agent')).toContain('Engineer guidance added after session creation')
  })

  it('preserves prompt variable-looking Agent configuration literally', async () => {
    const root = await tempRoot()
    const { globalAgentsDir } = await writeAgentConfig(root, 'engineer', {
      global: 'Use the literal token template ${{ secrets.TOKEN }} in examples.',
    })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.a2d2.recordSessionAgent(root, SessionId('session-engineer'), 'engineer')
    await ctx.plugin(agentPromptPlugin, { globalAgentsDir })
    const child = agent(root, 'session-engineer')

    ;(ctx.get('agents') as unknown as StubAgents).add(child)

    await vi.waitFor(() => {
      expect(child.prompt.renderModelPrompt('a2d2:agent')).toContain('${{ secrets.TOKEN }}')
    })
  })

  it('touches each Agent configuration file exactly once per assembly', async () => {
    const root = await tempRoot()
    const { globalAgentsDir } = await writeAgentConfig(root, 'engineer', {
      global: 'Global engineer instructions',
      project: 'Project engineer instructions',
    })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.a2d2.recordSessionAgent(root, SessionId('session-engineer'), 'engineer')
    await ctx.plugin(agentPromptPlugin, { globalAgentsDir })
    const child = agent(root, 'session-engineer')
    await (ctx.get('agents') as unknown as StubAgents).addSerial(child)

    resetAccesses()
    expect(child.prompt.render('a2d2:agent')).toContain('Project engineer instructions')

    for (const path of [join(globalAgentsDir, 'engineer.md'), join(root, '.dsh', 'a2d2', 'agents', 'engineer.md')]) {
      expect(accessCount(path), path).toBe(1)
    }
  })

  it('names a project Agent configuration path that is a directory instead of failing assembly', async () => {
    const root = await tempRoot()
    const { globalAgentsDir } = await writeAgentConfig(root, 'engineer', { global: 'Global engineer instructions' })
    const projectConfig = join(root, '.dsh', 'a2d2', 'agents', 'engineer.md')
    await mkdir(projectConfig, { recursive: true })
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.a2d2.recordSessionAgent(root, SessionId('session-engineer'), 'engineer')
    await ctx.plugin(agentPromptPlugin, { globalAgentsDir })
    const child = agent(root, 'session-engineer')
    await (ctx.get('agents') as unknown as StubAgents).addSerial(child)

    const section = child.prompt.render('a2d2:agent')
    expect(section).toContain('Global engineer instructions')
    expect(section).toContain(`Unreadable project Agent configuration: ${projectConfig} (path is a directory`)
  })

  it('follows a symlinked global Agent configuration but refuses a symlinked project one', async () => {
    const root = await tempRoot()
    const dotfiles = join(root, 'dotfiles')
    await mkdir(dotfiles, { recursive: true })
    await writeFile(join(dotfiles, 'engineer.md'), 'Global engineer instructions from dotfiles', 'utf8')
    await writeFile(join(dotfiles, 'project-engineer.md'), 'Project engineer instructions from outside the tree', 'utf8')
    const { globalAgentsDir } = await writeAgentConfig(root, 'engineer', {})
    await symlink(join(dotfiles, 'engineer.md'), join(globalAgentsDir, 'engineer.md'))
    const projectConfig = join(root, '.dsh', 'a2d2', 'agents', 'engineer.md')
    await mkdir(join(projectConfig, '..'), { recursive: true })
    await symlink(join(dotfiles, 'project-engineer.md'), projectConfig)
    const ctx = new Context()
    await ctx.plugin(StubSystemPrompt)
    await ctx.plugin(StubAgents)
    await ctx.plugin(A2d2Service, { root })
    await ctx.a2d2.recordSessionAgent(root, SessionId('session-engineer'), 'engineer')
    await ctx.plugin(agentPromptPlugin, { globalAgentsDir })
    const child = agent(root, 'session-engineer')
    await (ctx.get('agents') as unknown as StubAgents).addSerial(child)

    const section = child.prompt.render('a2d2:agent')
    expect(section).toContain('Global engineer instructions from dotfiles')
    expect(section).toContain(`Unreadable project Agent configuration: ${projectConfig} (path is a symbolic link`)
    expect(section).not.toContain('Project engineer instructions from outside the tree')
  })
})
