/**
 * The `/handoff` command plugin.
 *
 * This is a separate mount from the task service so that each half declares only
 * the services it truly needs. Cordis refuses to load a plugin whose `inject` is
 * unsatisfied, so a single mount that named the command registry would make the
 * task store unavailable in every profile that composes none — here the store
 * loads anywhere, and only the command requires a registry and the service.
 *
 * The command is also the only half that can write a summary: `invocation.agent`
 * is the handing-off session's own agent, which holds the conversation that the
 * summary is about. Preparing therefore ends by queueing one ordinary turn of
 * that session, and the document stays unreadable until the turn finishes.
 *
 * @module @a2d2/dsh-a2d2/src/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from './message-source.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskId } from './brand.ts'
import { HANDOFF_USAGE, parseHandoffCommand } from './handoff.ts'

/** Cordis plugin name of the command half. */
export const name = 'a2d2-command'

/**
 * Services the command needs before it can register.
 *
 * The document and the task edges are reached through `ctx.a2d2` rather than
 * directly, so validation, redaction, and the project root have one owner and
 * this plugin needs no second declaration for them.
 */
export const inject = ['commands', 'a2d2']

/** The line a person pastes into the successor session to finish a handoff. */
function takeCommand(source: string): string {
  return `/handoff take ${source}`
}

/** Execute one parsed `/handoff` invocation. */
async function executeHandoff(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const command = parseHandoffCommand(invocation.rawInput)

  switch (command.kind) {
    case 'help':
      return { kind: 'success', text: HANDOFF_USAGE }

    case 'invalid':
      return { kind: 'error', text: `${command.message}\n${HANDOFF_USAGE}` }

    case 'prepare':
      return await prepare(ctx, invocation, command.focus, command.task)

    case 'take':
      return await take(ctx, invocation, command.source)
  }
}

/**
 * Write this session's handoff skeleton and queue the turn that fills it in.
 *
 * The summary is written by the session being handed off rather than by the
 * plugin, so the work continues on the next turn and this result only reports
 * what was written and that the document is not takeable yet.
 */
async function prepare(
  ctx: Context,
  invocation: CommandInvocation,
  focus: string | undefined,
  taskId: TaskId | undefined,
): Promise<CommandResult> {
  const agent = invocation.agent
  const cwd = agent.session.header.cwd
  if (cwd === undefined || cwd === '') {
    return {
      kind: 'error',
      text: 'This session records no working directory, so its handoff has no project to live in. '
        + 'Run /handoff from a session opened in the project.',
    }
  }

  let prepared: Awaited<ReturnType<Context['a2d2']['prepareHandoff']>>
  try {
    const runtime = ctx.get('a2d2TaskRuntime')?.runner
    if (runtime && await runtime.status(cwd, agent.id)) {
      return { kind: 'error', text: 'Task runtime owns this task. Use /task-runtime rotate; the manual handoff flow cannot create its successor.' }
    }
    prepared = await ctx.a2d2.prepareHandoff({
      source: agent.id,
      cwd,
      focus,
      taskId,
      now: new Date(),
    })
  } catch (error: unknown) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }

  // The command result is rendered to the person and never reaches the model, so
  // the writing turn is submitted the way `/goal` submits its first turn: an
  // ordinary prompt of this session, which is the only writer holding the
  // conversation the summary is about.
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: prepared.instruction }],
    source: { kind: 'a2d2-handoff', phase: 'prepare', sourceSessionId: agent.id },
  }))

  return {
    kind: 'success',
    text: [
      `Handoff document: ${prepared.path}`,
      `Task: ${prepared.task.id} — ${prepared.task.name}`,
      'This session is writing the summary now; until that turn finishes the document is not takeable.',
      '',
      'Then open a new session and paste this line to record the edge and continue:',
      '',
      takeCommand(prepared.source),
    ].join('\n'),
  }
}

/** Join the current session to the trail and hand it the prompt to continue from. */
async function take(
  ctx: Context,
  invocation: CommandInvocation,
  source: SessionId,
): Promise<CommandResult> {
  const agent = invocation.agent
  const cwd = agent.session.header.cwd
  if (cwd === undefined || cwd === '') {
    return {
      kind: 'error',
      text: 'This session records no working directory, so the handoff document cannot be located. '
        + `Run ${takeCommand(source)} from a session opened in the project.`,
    }
  }

  let taken: Awaited<ReturnType<Context['a2d2']['takeHandoff']>>
  try {
    taken = await ctx.a2d2.takeHandoff({ source, successor: agent.id, cwd })
  } catch (error: unknown) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }

  // The command result is rendered to the person and never reaches the model, so
  // the handoff itself is submitted as the successor's first ordinary prompt.
  // This producer owns that message, which is why the edge is recorded first.
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: taken.prompt }],
    source: { kind: 'a2d2-handoff', phase: 'take', sourceSessionId: source },
  }))

  return {
    kind: 'success',
    text: [
      `Handoff taken from ${source}.`,
      `Task: ${taken.task.id} — ${taken.task.name}`,
      ...(taken.document.focus === undefined ? [] : [`Focus: ${taken.document.focus}`]),
      'The handoff was submitted as this session\'s first prompt.',
    ].join('\n'),
  }
}

/**
 * Register `/handoff` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the task service.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.commands.register({
      name: 'handoff',
      description: 'hand this session off to a successor session, with a written summary',
      input: { hint: '[<focus>] [--task <task-id>] | take <session-id>' },
      handler: invocation => executeHandoff(ctx, invocation),
    }),
    'a2d2 /handoff registration',
  )
}
