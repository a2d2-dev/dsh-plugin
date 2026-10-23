/**
 * The message source this plugin stamps on the user messages of its detached
 * auxiliary model calls (next-step consult, model probe).
 *
 * DSH 0.2 removed the shared `plugin` source kind: `MessageSourceMap` is
 * merge-extensible and every producer declares its own `kind` in its own
 * module, which this file does for dsh-a2d2.
 *
 * @module @a2d2/dsh-a2d2/src/message-source
 */

import type {} from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A user message dsh-a2d2 builds for its own model call; never appended to a session. */
    'dsh-a2d2': { kind: 'dsh-a2d2' }
  }
}

/** Source of every user message this plugin builds for its own model calls. */
export const A2D2_MESSAGE_SOURCE = { kind: 'dsh-a2d2' } as const
