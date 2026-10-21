import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonical } from './retention.mjs'

// Read-only public WorkApplication queries on a private physical copy.
// The public optional execution capability is absent; forbidden resource/session
// operations throw instead of returning fabricated host observations.
export async function verifyDomainSnapshot(hostRoot,profileDir,input,root){
  await mkdir(root,{mode:0o700})
  const data=join(root,'data');await mkdir(data,{mode:0o700})
  const bytes=await readFile(input),raw=JSON.parse(bytes),file=join(data,'work-v3.json')
  await writeFile(file,bytes,{flag:'wx',mode:0o600})
  const anchor=join(hostRoot,'apps/cli/package.json'),req=createRequire(anchor)
  const appBoot=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-app-boot')).href)
  const{Context}=await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href)
  const{default:Loader}=await import(pathToFileURL(req.resolve('@deepseek-ai/cordis-plugin-loader')).href)
  const profile=appBoot.loadProfileDirectory('v4-domain-read',profileDir,anchor)
  if(profile.skippedBundles.length)throw Error('snapshot profile has unresolved bundle')
  const resolution=await appBoot.createRuntimeResolution({installAnchor:anchor,profile}),ctx=new Context()
  let hostCalls=0
  try{
    await ctx.plugin(appBoot.PluginPackages,{resolution})
    const loader=new Loader(ctx,{baseUrl:pathToFileURL(profileDir+'/').href})
    const{WorkApplication}=await loader.import('dsh-a2d2/work')
    const forbid=()=>{hostCalls++;throw Error('offline schema reader cannot invoke live host operations')}
    const app=new WorkApplication(data,{resources:forbid,sessions:forbid})
    const actor={operator:true},projects=await app.query({type:'projects.list'},actor)
    if(projects.status!=='completed'||canonical(projects.projects)!==canonical(raw.projects))throw Error('real WorkApplication changed/rejected Project identity/config')
    for(const project of raw.projects){
      const result=await app.query({type:'project.detail',projectId:project.id},actor)
      if(result.status!=='completed'||canonical(result.tasks)!==canonical(raw.tasks.filter(task=>task.projectId===project.id))||canonical(result.agents)!==canonical(raw.agents.filter(agent=>agent.projectId===project.id)))throw Error('real WorkApplication changed/rejected Task/Agent materials')
      const sources=await app.query({type:'source.list',projectId:project.id},actor)
      if(sources.status!=='completed'||canonical(sources.sources)!==canonical(raw.sources.filter(source=>source.projectId===project.id)))throw Error('real WorkApplication changed/rejected source records')
    }
    for(const execution of raw.executions){
      const result=await app.query({type:'task.execution',ref:execution.ref},actor)
      if(result.status!=='completed'||canonical(result.execution)!==canonical(execution))throw Error('real WorkApplication changed/rejected current/history Execution')
    }
    if(hostCalls!==0||!bytes.equals(await readFile(file)))throw Error('read-only domain proof attempted an operation or changed copied data')
  }finally{await ctx.fiber.dispose()}
  const proof={passed:true,hostRoot,profileDir,source:'real-public-WorkApplication-query',sha256:createHash('sha256').update(bytes).digest('hex'),projects:raw.projects.length,tasks:raw.tasks.length,agents:raw.agents.length,sources:raw.sources.length,executions:raw.executions.length,liveHostOperations:hostCalls,scope:'schema/material compatibility only; no execution/queue/model capability',capturedAt:new Date().toISOString()}
  await writeFile(join(root,'domain-proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600})
  return proof
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await verifyDomainSnapshot(...process.argv.slice(2)),null,2))}catch(error){console.error(error.message);process.exitCode=1}}
