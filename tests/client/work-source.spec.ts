import { describe, expect, it } from 'vitest'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { createWorkClient, WorkClientError } from '../../src/client/work-api.ts'
import type { WorkRequest } from '../../src/work-types.ts'
import type { GitHubIssue, WorkSource } from '../../src/work-sources/types.ts'

const identity={login:'imneov',nodeId:'U1',name:'LiuFeng'}
const issue:GitHubIssue={nodeId:'I112',url:'https://github.com/a2d2-dev/dsh-plugin/issues/112',number:112,title:'Existing Project 1 work',body:'Full original specification',repository:{owner:'a2d2-dev',repository:'dsh-plugin'},assignees:['imneov'],labels:['ready-for-agent'],state:'open',updatedAt:'2026-10-20T00:00:00Z',observedAt:'2026-10-20T00:01:00Z'}
const source:WorkSource={id:'s1',projectId:'p1',provider:'github',repository:issue.repository,enabled:true,version:1,sequence:1,requests:{},observations:[],pages:[],identity}
function setup() {
  const requests:WorkRequest[]=[]
  const client=createWorkClient(async(_url,init)=>{
    const request=JSON.parse(String(init?.body)) as WorkRequest;requests.push(request)
    const q=request.value
    const data=q.type==='project.detail'?{project:{id:q.projectId},tasks:[]}
      :q.type==='source.list'?{sources:[source]}
      :q.type==='source.issues'?{source,page:{identity,items:[issue],nextPage:3,observedAt:issue.observedAt}}
      :q.type==='source.issue'?{source,issue}
      :{}
    return Response.json({status:'completed',...data})
  })
  return {panel:new WorkPanelController(client,{selectPanel:()=>{},openSession:()=>{}}),requests,client}
}
describe('GitHub source public client behavior',()=>{
  it('retains displayed cached contents when a structured permission refusal omits a page',async()=>{
    const {panel,client}=setup()
    await panel.selectProject('p1');await panel.showSources()
    client.query=async()=>{throw new WorkClientError({status:'failed',error:{code:'github-forbidden',message:'Permission denied'},source})}
    await panel.browseIssues({},true)
    expect(panel.getSnapshot().source).toMatchObject({cached:true,error:'github-forbidden: Permission denied',listing:{items:[{number:112}]}})
  })
  it('retains full Issue content and its local mapping during an offline refresh',async()=>{
    const {panel,client}=setup()
    await panel.selectProject('p1');await panel.showSources();await panel.openIssue(112)
    client.query=async()=>{throw Error('offline')}
    await panel.openIssue(112)
    expect(panel.getSnapshot().source).toMatchObject({cached:true,error:'offline',issue:{number:112,body:'Full original specification'}})
  })
  it('disables the exact source version and retains the observed body without issuing another remote refresh',async()=>{
    const {panel,client}=setup()
    await panel.selectProject('p1');await panel.showSources();await panel.openIssue(112)
    const commands:unknown[]=[]
    client.command=async value=>{commands.push(value);return {status:'completed',source:{...source,enabled:false,version:2}}}
    await panel.setSourceEnabled(false)
    expect(commands).toEqual([{type:'source.set-enabled',projectId:'p1',sourceId:'s1',expectedVersion:1,enabled:false,commandId:expect.any(String)}])
    expect(panel.getSnapshot().source).toMatchObject({sources:[{enabled:false,version:2}],issue:{body:'Full original specification'}})
  })
  it('does not let a late Task detail replace a newly selected Issue source',async()=>{
    const {panel,client}=setup()
    await panel.selectProject('p1')
    const query=client.query.bind(client);let release!:()=>void
    client.query=async value=>{if(value.type==='task.detail'){await new Promise<void>(resolve=>{release=resolve});return {status:'completed',task:{id:'old-task'} as import('../../src/work-types.ts').WorkTask}}return query(value)}
    const pending=panel.openTask({projectId:'p1',taskId:'old-task'})
    await panel.showSources();release();await pending
    expect(panel.getSnapshot()).toMatchObject({object:'issues',detail:null,loading:false})
  })
  it('rejects an old source response after switching away and back to the same project',async()=>{
    const {panel,client}=setup()
    await panel.selectProject('p1');await panel.showSources()
    const query=client.query.bind(client);let release!:()=>void
    client.query=async value=>{if(value.type==='source.issue'){await new Promise<void>(resolve=>{release=resolve});return {status:'completed',source,issue}}return query(value)}
    const pending=panel.openIssue(112)
    await panel.selectProject('p2');await panel.selectProject('p1')
    release();await pending
    expect(panel.getSnapshot()).toMatchObject({projectId:'p1',detail:null,source:{sourceId:null,issue:null,listing:null}})
  })
  it('retains the latest filter page when an older page response arrives later',async()=>{
    const {panel,client}=setup()
    await panel.selectProject('p1');await panel.showSources()
    const query=client.query.bind(client);let release!:()=>void
    client.query=async value=>{if(value.type==='source.issues'&&value.page===2){await new Promise<void>(resolve=>{release=resolve});return {status:'completed',source,page:{identity,items:[{...issue,number:999}],observedAt:issue.observedAt}}}return query(value)}
    const pending=panel.browseIssues({page:2},true)
    await panel.browseIssues({page:1,assignee:'*'},true);release();await pending
    expect(panel.getSnapshot().source).toMatchObject({page:1,assignee:'*',listing:{items:[{number:112}]}})
  })
  it('offers canonical ownership and returns from that other project Task to the originating source location',async()=>{
    const {panel,client}=setup()
    await panel.selectProject('p1');await panel.showSources();await panel.browseIssues({page:2,assignee:'*'},true);await panel.openIssue(112)
    client.command=async()=>{throw new WorkClientError({status:'conflict',error:{code:'external-object-owned',message:'Already accepted'},ref:{projectId:'p2',taskId:'canonical'}})}
    await panel.acceptIssue()
    expect(panel.getSnapshot().source).toMatchObject({canonical:{projectId:'p2',taskId:'canonical'},error:'该 Issue 已关联本地工作，请打开已有工作。'})
    const query=client.query.bind(client)
    client.query=async value=>value.type==='task.detail'?{status:'completed',task:{id:'canonical',projectId:'p2'} as import('../../src/work-types.ts').WorkTask}:query(value)
    await panel.openTask(panel.getSnapshot().source.canonical!)
    expect(panel.getSnapshot()).toMatchObject({projectId:'p2',detail:{task:{id:'canonical'}}})
    panel.back()
    expect(panel.getSnapshot()).toMatchObject({projectId:'p1',object:'issues',detail:null,source:{sourceId:'s1',page:2,assignee:'*',issue:{number:112}}})
  })
  it('keeps the last page visible on a transport failure and distinguishes it from an empty result',async()=>{
    const {panel,client}=setup()
    await panel.selectProject('p1');await panel.showSources()
    client.query=async()=>{throw Error('network offline')}
    await panel.browseIssues({},true)
    expect(panel.getSnapshot().source).toMatchObject({loading:false,cached:true,error:'network offline',listing:{items:[{number:112}],nextPage:3}})
  })
  it('configures the selected project repository explicitly with the existing HTTP-safe command identity',async()=>{
    const {panel,requests,client}=setup()
    await panel.selectProject('p1')
    const command=client.command.bind(client)
    client.command=async value=>{await command(value);return {status:'completed',source}}
    await panel.configureSource('a2d2-dev','dsh-plugin')
    expect(requests.filter(r=>r.kind==='command')).toEqual([{kind:'command',value:{type:'source.configure',projectId:'p1',repository:{owner:'a2d2-dev',repository:'dsh-plugin'},commandId:expect.stringMatching(/^[a-f0-9-]{36}$/)}}])
    expect(panel.getSnapshot().source).toMatchObject({sourceId:'s1',assignee:'@me',listing:{identity:{login:'imneov'}}})
  })
  it('accepts only on an explicit action and opens the returned canonical TaskRef while preserving source position',async()=>{
    const {panel,client}=setup()
    await panel.selectProject('p1');await panel.showSources();await panel.browseIssues({page:2,assignee:'*'},true);await panel.openIssue(112)
    const commands:unknown[]=[]
    client.command=async value=>{commands.push(value);return {status:'completed',ref:{projectId:'p1',taskId:'canonical-uuid'}}}
    const query=client.query.bind(client)
    client.query=async value=>value.type==='task.detail'?{status:'completed',task:{id:value.ref.taskId,projectId:'p1',title:issue.title} as import('../../src/work-types.ts').WorkTask}:query(value)
    await panel.acceptIssue()
    expect(commands).toEqual([{type:'source.import',projectId:'p1',sourceId:'s1',nodeId:'I112',commandId:expect.any(String)}])
    expect(panel.getSnapshot()).toMatchObject({detail:{task:{id:'canonical-uuid'}},detailTab:'overview'})
    panel.back()
    expect(panel.getSnapshot()).toMatchObject({object:'issues',source:{page:2,assignee:'*',issue:{number:112}}})
  })
  it('browses a concrete project source and complete issue without accepting work, retaining source filters and page on return',async()=>{
    const {panel,requests}=setup()
    await panel.selectProject('p1')
    await panel.showSources()
    await panel.browseIssues({assignee:'*',page:2},true)
    await panel.openIssue(112)
    expect(panel.getSnapshot()).toMatchObject({object:'issues',source:{sourceId:'s1',assignee:'*',page:2,issue:{body:'Full original specification'}}})
    panel.backToIssues()
    expect(panel.getSnapshot()).toMatchObject({source:{assignee:'*',page:2,issue:null,listing:{items:[{number:112}],nextPage:3}}})
    expect(requests.filter(r=>r.kind==='command')).toEqual([])
    expect(requests).toContainEqual({kind:'query',value:{type:'source.issues',projectId:'p1',sourceId:'s1',assignee:'*',state:'open',page:2,perPage:20,refresh:true}})
  })
})
