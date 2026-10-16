import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { RuntimeHost } from './task-runtime/host.ts'
import { TaskRunner } from './task-runtime/runner.ts'
import { RuntimeStore } from './task-runtime/store.ts'
import type { RunRecord } from './task-runtime/types.ts'

export const name = 'a2d2-task-runtime'
export const inject = ['a2d2', 'agents', 'sessions', 'sessionController', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry', 'commands', 'tools']
export interface Config {
  enabled?: boolean
  homeDir?: string
  pollMs?: number
  rotateTokens?: number
  maxAutoTurns?: number
  maxFailures?: number
}
export const Config = z.object({
  enabled: z.boolean().default(false), homeDir: z.string(), pollMs: z.number().default(2000),
  rotateTokens: z.number().default(150000), maxAutoTurns: z.number().default(8), maxFailures: z.number().default(3),
})

declare module '@deepseek-ai/cordis' {
  interface Context { a2d2TaskRuntime: TaskRuntimeService }
}
export class TaskRuntimeService extends Service {
  readonly runner: TaskRunner
  constructor(ctx: Context, config: Config) {
    super(ctx, 'a2d2TaskRuntime')
    const options = { enabled: config.enabled ?? false, rotateTokens: config.rotateTokens ?? 150000, maxAutoTurns: config.maxAutoTurns ?? 8, maxFailures: config.maxFailures ?? 3 }
    const pollMs = config.pollMs ?? 2000
    for (const [key, value] of Object.entries({ pollMs, rotateTokens: options.rotateTokens, maxAutoTurns: options.maxAutoTurns, maxFailures: options.maxFailures })) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`task-runtime ${key} must be a positive integer`)
    }
    const root = config.homeDir ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'a2d2', 'task-runtime')
    this.runner = new TaskRunner(ctx, new RuntimeStore(root), new RuntimeHost(ctx), options)
    ctx.a2d2.installRuntimeExecutionGuard((agent, messages) => this.runner.allowed(agent, messages))
    ctx.effect(() => {
      let recovering = false
      const tick = async () => {
        if (recovering) return
        recovering = true
        try { await this.runner.recover() }
        catch (error) { ctx.logger.warn(`task-runtime: ${String(error)}`) }
        finally { recovering = false }
      }
      void tick()
      const timer = setInterval(() => { void tick() }, pollMs)
      timer.unref()
      return async () => { clearInterval(timer); await this.runner.close() }
    }, 'task runtime recovery loop')
  }
}
function render(record: RunRecord | undefined): string {
  if (!record) return 'Task runtime is not started for this session. Bind an issue, then /task-runtime start.'
  return JSON.stringify({ task: record.task, state: record.state, current: record.current, workspace: record.workspace,
    generation: record.generation, operation: record.operation, pendingEvents: record.inbox.filter(item => !item.delivered).length,
    failures: record.failures, error: record.error, recoveryRequired: record.recoveryRequired }, null, 2)
}

/** Human commands provide execution control; the model tool reports continuation intent. */
export function apply(ctx: Context, config: Config = {}): void {
  const service = new TaskRuntimeService(ctx, config)
  ctx.effect(() => ctx.commands.register({
    name: 'task-runtime', description: 'Control the bound task background runtime',
    input: { hint: 'start [issue-number] [title] | stop | resume | status | rotate [focus] | recover' },
    handler: async invocation => {
      const [action = 'status', ...rest] = invocation.rawInput.trim().split(/\s+/)
      const { agent } = invocation
      const cwd = agent.session.header.cwd ?? ''
      try {
        const binding = (action === 'start' || action === 'run') && rest.length > 0
          ? { issue: Number(rest[0]?.replace(/^#/, '')), title: rest.slice(1).join(' ') || undefined } : undefined
        const record = action === 'start' || action === 'run'
          ? await service.runner.start(cwd, agent.id, binding)
          : action === 'recover' ? await service.runner.recoverLegacy(cwd, agent.id)
          : action === 'stop' || action === 'resume' || action === 'rotate'
            ? await service.runner.control(cwd, agent.id, action, rest.join(' ') || undefined)
            : action === 'status' || action === '' ? await service.runner.status(cwd, agent.id) : undefined
        if (!['', 'run', 'start', 'stop', 'resume', 'rotate', 'status', 'recover'].includes(action)) throw new Error('Use start, stop, resume, status, rotate, or recover')
        return { kind: 'success', text: render(record) }
      } catch (error) { return { kind: 'error', text: String(error) } }
    },
  }), 'task runtime command')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'task_runtime',
    description: 'For an explicitly started A²D² background task, report what happens after this turn: continue with concrete progress, wait-human, or wait-event. status reads runtime state; rotate requests a safe handoff. Starting and resuming are human /task-runtime commands. Without a wait, the host continues active tasks and blocks repeated turns with no new progress.',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'continue', 'wait-human', 'wait-event', 'rotate'] },
      progress: { type: 'string', description: 'Concrete new progress for continue, or handoff focus for rotate.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.status }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('task_runtime requires a calling agent')
      const cwd = exec.agent.session.header.cwd ?? ''
      if (args.action === 'rotate') await service.runner.control(cwd, exec.agent.id, 'rotate', args.progress)
      else if (args.action === 'continue' || args.action === 'wait-human' || args.action === 'wait-event') {
        await service.runner.decide(cwd, exec.agent.id, args.action, args.progress ?? '')
      }
      return { status: render(await service.runner.status(cwd, exec.agent.id)) }
    },
    presentCall: args => ({ card: 'generic', title: `Task runtime: ${args.action}`, kind: 'other', rawInput: args }),
  })), 'task runtime intent tool')
}
