import {readFile,writeFile,open} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {join} from 'node:path'
const root='/tmp/a2d2-v4-154-5a2ecf3-02'
const suffix=process.argv[2]==='--recheck'?'-pre-execute-recheck':''
const planPath='/data/_dsh-builds/v4-141-artifacts-38d4d91/preview-final-154-5a2ecf3-02/final-plan.private.json'
const planBytes=await readFile(planPath),plan=JSON.parse(planBytes)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
if(hash(planBytes)!=='4d75ba31e211873b1f9e47f4a9ee70ec8958c9e2befe931e30cd1fdfde6951e7')throw Error('authorized plan changed')
const save=async(path,value)=>{const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=await open(path,'wx',0o600);try{await fd.writeFile(bytes);await fd.sync()}finally{await fd.close()}return{path,sha256:hash(bytes)}}
const identity=async pid=>{const text=await readFile(`/proc/${pid}/stat`,'utf8');return {pid,startTicks:text.slice(text.lastIndexOf(')')+2).split(/\s+/)[19]}}
const info=()=>{const result=spawnSync(plan.pythonBinary,[join(new URL('.',`file://${planPath}`).pathname,'tools/supervisor-info.py'),plan.program],{encoding:'utf8'});if(result.status!==0)throw Error('exact Supervisor observation failed');return JSON.parse(result.stdout)}
const service=info(),launcher=await identity(service.pid),cli=await identity(plan.initialStop.cli.pid)
if(service.statename!=='RUNNING'||launcher.pid!==plan.initialStop.launcher.pid||launcher.startTicks!==plan.initialStop.launcher.startTicks||cli.startTicks!==plan.initialStop.cli.startTicks)throw Error('target process generation differs from authorized plan')
const origin=plan.origin,password=(await readFile('/data/_dsh-dev/web-password','utf8')).trim()
const login=await fetch(origin+'/?token='+encodeURIComponent(password),{redirect:'manual',signal:AbortSignal.timeout(10000)})
const cookie=login.headers.get('set-cookie')?.split(';')[0]
if(login.status!==303||!cookie)throw Error('private target authentication failed')
const calls=[]
async function rpc(method,args){
 if(!['session/list','session/projections'].includes(method))throw Error('read-only whitelist')
 const request={type:'client-request',rpcId:randomUUID(),method,payload:{args}}
 const response=await fetch(origin+'/api/'+method,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(30000)})
 const result=await response.json();calls.push({method,request,httpStatus:response.status,response:result})
 if(!response.ok||result.result?.ok!==true)throw Error('public read rejected: '+method+' code='+(result.result?.error?.code??response.status))
 return result.result.value
}
const first=await rpc('session/list',{_request:{}})
if(!Array.isArray(first.items)||!first.items.length||new Set(first.items.map(row=>row.sessionId)).size!==first.items.length)throw Error('incomplete target Session membership')
const sessions=[]
for(const row of first.items){
 const projection=await rpc('session/projections',{request:{sessionId:row.sessionId}}),inbox=projection.values?.inbox
 if(row.running!==false||!Number.isInteger(projection.asOfSeq)||!Array.isArray(inbox?.['next-turn'])||!Array.isArray(inbox?.['next-step']))throw Error('Session/input state running or unknown')
 const pendingInputs=inbox['next-turn'].length+inbox['next-step'].length
 if(pendingInputs!==0)throw Error('target has pending accepted input; do not discard')
 sessions.push({id:row.sessionId,running:false,pendingInputs,asOfSeq:projection.asOfSeq,agentAvailable:row.agentAvailable})
}
const host='/data/src/github.com/deepseek-ai/deepseek-harness-dev.worktrees/v4-141-rollback-a45068d2'
const require=createRequire(host+'/packages/api/gateway/package.json'),WS=require('ws')
const frames=[]
async function registry(sessionId){
 return await new Promise((resolve,reject)=>{
  const streamId=randomUUID(),request={type:'open',streamId,endpoint:'job/list',payload:{args:{request:{sessionId}}}}
  const socket=new WS(origin.replace(/^http/,'ws')+'/api/remote.mux',{headers:{origin,cookie}})
  const timer=setTimeout(()=>{socket.close();reject(Error('target jobs roster timed out'))},10000)
  const done=(error,value)=>{clearTimeout(timer);if(socket.readyState===WS.OPEN)socket.send(JSON.stringify({type:'cancel',streamId}));socket.close();error?reject(error):resolve(value)}
  socket.once('open',()=>socket.send(JSON.stringify(request)))
  socket.once('error',()=>done(Error('target jobs transport failed')))
  socket.on('message',bytes=>{
   const frame=JSON.parse(bytes.toString());frames.push({sessionId,request,frame})
   if(frame.streamId!==streamId)return
   if(frame.type==='error')return done(Error('target jobs stream rejected code='+frame.error?.code))
   if(frame.type==='end')return done(Error('target jobs stream ended without complete roster'))
   if(frame.type!=='item'||frame.value?.type!=='rows'||!Array.isArray(frame.value.jobs))return done(Error('target jobs roster schema mismatch'))
   done(null,frame.value.jobs)
  })
 })
}
for(const session of sessions){const jobs=await registry(session.id);if(jobs.length)throw Error('target has jobs requiring exact owner collection; no consumption inferred')}
const second=await rpc('session/list',{_request:{}})
if(JSON.stringify(second.items.map(row=>row.sessionId).sort())!==JSON.stringify(sessions.map(row=>row.id).sort())||second.items.some(row=>row.running!==false))throw Error('target membership/running drift during collection')
for(const session of sessions){
 const projection=await rpc('session/projections',{request:{sessionId:session.id}}),inbox=projection.values?.inbox
 if(projection.asOfSeq!==session.asOfSeq||!Array.isArray(inbox?.['next-turn'])||!Array.isArray(inbox?.['next-step'])||inbox['next-turn'].length+inbox['next-step'].length!==0)throw Error('target accepted input/cursor changed during collection')
}
const after=info(),current=await identity(after.pid)
if(current.pid!==launcher.pid||current.startTicks!==launcher.startTicks||after.statename!=='RUNNING')throw Error('target PID changed during collection')
const observedAt=new Date().toISOString()
const targetReceipt=await save(root+'/target-observation-command'+suffix+'.private.json',{source:'actual-foreground-read-command',program:plan.program,origin,observedAt,service,launcher,cli,calls,scope:'public non-activating Session list and projections; no admission/flush/consumption claim'})
const registryReceipt=await save(root+'/registry-observation-command'+suffix+'.private.json',{source:'actual-foreground-read-command',program:plan.program,origin,observedAt,sessionIds:sessions.map(row=>row.id),frames,completeWholeSetQueries:frames.length,scope:'formal job/list whole-set first frame for each target Session, including unowned jobs; not model consuming reads'})
const proof={source:'parent-operational-handover',runId:plan.runId,program:plan.program,origin,pid:launcher.pid,startTicks:launcher.startTicks,observedAt,sessions,targetReceipt,jobs:[],registryObservation:{program:plan.program,origin,sessionIds:sessions.map(row=>row.id),noRunning:true,receipt:registryReceipt},scope:'fresh target-only operational observation; no flush/admission lock/product consumption inferred'}
const {validateOperationalHandover,checkHandoverReceipts}=await import('/data/_dsh-builds/v4-141-artifacts-38d4d91/preview-final-154-5a2ecf3-02/tools/one-shot.mjs')
validateOperationalHandover(plan,proof,launcher.pid);await checkHandoverReceipts(plan,proof,true)
const handover=await save(suffix?root+'/operational-handover'+suffix+'.json':plan.settlement,proof)
console.log(JSON.stringify({observedAt,program:plan.program,origin,pid:launcher.pid,startTicks:launcher.startTicks,cli,sessions,jobs:0,completeRegistryQueries:frames.length,targetReceipt,registryReceipt,handover},null,2))
