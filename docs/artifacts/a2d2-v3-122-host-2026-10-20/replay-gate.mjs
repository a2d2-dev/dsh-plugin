// Replay the recorded real-host observations; does not start a server or model.
import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const directory = dirname(fileURLToPath(import.meta.url))
const load = name => JSON.parse(readFileSync(join(directory, name), 'utf8'))
const { before, current } = load('03-host-restart-gate.json')
const first = load('700aaef7-db08-4c7a-af6b-0b5f7a5de746-run.json')
const second = load('1ce900f2-ede8-4d26-af51-209f566f391c-run.json')
assert.equal(first.baseURL, second.baseURL)
assert.notEqual(first.pid, second.pid)
assert.notEqual(first.runId, second.runId)
for (const run of [first, second]) assert.deepEqual(load(`${run.runId}-exit.json`), { code: 0, signal: null })
assert.deepEqual(current.sessions.map(row => row.sessionId), ['current', 'positive', 'retired', 'review'].map(role => `session-a2d2-122-${role}`))
assert.deepEqual(current.sessions.map(row => row.sessionId), before.sessions.map(row => row.sessionId))
assert.deepEqual([current.gateway, current.adapter], [1, 1])
assert.deepEqual([before.gateway, before.adapter], [1, 1])
assert.deepEqual(current.defaultModel, before.defaultModel)
const differences = []
for (const row of current.sessions) {
  const old = before.sessions.find(other => other.sessionId === row.sessionId)
  assert.deepEqual(row.meta, { ...old.meta, delegationDepth: 0 })
  assert.equal(row.meta.cwd, '/tmp/a2d2-v3-121/122-host-positive-606fcee/workspace')
  assert.equal(row.meta.agentPreset, 'standard')
  assert.deepEqual(row.projections.values, old.projections.values)
  if (row.sessionId.endsWith('-positive')) {
    assert.deepEqual(row.eventTypes, [...old.eventTypes, 'session/end-seed'])
    assert.equal(row.projections.asOfSeq, old.projections.asOfSeq + 1)
    differences.push({ sessionId: row.sessionId, field: 'eventTypes/asOfSeq', allowed: 'one shutdown session/end-seed appended; sequence 17→18' })
  } else {
    assert.deepEqual(row.eventTypes, old.eventTypes)
    assert.equal(row.projections.asOfSeq, old.projections.asOfSeq)
  }
  differences.push({ sessionId: row.sessionId, field: 'meta.delegationDepth', allowed: 'absent→0 on cold query normalization' })
}
for (const role of ['current', 'retired', 'review']) assert.equal(current.sessions.find(row => row.sessionId === `session-a2d2-122-${role}`).live, false)
const positive = load('1792468069794-positive.json')
assert.deepEqual(positive.before, { gateway: 0, adapter: 0 })
assert.deepEqual(positive.after, { gateway: 1, adapter: 1 })
assert.equal(positive.reply.text, 'A2D2_122_DETERMINISTIC_HOST_REPLY')
assert.equal(positive.end.data.reason.kind, 'completed')
assert.deepEqual(positive.defaultBefore, positive.defaultAfter)
assert.deepEqual(positive.assemblies, [positive.request])
const metrics = readFileSync(join(directory, 'metrics.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
assert.equal(metrics.filter(row => row.kind === 'gateway').length, 1)
assert.equal(metrics.filter(row => row.kind === 'adapter').length, 1)
assert.deepEqual([...new Set(metrics.filter(row => row.kind === 'session-born').map(row => row.sessionId))].sort(), current.sessions.map(row => row.sessionId))
const result = { passed: true, scope: 'recorded real host positive, read-only browse, stable-origin restart; product pending', origin: first.baseURL, pids: [first.pid, second.pid], jobs: [first.managedJobId, second.managedJobId], exits: [0, 0], counts: { gateway: 1, adapter: 1 }, sessionCount: 4, differences }
if (process.argv.includes('--record')) writeFileSync(join(directory, '05-strict-restart-gate.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify(result, null, 2))
