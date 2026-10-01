/**
 * Test-only composition helpers.
 *
 * Cordis loads a plugin only when every service its `inject` names is present,
 * so a test that mounts `A2d2Service` must compose the seams it declares. These
 * stubs supply exactly those seams and nothing else, which keeps every other
 * dependency in a test real: the task store, the document files, the command
 * and tool registries, and the agent's followup.
 *
 * @module dsh-a2d2/tests/stubs
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { vi } from 'vitest'

/** A `commands` registry that records what a plugin registers and returns real disposers. */
export class StubCommands extends Service {
  private readonly definitions: CommandDefinition[] = []

  /**
   * Take the registry name cordis exposes this stub under.
   * @param ctx - the owning cordis context.
   */
  constructor(ctx: Context) {
    super(ctx, 'commands')
  }

  /**
   * Record one registration.
   * @param definition - the command being registered.
   * @returns the disposer that unregisters it.
   */
  register(definition: CommandDefinition): () => void {
    this.definitions.push(definition)
    return () => {
      const index = this.definitions.indexOf(definition)
      if (index >= 0) this.definitions.splice(index, 1)
    }
  }

  /**
   * The definitions registered so far, in registration order.
   * @returns the recorded definitions.
   */
  registered(): readonly CommandDefinition[] {
    return this.definitions
  }

  /**
   * Resolve a registered definition by name, as the real registry's `find` does.
   * @param agent - the receiving agent; ignored, since this stub registers globally.
   * @param name - the command name without a slash.
   * @returns the definition, or `undefined` when nothing registered it.
   */
  find(_agent: Agent, name: string): CommandDefinition | undefined {
    return this.definitions.find(definition => definition.name === name)
  }
}

/** A `tools` registry that records what a plugin registers and returns real disposers. */
export class StubTools extends Service {
  private readonly definitions: ToolDefinition[] = []

  /**
   * Take the registry name cordis exposes this stub under.
   * @param ctx - the owning cordis context.
   */
  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  /**
   * Record one registration.
   * @param definition - the tool being registered.
   * @returns the disposer that unregisters it.
   */
  register(definition: ToolDefinition): () => void {
    this.definitions.push(definition)
    return () => {
      const index = this.definitions.indexOf(definition)
      if (index >= 0) this.definitions.splice(index, 1)
    }
  }

  /**
   * Resolve a registered definition by name.
   * @param name - the tool name.
   * @returns the definition, or `undefined` when nothing registered it.
   */
  find(name: string): ToolDefinition | undefined {
    return this.definitions.find(definition => definition.name === name)
  }
}

/**
 * The execution context a tool body receives when an agent calls it.
 * @param agent - the calling agent, whose session the tool acts for.
 * @param name - the called tool's name.
 * @param args - the call's arguments.
 * @returns the run context.
 */
export function toolRunContext(agent: Agent, name: string, args: unknown): ToolRunContext {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    name,
    arguments: args,
    agent,
    signal: new AbortController().signal,
    token: Symbol('call-1'),
    deferContext: () => {},
    concludeTurn: () => {},
  } as unknown as ToolRunContext
}

/**
 * A fake agent whose session header supplies the cwd the command reads.
 *
 * `followup` records the messages the command queues on this session, which is
 * how a test observes the turns a handoff submits without a live agent loop.
 * @param cwd - the session's working directory, which locates the project.
 * @param id - the session id the command hands off or takes with.
 * @returns the fake agent, with its recorded followup calls.
 */
export function stubAgent(cwd: string, id: SessionId): Agent & { followup: ReturnType<typeof vi.fn> } {
  const followup = vi.fn()
  const session = {
    header: { version: 0, id, createdAt: 1_758_412_800_000, cwd },
    id,
    append: (type: string, data: unknown) => ({ type, data, seq: 1, time: 1 }),
  }
  return { id, options: {}, session, followup } as unknown as
    Agent & { followup: ReturnType<typeof vi.fn> }
}
