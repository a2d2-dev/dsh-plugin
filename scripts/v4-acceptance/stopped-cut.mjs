import { readFile, readdir, readlink, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { digest, domainMaterialCut } from './live-cut.mjs'
import { targets } from './profile-actions.mjs'
import { permitsSystemGenesis } from './data-genesis.mjs'

export function validateJournal(text,accepted){
  if(!text.endsWith('\n'))throw Error('torn journal row')
  const rows=text.trimEnd().split('\n').map(line=>JSON.parse(line)),header=rows.shift()
  if(header.type!=='session'||header.id!==accepted.id||header.cwd!==accepted.cwd)throw Error('Session identity/config drift')
  if(rows.some((row,index)=>row.seq!==index))throw Error('noncontiguous journal')
  if(rows.length<accepted.eventHashes.length||accepted.eventHashes.some((value,index)=>digest(rows[index])!==value))throw Error('accepted event prefix missing/changed')
  return {ok:true,id:header.id,events:rows.length,acceptedThrough:accepted.throughSeq,sha256:digest(rows)}
}
export function assessStop({exit,staticCut,parentReviewedStaticCut,officialReceipt}){
  if(!staticCut?.ok)throw Error('post-stop durability/integrity not proven')
  if(exit?.forced===true||exit?.signal||exit?.code!==0||exit?.stopElapsedMs>=5000||exit?.wrapperSignals>1)throw Error('forced/error exit: refuse new switch; preserve evidence for runnable rollback')
  if(officialReceipt)throw Error('formal shutdown receipt producer is not available in the verified host contract; do not manufacture one')
  if(parentReviewedStaticCut!==true)throw Error('parent-reviewed operational static-cut mode required; exit0 is not a flush ack')
  return {barrier:'accepted-prefix-and-static-integrity',gracefulAcknowledged:false,scope:'operational data retention barrier; no claim of product consumed or a formal graceful receipt'}
}
async function journals(root){
  const rows=[]
  for(const entry of await readdir(root,{withFileTypes:true})){
    const path=join(root,entry.name)
    if(entry.isDirectory())rows.push(...await journals(path))
    else if(entry.isFile()&&entry.name.endsWith('.jsonl.zstd'))rows.push(path)
    else if(entry.isSymbolicLink())throw Error('unexpected data symlink')
  }
  return rows.sort()
}
async function writableDescriptors(roots){
  const writers=[]
  for(const pid of (await readdir('/proc')).filter(name=>/^\d+$/.test(name))){
    let descriptors
    try{descriptors=await readdir(`/proc/${pid}/fd`)}catch(error){if(['ENOENT','ESRCH'].includes(error.code))continue;throw error}
    for(const fd of descriptors){
      try{
        const path=(await readlink(`/proc/${pid}/fd/${fd}`)).replace(/ \(deleted\)$/,'')
        if(!roots.some(root=>path===root||path.startsWith(root+'/')))continue
        const info=await readFile(`/proc/${pid}/fdinfo/${fd}`,'utf8')
        const flags=parseInt(info.match(/^flags:\s+(\d+)$/m)?.[1]??'',8)
        if(!Number.isInteger(flags)||(flags&3)!==0)writers.push({pid:Number(pid),fd:Number(fd),path})
      }catch(error){if(!['ENOENT','ESRCH','EINVAL'].includes(error.code))throw error}
    }
  }
  return writers
}
export async function verifyStopped(plan,exit){
  const target=targets[plan.program]
  if(!target||plan.origin!==target.origin)throw Error('exact target required')
  const status=spawnSync('supervisorctl',['status',plan.program],{encoding:'utf8'})
  if(![0,3].includes(status.status)||!status.stdout.startsWith(plan.program+' ')||!/\b(STOPPED|EXITED|FATAL)\b/.test(status.stdout))throw Error('target is not stopped')
  const cut=JSON.parse(await readFile(plan.liveCutPath))
  if(cut.source!=='public-session-cut'||cut.program!==plan.program||cut.origin!==plan.origin)throw Error('wrong accepted cut')
  for(const process of cut.processes??[{pid:cut.supervisorPid}]){
    try{const stat=await readFile(`/proc/${process.pid}/stat`,'utf8');if(!process.startTicks||stat.split(' ')[21]===process.startTicks)throw Error('observed service process still exists')}catch(error){if(error.code!=='ENOENT'&&error.code!=='ESRCH')throw error}
  }
  const home=plan.program==='dsh-dev-web-server'?'/data/_dsh-dev':'/data/_dsh-dev/previews/a2d2-v3-121/home'
  const writers=await writableDescriptors([join(home,'sessions'),join(home,'storages'),join(home,'a2d2')])
  if(writers.length)throw Error('writable data descriptors remain; do not kill them as leaks')
  const paths=await journals(join(home,'sessions')),observed=[],before=[]
  const rawRoot=join(plan.evidenceRoot,'stopped-raw')
  await mkdir(rawRoot,{mode:0o700})
  const bytesHash=bytes=>createHash('sha256').update(bytes).digest('hex')
  const expected=new Map(cut.sessions.map(row=>[row.id,row]))
  for(const path of paths){
    const bytes=await readFile(path);before.push([path,bytesHash(bytes)])
    await writeFile(join(rawRoot,bytesHash(path)),bytes,{flag:'wx',mode:0o600})
  }
  for(const path of paths){
    const bytes=await readFile(join(rawRoot,bytesHash(path)))
    const decoded=spawnSync('zstd',['-dc'],{input:bytes,maxBuffer:256*1024*1024})
    if(decoded.status!==0)throw Error('incomplete physical zstd frame; no repair/fallback')
    const text=decoded.stdout.toString(),id=JSON.parse(text.split('\n',1)[0]).id,accepted=expected.get(id)
    if(!accepted)throw Error('unexpected unregistered Session after accepted cut')
    observed.push(validateJournal(text,accepted));expected.delete(id)
  }
  if(expected.size)throw Error('accepted Sessions missing after stop')
  for(const [path,sha256]of before)if(bytesHash(await readFile(path))!==sha256)throw Error('data changed during stopped snapshot')
  if(JSON.stringify(paths)!==JSON.stringify(await journals(join(home,'sessions'))))throw Error('Session membership changed during static check')
  if(!Array.isArray(cut.jsonCut))throw Error('domain/runtime/workspace material cut missing')
  for(const file of cut.jsonCut){
    if(![join(home,'storages/workspace.json'),join(home,'a2d2/work-v3/runtime-v1.json'),join(home,'a2d2/work-v3/work-v3.json')].includes(file.path))throw Error('unexpected data cut path')
    let bytes
    try{bytes=await readFile(file.path)}catch(error){if(error.code==='ENOENT'&&file.exists===false)continue;throw error}
    await writeFile(join(rawRoot,bytesHash(file.path)),bytes,{flag:'wx',mode:0o600})
    const value=JSON.parse(bytes)
    if(file.exists!==true){
      if(!permitsSystemGenesis(file.path,file.exists,value,plan.allowedSystemGenesis))throw Error('unapproved persistent data birth after cut')
    }else if(digest(file.path.endsWith('/work-v3.json')?domainMaterialCut(value):value)!==file.materialSha256)throw Error('accepted JSON/config/material changed')
  }
  const nativeRoot=join(plan.evidenceRoot,'native-readers');await mkdir(nativeRoot,{mode:0o700})
  const manifest=join(nativeRoot,'physical-input.private.json')
  await writeFile(manifest,JSON.stringify({files:before.map(([path,sha256])=>({path:join(rawRoot,bytesHash(path)),relativePath:path.slice(join(home,'sessions').length+1),sha256}))},null,2)+'\n',{flag:'wx',mode:0o600})
  const nativeReaders=[]
  for(const [side,hostRoot]of [['new',plan.release.hostRoot],['rollback',plan.release.rollbackHostRoot]]){
    const output=join(nativeRoot,side)
    const parsed=spawnSync(process.execPath,[new URL('./native-snapshot.mjs',import.meta.url).pathname,hostRoot,'--physical',manifest,output],{encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024})
    await writeFile(join(nativeRoot,`${side}.private.log`),JSON.stringify({status:parsed.status,stdout:parsed.stdout,stderr:parsed.stderr}),{flag:'wx',mode:0o600})
    if(parsed.status!==0)throw Error('real new/rollback readonly parser rejected or changed stopped data; inspect private native reader evidence')
    const path=join(output,'native-snapshot-proof.json'),bytes=await readFile(path),proof=JSON.parse(bytes)
    if(proof.passed!==true||proof.sessions.length!==cut.sessions.length)throw Error('native snapshot proof incomplete')
    nativeReaders.push({side,hostRoot,path,sha256:bytesHash(bytes),passed:true})
  }
  const staticCut={ok:true,source:'actual-stopped-files',sessions:observed,nativeReaders,writableDescriptors:0,capturedAt:new Date().toISOString()}
  let outcome
  try{outcome=assessStop({exit,staticCut,parentReviewedStaticCut:plan.stopPolicy?.parentReviewedStaticCut,officialReceipt:plan.stopPolicy?.officialReceipt})}
  catch(error){
    error.staticCut=staticCut
    await writeFile(join(plan.evidenceRoot,'stopped-cut.json'),JSON.stringify({...staticCut,exit,refused:true,error:error.message},null,2)+'\n',{flag:'wx',mode:0o600})
    throw error
  }
  const result={...staticCut,...outcome,exit,program:plan.program,origin:plan.origin}
  await writeFile(join(plan.evidenceRoot,'stopped-cut.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600})
  return result
}
