import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSettlement, validateOperationalHandover } from './one-shot.mjs'

test('正式运维交接允许CEO升级等待与旧job原始收取回执，不冒充产品消费',()=>{
  const plan={runId:'ops',program:'dsh-dev-web-server',origin:'http://127.0.0.1:18781',coordinatorSessionId:'ceo',childIds:['child']}
  const receipt={path:'/tmp/actual-receipt',sha256:'a'.repeat(64)}
  const proof={...plan,source:'parent-operational-handover',pid:123,observedAt:new Date().toISOString(),coordinator:{sessionId:'ceo',state:'upgrade-wait',handoverReceipt:receipt},children:[{id:'child',settled:true,resultReceipt:receipt}],jobs:[{id:'job-1',ownerSessionId:'ceo',status:'completed',collectionEvidence:'owner-job-output-command',receipt,productConsumption:'unknown'}],registryObservation:{noRunning:true,receipt}}
  assert.doesNotThrow(()=>validateOperationalHandover(plan,proof,123))
  assert.throws(()=>validateOperationalHandover(plan,{...proof,jobs:[{...proof.jobs[0],status:'running'}]},123))
  assert.throws(()=>validateOperationalHandover(plan,{...proof,coordinator:{...proof.coordinator,state:'running'}},123))
  assert.throws(()=>validateOperationalHandover(plan,{...proof,jobs:[{...proof.jobs[0],productConsumption:'consumed'}]},123))
})

test('CEO未结算、flush失败、待收job或PID过期时不准停止服务', () => {
  const plan = { runId: 'qa', program: 'dsh-dev-web-server', origin: 'http://127.0.0.1:18781', liveSessionIds: ['ceo'], childIds: ['child'] }
  const now = Date.now()
  const proof = { ...plan, source: 'live-host-public-services', pid: 123, heldUntil: new Date(now+30000).toISOString(), admissionHeld: true, registryComplete: true, sessions: [{ id: 'ceo', idle: true, flush: true }], children: [{ id: 'child', settled: true, resultReceipt: 'sha256:real-parent-delivery' }], jobs: [], pendingInputs: 0 }
  assert.doesNotThrow(() => validateSettlement(plan, proof, 123, now))
  for (const patch of [{children:[]}, {registryComplete:false}, { sessions: [{ id:'ceo', idle:false, flush:true }] }, { sessions: [{id:'ceo', idle:true, flush:false}] }, {jobs:[{terminalResult:'pending'}]}, {admissionHeld:false}, {pid:124}, {pendingInputs:1}, {heldUntil:new Date(now-1).toISOString()}]) assert.throws(() => validateSettlement(plan, {...proof,...patch},123,now))
})
