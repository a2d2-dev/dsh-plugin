import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { ModelBoundary, PROVIDER, MODEL, REPLY } from '../scripts/a2d2-v3-122/model.mjs'

const require = createRequire('/data/src/github.com/deepseek-ai/deepseek-harness-dev/packages/bundle/base/package.json')
const { LlmAdapter } = await import(require.resolve('@deepseek-ai/dsh-llm'))

test('model boundary requires an explicit session budget and consumes it exactly once', async () => {
  const records = []
  const boundary = new ModelBoundary((kind, data) => records.push({ kind, ...data }))
  const adapter = boundary.adapter(LlmAdapter)
  const options = { provider: PROVIDER, model: MODEL, sessionId: 'session-positive', messages: [] }
  const invoke = async input => {
    const chunks = []
    for await (const chunk of boundary.gateway(input, () => adapter.stream(input))) chunks.push(chunk)
    return chunks
  }
  await assert.rejects(invoke(options), /NOT_AUTHORIZED/)
  boundary.authorize({ sessionId: options.sessionId, calls: 1, phase: 'host-positive' })
  await assert.rejects(invoke({ ...options, sessionId: 'session-other' }), /NOT_AUTHORIZED/)
  const chunks = await invoke(options)
  assert.equal(chunks.find(row => row.type === 'text-delta').text, REPLY)
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  await assert.rejects(invoke(options), /NOT_AUTHORIZED/)
  assert.equal(records.filter(row => row.kind === 'gateway').length, 4)
  assert.equal(records.filter(row => row.kind === 'adapter').length, 1)
  assert.equal(records.filter(row => row.kind === 'adapter')[0].phase, 'host-positive')
  assert.equal(JSON.stringify(records).includes('messages'), false)
  assert.deepEqual((await adapter.listModels(PROVIDER)).map(row => row.id), [MODEL])
})
