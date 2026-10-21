import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSettlement, validateOperationalHandover } from './one-shot.mjs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

test('正式运维交接允许CEO升级等待与旧job原始收取回执，不冒充产品消费',()=>{
  const plan={runId:'ops',program:'dsh-dev-web-server',origin:'http://127.0.0.1:18781',coordinatorSessionId:'ceo',childIds:['child']}
  const receipt={path:'/tmp/actual-receipt',sha256:'a'.repeat(64)}
  const proof={...plan,source:'parent-operational-handover',pid:123,observedAt:new Date().toISOString(),coordinator:{sessionId:'ceo',state:'upgrade-wait',handoverReceipt:receipt},children:[{id:'child',settled:true,resultReceipt:receipt}],jobs:[{id:'job-1',ownerSessionId:'ceo',status:'completed',collectionEvidence:'owner-job-output-command',receipt,productConsumption:'unknown'}],registryObservation:{noRunning:true,receipt}}
  assert.doesNotThrow(()=>validateOperationalHandover(plan,proof,123))
  assert.throws(()=>validateOperationalHandover(plan,{...proof,jobs:[{...proof.jobs[0],status:'running'}]},123))
  assert.throws(()=>validateOperationalHandover(plan,{...proof,coordinator:{...proof.coordinator,state:'running'}},123))
  assert.throws(()=>validateOperationalHandover(plan,{...proof,jobs:[{...proof.jobs[0],productConsumption:'consumed'}]},123))
})

test('18782只要求本实例交接，18781父与QA继续工作不阻止preview',()=>{
  const receipt={path:'/tmp/preview-owner-command',sha256:'b'.repeat(64)}
  const plan={runId:'preview',program:'dsh-a2d2-v3-preview',origin:'http://10.126.126.12:18782',coordinatorSessionId:'ceo-on-18781',childIds:['qa-on-18781']}
  const proof={runId:plan.runId,program:plan.program,origin:plan.origin,source:'parent-operational-handover',pid:123,startTicks:'100',observedAt:new Date().toISOString(),sessions:[{id:'preview-session',running:false,pendingInputs:0}],targetReceipt:receipt,jobs:[],registryObservation:{program:plan.program,origin:plan.origin,sessionIds:['preview-session'],noRunning:true,receipt}}
  assert.doesNotThrow(()=>validateOperationalHandover(plan,proof,123))
  for(const patch of [{pid:124},{startTicks:null},{sessions:[]},{sessions:[{id:'preview-session',running:true,pendingInputs:0}]},{sessions:[{id:'preview-session',running:false,pendingInputs:1}]},{registryObservation:{...proof.registryObservation,program:'dsh-dev-web-server'}},{registryObservation:{...proof.registryObservation,noRunning:false}},{jobs:[{ownerSessionId:'ceo-on-18781'}]},{jobs:[{ownerSessionId:'preview-session',status:'running'}]}])assert.throws(()=>validateOperationalHandover(plan,{...proof,...patch},123))
})

test('preview运维回执由真实文件校验，外实例父与children回执不读取',async()=>{
  const root=await mkdtemp(join(tmpdir(),'a2d2-v4-handover-')),path=join(root,'owner-command.json')
  const bytes='actual fixture command result\n'
  await writeFile(path,bytes)
  const receipt={path,sha256:createHash('sha256').update(bytes).digest('hex')}
  const plan={program:'dsh-a2d2-v3-preview'}
  const proof={targetReceipt:receipt,registryObservation:{receipt},jobs:[]}
  const {checkHandoverReceipts}=await import('./one-shot.mjs')
  await checkHandoverReceipts(plan,proof,true)
  await writeFile(path,'changed command result\n')
  await assert.rejects(checkHandoverReceipts(plan,proof,true),/receipt missing or changed/)
})

test('preview临执行cut拒绝任意运行Session、PID复用和Session遗漏',async()=>{
  const {validateTargetCut}=await import('./live-cut.mjs')
  const plan={program:'dsh-a2d2-v3-preview',origin:'http://10.126.126.12:18782',coordinatorSessionId:'preview-session'}
  const proof={pid:123,startTicks:'100',sessions:[{id:'preview-session',running:false,pendingInputs:0}]}
  const cut={source:'public-session-cut',program:plan.program,origin:plan.origin,supervisorPid:123,processes:[{pid:123,startTicks:'100'}],sessions:[{id:'preview-session',running:false}]}
  assert.doesNotThrow(()=>validateTargetCut(plan,proof,cut))
  for(const patch of [{supervisorPid:124},{processes:[{pid:123,startTicks:'101'}]},{sessions:[]},{sessions:[{id:'preview-session',running:true}]}])assert.throws(()=>validateTargetCut(plan,proof,{...cut,...patch}))
})

test('CEO未结算、flush失败、待收job或PID过期时不准停止服务', () => {
  const plan = { runId: 'qa', program: 'dsh-dev-web-server', origin: 'http://127.0.0.1:18781', liveSessionIds: ['ceo'], childIds: ['child'] }
  const now = Date.now()
  const proof = { ...plan, source: 'live-host-public-services', pid: 123, heldUntil: new Date(now+30000).toISOString(), admissionHeld: true, registryComplete: true, sessions: [{ id: 'ceo', idle: true, flush: true }], children: [{ id: 'child', settled: true, resultReceipt: 'sha256:real-parent-delivery' }], jobs: [], pendingInputs: 0 }
  assert.doesNotThrow(() => validateSettlement(plan, proof, 123, now))
  for (const patch of [{children:[]}, {registryComplete:false}, { sessions: [{ id:'ceo', idle:false, flush:true }] }, { sessions: [{id:'ceo', idle:true, flush:false}] }, {jobs:[{terminalResult:'pending'}]}, {admissionHeld:false}, {pid:124}, {pendingInputs:1}, {heldUntil:new Date(now-1).toISOString()}]) assert.throws(() => validateSettlement(plan, {...proof,...patch},123,now))
})
