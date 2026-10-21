import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { canonical } from './retention.mjs'
import { targets } from './profile-actions.mjs'

export const digest = value => createHash('sha256').update(canonical(value)).digest('hex')
export function domainMaterialCut(value){
  const result=structuredClone(value)
  if(Array.isArray(result.sources))result.sources=result.sources.map(({sequence,requests,observations,pages,lastError,projectSnapshot,discovery,...configuration})=>configuration)
  if(Array.isArray(result.externalBindings))result.externalBindings=result.externalBindings.map(({lastObserved,...accepted})=>accepted)
  return result
}
export async function connectReadOnly(origin) {
  if (!Object.values(targets).some(target => target.origin === origin)) throw Error('unapproved origin')
  const password = (await readFile('/data/_dsh-dev/web-password','utf8')).trim()
  const login = await fetch(`${origin}/?token=${encodeURIComponent(password)}`, { redirect:'manual', signal:AbortSignal.timeout(10000) })
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  if (login.status!==303 || !cookie) throw Error('private authentication failed')
  return async (method, args) => {
    if (!['session/list','session/projections','session/page'].includes(method)) throw Error('only non-activating public read methods allowed')
    const response=await fetch(`${origin}/api/${method}`,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}}),signal:AbortSignal.timeout(30000)})
    if (!response.ok) throw Error(`public read HTTP ${response.status}`)
    const value=await response.json()
    if (value.result?.ok!==true) throw Error(`public read failed: ${method}; code=${value.result?.error?.code}`)
    return value.result.value
  }
}
export function validateTargetCut(plan,proof,cut){
  if(cut.source!=='public-session-cut'||cut.program!==plan.program||cut.origin!==plan.origin||cut.supervisorPid!==proof.pid)throw Error('target PID/origin changed during accepted cut')
  if(plan.program==='dsh-a2d2-v3-preview'){
    if(cut.processes?.find(row=>row.pid===proof.pid)?.startTicks!==proof.startTicks)throw Error('preview target process generation changed')
    if(!Array.isArray(cut.sessions)||JSON.stringify(cut.sessions.map(row=>row.id).sort())!==JSON.stringify(proof.sessions.map(row=>row.id).sort()))throw Error('preview target Session membership changed')
    if(cut.sessions.some(row=>row.running!==false))throw Error('preview target Session still running or unknown; no cleanup performed')
  }else if(cut.sessions.some(row=>row.running===true&&row.id!==plan.coordinatorSessionId))throw Error('non-coordinator Session still running; no cleanup performed')
}
export async function liveCut(program, root) {
  const target=targets[program]
  if (!target || !root.startsWith('/tmp/a2d2-v4-')) throw Error('exact target and private root required')
  await mkdir(root,{mode:0o700})
  const rpc=await connectReadOnly(target.origin)
  const {items}=await rpc('session/list',{_request:{}})
  const sessions=[]
  for (const row of items) {
    const projection=await rpc('session/projections',{request:{sessionId:row.sessionId}})
    if (!projection || !Number.isInteger(projection.asOfSeq)) throw Error('missing accepted live Session cursor')
    const throughSeq=projection.asOfSeq
    let beforeSeq, events=[]
    while (true) {
      const request={address:{kind:'session',sessionId:row.sessionId},throughSeq,maxMessages:100,...beforeSeq===undefined?{}:{beforeSeq}}
      const page=await rpc('session/page',{request})
      const batch=page.records.map(record=>record.event)
      if (batch.some(event=>!Number.isInteger(event.seq))) throw Error('invalid public history page')
      events=[...batch,...events]
      if (!page.hasMore) break
      const next=batch[0]?.seq
      if (!Number.isInteger(next)||next===beforeSeq) throw Error('history pagination did not progress')
      beforeSeq=next
    }
    if (events.length!==throughSeq+1 || events.some((event,index)=>event.seq!==index)) throw Error('accepted Session prefix incomplete')
    await writeFile(join(root,`${row.sessionId}.events.private.json`),JSON.stringify(events)+'\n',{flag:'wx',mode:0o600})
    const config=Object.fromEntries(Object.entries(projection.values??{}).filter(([key])=>['agentPreset','permissions','modelSelection'].includes(key)))
    sessions.push({id:row.sessionId,cwd:row.cwd,running:row.running,throughSeq,eventHashes:events.map(digest),config,projectionSha256:digest(projection)})
  }
  const status=spawnSync('supervisorctl',['status',program],{encoding:'utf8'})
  const supervisorPid=Number(status.stdout?.match(/RUNNING\s+pid (\d+)/)?.[1])
  if(status.status!==0||!supervisorPid)throw Error('target not RUNNING')
  const processes=[]
  const visit=async pid=>{
    const stat=await readFile(`/proc/${pid}/stat`,'utf8')
    processes.push({pid,startTicks:stat.split(' ')[21]})
    const children=(await readFile(`/proc/${pid}/task/${pid}/children`,'utf8')).trim().split(/\s+/).filter(Boolean)
    for(const child of children)await visit(Number(child))
  }
  await visit(supervisorPid)
  const home=program==='dsh-dev-web-server'?'/data/_dsh-dev':'/data/_dsh-dev/previews/a2d2-v3-121/home'
  const jsonCut=[]
  for(const relative of ['storages/workspace.json','a2d2/work-v3/runtime-v1.json','a2d2/work-v3/work-v3.json']){
    const path=join(home,relative)
    try{
      const bytes=await readFile(path),value=JSON.parse(bytes)
      await writeFile(join(root,`${digest(path)}.json.private`),bytes,{flag:'wx',mode:0o600})
      jsonCut.push({path,exists:true,materialSha256:digest(relative.endsWith('work-v3.json')?domainMaterialCut(value):value)})
    }catch(error){if(error.code!=='ENOENT')throw error;jsonCut.push({path,exists:false})}
  }
  const value={source:'public-session-cut',program,origin:target.origin,supervisorPid,processes,sessions,jsonCut,capturedAt:new Date().toISOString(),scope:'exact accepted public event prefix; not a flush acknowledgment or admission lock'}
  await writeFile(join(root,'live-cut.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600})
  return value
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
  liveCut(...process.argv.slice(2)).then(value=>console.log(JSON.stringify({origin:value.origin,sessions:value.sessions.length,source:value.source}))).catch(error=>{console.error(error.message);process.exitCode=1})
}
