import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorkApplication } from '../work.ts'

/** Production tools are optional; local work queries never require a live Agent. */
export function installWorkControlRecovery(ctx: Context, app: WorkApplication): void {
  ctx.effect(() => {
    let closed = false
    let running: Promise<void> | undefined
    const tick = () => {
      if (closed || running) return
      running = app.reconcileControls().catch(error => { ctx.logger.warn(`work control recovery: ${String(error)}`) }).finally(() => { running = undefined })
    }
    // agent/status is emitted after the real loop changes to idle. The recovery
    // read yields out of the event callback; it never waits on its emitting turn.
    const off = ctx.on('agent/status', ({ status }) => { if (status === 'idle') tick() })
    const timer = setInterval(tick, 250)
    timer.unref()
    tick()
    return async () => { closed = true; clearInterval(timer); off(); await running }
  }, 'persisted managed work control recovery')
}

export function installWorkTools(ctx: Context, app: WorkApplication, runtimeId: string): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'work_control',
    description: 'Read status or report progress, ask/wait, pause or explicitly resume your current managed Task. Waiting and pausing are durably accepted now and applied after this turn. They preserve queued input until an explicit resume. Task identity and execution authority come from your calling Session.',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'progress', 'wait', 'pause', 'resume'] },
      text: { type: 'string', description: 'Concrete progress, question, or reason for the control request.' },
      expected_epoch: { type: 'integer', description: 'Optional epoch precondition from status. A mismatch rejects the write; this never grants ownership.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.result }] },
    async execute(args, exec) {
      if (!exec.agent || exec.agent.session.id !== exec.agent.id) throw new Error('work_control requires a real calling Agent Session')
      return { result: JSON.stringify(await app.sessionControl({ runtimeId, sessionId: exec.agent.id }, exec.callId, args.action, args.text, args.expected_epoch)) }
    },
    presentCall: args => ({ card: 'generic', title: `Work: ${args.action}`, kind: 'other', rawInput: args }),
  })), 'managed work model tool')
}
