/**
 * Dispatching subagents from a main session: stage Agent model selection, child
 * session Agent recording, and the continuable start request sent to DSH.
 *
 * @module dsh-a2d2/tests/dispatch-subagent
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import A2d2Service from '../src/index.ts'
import type { ModelCandidate, StageAgent, StageAgentsSettings } from '../src/stage-agents.ts'
import { DEFAULT_STAGE_AGENTS } from '../src/stage-agents.ts'
import * as toolsPlugin from '../src/tools.ts'
import { StubLlm, StubSubagents, StubTools, stubAgent, toolRunContext } from './stubs.ts'

const roots: string[] = []
const mainSession = SessionId('session-main')

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-dispatch-subagent-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function stageAgents(agent: StageAgent, routes: readonly ModelCandidate[]): StageAgentsSettings {
  return {
    stages: { ...DEFAULT_STAGE_AGENTS.stages },
    consult: [...DEFAULT_STAGE_AGENTS.consult],
    agents: {
      ceo: [...DEFAULT_STAGE_AGENTS.agents.ceo],
      engineer: [...DEFAULT_STAGE_AGENTS.agents.engineer],
      reviewer: [...DEFAULT_STAGE_AGENTS.agents.reviewer],
      [agent]: [...routes],
    },
  }
}

async function writeSpecialAgent(root: string, name: string, text: string): Promise<void> {
  const directory = join(root, '.dsh', 'a2d2', 'agents')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${name}.md`), text, 'utf8')
}

function replaceStageAgents(service: A2d2Service, settings: StageAgentsSettings): void {
  const ref = (service as unknown as { readonly stageAgentsConfig: object }).stageAgentsConfig
  const write = (ref as { [key: symbol]: ((value: unknown) => void) | undefined })[Symbol.for('cosmokit.volatile.write')]
  if (write === undefined) throw new Error('stageAgentsConfig is not writable in this test')
  write(settings)
}

async function mount(root: string, settings: StageAgentsSettings, catalog: readonly string[]) {
  const ctx = new Context()
  await ctx.plugin(StubLlm, { routes: catalog })
  await ctx.plugin(StubSubagents)
  await ctx.plugin(A2d2Service, { root, stageAgents: settings as never })
  return {
    ctx,
    service: ctx.a2d2,
    llm: ctx.get('llm') as unknown as StubLlm,
    subagents: ctx.get('subagents') as unknown as StubSubagents,
  }
}

describe('dispatchSubagent', () => {
  it('dispatches explicit effort independently and reads changed effort on the next call', async () => {
    const root = await tempRoot()
    const route = 'claude-bray/claude-opus-5-5'
    const { service, subagents } = await mount(root,
      stageAgents('engineer', [{ route, reasoningEffort: 'medium' }]), [route])
    const parent = stubAgent(root, mainSession)
    await service.bindMainSession({ cwd: root, issue: 41, mainSession, now: new Date() })
    const request = { cwd: root, stage: 'implement' as const, issue: 48,
      prompt: 'Implement.', parent, signal: new AbortController().signal }
    await expect(service.dispatchSubagent(request)).resolves.toMatchObject({
      model: route, reasoningEffort: 'medium', agent: 'engineer',
    })
    expect(subagents.startContinuable.mock.calls[0]?.[0].request.agentOptions).toEqual({
      provider: 'claude-bray', model: 'claude-opus-5-5', reasoningEffort: 'medium',
    })
    replaceStageAgents(service, stageAgents('engineer', [{ route, reasoningEffort: 'low' }]))
    await service.dispatchSubagent(request)
    expect(subagents.startContinuable.mock.calls[1]?.[0].request.agentOptions).toHaveProperty('reasoningEffort', 'low')
    replaceStageAgents(service, stageAgents('engineer', [{ route, reasoningEffort: 'invalid' }]))
    await expect(service.dispatchSubagent(request)).rejects.toThrow(/does not support reasoning effort/)
    expect(subagents.startContinuable).toHaveBeenCalledTimes(2)
  })

  it('starts a child with the stage Agent first model candidate present in the model catalog', async () => {
    const root = await tempRoot()
    const { service, subagents } = await mount(
      root,
      stageAgents('engineer', ['missing/slow', 'codex/gpt-5.5', 'claude-bray/claude-opus-5-5']),
      ['codex/gpt-5.5', 'claude-bray/claude-opus-5-5'],
    )
    const parent = stubAgent(root, mainSession)
    await service.bindMainSession({ cwd: root, issue: 41, mainSession, now: new Date() })

    const result = await service.dispatchSubagent({
      cwd: root,
      stage: 'implement',
      issue: 48,
      prompt: 'Implement issue #48.',
      parent,
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ model: 'codex/gpt-5.5', agent: 'engineer' })
    expect(result.session).toMatch(/^session-/u)
    await expect(service.agentOfSession(root, result.session)).resolves.toBe('engineer')
    expect(subagents.startContinuable).toHaveBeenCalledOnce()
    expect(subagents.startContinuable).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'spawn',
      label: 'implement #48',
      childId: result.session,
      request: expect.objectContaining({
        parent,
        prompt: [{ type: 'text', text: 'Implement issue #48.' }],
        agentOptions: { provider: 'codex', model: 'gpt-5.5' },
      }),
    }))
    expect(subagents.startContinuable.mock.calls[0]?.[0].request).not.toHaveProperty('persona')
  })

  it('does not pass project Agent configuration through the DSH persona field', async () => {
    const root = await tempRoot()
    const { service, subagents } = await mount(root, stageAgents('reviewer', ['codex/reviewer']), ['codex/reviewer'])
    const parent = stubAgent(root, mainSession)
    await writeSpecialAgent(root, 'reviewer', 'Review with the project-specific checklist.\n')
    await service.bindMainSession({ cwd: root, issue: 41, mainSession, now: new Date() })

    const result = await service.dispatchSubagent({
      cwd: root,
      stage: 'code-review',
      issue: 48,
      prompt: 'Review issue #48.',
      parent,
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ model: 'codex/reviewer', agent: 'reviewer' })
    await expect(service.agentOfSession(root, result.session)).resolves.toBe('reviewer')
    expect(subagents.startContinuable.mock.calls[0]?.[0].request).not.toHaveProperty('persona')
  })

  it('does not treat missing project Agent configuration as a dispatch failure', async () => {
    const root = await tempRoot()
    const { service, subagents } = await mount(root, stageAgents('engineer', ['codex/gpt-5.5']), ['codex/gpt-5.5'])
    const parent = stubAgent(root, mainSession)
    await service.bindMainSession({ cwd: root, issue: 41, mainSession, now: new Date() })

    await expect(service.dispatchSubagent({
      cwd: root,
      stage: 'implement',
      issue: 48,
      prompt: 'Implement issue #48.',
      parent,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ model: 'codex/gpt-5.5', agent: 'engineer' })
    expect(subagents.startContinuable).toHaveBeenCalledOnce()
  })

  it('rejects a caller that is not the project task issue main session', async () => {
    const root = await tempRoot()
    const { service, subagents } = await mount(root, stageAgents('engineer', ['codex/gpt-5.5']), ['codex/gpt-5.5'])

    await expect(service.dispatchSubagent({
      cwd: root,
      stage: 'implement',
      issue: 48,
      prompt: 'Implement issue #48.',
      parent: stubAgent(root, SessionId('session-other')),
      signal: new AbortController().signal,
    })).rejects.toThrow(/not the main session/)
    expect(subagents.startContinuable).not.toHaveBeenCalled()
  })

  it.each(['constructor', '__proto__', 'toString'])('rejects %s as an unknown stage before model selection', async (stage) => {
    const root = await tempRoot()
    const { service, subagents } = await mount(root, stageAgents('engineer', ['codex/gpt-5.5']), ['codex/gpt-5.5'])
    const parent = stubAgent(root, mainSession)
    await service.bindMainSession({ cwd: root, issue: 41, mainSession, now: new Date() })

    await expect(service.dispatchSubagent({
      cwd: root,
      stage: stage as never,
      issue: 48,
      prompt: 'Implement issue #48.',
      parent,
      signal: new AbortController().signal,
    })).rejects.toThrow(`unknown stage "${stage}"`)
    expect(subagents.startContinuable).not.toHaveBeenCalled()
  })

  it('uses the changed stage Agent table on the next dispatch', async () => {
    const root = await tempRoot()
    const { service, subagents } = await mount(root, stageAgents('engineer', ['codex/old']), ['codex/old', 'codex/new'])
    const parent = stubAgent(root, mainSession)
    await service.bindMainSession({ cwd: root, issue: 41, mainSession, now: new Date() })

    await service.dispatchSubagent({
      cwd: root,
      stage: 'implement',
      issue: 48,
      prompt: 'First dispatch.',
      parent,
      signal: new AbortController().signal,
    })
    replaceStageAgents(service, stageAgents('engineer', ['codex/new', 'codex/old']))
    await service.dispatchSubagent({
      cwd: root,
      stage: 'implement',
      issue: 49,
      prompt: 'Second dispatch.',
      parent,
      signal: new AbortController().signal,
    })

    expect(subagents.startContinuable.mock.calls[0]?.[0].request.agentOptions).toEqual({ provider: 'codex', model: 'old' })
    expect(subagents.startContinuable.mock.calls[1]?.[0].request.agentOptions).toEqual({ provider: 'codex', model: 'new' })
  })
})

describe('dispatch_subagent tool', () => {
  it.each(['medium', 'high'])('validates and renders explicit %s reasoning effort in the tool output', async (reasoningEffort) => {
    const root = await tempRoot()
    const route = 'codex/gpt-5.5'
    const { ctx, service } = await mount(root,
      stageAgents('engineer', [{ route, reasoningEffort }]), [route])
    await ctx.plugin(StubTools)
    await ctx.plugin(toolsPlugin)
    const parent = stubAgent(root, mainSession)
    await service.bindMainSession({ cwd: root, issue: 41, mainSession, now: new Date() })
    const tool = (ctx.get('tools') as unknown as StubTools).find('dispatch_subagent')
    if (tool === undefined) throw new Error('the tool did not register')
    const args = { stage: 'implement', issue: 48, prompt: 'Implement issue #48.' }

    const value = await tool.execute(args, toolRunContext(parent, tool.name, args)) as {
      session: string; model: string; agent: string; reasoningEffort: string
    }

    expect(value).toMatchObject({ model: route, agent: 'engineer', reasoningEffort })
    expect(validateJsonSchemaValue(tool.output.schema, value, 'value')).toEqual([])
    expect(validateJsonSchemaValue(tool.output.schema, { ...value, unexpected: 'extra' }, 'value')).toEqual([
      '"value.unexpected" is not a declared property (additionalProperties: false)',
    ])
    expect(tool.output.render(args, value)).toEqual([{
      type: 'text',
      text: `Dispatched subagent ${value.session} with ${route} as engineer; reasoning effort: ${reasoningEffort}`,
    }])
  })

  it('hands stage, issue, and prompt to the service with the calling session as parent', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(StubTools)
    await ctx.plugin(StubLlm, { routes: ['codex/gpt-5.5'] })
    await ctx.plugin(StubSubagents)
    await ctx.plugin(A2d2Service, { root, stageAgents: stageAgents('engineer', ['codex/gpt-5.5']) as never })
    await ctx.plugin(toolsPlugin)
    const parent = stubAgent(root, mainSession)
    await ctx.a2d2.bindMainSession({ cwd: root, issue: 41, mainSession, now: new Date() })
    const tool = (ctx.get('tools') as unknown as StubTools).find('dispatch_subagent')
    if (tool === undefined) throw new Error('the tool did not register')
    const args = { stage: 'implement', issue: 48, prompt: 'Implement issue #48.' }
    expect(tool.parameters).not.toHaveProperty('agent')

    const value = await tool.execute(args, toolRunContext(parent, tool.name, args)) as { session: string; model: string; agent: string }

    expect(value).toMatchObject({ model: 'codex/gpt-5.5', agent: 'engineer' })
    expect(value.session).toMatch(/^session-/u)
    expect(value).not.toHaveProperty('reasoningEffort')
    expect(validateJsonSchemaValue(tool.output.schema, value, 'value')).toEqual([])
    expect(tool.output.render(args, value)).toEqual([{
      type: 'text',
      text: `Dispatched subagent ${value.session} with codex/gpt-5.5 as engineer`,
    }])
  })
})
