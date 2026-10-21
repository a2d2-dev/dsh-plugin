import { afterEach, expect, it } from 'vitest'
import { mkdtemp, realpath, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { WorkApplication, type WorkHost } from '../src/work.ts'
import type { WorkCompleted, WorkResult, WorkTask, WorkExecution } from '../src/work-types.ts'
import type { GitHubSourcePort } from '../src/work-sources/types.ts'
const operator={operator:true}
const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0)){if(dirname(root)!==tmpdir()||!basename(root).startsWith('completion-contract-')||await realpath(root)!==root)throw Error('Unsafe cleanup');await rm(root,{recursive:true,force:true})}})
function ok(result:WorkResult):WorkCompleted{if(result.status!=='completed')throw Error(JSON.stringify(result));return result}
async function setup(source?:GitHubSourcePort){
 const root=await mkdtemp(join(tmpdir(),'completion-contract-'));roots.push(root)
 const resource={runtimeId:'runtime',workspaceId:'workspace'}
 let guard:Parameters<NonNullable<WorkHost['execution']>['connect']>[0]
 const calls={ensure:0,wake:0,settle:0,maintain:0}
 let inMaintenance=false
 const choices={models:[{provider:'contract',model:'selected'}],agentPresets:['contract'],permissionPresets:['workspace-write'],defaults:{model:{provider:'contract',model:'selected'},agentPreset:'contract',permissionPreset:'workspace-write'}}
 let settlement:'settled'|'pending'|'unknown'='settled'
 const host:WorkHost={resources:async()=>[{ref:resource,title:'local'}],sessions:async()=>[],execution:{
  connect(fn){guard=fn},choices:async()=>choices,check:async()=>choices,status:()=> 'idle',
  ensure:async()=>{calls.ensure++;return {runtimeId:'runtime',cwd:root,agentPreset:'contract',provider:'contract',model:'selected',permissionPreset:'workspace-write',sandbox:'workspace-write',approval:'never'}},
  wake:async()=>{calls.wake++},settle:async()=>{calls.settle++;if(inMaintenance)throw Error('Nested maintenance would deadlock')},deliver:async()=> 'consumed',observe:async()=> 'consumed',
  maintain:async(_execution,body)=>{calls.maintain++;inMaintenance=true;try{return await body()}finally{inMaintenance=false}},
  observation:async()=>({settlement,blockers:[],limitations:[],sessions:[]}),
 }}
 const app=new WorkApplication(join(root,'work'),host,source)
 const project=ok(await app.execute({type:'project.create',commandId:'project',name:'local',resource},operator)).project!
 const create=async(commandId:string)=>ok(await app.execute({type:'task.create',commandId,projectId:project.id,title:commandId,goal:'finish',specification:'verify result',acceptance:['verified']},operator)).task!
 const start=async(task:WorkTask)=>ok(await app.execute({type:'task.start',commandId:`start:${task.id}`,ref:{projectId:task.projectId,taskId:task.id},expectedVersion:task.version,agentId:task.agentId,resource,agentPreset:'contract',model:{provider:'contract',model:'selected'},permissionPreset:'workspace-write'},operator)).execution!
 const done=async(execution:WorkExecution,closeExternal=false)=>ok(await app.sessionReport(execution.session,`done:${execution.id}`,{specificationVersion:1,stage:'done',summary:'verified',next:'',blockers:[],criteria:[{index:0,passed:true,evidence:['contract passed']}],closeExternal}))
 const detail=async(task:WorkTask)=>ok(await app.query({type:'task.detail',ref:{projectId:task.projectId,taskId:task.id}},operator))
 return {app,host,project,create,start,done,detail,calls,guard:(...args:Parameters<typeof guard>)=>guard(...args),setSettlement:(value:typeof settlement)=>{settlement=value}}
}
it('commits child acceptance and exactly one parent result before any delivery, preserving terminal native input fences',async()=>{
 const h=await setup(),parent=await h.create('parent'),parentExecution=await h.start(parent)
 const current=(await h.detail(parent)).task!
 const child=ok(await h.app.execute({type:'task.create-child',commandId:'child',ref:parentExecution.ref,expectedVersion:current.version,title:'child',goal:'verify',specification:'verify',acceptance:['verified']},operator)).task!
 const childExecution=await h.start(child)
 await h.done(childExecution)
 const recovered=new WorkApplication(h.app.directory,h.host)
 await recovered.sessionReport(childExecution.session,`done:${childExecution.id}`,{specificationVersion:1,stage:'done',summary:'verified',next:'',blockers:[],criteria:[{index:0,passed:true,evidence:['contract passed']}],closeExternal:false})
 const parentState=ok(await recovered.query({type:'task.detail',ref:parentExecution.ref},operator))
 expect(parentState.task!.childCompletions).toHaveLength(1)
 expect(parentState.execution!.events.filter(event=>event.kind==='result')).toHaveLength(1)
 expect(parentState.task!.progress).toBeUndefined()
 expect(await h.guard(childExecution.session.sessionId,[{id:'late-input',role:'user',content:[{type:'text',text:'continue'}],source:'native'}])).toBe(false)
 expect((await h.detail(child)).task!.completion!.operationId).toBe(parentState.task!.childCompletions![0]!.operationId)
 await h.done(parentExecution)
 expect((await h.detail(parent)).task!.completion).toBeDefined()
})
const identity={login:'developer',nodeId:'U_developer',name:null}
const issue={nodeId:'I_contract',url:'https://github.com/example/repo/issues/139',number:139,title:'contract',body:'verify',repository:{owner:'example',repository:'repo'},assignees:['developer'],labels:[],state:'open' as 'open'|'closed',updatedAt:'2026-10-21T00:00:00Z',observedAt:'2026-10-21T00:01:00Z'}
async function externalSetup(mode:'lost'|'error'='lost'){
 let remote=structuredClone(issue),writes=0
 const source:GitHubSourcePort={list:async()=>({identity,items:[remote],observedAt:remote.observedAt}),detail:async()=>({identity,issue:structuredClone(remote)}),close:async()=>{writes++;if(mode==='error')return {status:'error',message:'permission denied'};remote.state='closed';return {status:'unknown',message:'receipt lost'}}}
 const h=await setup(source),task=await h.create('external'),execution=await h.start(task)
 const configured=ok(await h.app.execute({type:'source.configure',commandId:'source',projectId:task.projectId,repository:issue.repository},operator)).source!
 ok(await h.app.query({type:'source.issue',projectId:task.projectId,sourceId:configured.id,number:139,refresh:true},operator))
 const current=(await h.detail(task)).task!
 ok(await h.app.execute({type:'source.link',commandId:'link',ref:execution.ref,expectedVersion:current.version,sourceId:configured.id,nodeId:issue.nodeId},operator))
 const sync=async(commandId:string)=>h.app.execute({type:'task.completion-sync',commandId,ref:execution.ref,executionId:execution.id,owner:execution.owner,epoch:execution.epoch},operator)
 return {...h,task,execution,sync,writes:()=>writes,setRemote:(change:Partial<typeof issue>)=>{remote={...remote,...change}},setMode:(value:typeof mode)=>{mode=value}}
}
it('observes a lost close receipt before recovery and detects remote reopening without changing local acceptance',async()=>{
 const h=await externalSetup();await h.done(h.execution,true)
 expect((await h.detail(h.task)).task!.completion!.external).toMatchObject({status:'pending',nodeId:issue.nodeId})
 await h.sync('sync-one')
 expect((await h.detail(h.task)).task!.completion!.external!.status).toBe('unknown')
 expect(h.writes()).toBe(1)
 const recovered=new WorkApplication(h.app.directory,h.host,h.app.source)
 await recovered.reconcileCompletions()
 expect((await h.detail(h.task)).task!.completion!.external!.status).toBe('closed')
 expect(h.writes()).toBe(1)
 h.setRemote({state:'open',updatedAt:'2026-10-22T00:00:00Z'})
 await h.sync('observe-reopen')
 expect((await h.detail(h.task)).task!.completion!.external).toMatchObject({status:'conflict',error:'remote-reopened'})
 expect((await h.detail(h.task)).progress!.stage).toBe('done')
 expect(h.calls.ensure).toBe(1);expect(h.calls.wake).toBe(0)
})
it('exposes known close errors, retries explicitly, and refuses changed assignees or forged synchronization authority',async()=>{
 const h=await externalSetup('error');await h.done(h.execution,true);await h.sync('first')
 expect((await h.detail(h.task)).task!.completion!.external).toMatchObject({status:'error',error:'permission denied'})
 await h.app.reconcileCompletions();expect(h.writes()).toBe(1)
 await h.sync('first');expect(h.writes()).toBe(1)
 h.setRemote({assignees:['someone-else']});await h.sync('retry-owner-changed')
 expect((await h.detail(h.task)).task!.completion!.external).toMatchObject({status:'conflict',error:'remote-assignees-changed'})
 expect(h.writes()).toBe(1)
 expect(await h.app.execute({type:'task.completion-sync',commandId:'forged',ref:h.execution.ref,executionId:h.execution.id,owner:h.execution.owner,epoch:h.execution.epoch+1},operator)).toMatchObject({status:'failed',error:{code:'stale-execution-authority'}})
})

it('keeps closeout pending for unknown job settlement and settles only inside the host maintenance boundary',async()=>{
 const h=await setup(),task=await h.create('task'),execution=await h.start(task)
 await h.done(execution);h.setSettlement('unknown')
 await h.app.reconcileCompletions()
 expect((await h.detail(task)).task!.completion!.closeout).toMatchObject({status:'pending',error:expect.stringContaining('unknown')})
 expect(h.calls.maintain).toBe(0)
 h.setSettlement('settled');await h.app.reconcileCompletions()
 expect((await h.detail(task)).task!.completion!.closeout.status).toBe('settled')
 expect(h.calls.maintain).toBe(1)
 expect(h.calls.settle).toBe(0)
 expect(h.calls.ensure).toBe(1)
 expect(h.calls.wake).toBe(0)
})

it('serializes concurrent sync attempts while the unknown write receipt and local fact stay queryable',async()=>{
 const h=await externalSetup('error');await h.done(h.execution,true)
 let release!:()=>void,entered!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{entered=resolve})
 const close=h.app.source!.close!
 h.app.source!.close=async(target,id)=>{entered();await gate;return close(target,id)}
 const first=h.sync('concurrent-first')
 try {
  await started
  expect((await h.detail(h.task)).task!.completion!.external!.status).toBe('unknown')
  const other=await h.sync('concurrent-second')
  expect(other.status).toBe('completed')
  expect(h.writes()).toBe(0)
 } finally {release();await first}
 expect(h.writes()).toBe(1)
 expect(h.calls.ensure).toBe(1);expect(h.calls.wake).toBe(0)
})
it('reads legacy accepted reports as terminal without inventing an operation or restarting execution',async()=>{
 const h=await setup(),task=await h.create('legacy'),execution=await h.start(task)
 await h.done(execution)
 // Arrange the previously persisted v3 format; assertions use public commands/queries.
 const file=join(h.app.directory,'work-v3.json'),record=JSON.parse(await readFile(file,'utf8'))
 for(const row of record.tasks)delete row.completion
 for(const receipt of record.commands)if(receipt.result.task)delete receipt.result.task.completion
 await writeFile(file,JSON.stringify(record))
 const recovered=new WorkApplication(h.app.directory,h.host)
 const detail=ok(await recovered.query({type:'task.detail',ref:execution.ref},operator))
 expect(detail.progress!.stage).toBe('done');expect(detail.task!.completion).toBeUndefined()
 expect(await recovered.sessionControl(execution.session,'legacy-resume','resume','more')).toMatchObject({status:'failed',error:{code:'task-completed'}})
 await recovered.reconcileCompletions()
 expect(ok(await recovered.query({type:'task.detail',ref:execution.ref},operator)).task!.completion).toBeUndefined()
 expect(h.calls.ensure).toBe(1);expect(h.calls.wake).toBe(0)
})

it('never replays an older failed retry command after a newer explicit retry',async()=>{
 const h=await externalSetup('error');await h.done(h.execution,true)
 await h.sync('retry-one');await h.sync('retry-two');expect(h.writes()).toBe(2)
 await h.sync('retry-one');expect(h.writes()).toBe(2)
})
