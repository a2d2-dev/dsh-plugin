import { describe, expect, it } from 'vitest'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { createWorkClient } from '../../src/client/work-api.ts'
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
