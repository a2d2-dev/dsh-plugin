/**
 * The A²D² model tool that declares the calling task issue complete.
 *
 * This is a separate mount from `a2d2-tools`: `complete_task` may need to resume
 * the parent task's main session before delivering the completion notification,
 * so it declares `agents` while keeping `bind_main_session` available in smaller
 * profiles.
 *
 * @module @deepseek-ai/dsh-a2d2/src/complete-task-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'

/** Cordis plugin name of the complete-task tools half. */
export const name = 'a2d2-complete-task-tools'

/** Services the tool needs before it can register. */
export const inject = ['tools', 'a2d2', 'agents']

/** Name of the tool that declares the calling task issue complete. */
export const COMPLETE_TASK_TOOL = 'complete_task'

/** The calling session's agent, which every A²D² tool acts for. */
function callingAgent(exec: ToolRunContext): NonNullable<ToolRunContext['agent']> {
  if (exec.agent === undefined) throw new Error(`${exec.name} requires a calling agent session`)
  return exec.agent
}

/**
 * Register the complete-task model tool.
 * @param ctx - context carrying the tool registry and the task service.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: COMPLETE_TASK_TOOL,
    description: 'Mark this task issue done and, when it is a subtask whose parent task has a main session, notify that parent main session. Only the task issue main session may call this; the plugin does not call GitHub.',
    parameters: {
      summary: { type: 'string', required: true, description: 'Completion summary to send to the parent main session when one exists.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task: { type: 'string', required: true },
          issue: { type: 'integer', required: true },
          parent_issue: { type: 'integer' },
          state: { type: 'string', required: true },
          notified_parent: { type: 'boolean', required: true },
          parent_main_session: { type: 'string' },
          resumed_parent: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Marked task issue #${value.issue} ${value.state}`
          + (value.notified_parent ? ` and notified parent main session ${value.parent_main_session}` : ''),
      }],
    },
    async execute(args, exec) {
      const agent = callingAgent(exec)
      const completed = await ctx.a2d2.completeTask({
        cwd: agent.session.header.cwd ?? '',
        caller: agent.id,
        summary: args.summary,
      })
      return {
        task: completed.task.id,
        issue: completed.task.issue.number,
        ...(completed.parentIssue === undefined ? {} : { parent_issue: completed.parentIssue }),
        state: completed.task.state,
        notified_parent: completed.notifiedParent,
        ...(completed.parentMainSession === undefined ? {} : { parent_main_session: completed.parentMainSession }),
        ...(completed.notifiedParent ? { resumed_parent: completed.resumedParent } : {}),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Complete task', kind: 'other', rawInput: args }),
  })), 'a2d2 complete_task model tool registration')
}
