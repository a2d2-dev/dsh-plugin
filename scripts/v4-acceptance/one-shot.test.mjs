import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSettlement } from './one-shot.mjs'

test('CEO未结算、flush失败、待收job或PID过期时不准停止服务', () => {
  const plan = { runId: 'qa', program: 'dsh-dev-web-server', origin: 'http://127.0.0.1:18781', liveSessionIds: ['ceo'], childIds: ['child'] }
  const now = Date.now()
  const proof = { ...plan, source: 'live-host-public-services', pid: 123, heldUntil: new Date(now+30000).toISOString(), admissionHeld: true, registryComplete: true, sessions: [{ id: 'ceo', idle: true, flush: true }], children: [{ id: 'child', settled: true, resultReceipt: 'sha256:real-parent-delivery' }], jobs: [], pendingInputs: 0 }
  assert.doesNotThrow(() => validateSettlement(plan, proof, 123, now))
  for (const patch of [{children:[]}, {registryComplete:false}, { sessions: [{ id:'ceo', idle:false, flush:true }] }, { sessions: [{id:'ceo', idle:true, flush:false}] }, {jobs:[{terminalResult:'pending'}]}, {admissionHeld:false}, {pid:124}, {pendingInputs:1}, {heldUntil:new Date(now-1).toISOString()}]) assert.throws(() => validateSettlement(plan, {...proof,...patch},123,now))
})
