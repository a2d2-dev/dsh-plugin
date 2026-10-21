import { readFile, open, realpath, lstat, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join, isAbsolute, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { verifyRelease } from './fingerprint.mjs'

const origins = { 'dsh-dev-web-server': 'http://127.0.0.1:18781', 'dsh-a2d2-v3-preview': 'http://10.126.126.12:18782' }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export function validateSettlement(plan, proof, pid, now = Date.now()) {
  for (const key of ['runId', 'program', 'origin']) if (!plan[key] || proof[key] !== plan[key]) throw Error(`settlement ${key} mismatch`)
  if (proof.source !== 'live-host-public-services' || proof.pid !== pid || proof.admissionHeld !== true || !Number.isFinite(Date.parse(proof.heldUntil)) || Date.parse(proof.heldUntil) <= now || Date.parse(proof.heldUntil) > now + 60000) throw Error('missing fresh held admission/PID proof')
  const expected = [...(plan.liveSessionIds ?? [])].sort()
  if (!expected.length || !Array.isArray(proof.sessions) || JSON.stringify(proof.sessions.map(s => s.id).sort()) !== JSON.stringify(expected) || proof.sessions.some(s => s.idle !== true || s.flush !== true)) throw Error('CEO/Session idle or durable flush incomplete')
  if (!Array.isArray(plan.childIds) || !Array.isArray(proof.children) || JSON.stringify(proof.children.map(child => child.id).sort()) !== JSON.stringify([...plan.childIds].sort()) || proof.children.some(child => child.settled !== true || !child.resultReceipt)) throw Error('children not settled/collected or omitted')
  if (proof.registryComplete !== true) throw Error('complete exact-owner registry observation required')
  if (!Array.isArray(proof.jobs) || proof.jobs.some(job => job.terminalResult !== 'collected' || !job.registryEpoch || !job.instanceId || !job.receipt)) throw Error('job still running, pending, or unknown')
  if (proof.pendingInputs !== 0) throw Error('pending input must be retained and settled before restart')
}
export function validateOperationalHandover(plan,proof,pid,now=Date.now()) {
  for(const key of ['runId','program','origin'])if(proof[key]!==plan[key])throw Error(`operational handover ${key} mismatch`)
  if(proof.source!=='parent-operational-handover'||proof.pid!==pid||!Number.isFinite(Date.parse(proof.observedAt))||now-Date.parse(proof.observedAt)>300000||Date.parse(proof.observedAt)>now+1000)throw Error('fresh PID-bound parent handover required')
  if(plan.program==='dsh-a2d2-v3-preview'){
    if(!/^\d+$/.test(proof.startTicks??'')||!proof.targetReceipt||!Array.isArray(proof.sessions)||!proof.sessions.length||new Set(proof.sessions.map(row=>row.id)).size!==proof.sessions.length||proof.sessions.some(row=>!row.id||row.running!==false||row.pendingInputs!==0))throw Error('preview target Session/input/startTicks observation required')
    const registry=proof.registryObservation
    if(registry?.program!==plan.program||registry?.origin!==plan.origin||!Array.isArray(registry?.sessionIds)||JSON.stringify([...registry.sessionIds].sort())!==JSON.stringify(proof.sessions.map(row=>row.id).sort()))throw Error('preview exact-target registry scope required')
    if(proof.jobs?.some(job=>!registry.sessionIds.includes(job.ownerSessionId)))throw Error('job owner outside preview target')
  }else{
    if(proof.coordinator?.sessionId!==plan.coordinatorSessionId||proof.coordinator?.state!=='upgrade-wait'||!proof.coordinator?.handoverReceipt)throw Error('CEO handover and explicit upgrade-wait required')
    if(!Array.isArray(plan.childIds)||!Array.isArray(proof.children)||JSON.stringify([...plan.childIds].sort())!==JSON.stringify(proof.children.map(row=>row.id).sort())||proof.children.some(row=>row.settled!==true||!row.resultReceipt))throw Error('children not settled/collected')
  }
  if(proof.registryObservation?.noRunning!==true||!proof.registryObservation.receipt||!Array.isArray(proof.jobs))throw Error('actual no-running registry observation required')
  if(proof.jobs.some(job=>!job.ownerSessionId||!['completed','failed','killed'].includes(job.status)||!['owner-job-output-command','foreground-command-result'].includes(job.collectionEvidence)||!job.receipt||job.productConsumption!=='unknown'))throw Error('running job, missing owner command receipt, or fabricated product consumption')
}
export async function checkHandoverReceipts(plan,proof,operational) {
  const receipts=operational&&plan.program==='dsh-a2d2-v3-preview'
    ? [proof.targetReceipt,proof.registryObservation.receipt,...proof.jobs.map(row=>row.receipt)]
    : [...operational?[proof.coordinator.handoverReceipt,proof.registryObservation.receipt]:[],...proof.children.map(row=>row.resultReceipt),...proof.jobs.map(row=>row.receipt)]
  for(const receipt of receipts)if(!receipt?.path||!/^[a-f0-9]{64}$/.test(receipt.sha256??'')||sha(await readFile(receipt.path))!==receipt.sha256)throw Error('real command/handover receipt missing or changed')
}
function supervisorInfo(program,python='python3') { return JSON.parse(command(python,[new URL('./supervisor-info.py',import.meta.url).pathname,program])) }
function command(program, args, timeout = 120000) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw Error(`command failed: ${program} (${result.status ?? result.signal}); inspect private unit log`)
  return result.stdout
}
function serviceStatus(program) {
  const result = spawnSync('supervisorctl', ['status', program], { encoding: 'utf8', timeout: 10000 })
  if (![0, 3].includes(result.status) || !result.stdout.trim().startsWith(program + ' ') || !/\b(RUNNING|STOPPED|EXITED|FATAL|BACKOFF|STARTING|STOPPING)\b/.test(result.stdout)) throw Error('cannot read exact target Supervisor status')
  return result.stdout
}
async function inspect(plan) {
  const reasons = []
  if (!/^[a-z0-9-]+$/.test(plan.runId ?? '')) reasons.push('missing stable runId')
  if (!origins[plan.program] || plan.origin !== origins[plan.program]) reasons.push('only the two exact existing programs/origins are allowed')
  try { await verifyRelease(plan.release) } catch (error) { reasons.push(error.message) }
  for (const kind of ['apply', 'verify', 'rollback', 'rollbackVerify']) {
    const action = plan.actions?.[kind]
    try {
      if (!isAbsolute(action?.script ?? '') || !/^[a-f0-9]{64}$/.test(action?.sha256 ?? '') || sha(await readFile(action.script)) !== action.sha256) throw Error()
    } catch { reasons.push(`missing reviewed/pinned ${kind} action`) }
  }
  const operational=plan.stopMode==='operational-stop-cut'
  if (!plan.settlement) reasons.push('real parent operational handover required')
  else if(origins[plan.program]) {
    try {
      const proof=JSON.parse(await readFile(plan.settlement)),pid=supervisorInfo(plan.program,plan.pythonBinary).pid
      if(operational)validateOperationalHandover(plan,proof,pid)
      else validateSettlement(plan,proof,pid)
      await checkHandoverReceipts(plan,proof,operational)
    } catch(error) { reasons.push(`invalid real handover: ${error.message}`) }
  }
  for(const side of ['new','rollback']) {
    try {
      const profile=plan.profiles[side]
      if(profile.hostRoot!==(side==='new'?plan.release.hostRoot:plan.release.rollbackHostRoot))throw Error('profile points to a different host than verified release')
      if(sha(await readFile(join(profile.path,'node_modules/dsh-a2d2/lib/client.js')))!==profile.clientSha256)throw Error('staged installed client changed')
      if(side==='new'&&profile.clientSha256!==plan.release.artifacts.find(row=>row.role==='plugin-client')?.sha256)throw Error('profile client is not the verified plugin')
      const {fingerprintTree}=await import('./profile-actions.mjs')
      if(await fingerprintTree(profile.path)!==profile.sha256)throw Error('staged profile changed')
      const bytes=await readFile(profile.importsReceipt.path),proof=JSON.parse(bytes)
      if(sha(bytes)!==profile.importsReceipt.sha256||proof.passed!==true||proof.hostRoot!==profile.hostRoot||proof.profileDir!==profile.path)throw Error('complete profile import proof missing')
    } catch(error) { reasons.push(`${side} complete executable profile: ${error.message}`) }
  }
  for(const file of plan.toolFiles??[])try{if(sha(await readFile(file.path))!==file.sha256)throw Error()}catch{reasons.push('frozen operational tool changed')}
  if(operational&&plan.stopPolicy?.parentReviewedStaticCut!==true)reasons.push('parent source review of operational static-cut mode pending; no new LF approval required')
  if(plan.environmentPolicy&&origins[plan.program]){
    try{
      const predicted=JSON.parse(command(plan.pythonBinary??'python3',[new URL('./supervisor-env.py',import.meta.url).pathname,plan.program])).valueHashes
      for(const [key,value]of Object.entries(plan.environmentPolicy.expectedInheritedHashes))if(predicted[key]!==value)throw Error(`inherited environment changed: ${key}`)
      if(plan.program==='dsh-dev-web-server'&&(plan.environmentPolicy.serviceEnvironment?.path!=='/data/_dsh-dev/service-env.json'||JSON.stringify(plan.environmentPolicy.serviceEnvironment.keys)!==JSON.stringify(['DEEPSEEK_API_KEY'])))throw Error('approved service environment reference missing')
    }catch(error){reasons.push(error.message)}
  }
  if(plan.initialStop?.strategy==='single-pid-term-with-hold'){
    try{
      for(const file of plan.initialStop.signalContractFiles)if(sha(await readFile(file.path))!==file.sha256)throw Error('installed signal/autorestart contract changed')
      if(sha(await readFile(plan.initialStop.hold.candidate))!==plan.initialStop.hold.sha256||!plan.initialStop.hold.allowedCurrentSha256.includes(sha(await readFile(plan.initialStop.hold.target))))throw Error('original preview/holder candidate changed')
      const probe=JSON.parse(command(plan.pythonBinary??'python3',['-c','import os, signal, json; fd=os.pidfd_open(os.getpid()); os.close(fd); print(json.dumps({"pidfd":hasattr(signal,"pidfd_send_signal")}))']))
      if(probe.pidfd!==true)throw Error('single instance signal primitive unavailable')
    }catch(error){reasons.push(error.message)}
  }else if(plan.program==='dsh-a2d2-v3-preview'&&plan.initialStop?.strategy!=='supervisor-single-signal')reasons.push('concrete preview first-stop strategy required')
  if (plan.program === 'dsh-dev-web-server') {
    try {
      const receiptBytes = await readFile(plan.previewVerifiedReceiptPath)
      const receipt = JSON.parse(receiptBytes)
      for (const role of ['plugin-tgz', 'plugin-client', 'host-cli']) if (receipt.deployed?.[role] !== plan.release.artifacts.find(item => item.role === role)?.sha256) throw Error()
      if (sha(receiptBytes) !== plan.previewVerifiedReceiptSha256 || receipt.status !== 'deployment-verified' || receipt.origin !== origins['dsh-a2d2-v3-preview'] || receipt.pluginCommit !== plan.release.pluginCommit || receipt.hostCommit !== plan.release.hostCommit) throw Error()
    } catch { reasons.push('matching real preview completion receipt required before actual GUI') }
  }
  if (plan.prepareOnly !== false) reasons.push('prepareOnly; deployment not authorized')
  return reasons
}
async function main() {
  const [path, flag] = process.argv.slice(2)
  if (flag && flag !== '--execute') throw Error('Usage: one-shot.mjs PLAN.json [--execute]; default is dry-run')
  const bytes = await readFile(path), plan = JSON.parse(bytes)
  const reasons = await inspect(plan)
  const steps = ['verify complete new and rollback hosts', 'hold external admission and settle CEO/children/jobs; flush', `stop only ${plan.program}`, 'apply pinned profile + isolated-host launcher switch', `start only ${plan.program}`, 'same-origin refresh, client fingerprint and retention check', 'write durable completion; on failure preserve data and restore executable runtime']
  if (flag !== '--execute') {
    console.log(JSON.stringify({ mode: 'dry-run', ready: reasons.length === 0, reasons, steps }, null, 2))
    process.exitCode = reasons.length ? 1 : 0
    return
  }
  if (reasons.length) throw Error(`preflight refused before stop: ${reasons.join('; ')}`)
  const cgroup = await readFile('/proc/self/cgroup', 'utf8')
  if (!cgroup.includes(`/a2d2-v4-141-${plan.runId}.service`)) throw Error('must run in its own system-managed one-shot unit, outside DSH service')
  const authorization = JSON.parse(await readFile(plan.executionInstruction))
  if (authorization.planSha256 !== sha(bytes) || authorization.source !== 'parent-session-deployment-instruction' || !authorization.requestRef || authorization.parentSessionId!==plan.coordinatorSessionId) throw Error('parent execution instruction for this reviewed plan required; original human deployment scope persists')
  const root = plan.evidenceRoot
  const persistentEvidence=join(dirname(dirname(fileURLToPath(import.meta.url))),'evidence')
  if (!isAbsolute(root ?? '') || !(root.startsWith('/tmp/a2d2-v4-')||(root===persistentEvidence&&root.startsWith('/data/_dsh-builds/v4-141-artifacts-38d4d91/'))) || await realpath(root) !== root || (await lstat(root)).mode & 0o077) throw Error('existing canonical private evidenceRoot in tmp or this frozen artifact run required')
  const lock = await open(join(root, 'one-shot.lock'), 'wx', 0o600); await lock.close()
  const journal = await open(join(root, 'one-shot.jsonl'), 'ax', 0o600)
  const record = async (stage, detail = {}) => { await journal.write(JSON.stringify({ runId: plan.runId, at: new Date().toISOString(), stage, ...detail })+'\n'); await journal.sync() }
  const finish = async (status, detail = {}) => {
    const file = await open(join(root, 'completion.json'), 'wx', 0o600)
    await file.writeFile(JSON.stringify({ runId: plan.runId, status, origin: plan.origin, program: plan.program, ticketAcceptance: 'not implied', pluginCommit: plan.release.pluginCommit, hostCommit: plan.release.hostCommit, deployed: Object.fromEntries(plan.release.artifacts.filter(item => ['plugin-tgz', 'plugin-client', 'host-cli'].includes(item.role)).map(item => [item.role, item.sha256])), at: new Date().toISOString(), ...detail }, null, 2)+'\n'); await file.sync(); await file.close()
    if(plan.notification?.enabled===true&&status!=='refused-before-stop'){
      try{
        const request=await open(join(root,'notification-request.json'),'wx',0o600)
        await request.writeFile(JSON.stringify({source:'automatic-acceptance',runId:plan.runId,targetSessionId:plan.notification.targetSessionId,parentInstructionRef:plan.notification.parentInstructionRef,receiptSha256:sha(await readFile(join(root,'completion.json')))},null,2)+'\n');await request.sync();await request.close()
      }catch(error){console.error(JSON.stringify({stage:'notification-outbox-failed',runId:plan.runId,error:error.message}));process.exitCode=1}
    }
  }
  const action = async kind => {
    const descriptor = plan.actions[kind]
    if (sha(await readFile(descriptor.script)) !== descriptor.sha256) throw Error(`action changed: ${kind}`)
    const result = spawnSync(process.execPath, [descriptor.script, path, kind], { env:{...process.env,A2D2_V4_DEPLOY_PLAN_SHA256:sha(bytes)}, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
    const log = await open(join(root, `${kind}.private.log`), 'wx', 0o600)
    await log.writeFile(JSON.stringify({ status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr })); await log.sync(); await log.close()
    if (result.status !== 0) throw Error(`action failed: ${kind}; inspect private action log`)
  }
  let stopped = false, safeStoppedData = false, runtimeMayHaveWrittenData=false
  const operational=plan.stopMode==='operational-stop-cut'
  const stopProgram=()=>{
    const result=spawnSync('supervisorctl',['stop',plan.program],{encoding:'utf8',timeout:120000})
    const info=supervisorInfo(plan.program,plan.pythonBinary)
    if(!['STOPPED','EXITED','FATAL'].includes(info.statename))throw Error('specified program did not fully stop')
    return {info,commandStatus:result.status}
  }
  const ensureRunning=()=>{const state=supervisorInfo(plan.program,plan.pythonBinary);if(!['RUNNING','STARTING','BACKOFF'].includes(state.statename))command('supervisorctl',['start',plan.program])}
  try {
    const before=supervisorInfo(plan.program,plan.pythonBinary),pid=before.pid
    if(before.statename!=='RUNNING'||!pid)throw Error('target is not the observed running process')
    const proof=JSON.parse(await readFile(plan.settlement))
    if(operational)validateOperationalHandover(plan,proof,pid);else validateSettlement(plan,proof,pid)
    await checkHandoverReceipts(plan,proof,operational)
    if(operational){
      const {liveCut,validateTargetCut}=await import('./live-cut.mjs')
      const cut=await liveCut(plan.program,join(root,'pre-stop-cut'))
      validateTargetCut(plan,proof,cut)
    }
    await record('preflight-passed',{pid,planSha256:sha(bytes),stopMode:plan.stopMode})
    if(operational)validateOperationalHandover(plan,proof,pid);else validateSettlement(plan,proof,pid)
    const stopStarted=Date.now()
    stopped=true
    let stoppedResult
    if(plan.initialStop?.strategy==='single-pid-term-with-hold'){
      const{stopPreviewWithHold}=await import('./preview-stop.mjs');stoppedResult=await stopPreviewWithHold(plan)
    }else stoppedResult=stopProgram()
    const after=stoppedResult.info
    if(!stoppedResult.heldPreview&&after.start!==before.start)throw Error('Supervisor process generation changed during stop')
    const exit=stoppedResult.exit??{source:'supervisor-xmlrpc-process-info',code:after.exitstatus,signal:null,forced:after.exitstatus<0,stopElapsedMs:Date.now()-stopStarted,supervisor:after,gracefulOutcome:'not inferred'}
    await record('stopped',{exit,commandStatus:stoppedResult.commandStatus})
    if(operational){
      const {verifyStopped}=await import('./stopped-cut.mjs')
      try{await verifyStopped(plan,exit);safeStoppedData=true}catch(error){safeStoppedData=error.staticCut?.ok===true;throw error}
    }else safeStoppedData=true
    runtimeMayHaveWrittenData=true
    await action('apply');await record('applied')
    ensureRunning();await record('started')
    await action('verify');await record('verified')
    await finish('deployment-verified')
  }catch(error){
    await record('failed',{error:error.message,safeStoppedData})
    if(stopped&&safeStoppedData){
      try{
        let observed=supervisorInfo(plan.program,plan.pythonBinary),rollbackCut=plan.liveCutPath,stopElapsedMs=0
        if(!['STOPPED','EXITED','FATAL'].includes(observed.statename)){
          if(operational&&observed.statename==='RUNNING'){
            try{const{liveCut}=await import('./live-cut.mjs');await liveCut(plan.program,join(root,'rollback-pre-stop-cut'));rollbackCut=join(root,'rollback-pre-stop-cut/live-cut.json')}
            catch(cutError){await record('rollback-public-cut-unavailable',{error:cutError.message,scope:'last confirmed accepted cut retained; complete current physical/native snapshot still required'})}
          }
          const began=Date.now();observed=stopProgram().info;stopElapsedMs=Date.now()-began
        }
        if(operational&&runtimeMayHaveWrittenData){
          const area=join(root,'rollback-stop');await mkdir(area,{mode:0o700})
          const{verifyStopped}=await import('./stopped-cut.mjs')
          try{await verifyStopped({...plan,evidenceRoot:area,liveCutPath:rollbackCut},{source:'supervisor-xmlrpc-process-info',code:observed.exitstatus,signal:null,forced:observed.exitstatus<0,stopElapsedMs})}
          catch(stopError){if(stopError.staticCut?.ok!==true)throw stopError;await record('rollback-stop-unsafe-exit',{error:stopError.message,dataIntact:true})}
        }
        await action('rollback');await record('rollback-applied')
        ensureRunning();await action('rollbackVerify');await record('rollback-verified')
        await finish('rolled-back',{failure:error.message})
      }catch(rollbackError){await record('rollback-failed',{error:rollbackError.message});await finish('failed-needs-external-recovery',{failure:error.message,rollbackFailure:rollbackError.message})}
    }else await finish(stopped?'failed-needs-external-recovery':'refused-before-stop',{failure:error.message,reason:stopped?'data integrity not proven; preserve stopped originals, do not start a repairing reader':'no service stop performed'})
    process.exitCode=1
  }finally{await journal.close()}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(JSON.stringify({ status: 'refused-or-failed', error: error.message })); process.exitCode = 1 })
