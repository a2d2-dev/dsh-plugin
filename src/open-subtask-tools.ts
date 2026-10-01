/**
 * The A²D² model tool that opens a subtask as its own main session.
 *
 * This is a separate mount from `a2d2-tools`: `open_subtask` creates a root
 * Agent and selects a live model, so it needs `agents` and `llm` in addition to
 * the task service. Keeping the row separate lets `bind_main_session` continue
 * to load in smaller profiles.
 *
 * @module @deepseek-ai/dsh-a2d2/src/open-subtask-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'

/** Cordis plugin name of the open-subtask tools half. */
export const name = 'a2d2-open-subtask-tools'

/** Services the tool needs before it can register. */
export const inject = ['tools', 'a2d2', 'agents', 'llm']

/** Name of the tool that opens a subtask as its own main session. */
export const OPEN_SUBTASK_TOOL = 'open_subtask'

/** The calling session's agent, which every A²D² tool acts for. */
function callingAgent(exec: ToolRunContext): NonNullable<ToolRunContext['agent']> {
  if (exec.agent === undefined) throw new Error(`${exec.name} requires a calling agent session`)
  return exec.agent
}

/**
 * Register the open-subtask model tool.
 * @param ctx - context carrying the tool registry and the task service.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: OPEN_SUBTASK_TOOL,
    description: 'Open a subtask issue as its own root main session. Only a task issue main session may call this; '
      + 'the caller\'s task issue becomes the parent issue, and the subtask must not already have a main session.',
    parameters: {
      issue: { type: 'integer', required: true, description: 'Subtask issue number that already exists under the calling task issue.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          session: { type: 'string', required: true },
          issue: { type: 'integer', required: true },
          parent_issue: { type: 'integer', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          task: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Opened task issue #${value.issue} as main session ${value.session} under parent #${value.parent_issue} using ${value.provider}/${value.model}; task document: .dsh/a2d2/tasks/${value.task}.yaml`,
      }],
    },
    async execute(args, exec) {
      const agent = callingAgent(exec)
      const opened = await ctx.a2d2.openSubtask({
        cwd: agent.session.header.cwd ?? '',
        caller: agent.id,
        issue: args.issue,
        now: new Date(),
      })
      const parentIssue = opened.task.issue.parent
      if (parentIssue === undefined) throw new Error(`open_subtask opened task issue #${opened.task.issue.number} without a parent issue`)
      return {
        session: opened.session,
        issue: opened.task.issue.number,
        parent_issue: parentIssue,
        provider: opened.model.provider,
        model: opened.model.model,
        task: opened.task.id,
      }
    },
    presentCall: args => ({ card: 'generic', title: `Open subtask #${args.issue}`, kind: 'other', rawInput: args }),
  })), 'a2d2 open_subtask model tool registration')
}
