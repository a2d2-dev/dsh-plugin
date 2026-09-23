/**
 * Test-only composition helpers.
 *
 * Cordis loads a plugin only when every service its `inject` names is present,
 * so a test that mounts `A2d2Service` must compose the seams it declares. These
 * stubs supply exactly those seams and nothing else, which keeps every other
 * dependency in a test real: the task store, the document files, the command
 * registry, and the agent's followup.
 *
 * @module dsh-a2d2/tests/stubs
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
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
