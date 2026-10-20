import { randomUUID } from 'node:crypto'

export const PROVIDER = 'a2d2-acceptance'
export const MODEL = 'deterministic'
export const REPLY = 'A2D2_122_DETERMINISTIC_HOST_REPLY'
const sameRef = (a, b) => a?.projectId === b?.projectId && a?.taskId === b?.taskId
const text = value => typeof value === 'string' && value.trim().length > 0
const sameBinding = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const runnable = execution => ['ready', 'running'].includes(execution.state) && !(execution.control?.status === 'accepted' && execution.control.action !== 'resume')

// External model boundary only. queryWork is the public WorkApplication.query
// seam; no store access, browser data, or model message supplies authority.
export class ModelBoundary {
  constructor(record, queryWork) { this.record = record; this.queryWork = queryWork }
  deny(reason, extra = {}) {
    this.record('rejected', { grantId: this.grant?.grantId, phase: this.grant?.phase, ...(this.grant?.ref ? { ref: this.grant.ref } : {}), reason, ...extra })
    throw new Error(`A2D2_122_NOT_AUTHORIZED: ${reason}`)
  }
  validateGrant(grant) {
    if (!Number.isSafeInteger(grant.calls) || grant.calls < 1 || !/^[a-z0-9-]+$/.test(grant.phase ?? '')) this.deny('INVALID_GRANT')
    if (this.active || this.authorizing) this.deny('BUSY_GRANT')
  }
  authorize(grant) {
    this.validateGrant(grant)
    if (!text(grant.sessionId)) this.deny('INVALID_GRANT')
    this.grant = { mode: 'session', grantId: randomUUID(), sessionId: grant.sessionId, calls: grant.calls, phase: grant.phase }
    this.record('authorized', this.grant)
    return structuredClone(this.grant)
  }
  async query(value) {
    if (typeof this.queryWork !== 'function') this.deny('WORK_APPLICATION_UNAVAILABLE')
    let result
    try { result = await this.queryWork(value) } catch (error) { this.deny(error?.code === 'WORK_APPLICATION_UNAVAILABLE' ? 'WORK_APPLICATION_UNAVAILABLE' : 'WORK_QUERY_FAILED', { queryType: value.type }) }
    if (result?.status !== 'completed') this.deny('WORK_QUERY_FAILED', { queryType: value.type })
    return result
  }
  binding(execution, ref) {
    if (!execution || !sameRef(execution.ref, ref) || !text(execution.id) || !text(execution.owner) || !Number.isSafeInteger(execution.epoch) || execution.epoch < 1
      || !text(execution.session?.sessionId) || !text(execution.session?.runtimeId) || execution.resource?.runtimeId !== execution.session.runtimeId
      || execution.model?.provider !== PROVIDER || execution.model?.model !== MODEL) this.deny('INVALID_TASK_EXECUTION')
    return { executionId: execution.id, owner: execution.owner, epoch: execution.epoch, runtimeId: execution.session.runtimeId, sessionId: execution.session.sessionId }
  }
  async control(execution, ref) {
    const binding = this.binding(execution, ref)
    const result = await this.query({ type: 'session.work', session: { runtimeId: binding.runtimeId, sessionId: binding.sessionId } })
    const controls = Array.isArray(result.work) ? result.work.filter(row => row.purpose === 'control') : []
    if (controls.length !== 1 || !sameRef(controls[0].ref, ref) || controls[0].executionId !== binding.executionId || controls[0].epoch !== binding.epoch) this.deny('NOT_CURRENT_CONTROL')
    return binding
  }
  async authorizeTask(grant) {
    this.validateGrant(grant)
    if (!text(grant.ref?.projectId) || !text(grant.ref?.taskId)) this.deny('INVALID_TASK_REF')
    this.authorizing = true
    try {
      const ref = { projectId: grant.ref.projectId, taskId: grant.ref.taskId }
      const detail = await this.query({ type: 'task.detail', ref })
      if (detail.task?.id !== ref.taskId || detail.task?.projectId !== ref.projectId) this.deny('UNKNOWN_TASK')
      const { execution } = await this.query({ type: 'task.execution', ref })
      const binding = execution === undefined ? undefined : await this.control(execution, ref)
      this.grant = { mode: 'task', grantId: randomUUID(), ref, calls: grant.calls, phase: grant.phase, ...(binding ? { binding } : {}) }
      this.record('authorized', this.grant)
      return structuredClone(this.grant)
    } finally { this.authorizing = false }
  }
  async *gateway(options, next) {
    const request = { sessionId: options.sessionId, provider: options.provider, model: options.model, ...(options.purpose ? { purpose: options.purpose } : {}) }
    this.record('gateway', request)
    const grant = this.grant
    if (options.provider !== PROVIDER || options.model !== MODEL || options.purpose || !grant || grant.calls === 0 || this.active || this.authorizing) this.deny('ROUTE_BUDGET_OR_BUSY', request)
    // Claim synchronously before public asynchronous queries, so concurrent calls
    // and grant replacement cannot race the budget or its first identity pin.
    this.active = { sessionId: options.sessionId, grantId: grant.grantId, phase: grant.phase, admitted: false }
    try {
      if (grant.mode === 'task') {
        const { execution } = await this.query({ type: 'task.execution', ref: grant.ref })
        const current = await this.control(execution, grant.ref)
        if (current.sessionId !== options.sessionId) this.deny('NOT_CURRENT_SESSION', request)
        if (!runnable(execution)) this.deny('TASK_NOT_RUNNABLE', request)
        if (grant.binding && !sameBinding(grant.binding, current)) this.deny('STALE_TASK_BINDING', request)
        // Re-read after the reverse query; reject authority changes observed
        // across the two public reads rather than pinning a mixed observation.
        const latest = (await this.query({ type: 'task.execution', ref: grant.ref })).execution
        if (!sameBinding(this.binding(latest, grant.ref), current) || !runnable(latest)) this.deny('TASK_CHANGED_DURING_CHECK', request)
        if (!grant.binding) {
          grant.binding = current
          this.record('task-pinned', { grantId: grant.grantId, phase: grant.phase, ref: grant.ref, ...current })
        }
        this.active.ref = grant.ref
        this.active.binding = grant.binding
      } else if (grant.sessionId !== options.sessionId) this.deny('WRONG_SESSION', request)
      grant.calls--
      this.active.admitted = true
      this.record('admitted', { ...this.active, remainingCalls: grant.calls })
      yield* next()
    } finally { this.active = undefined }
  }
  adapter(LlmAdapter) {
    const boundary = this
    return new class extends LlmAdapter {
      providerInfo(provider) { return { id: provider, name: 'A2D2 deterministic acceptance' } }
      async listModels(provider) { return [{ provider, id: MODEL, name: 'Deterministic acceptance only', contextWindow: 128000 }] }
      async resolveModel(provider, model) {
        if (provider !== PROVIDER || model !== MODEL) throw new Error('Unsupported acceptance route')
        return (await this.listModels(provider))[0]
      }
      async *stream(options) {
        const active = boundary.active
        boundary.record('adapter', { sessionId: options.sessionId, provider: options.provider, model: options.model, grantId: active?.grantId, phase: active?.phase, ...(active?.ref ? { ref: active.ref, binding: active.binding } : {}) })
        if (options.provider !== PROVIDER || options.model !== MODEL || options.purpose || active?.sessionId !== options.sessionId || !active?.admitted) boundary.deny('ADAPTER_NOT_AUTHORIZED', { sessionId: options.sessionId })
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: REPLY }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: REPLY } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }()
  }
}
