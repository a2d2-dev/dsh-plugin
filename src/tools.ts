/**
 * The model tools of A²D²: the actions a main session's CEO takes on its task.
 *
 * This is a separate mount from the task service for the same reason the
 * `/handoff` command is: cordis loads a plugin only once every service it
 * declares exists, so the task store keeps loading in profiles without a tool
 * registry, and only this row requires one.
 *
 * Every tool is a thin shell: it reads the calling session from the execution
 * context and hands its arguments to `ctx.a2d2`, which owns the rules.
 *
 * @module @deepseek-ai/dsh-a2d2/src/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'

/** Cordis plugin name of the tools half. */
export const name = 'a2d2-tools'

/** Services the tools need before they can register. */
export const inject = ['tools', 'a2d2']

/** Name of the tool that binds the calling session as a task issue's main session. */
export const BIND_MAIN_SESSION_TOOL = 'bind_main_session'

/** The calling session's agent, which every A²D² tool acts for. */
function callingAgent(exec: ToolRunContext): NonNullable<ToolRunContext['agent']> {
  if (exec.agent === undefined) throw new Error(`${exec.name} requires a calling agent session`)
  return exec.agent
}

/**
 * Register the A²D² model tools.
 * @param ctx - context carrying the tool registry and the task service.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: BIND_MAIN_SESSION_TOOL,
    description: 'Bind this session as the main session of a task issue, recorded in the project\'s A²D² task document. '
      + 'A task issue has one main session at a time and a session is the main session of at most one task issue; '
      + 'binding again with the same arguments is a no-op.',
    parameters: {
      issue: { type: 'integer', required: true, description: 'Task issue number this session executes.' },
      parent_issue: { type: 'integer', description: 'Parent task issue number; set only when the task issue is a subtask.' },
      title: { type: 'string', description: 'Task issue title, used as the task name when the task is first recorded.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task: { type: 'string', required: true },
          issue: { type: 'integer', required: true },
          parent_issue: { type: 'integer' },
          main_session: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `This session is the main session of task issue #${value.issue}`
          + (value.parent_issue === undefined ? '' : `, a subtask of #${value.parent_issue}`)
          + `; task document: .dsh/a2d2/tasks/${value.task}.yaml`,
      }],
    },
    async execute(args, exec) {
      const agent = callingAgent(exec)
      const task = await ctx.a2d2.bindMainSession({
        cwd: agent.session.header.cwd ?? '',
        issue: args.issue,
        ...(args.parent_issue === undefined ? {} : { parentIssue: args.parent_issue }),
        ...(args.title === undefined ? {} : { title: args.title }),
        mainSession: agent.id,
        now: new Date(),
      })
      const issue = task.issue
      return {
        task: task.id,
        issue: issue.number,
        ...(issue.parent === undefined ? {} : { parent_issue: issue.parent }),
        main_session: issue.mainSession,
      }
    },
    presentCall: args => ({ card: 'generic', title: `Bind main session of #${args.issue}`, kind: 'other', rawInput: args }),
  })), 'a2d2 model tools registration')
}
