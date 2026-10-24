import { beforeEach, afterEach, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { WorkApplication } from '../src/work.ts'
import { join } from 'node:path'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { installWorkTools } from '../src/work-execution/tools.ts'
import { installWorkProgressTools } from '../src/work-progress-tools.ts'
import { installWorkOrganizationTools } from '../src/work-organization-tools.ts'
import type { TaskReport } from '../src/work-progress.ts'
import type { WorkCompleted, WorkResult } from '../src/work-types.ts'
const operator={operator:true}
let fixtures:ExecutionFixtures
beforeEach(({signal})=>{fixtures=new ExecutionFixtures(signal)})
afterEach(()=>fixtures.close())
function completed(result:WorkResult):WorkCompleted {if(result.status!=='completed')throw Error(JSON.stringify(result));return result}
async function setup(){
  const path=await fixtures.root(), h=await fixtures.mount(path)
  const resource={runtimeId:'runtime',workspaceId:h.workspace.id}
  const project=completed(await h.app.execute({type:'project.create',commandId:'project',name:'镜像管理',resource},operator)).project!
  const task=completed(await h.app.execute({type:'task.create',commandId:'task',projectId:project.id,title:'镜像管理',goal:'发布并清理镜像',specification:'镜像管理的已确认要求',acceptance:['镜像推送验证通过','清理策略验证通过']},operator)).task!
  const ref={projectId:project.id,taskId:task.id}
  installWorkTools(h.ctx,h.app,'runtime');installWorkProgressTools(h.ctx,h.app,'runtime');installWorkOrganizationTools(h.ctx,h.app,'runtime')
  const execution=completed(await h.app.execute({type:'task.start',commandId:'start',ref,expectedVersion:task.version,agentId:project.defaultAgentId,resource,agentPreset:'contract',model:{provider:'contract',model:'selected'},permissionPreset:'workspace-write'},operator)).execution!
  const agent=h.ctx.agents.get(SessionId(execution.session.sessionId))!
  await fixtures.run(()=>agent.whenIdle())
  const report=(callId:string,report:TaskReport)=>fixtures.run(()=>h.ctx.tools.execute({callId:ToolCallId(callId),name:'work_report',arguments:{report},agent,signal:new AbortController().signal}))
  return {...h,project,task,ref,execution,agent,report}
}
it('keeps a remotely closed Issue unstarted until local work is actually handled',async()=>{
  const path=await fixtures.root()
  const identity={login:'developer',nodeId:'U_developer',name:null}
  const issue={nodeId:'I_closed',url:'https://github.com/example/repo/issues/124',number:124,title:'已经关闭的来源',body:'完整原文',repository:{owner:'example',repository:'repo'},assignees:['developer'],labels:[],state:'closed' as const,updatedAt:'2026-10-21T00:00:00Z',observedAt:'2026-10-21T00:01:00Z'}
  const app=new WorkApplication(join(path,'work'),{resources:async()=>[],sessions:async()=>[]},{list:async()=>({identity,items:[issue],observedAt:issue.observedAt}),detail:async()=>({identity,issue})})
  const project=completed(await app.execute({type:'project.create',commandId:'project',name:'来源状态'},operator)).project!
  const source=completed(await app.execute({type:'source.configure',commandId:'source',projectId:project.id,repository:issue.repository},operator)).source!
  completed(await app.query({type:'source.issue',projectId:project.id,sourceId:source.id,number:124,refresh:true},operator))
  const imported=completed(await app.execute({type:'source.import',commandId:'import',projectId:project.id,sourceId:source.id,nodeId:issue.nodeId},operator))
  expect(completed(await app.query({type:'task.detail',ref:imported.ref!},operator))).toMatchObject({progress:{stage:'planned',source:{state:'closed'},criteria:{passed:0,assessed:0}}})
})
it('lets the real coordinator preserve specifications and refuses local child creation',async()=>{
  const h=await setup()
  const invoke=(callId:string,args:Record<string,unknown>,agent=h.agent)=>fixtures.run(()=>h.ctx.tools.execute({callId:ToolCallId(callId),name:'work_organize',arguments:args,agent,signal:new AbortController().signal}))
  const before=completed(await h.app.query({type:'task.detail',ref:h.ref},operator)).task!
  expect(await invoke('specification',{action:'specification',expected_version:before.version,goal:before.goal,specification:'已接受要求：镜像推送、清理策略和签名',acceptance:[...before.specification.acceptance,'镜像签名通过']})).toMatchObject({isError:false})
  const updated=completed(await h.app.query({type:'task.detail',ref:h.ref},operator)).task!
  expect(updated).toMatchObject({id:before.id,specification:{version:2},specificationHistory:[before.specification]})
  const childIntent={kind:'child' as const,expectedVersion:updated.version,title:'镜像签名',goal:'验证签名',specification:'使用已确认的签名机制',acceptance:['签名验证通过']}
  expect(await h.app.sessionOrganize(h.execution.session,'local-child',childIntent)).toMatchObject({status:'failed',error:{code:'local-subtask-not-supported'}})
  const childArgs={action:'child',expected_version:updated.version,title:'镜像签名',goal:'验证签名',specification:'使用已确认的签名机制',acceptance:['签名验证通过']}
  expect(await invoke('child-once',childArgs)).toMatchObject({isError:true})
  const detail=completed(await h.app.query({type:'task.detail',ref:h.ref},operator))
  expect(detail.children).toHaveLength(0)
  expect(detail.task!.children).toEqual([])
  expect(completed(await h.app.query({type:'project.detail',projectId:h.project.id},operator)).progressItems).toHaveLength(1)
  const foreign=await fixtures.run(()=>h.ctx.sessionController.create({workspaceId:h.workspace.id,agentPreset:'contract'}))
  const specArgs={action:'specification',expected_version:detail.task!.version,goal:detail.task!.goal,specification:'越权修改',acceptance:['越权']}
  expect(JSON.stringify(await invoke('foreign',specArgs,h.ctx.agents.get(foreign.sessionId)!))).toContain('forbidden')
  expect(completed(await h.app.query({type:'task.detail',ref:h.ref},operator)).children).toHaveLength(0)
})
const initial:TaskReport={specificationVersion:1,stage:'in-progress',summary:'镜像推送已实现，清理策略待确认',next:'确认清理保留数量',blockers:['需要确定保留数量'],criteria:[{index:0,passed:true,evidence:['测试：push.integration 通过']}],breakdown:[{id:'push',title:'镜像推送',description:'推送并校验',status:'done',evidence:['测试：push.integration 通过']},{id:'cleanup',title:'清理策略',description:'按保留数量清理',status:'blocked',evidence:[]}]}
it('records real coordinator reports and projects requirements, evidence and blockers without model status calls',async()=>{
  const h=await setup()
  expect(await h.report('progress',initial)).toMatchObject({isError:false})
  const before=h.model.requests.length
  const detail=completed(await h.app.query({type:'task.detail',ref:h.ref},operator))
  expect(detail).toMatchObject({progress:{stage:'in-progress',summary:initial.summary,blockers:initial.blockers,criteria:{passed:1,total:2,assessed:1,current:true},breakdown:[{id:'push',status:'done'},{id:'cleanup',status:'blocked'}]}})
  const project=completed(await h.app.query({type:'project.detail',projectId:h.project.id},operator))
  expect(project.progressItems).toEqual([detail.progress])
  expect(h.model.requests).toHaveLength(before)
  expect((await h.app.sessionControl(h.execution.session,'status','status'))).toMatchObject({task:{specification:{version:1,acceptance:['镜像推送验证通过','清理策略验证通过']}}})
})
it('rejects evidence-free completion and local child creation',async()=>{
  const h=await setup()
  const done:TaskReport={specificationVersion:1,stage:'done',summary:'全部完成',next:'',blockers:[],criteria:[{index:0,passed:true,evidence:[]},{index:1,passed:true,evidence:['清理测试通过']}]}
  expect(JSON.stringify(await h.report('no-evidence',done))).toContain('missing-evidence')
  const detail=completed(await h.app.query({type:'task.detail',ref:h.ref},operator))
  expect(await h.app.execute({type:'task.create-child',commandId:'child',ref:h.ref,expectedVersion:detail.task!.version,title:'清理实现',goal:'验证清理',specification:'保留数量为三',acceptance:['清理测试通过']},operator))
    .toMatchObject({status:'failed',error:{code:'local-subtask-not-supported'}})
  done.criteria[0]!.evidence=['推送测试通过']
  expect(await h.report('complete',done)).toMatchObject({isError:false})
  expect(completed(await h.app.query({type:'task.detail',ref:h.ref},operator)).progress?.stage).toBe('done')
  const rows=completed(await h.app.query({type:'project.detail',projectId:h.project.id},operator)).progressItems!
  expect(rows).toHaveLength(1)
})
it('invalidates old criterion results after a specification change and rejects stale model reports',async()=>{
  const h=await setup()
  await h.report('progress',initial)
  const task=completed(await h.app.query({type:'task.detail',ref:h.ref},operator)).task!
  completed(await h.app.execute({type:'task.update-spec',commandId:'new-spec',ref:h.ref,expectedVersion:task.version,goal:task.goal,specification:'新增镜像签名要求',acceptance:['签名通过']},operator))
  expect(JSON.stringify(await h.report('old-report',initial))).toContain('stale-specification')
  expect(completed(await h.app.query({type:'task.detail',ref:h.ref},operator))).toMatchObject({progress:{criteria:{passed:0,total:1,assessed:0,current:false},blockers:['规格已更新，旧验收结果需要重新核验']}})
})
it('persists one completion fact and fences resume for ordinary tasks across application recovery',async()=>{
  const h=await setup()
  const report:TaskReport={specificationVersion:1,stage:'done',summary:'已验收',next:'',blockers:[],criteria:[{index:0,passed:true,evidence:['push passed']},{index:1,passed:true,evidence:['cleanup passed']}]}
  completed(await h.app.sessionReport(h.execution.session,'complete-once',report))
  const recovered=new WorkApplication(h.app.directory,h.app.host)
  const first=completed(await recovered.query({type:'task.detail',ref:h.ref},operator))
  expect(first.task).toMatchObject({completion:{operationId:expect.any(String),specificationVersion:1,executionId:h.execution.id,closeout:{status:'pending'}}})
  completed(await recovered.sessionReport(h.execution.session,'complete-once',report))
  expect(completed(await recovered.query({type:'task.detail',ref:h.ref},operator)).task!.completion).toEqual(first.task!.completion)
  expect(await recovered.sessionControl(h.execution.session,'resume-after-complete','resume','continue')).toMatchObject({status:'failed',error:{code:'task-completed'}})
  expect(await recovered.sessionReport(h.execution.session,'rewrite-complete',{...report,stage:'in-progress'})).toMatchObject({status:'failed',error:{code:'task-completed'}})
})

it('keeps business completion separate from an idle session and stops completed work using an accepted wait intent',async()=>{
  const h=await setup()
  expect(completed(await h.app.query({type:'task.detail',ref:h.ref},operator))).toMatchObject({progress:{stage:'in-progress',execution:{runtime:'idle'}}})
  const report:TaskReport={specificationVersion:1,stage:'done',summary:'两项要求均已验证',next:'',blockers:[],criteria:[{index:0,passed:true,evidence:['推送测试通过']},{index:1,passed:true,evidence:['清理测试通过']}]}
  expect(await h.report('done',report)).toMatchObject({isError:false})
  expect(completed(await h.app.query({type:'task.detail',ref:h.ref},operator))).toMatchObject({progress:{stage:'done',criteria:{passed:2,total:2,current:true}},execution:{control:{action:'wait',status:'accepted'}}})
  const taskVersion=completed(await h.app.query({type:'task.detail',ref:h.ref},operator)).task!.version
  await h.report('done',report)
  expect(completed(await h.app.query({type:'task.detail',ref:h.ref},operator)).task!.version).toBe(taskVersion)
})
