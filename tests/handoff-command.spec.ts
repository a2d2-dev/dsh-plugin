/**
 * The `/handoff` command: the writing turn it queues on the handing-off
 * session, and the prompt it queues on the successor that takes the handoff.
 *
 * @module dsh-a2d2/tests/handoff-command
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { parseCommand } from '@deepseek-ai/dsh-commands'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  HANDOFF_SUMMARY_END,
  HANDOFF_SUMMARY_PLACEHOLDER,
  HANDOFF_SUMMARY_START,
} from '../src/handoff-document.ts'
import { HANDOFF_USAGE } from '../src/handoff.ts'
import * as commandPlugin from '../src/command.ts'
import A2d2Service from '../src/index.ts'
import { StubCommands, stubAgent } from './stubs.ts'

const roots: string[] = []
const source = SessionId('session-a')
const successor = SessionId('session-b')

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-command-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** One message a command queued, as the model would receive it. */
interface QueuedMessage {
  readonly role: string
  readonly content: readonly { readonly type: string; readonly text?: string }[]
  readonly source: { readonly kind: string }
}

type CommandResult = Awaited<ReturnType<CommandDefinition['handler']>>

/** The agent stub the harness runs commands on, whose `followup` records queued turns. */
type StubAgent = ReturnType<typeof stubAgent>

interface Harness {
  readonly ctx: Context
  readonly service: A2d2Service
  readonly agent: StubAgent
  registered(): readonly CommandDefinition[]
  invoke(rawInput: string): Promise<CommandResult>
  invokeAs(agent: Agent, rawInput: string): Promise<CommandResult>
}

/**
 * Mount the command the way a profile does: the real registry, the real task
 * service, the real store and document files, and a stub session.
 *
 * Services are composed as plugins rather than assigned onto the context:
 * Cordis requires a plugin to declare every service it reads, so a context with
 * hand-assigned properties would not prove the command can read them at all.
 * @param root - the project root the store is pinned to.
 * @param cwd - the working directory the handing-off session reports.
 * @returns the mounted command and the agent it runs on.
 */
async function harness(root: string, cwd = root): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(StubCommands)
  await ctx.plugin(A2d2Service, { root })
  await ctx.plugin(commandPlugin)

  const commands = (): StubCommands => ctx.commands as unknown as StubCommands
  const agent = stubAgent(cwd, source)
  let seq = 0

  const invokeAs = async (target: Agent, rawInput: string): Promise<CommandResult> => {
    seq += 1
    const definition = commands().find(target, 'handoff')
    if (definition === undefined) throw new Error('the command did not register')
    const invocation = {
      commandId: CommandId(`cmd-test-${seq}`),
      agent: target,
      rawInput,
      attachments: [],
      signal: new AbortController().signal,
    } satisfies CommandInvocation
    return await definition.handler(invocation)
  }

  return {
    ctx,
    service: ctx.a2d2,
    agent,
    registered: () => commands().registered(),
    invoke: async (rawInput: string) => await invokeAs(agent, rawInput),
    invokeAs,
  }
}

/** The result text of a command, whichever kind it returned. */
function textOf(result: CommandResult): string {
  return result.text ?? ''
}

/** The single message a command queued on an agent. */
function queued(agent: StubAgent): QueuedMessage {
  expect(agent.followup).toHaveBeenCalledTimes(1)
  const message = agent.followup.mock.calls[0]?.[0] as QueuedMessage | undefined
  if (message === undefined) throw new Error('the command queued no message')
  return message
}

/** The text of the single message a command queued on an agent. */
function queuedText(agent: StubAgent): string {
  const message = queued(agent)
  expect(message.content).toHaveLength(1)
  return message.content.flatMap(block => block.text ?? '').join('')
}

/** The path `<root>/.dsh/a2d2/handoffs/<session>.md` holds the handoff of a session. */
function handoffPath(root: string, id: SessionId): string {
  return join(root, '.dsh', 'a2d2', 'handoffs', `${id}.md`)
}

/**
 * Fill a skeleton's summary region the way the handing-off session's agent does
 * during the queued turn.
 * @param path - the skeleton document to fill in.
 * @param summary - the prose to put between the markers.
 */
async function writeSummary(path: string, summary: string): Promise<void> {
  const skeleton = await readFile(path, 'utf8')
  expect(skeleton).toContain(HANDOFF_SUMMARY_PLACEHOLDER)
  await writeFile(path, skeleton.replace(HANDOFF_SUMMARY_PLACEHOLDER, summary), 'utf8')
}

describe('/handoff registration', () => {
  it('refuses the manual flow for a managed task without scheduling a second driver', async () => {
    const h = await harness(await tempRoot())
    const control = vi.fn()
    h.ctx.provide('a2d2TaskRuntime', { runner: { status: async () => ({ current: source }), control } } as never)
    const prepare = vi.spyOn(h.service, 'prepareHandoff')
    const result = await h.invoke('carry the work')
    expect(result).toMatchObject({ kind: 'error', text: expect.stringContaining('/task-runtime rotate') })
    expect(control).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(h.agent.followup).not.toHaveBeenCalled()
  })

  it('advertises the command and its input syntax', async () => {
    const root = await tempRoot()
    const { registered } = await harness(root)
    const [definition] = registered()
    expect(definition?.name).toBe('handoff')
    expect(definition?.description).toContain('successor')
    expect(definition?.input?.hint).toContain('take <session-id>')
    expect(parseCommand('/handoff take session-a')).toEqual({ name: 'handoff', rawInput: ' take session-a' })
  })

  it('registers once per command runtime', async () => {
    const root = await tempRoot()
    const { registered } = await harness(root)
    expect(registered()).toHaveLength(1)
  })
})

describe('/handoff prepare', () => {
  it('writes the skeleton and queues the turn that fills it in', async () => {
    const root = await tempRoot()
    const { invoke, agent, service } = await harness(root)
    const result = await invoke(' land the retry guard')

    expect(result.kind).toBe('success')
    const path = handoffPath(root, source)
    const text = textOf(result)
    const task = await service.resolve(root)
    if (task === undefined) throw new Error('the handoff created no task')
    expect(text).toContain(`Handoff document: ${path}`)
    expect(text).toContain(`Task: ${task.id} — ${task.name}`)
    expect(text).toContain('not takeable')
    expect(text).toContain('/handoff take session-a')

    const skeleton = await readFile(path, 'utf8')
    expect(skeleton).toContain(HANDOFF_SUMMARY_PLACEHOLDER)
    expect(skeleton).toContain('## Summary')

    const message = queued(agent)
    expect(message.role).toBe('user')
    expect(message.source.kind).toBe('user')
    const instruction = queuedText(agent)
    expect(instruction).toContain(path)
    expect(instruction).toContain(HANDOFF_SUMMARY_START)
    expect(instruction).toContain(HANDOFF_SUMMARY_END)
    expect(instruction).toContain('land the retry guard')
  })

  it('joins the source to the task before the summary exists', async () => {
    const root = await tempRoot()
    const { invoke, service } = await harness(root)
    await invoke(' land the retry guard')
    const tasks = await service.list(root)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.members).toEqual([{ sessionId: source }])
  })

  it('answers --help with the usage line and touches nothing', async () => {
    const root = await tempRoot()
    const { invoke, agent, service } = await harness(root)
    expect(await invoke(' --help')).toEqual({ kind: 'success', text: HANDOFF_USAGE })
    expect(await service.list(root)).toEqual([])
    expect(agent.followup).not.toHaveBeenCalled()
  })

  it('answers a typo with the message and the usage line', async () => {
    const root = await tempRoot()
    const { invoke, agent } = await harness(root)
    const result = await invoke(' --fucos the retry guard')
    expect(result).toEqual({
      kind: 'error',
      text: `Unknown option "--fucos".\n${HANDOFF_USAGE}`,
    })
    expect(agent.followup).not.toHaveBeenCalled()
  })

  it('reports a prepare failure rather than queueing a turn', async () => {
    const root = await tempRoot()
    const { invoke, agent } = await harness(root)
    const result = await invoke(' --task missing-task')
    expect(result.kind).toBe('error')
    expect(textOf(result)).toContain('missing-task')
    expect(agent.followup).not.toHaveBeenCalled()
  })

  it('fails with the project problem rather than writing a document it cannot place', async () => {
    const root = await tempRoot()
    const { invoke, agent, service } = await harness(root, '')
    const result = await invoke('')
    expect(result.kind).toBe('error')
    expect(textOf(result)).toContain('records no working directory')
    expect(await service.list(root)).toEqual([])
    expect(agent.followup).not.toHaveBeenCalled()
  })
})

describe('/handoff take', () => {
  it('queues the document body as the successor\'s first prompt', async () => {
    const root = await tempRoot()
    const { invoke, invokeAs, agent, service } = await harness(root)
    await invoke(' land the retry guard')
    await writeSummary(handoffPath(root, source), 'The retry guard landed; the store layer is next.')

    const successorAgent = stubAgent(root, successor)
    const result = await invokeAs(successorAgent, ' take session-a')

    expect(result.kind).toBe('success')
    const text = textOf(result)
    expect(text).toContain('Handoff taken from session-a.')
    expect(text).toContain('Focus: land the retry guard')
    expect(text).toContain('submitted as this session\'s first prompt')

    const prompt = queuedText(successorAgent)
    expect(prompt).toContain('Continue the work described below.')
    expect(prompt).toContain('The retry guard landed; the store layer is next.')
    expect(prompt).not.toContain('version:')
    expect(agent.followup).toHaveBeenCalledTimes(1)

    const tasks = await service.list(root)
    expect(tasks[0]?.members).toEqual([
      { sessionId: source },
      { sessionId: successor, handoffFrom: source },
    ])
  })

  it('refuses a handoff whose summary is not written yet', async () => {
    const root = await tempRoot()
    const { invoke, invokeAs } = await harness(root)
    await invoke(' land the retry guard')

    const successorAgent = stubAgent(root, successor)
    const result = await invokeAs(successorAgent, ' take session-a')
    expect(result.kind).toBe('error')
    expect(textOf(result)).toContain('not written yet')
    expect(successorAgent.followup).not.toHaveBeenCalled()
  })

  it('reports a missing handoff document instead of continuing without context', async () => {
    const root = await tempRoot()
    const { invokeAs, service } = await harness(root)
    const task = await service.create(root, { name: 'Orphan task' })
    await service.registerMember(root, task.id, source)

    const successorAgent = stubAgent(root, successor)
    const result = await invokeAs(successorAgent, ' take session-a')
    expect(result.kind).toBe('error')
    expect(textOf(result)).toContain('no handoff document')
    expect(successorAgent.followup).not.toHaveBeenCalled()
  })

  it('fails with the project problem when the taking session records no working directory', async () => {
    const root = await tempRoot()
    const { invokeAs } = await harness(root)
    const result = await invokeAs(stubAgent('', successor), ' take session-a')
    expect(result.kind).toBe('error')
    expect(textOf(result)).toContain('records no working directory')
  })

  it('refuses a take that names more than the session id', async () => {
    const root = await tempRoot()
    const { invoke } = await harness(root)
    expect(await invoke(' take fix-flaky-test session-a')).toEqual({
      kind: 'error',
      text: `take takes exactly one session id.\n${HANDOFF_USAGE}`,
    })
  })

  it('refuses a take that names no session at all', async () => {
    const root = await tempRoot()
    const { invoke } = await harness(root)
    expect(await invoke(' take')).toEqual({
      kind: 'error',
      text: `take needs the handed-off session id.\n${HANDOFF_USAGE}`,
    })
  })
})
