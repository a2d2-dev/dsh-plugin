import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { canonical } from './retention.mjs'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
// All parser inputs are private physical copies; no write handle, Agent or server.
export async function verifyNativeSnapshot(hostRoot,physicalFiles,root){
  await mkdir(root,{mode:0o700})
  const data=join(root,'sessions');await mkdir(data,{mode:0o700})
  const inputs=[]
  for(const file of physicalFiles){
    const bytes=await readFile(file.path),decoded=spawnSync('zstd',['-dc'],{input:bytes,maxBuffer:256*1024*1024})
    if(decoded.status!==0)throw Error('native snapshot input has incomplete physical frame')
    const rows=decoded.stdout.toString().trimEnd().split('\n').map(line=>JSON.parse(line)),header=rows.shift()
    if(file.sha256&&hash(bytes)!==file.sha256)throw Error('captured physical bytes changed')
    if(typeof file.relativePath!=='string')throw Error('observed native relative path required')
    const target=resolve(data,file.relativePath)
    if(!target.startsWith(data+'/')||!target.endsWith('/session.v4.jsonl.zstd'))throw Error('invalid captured physical path')
    await mkdir(dirname(target),{recursive:true,mode:0o700})
    await writeFile(target,bytes,{flag:'wx',mode:0o600})
    inputs.push({header,events:rows,sha256:hash(bytes)})
  }
  // Keep the observed storage layout; the public read backend owns path/format validation.
  const req=createRequire(join(hostRoot,'packages/bundle/base/package.json'))
  const {Context}=await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href)
  const {default:Persistence}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href)
  const ctx=new Context(),reader=new Persistence(ctx,{root:data}),results=[]
  try{
    for(const input of inputs){
      const handle=await reader.open(input.header.id,'read')
      try{
        const value=await handle.read()
        if(handle.header.id!==input.header.id||handle.header.cwd!==input.header.cwd||handle.header.agentPreset!==input.header.agentPreset||canonical(value.events)!==canonical(input.events))throw Error('native reader changed/repaired/dropped current-format data')
        results.push({sessionId:handle.header.id,eventCount:value.events.length,physicalSha256:input.sha256,readOnly:true})
      }finally{await handle.close()}
    }
  }finally{await ctx.fiber.dispose()}
  const proof={passed:true,hostRoot,source:'real-compiled-SessionPersistence.open(read)',sessions:results,scope:'exact V4 physical rows retained by real readonly backend; no migration write, model, Task or server',capturedAt:new Date().toISOString()}
  await writeFile(join(root,'native-snapshot-proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600})
  return proof
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const[host,source,third,fourth]=process.argv.slice(2)
    let physical,output
    if(source==='--physical'){
      physical=JSON.parse(await readFile(third)).files;output=fourth
    }else{
      const baselineRoot=source;output=third
      const baseline=JSON.parse(await readFile(join(baselineRoot,'baseline.json')))
      physical=baseline.fingerprints.filter(file=>file.path.endsWith('.jsonl.zstd')).map(file=>({path:join(baselineRoot,'raw',hash(file.path)),relativePath:file.path.split('/sessions/').slice(1).join('/sessions/'),sha256:file.sha256}))
    }
    const proof=await verifyNativeSnapshot(host,physical,output)
    console.log(JSON.stringify({passed:true,hostRoot:host,sessions:proof.sessions.length,readOnly:true}))
  }catch(error){console.error(error.message);process.exitCode=1}
}
