import test from 'node:test'
import assert from 'node:assert/strict'
import { compareRetention } from './retention.mjs'

const baseline = { origin: 'http://127.0.0.1:18781', records: [{ kind: 'session', id: 'old', identity: { cwd: '/work', model: 'codex/accepted', permissions: 'standard', agentPreset: 'engineer' }, history: ['birth', 'decision'] }] }
test('保留旧身份和配置，允许追加历史及明确批准的新对象', () => {
  const current = structuredClone(baseline)
  current.records[0].history.push('result')
  current.records.push({ kind: 'session', id: 'qa', identity: {}, history: [] })
  assert.deepEqual(compareRetention(baseline, current, ['session:qa']), { ok: true, violations: [] })
  for (const key of ['cwd', 'model', 'permissions', 'agentPreset']) {
    const drift = structuredClone(current)
    drift.records[0].identity[key] = 'drift'
    assert.equal(compareRetention(baseline, drift, ['session:qa']).ok, false, key)
  }
  const lost = structuredClone(current)
  lost.records[0].history.shift()
  assert.equal(compareRetention(baseline, lost, ['session:qa']).ok, false)
  assert.equal(compareRetention(baseline, { ...current, records: [] }).ok, false)
  assert.equal(compareRetention(baseline, current).ok, false)
})
