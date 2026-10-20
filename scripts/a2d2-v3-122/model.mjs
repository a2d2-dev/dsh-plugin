export const PROVIDER = 'a2d2-acceptance'
export const MODEL = 'deterministic'
export const REPLY = 'A2D2_122_DETERMINISTIC_HOST_REPLY'

// This is the external model boundary, never a product Task response.
export class ModelBoundary {
  constructor(record) { this.record = record }
  authorize(grant) {
    if (!grant.sessionId || !Number.isSafeInteger(grant.calls) || grant.calls < 1 || !grant.phase) throw new Error('Invalid explicit model grant')
    this.grant = { ...grant }
    this.record('authorized', this.grant)
  }
  async *gateway(options, next) {
    this.record('gateway', { sessionId: options.sessionId, provider: options.provider, model: options.model })
    if (options.provider !== PROVIDER || options.model !== MODEL || options.purpose || !this.grant || this.grant.sessionId !== options.sessionId || this.grant.calls === 0 || this.active) throw new Error('A2D2_122_NOT_AUTHORIZED')
    this.grant.calls--
    this.active = options.sessionId
    try { yield* next() } finally { this.active = undefined }
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
        boundary.record('adapter', { sessionId: options.sessionId, provider: options.provider, model: options.model, phase: boundary.grant?.phase })
        if (options.provider !== PROVIDER || options.model !== MODEL || boundary.active !== options.sessionId || !boundary.active) throw new Error('A2D2_122_ADAPTER_NOT_AUTHORIZED')
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: REPLY }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: REPLY } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }()
  }
}
