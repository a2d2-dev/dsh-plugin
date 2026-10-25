import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import type { WorkClient } from '../../src/client/work-api.ts'
import type { WorkCompleted, WorkTask } from '../../src/work-types.ts'
import type { GitHubIssue } from '../../src/work-sources/types.ts'
import type { TaskProgressView } from '../../src/work-progress.ts'

const identity={login:'developer',nodeId:'U1',name:null}
const project={id:'p1',name:'Roadmap',version:1,defaultAgentId:'a1',resources:[]}
const source={title:'Roadmap',id:'s1',projectId:'p1',provider:'github' as const,githubProject:{owner:'acme',type:'org' as const,number:7},enabled:true,version:1,sequence:1,requests:{},observations:[],pages:[],identity}
const issue=(number:number):GitHubIssue=>({nodeId:`I${number}`,number,title:`Requirement ${number}`,body:`Original requirement ${number}`,url:`https://github.com/acme/repo/issues/${number}`,repository:{owner:'acme',repository:'repo'},state:'open',assignees:['developer'],labels:['ready-for-agent'],updatedAt:'2026-10-20',observedAt:'2026-10-21'})
const task=(id:string,title:string):WorkTask=>({id,projectId:'p1',title,goal:title,version:1,agentId:'a1',specification:{version:1,text:title,acceptance:['Evidence exists']},specificationHistory:[],breakdown:[],children:[],sessions:[],activity:[]})
const root={...task('t1','Root requirement'),children:[{projectId:'p1',taskId:'t2'}],breakdown:[{id:'b1',title:'Deliver the capability',description:'Root requirement block',status:'in-progress' as const,evidence:['Design accepted'],child:{projectId:'p1',taskId:'t2'}}]}
const child={...task('t2','Implementation requirement'),parent:{projectId:'p1',taskId:'t1'},children:[{projectId:'p1',taskId:'t3'}]}
const grandchild={...task('t3','Deep verification'),parent:{projectId:'p1',taskId:'t2'},progress:{specificationVersion:1,stage:'blocked' as const,summary:'Validation pending',next:'Run integration check',blockers:['Waiting for test environment'],criteria:[{index:0,passed:false,evidence:['Failure log retained']}],updatedAt:'2026-10-21'}}
const progress=(value:WorkTask,state:NonNullable<TaskProgressView['processingState']>,number?:number):TaskProgressView=>({ref:{projectId:value.projectId,taskId:value.id},title:value.title,children:value.children,processingState:state,stage:state==='completed'?'done':'in-progress',summary:value.progress?.summary??value.title,next:value.progress?.next??'',blockers:value.progress?.blockers??[],criteria:{passed:0,total:1,assessed:0,current:false},breakdown:value.breakdown,...(number?{source:{nodeId:`I${number}`,number,url:issue(number).url,state:'open' as const,observedAt:'2026-10-21'}}:{})})
const binding=(value:WorkTask,number:number)=>({provider:'github' as const,nodeId:`I${number}`,urls:[issue(number).url],sourceIds:['s1'],ref:{projectId:'p1',taskId:value.id},accepted:issue(number),lastObserved:issue(number)})
function fixture() {
  const tasks=[root,child,grandchild]
  let items=[issue(1),issue(2),issue(3),issue(4),issue(5),issue(6),issue(7)]
  const progressItems=[progress(root,'processing',1),progress(child,'waiting',2),progress(grandchild,'blocked'),progress(task('t4','Paused'),'paused',4),progress(task('t5','Done'),'completed',5),progress(task('t6','Blocked'),'blocked',6)]
  const command=vi.fn(async():Promise<WorkCompleted>=>({status:'completed',project,source}))
  const query=vi.fn(async(q:Parameters<WorkClient['query']>[0]):Promise<WorkCompleted>=>{
    if(q.type==='projects.list')return {status:'completed',projects:[{...project,id:'old',name:'Archived internal records'},project]}
    if(q.type==='project.detail')return {status:'completed',project:{...project,id:q.projectId},tasks:q.projectId==='p1'?tasks:[],progressItems:q.projectId==='p1'?progressItems:[]}
    if(q.type==='source.list')return {status:'completed',sources:q.projectId==='p1'?[source]:[]}
    if(q.type==='source.issues')return {status:'completed',source,page:{identity,items,nextPage:3,observedAt:'2026-10-21'}}
    if(q.type==='source.issue'){const value=q.number===1?root:q.number===2?child:undefined;return {status:'completed',source,issue:issue(q.number),bindings:value?[binding(value,q.number)]:[]}}
    if(q.type==='task.detail'){const value=tasks.find(value=>value.id===q.ref.taskId)!;return {status:'completed',task:value,project,progress:progressItems.find(item=>item.ref.taskId===value.id),children:tasks.filter(item=>item.parent?.taskId===value.id),parent:tasks.find(item=>item.id===value.parent?.taskId),bindings:value.id==='t3'?[]:[binding(value,value.id==='t1'?1:2)]}}
    return {status:'completed'}
  })
  const navigation={selectPanel:vi.fn(),openSession:vi.fn()}
  return {panel:new WorkPanelController({query,command},navigation),query,command,navigation,setItems:(value:GitHubIssue[])=>{items=value}}
}
const html=(panel:WorkPanelController)=>renderToStaticMarkup(createElement(WorkPanel,{controller:panel}))
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return {promise,resolve}}

describe('GitHub-first navigation and evidence',()=>{
  it('selects a GitHub Project by default and excludes internal records and local entrances from the surface',async()=>{
    const h=fixture();await h.panel.load()
    expect(h.panel.connectedProjects().map(item=>item.id)).toEqual(['p1'])
    expect(h.panel.getSnapshot()).toMatchObject({projectId:'p1',object:'issues',detail:null})
    expect(html(h.panel)).toContain('来源概览')
    expect(h.panel.getSnapshot().projects.find(item=>item.id==='p1')?.name).toBe('Roadmap')
    await h.panel.selectSourceTab('issues')
    const rendered=html(h.panel)
    for(const text of ['Roadmap','Requirement 1','搜索来源 Issues','来源操作'])expect(rendered).toContain(text)
    for(const text of ['Archived internal records','创建本地项目','接入已有资源','添加工作','关联已有本地工作','PR 来源','全部本地工作'])expect(rendered).not.toContain(text)
    expect(h.command).not.toHaveBeenCalled()
    expect(h.query.mock.calls.some(([q])=>q.type==='task.execution-options'||q.type==='source.execution-options')).toBe(false)
  })
  it('shows only GitHub onboarding when all existing records have no GitHub Project',async()=>{
    const h=fixture(),query=h.query.getMockImplementation()!
    h.query.mockImplementation(q=>q.type==='source.list'?Promise.resolve({status:'completed',sources:[]}):query(q))
    await h.panel.load()
    expect(h.panel.getSnapshot().projectId).toBeNull()
    expect(html(h.panel)).toContain('添加仓库')
    expect(html(h.panel)).toContain('选择仓库')
    expect(html(h.panel)).toContain('通过链接')
    expect(h.command).not.toHaveBeenCalled()
    expect(html(h.panel)).not.toContain('Archived internal records')
    expect(html(h.panel)).not.toContain('GitHub Issue 列表')
  })
  it('uses processing facts for page-scoped filters and keeps search together with status',async()=>{
    const h=fixture();await h.panel.load()
    for(const [filter,expected] of [['not-started',[3,7]],['processing',[1]],['waiting',[2,4]],['blocked',[6]],['completed',[5]]] as const){
      h.panel.setIssueFilter(filter);expect(h.panel.visibleIssues().map(item=>item.number)).toEqual(expected)
    }
    h.panel.setIssueFilter('waiting');h.panel.setSearch('#4')
    expect(h.panel.visibleIssues().map(item=>item.number)).toEqual([4])
    h.panel.setSearch('Original requirement 2');expect(h.panel.visibleIssues().map(item=>item.number)).toEqual([2])
    expect(h.query.mock.calls.filter(([q])=>q.type==='source.issues')).toHaveLength(1)
    expect(h.command).not.toHaveBeenCalled()
  })
  it('loads existing progress on Issue view without import or execution option queries and shows descendants with evidence',async()=>{
    const h=fixture();await h.panel.load();await h.panel.openIssue(1,false,'I1')
    expect(h.panel.getSnapshot().detail?.task?.id).toBe('t1')
    const rendered=html(h.panel)
    for(const text of ['#1 Requirement 1','Original requirement 1','Deliver the capability','Design accepted','子 Issue #2','Deep verification','Run integration check','Waiting for test environment','Failure log retained'])expect(rendered).toContain(text)
    expect(rendered).not.toContain('子 Issue #3')
    expect(rendered).not.toMatch(/\d+%/)
    expect(h.command).not.toHaveBeenCalled()
    expect(h.navigation.openSession).not.toHaveBeenCalled()
    expect(h.query.mock.calls.some(([q])=>q.type==='task.execution-options'||q.type==='source.execution-options')).toBe(false)
  })
  it('refreshes nested requirement state and evidence while the original Issue stays open',async()=>{
    const h=fixture();await h.panel.load();await h.panel.openIssue(1,false,'I1');h.panel.setDetailTab('related')
    expect(html(h.panel)).toContain('Waiting for test environment')
    const verified:WorkTask={...grandchild,version:2,progress:{...grandchild.progress,stage:'done',summary:'Nested verification complete',next:'',blockers:[],criteria:[{index:0,passed:true,evidence:['Stable image retained in integration check']}]}}
    const query=h.query.getMockImplementation()!
    h.query.mockImplementation(q=>q.type==='project.detail'?Promise.resolve({status:'completed',project,tasks:[root,child,verified],progressItems:[progress(root,'processing',1),progress(child,'waiting',2),progress(verified,'completed')]}):query(q))
    await h.panel.observeCurrent()
    expect(h.panel.getSnapshot()).toMatchObject({detail:{task:{id:'t1'}},detailTab:'related',source:{issue:{nodeId:'I1'}}})
    const rendered=html(h.panel)
    expect(rendered).toContain('Nested verification complete')
    expect(rendered).toContain('Stable image retained in integration check')
    expect(rendered).not.toContain('Waiting for test environment')
    expect(h.command).not.toHaveBeenCalled()
    expect(h.navigation.openSession).not.toHaveBeenCalled()
  })
  it('returns from child detail to root requirements then to the exact scoped Issue list',async()=>{
    const h=fixture();await h.panel.load();await h.panel.browseIssues({page:2,assignee:'*'},false)
    h.panel.setIssueFilter('processing');h.panel.setSearch('Requirement')
    await h.panel.openIssue(1,false,'I1');h.panel.setDetailTab('related')
    await h.panel.openTask({projectId:'p1',taskId:'t2'})
    expect(html(h.panel)).toContain('#2 Requirement 2')
    expect(html(h.panel)).not.toContain('#1 Requirement 1')
    expect(h.panel.canReturnToRequirement()).toBe(true)
    h.panel.back()
    expect(h.panel.getSnapshot()).toMatchObject({detail:{task:{id:'t1'}},detailTab:'related',source:{issue:{nodeId:'I1'}}})
    h.panel.back()
    expect(h.panel.getSnapshot()).toMatchObject({detail:null,source:{issue:null,page:2,assignee:'*'},issueFilter:'processing',search:'Requirement'})
    expect(h.command).not.toHaveBeenCalled()
  })
  it('reveals current Session work in the same Issue detail and returns to its Project list',async()=>{
    const h=fixture();await h.panel.revealTask({projectId:'p1',taskId:'t2'})
    expect(html(h.panel)).toContain('#2 Requirement 2')
    expect(h.panel.connectedProjects().map(item=>item.id)).toEqual(['p1'])
    h.panel.back();await vi.waitFor(()=>expect(h.panel.getSnapshot().source.listing?.items.length).toBe(7))
    expect(h.panel.getSnapshot()).toMatchObject({detail:null,source:{sourceId:'s1',issue:null},object:'issues'})
    expect(h.command).not.toHaveBeenCalled()
    expect(h.navigation.selectPanel).toHaveBeenCalledExactlyOnceWith('a2d2-panel')
  })
  it('does not let an older existing-task read replace a newly selected Issue',async()=>{
    const h=fixture();await h.panel.load()
    const gate=deferred<WorkCompleted>(),query=h.query.getMockImplementation()!
    h.query.mockImplementation(q=>q.type==='task.detail'&&q.ref.taskId==='t1'?gate.promise:query(q))
    const pending=h.panel.openIssue(1,false,'I1')
    await vi.waitFor(()=>expect(h.query.mock.calls.some(([q])=>q.type==='task.detail')).toBe(true))
    await h.panel.openIssue(7,false,'I7');gate.resolve({status:'completed',task:root});await pending
    expect(h.panel.getSnapshot()).toMatchObject({detail:null,source:{issue:{nodeId:'I7'}}})
    expect(h.command).not.toHaveBeenCalled()
  })
  it('ignores a late connect success after panel exit while retaining the single authorized command',async()=>{
    const h=fixture();await h.panel.load();const gate=deferred<WorkCompleted>()
    h.command.mockReturnValueOnce(gate.promise)
    const pending=h.panel.connectProject({owner:'acme',type:'org',number:9})
    h.panel.close();const before=h.query.mock.calls.length
    gate.resolve({status:'completed',project:{...project,id:'new'},source:{...source,id:'new-source',projectId:'new'}});await pending
    expect(h.query.mock.calls).toHaveLength(before)
    expect(h.panel.getSnapshot().projectId).toBe('p1')
    expect(h.command).toHaveBeenCalledTimes(1)
    expect(h.navigation.selectPanel).toHaveBeenLastCalledWith(null)
  })
  it('does not browse a stale connection after navigation away and back during project loading',async()=>{
    const h=fixture();await h.panel.load();const gate=deferred<WorkCompleted>(),query=h.query.getMockImplementation()!
    let delayed=false
    h.query.mockImplementation(q=>{if(q.type==='project.detail'&&q.projectId==='p1'&&!delayed){delayed=true;return gate.promise}return query(q)})
    const pending=h.panel.connectProject({owner:'acme',type:'org',number:7})
    await vi.waitFor(()=>expect(delayed).toBe(true))
    await h.panel.selectProject('old');await h.panel.selectProject('p1');await h.panel.openIssue(7,false,'I7')
    gate.resolve({status:'completed',project,tasks:[root]});await pending
    expect(h.panel.getSnapshot()).toMatchObject({detail:null,source:{issue:{nodeId:'I7'}}})
    expect(h.query.mock.calls.filter(([q])=>q.type==='source.issues'&&q.refresh)).toHaveLength(0)
  })
})
