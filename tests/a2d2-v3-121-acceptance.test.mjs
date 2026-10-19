import { test } from 'node:test'
import assert from 'node:assert/strict'

test('real host counts both model boundaries and turns the disabled adapter throw into finish error', { skip: !process.env.A2D2_ACCEPTANCE_POSITIVE_ROOT }, async () => {
  const result = await request(process.env.A2D2_ACCEPTANCE_POSITIVE_ROOT, 'positive')
  assert.equal(result.before.gateway, 0)
  assert.equal(result.before.adapter, 0)
  assert.equal(result.after.gateway, 1)
  assert.equal(result.after.adapter, 1)
  assert.equal(result.finish.reason.kind, 'error')
  assert.equal(result.finish.reason.failure.message, 'A2D2_ACCEPTANCE_MODEL_DISABLED')
})

test('fresh real host has real Session configuration and no model invocation', { skip: !process.env.A2D2_ACCEPTANCE_ZERO_ROOT }, async () => {
  const result = await request(process.env.A2D2_ACCEPTANCE_ZERO_ROOT, 'snapshot')
  assert.deepEqual(result.providers, ['acceptance-disabled'])
  assert.equal(result.gateway, 0)
  assert.equal(result.adapter, 0)
  assert.ok(result.sessions.length > 0)
  assert.equal(result.sessions[0].model.default.provider, 'acceptance-disabled')
  assert.equal(result.sessions[0].model.default.model, 'no-model')
  assert.equal(result.sessions[0].permissions.sandbox.mode, 'workspace-write')
  assert.equal(result.sessions[0].permissions.approval, 'ask')
})
import { isolatedEnvironment, assertUnchanged, prepare, request } from '../scripts/a2d2-v3-121/acceptance.mjs'

test('prepare refuses a relative host and any root outside the ticket temporary namespace', async () => {
  await assert.rejects(() => prepare({ host: '.', root: '/tmp/a2d2-v3-121/test', hostOnly: true }), /absolute/)
  await assert.rejects(() => prepare({ host: '/some/host', root: '/tmp/elsewhere', hostOnly: true }), /namespace/)
})

test('isolated launch environment does not inherit credentials or HOME', () => {
  const env = isolatedEnvironment('/tmp/a2d2-v3-121/test', { PATH: '/bin', HOME: '/root', OPENAI_API_KEY: 'secret', DSH_HOME: '/real' })
  assert.deepEqual(env, { PATH: '/bin', DSH_HOME: '/tmp/a2d2-v3-121/test/home', XDG_CONFIG_HOME: '/tmp/a2d2-v3-121/test/config', XDG_STATE_HOME: '/tmp/a2d2-v3-121/test/state', DSH_TELEMETRY_DISABLED: '1' })
})

test('acceptance rejects replaced Session identities, configuration drift and any model call', () => {
  const baseline = { sessions: [{ sessionId: 'a', cwd: '/tmp/work', model: { provider: 'acceptance-disabled', model: 'no-model' }, permissions: { mode: 'workspace-write' } }], births: 1 }
  const clean = { ...baseline, gateway: 0, adapter: 0 }
  assert.doesNotThrow(() => assertUnchanged(baseline, clean))
  assert.throws(() => assertUnchanged(baseline, { ...clean, sessions: [{ ...baseline.sessions[0], sessionId: 'b' }] }), /Session/)
  assert.throws(() => assertUnchanged(baseline, { ...clean, sessions: [{ ...baseline.sessions[0], cwd: '/elsewhere' }] }), /Session/)
  assert.throws(() => assertUnchanged(baseline, { ...clean, gateway: 1 }), /model/)
  assert.throws(() => assertUnchanged(baseline, { ...clean, adapter: 1 }), /model/)
  assert.throws(() => assertUnchanged(baseline, { ...clean, births: 2 }), /birth/)
  const first = { ...baseline, processId: 'first' }
  const reloaded = { ...clean, processId: 'second', births: 2, bornSessionIds: ['a', 'a'] }
  assert.doesNotThrow(() => assertUnchanged(first, reloaded))
  assert.throws(() => assertUnchanged(first, { ...reloaded, bornSessionIds: ['a', 'unknown'] }), /birth/)
})
