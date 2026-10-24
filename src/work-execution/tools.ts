import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorkApplication } from '../work.ts'
import { modelWorkResult, readModelWorkDetails } from '../work-model-details.ts'
import { workMaterialPage } from '../work-model-read.ts'

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
    // This fallback reconciles the whole work snapshot; with a Project of
    // thousands of items a 250ms cadence re-parsed megabytes several times a
    // second and starved the server event loop. The idle event above is the
    // responsive path, so the timer only needs to be a slow safety net.
    const timer = setInterval(tick, 2_000)
    timer.unref()
    tick()
    return async () => { closed = true; clearInterval(timer); off(); await running }
  }, 'persisted managed work control recovery')
}

export function installWorkTools(ctx: Context, app: WorkApplication, runtimeId: string): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'work_read',
    description: 'Explicitly read current managed Task material when startup material is missing or status flags a different specification version. Choose specification (goal, all criteria and necessary child scope), progress, sources, continuation, or result with the exact detail_id from a truncated diagnostic. Result IDs are bound to the current Task execution; terminal audit-only file references do not permit further tools. Returns bounded JSON fragments; concatenate content from every page until complete before interpreting it. Continue with nextCursor, revision and the same expected_version; on conflict or material-changed restart. This does not grant execution authority. For fresh accepted GitHub source observations use work_related_issue.',
    parameters: {
      section: { type: 'string', required: true, enum: ['specification', 'progress', 'sources', 'continuation', 'result'] },
      detail_id: { type: 'string', description: 'For section result: exact content ID from a truncated tool response; bound to the Task execution.' },
      expected_version: { type: 'integer', required: true, description: 'Task version returned by work_control status.' },
      expected_epoch: { type: 'integer' },
      cursor: { type: 'integer', description: 'Zero initially, then the exact nextCursor.' },
      revision: { type: 'string', description: 'Required after the first page; detects changed material.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.result }] },
    async execute(args, exec) {
      if (!exec.agent || exec.agent.session.id !== exec.agent.id) throw new Error('work_read requires a real calling Agent Session')
      const session = { runtimeId, sessionId: exec.agent.id }
      const full = await app.sessionControl(session, exec.callId, 'status')
      if (args.section === 'result') {
        const details = await readModelWorkDetails(app, session, args.detail_id)
        if (details.status !== 'completed') return { result: JSON.stringify(details) }
        return { result: JSON.stringify(workMaterialPage(full, args, details.diagnostics)) }
      }
      return { result: JSON.stringify(workMaterialPage(full, args)) }
    },
    presentCall: args => ({ card: 'generic', title: `Read work: ${args.section}`, kind: 'other' }),
  })), 'explicit managed work material reading')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'work_continuation_material',
    description: 'Save your current managed Task continuation material: the original discussion, concrete accepted decisions, evidence, unfinished work and next step. Task and source Session references are resolved by the server. This saves material only; it does not transfer coordination or start a successor.',
    parameters: {
      body: { type: 'string', required: true, description: 'Original source material. Preserve the reasoning and necessary local references.' },
      decisions: { type: 'string', required: true, description: 'Concrete accepted decisions, or an explicit statement that none exist yet.' },
      evidence: { type: 'string', required: true, description: 'Observed evidence and locally resolvable references; state any evidence gaps.' },
      unfinished: { type: 'string', required: true, description: 'Unfinished acceptance work and blockers.' },
      next: { type: 'string', required: true, description: 'The concrete next step for the successor.' },
      expected_epoch: { type: 'integer', description: 'Optional current epoch precondition; this never grants ownership.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.result }] },
    async execute(args, exec) {
      if (!exec.agent || exec.agent.session.id !== exec.agent.id) throw new Error('work_continuation_material requires a real calling Agent Session')
      const { expected_epoch, ...content } = args
      return { result: JSON.stringify(await app.sessionContinuationMaterial({ runtimeId, sessionId: exec.agent.id }, exec.callId, content, expected_epoch)) }
    },
    presentCall: args => ({ card: 'generic', title: 'Save continuation material', kind: 'other', rawInput: args }),
  })), 'managed work continuation material tool')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'work_control',
    description: 'Check current-session ownership and Task/specification versions with status (no Task material); use work_read for explicit paginated details when supplied material is missing or changed. Status remains available after startup. Report progress, ask/wait, pause or explicitly resume your current managed Task. Waiting and pausing are durably accepted now and applied after this turn, which may still finish its reply. Automatic task input waits for explicit resume; native human conversation remains available and does not itself resume the task. Task identity and execution authority come from your calling Session.',
    parameters: {
      known_specification_version: { type: 'integer', description: 'Specification version supplied at startup or fully read with work_read; status flags changed or missing material.' },
      action: { type: 'string', required: true, enum: ['status', 'progress', 'wait', 'pause', 'resume'] },
      text: { type: 'string', description: 'Concrete progress, question, or reason for the control request.' },
      expected_epoch: { type: 'integer', description: 'Optional epoch precondition from status. A mismatch rejects the write; this never grants ownership.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.result }] },
    async execute(args, exec) {
      if (!exec.agent || exec.agent.session.id !== exec.agent.id) throw new Error('work_control requires a real calling Agent Session')
      const session = { runtimeId, sessionId: exec.agent.id }
      return { result: JSON.stringify(await modelWorkResult(app, session, await app.sessionControl(session, exec.callId, args.action, args.text, args.expected_epoch), args.action === 'status' ? 'status' : 'control', args.known_specification_version)) }
    },
    presentCall: args => ({ card: 'generic', title: `Work: ${args.action}`, kind: 'other', rawInput: args }),
  })), 'managed work model tool')
}
