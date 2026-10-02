import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service from '../src/index.ts'
import * as agentPromptPlugin from '../src/agent-prompt.ts'

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

  it('does not install a section when both Agent configuration levels are absent', async () => {
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

    expect(child.prompt.render('a2d2:agent')).toBeUndefined()
  })
})
