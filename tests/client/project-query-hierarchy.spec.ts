import { describe, expect, it } from 'vitest'
import { mountProductionComponent } from './production-component-harness.ts'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { GitHubIssue, WorkSource } from '../../src/work-sources/types.ts'

const observedAt='2026-10-24T00:00:00Z'
const identity={login:'reader',nodeId:'U',name:null}
const parent:GitHubIssue={nodeId:'parent',number:1,title:'Parent work',body:'',repository:{owner:'acme',repository:'app'},url:'https://github.com/acme/app/issues/1',state:'open',assignees:['reader'],labels:[],observedAt,updatedAt:observedAt}
const child:GitHubIssue={...parent,nodeId:'child',number:2,title:'Child work',url:'https://github.com/acme/app/issues/2',parent:{...parent}}
async function setup(extraCount=0){
  const records=[parent,child,...Array.from({length:extraCount},(_,index)=>({...child,nodeId:`extra-${index}`,number:index+3,title:`Extra ${index}`,url:`https://github.com/acme/app/issues/${index+3}`}))]
  const items=records.map(issue=>({id:`item-${issue.nodeId}`,kind:'issue' as const,archived:false,issueNodeId:issue.nodeId,title:issue.title,url:issue.url,fields:[],fieldsPartial:false}))
  const source:WorkSource={id:'s',projectId:'p',provider:'github',enabled:true,version:1,sequence:1,requests:{},pages:[],githubProject:{owner:'acme',type:'org',number:1},observations:records.map(issue=>({issue,sequence:1})),projectSnapshot:{identity,observedAt,project:{nodeId:'P',title:'Project',url:'https://github.com/orgs/acme/projects/1',closed:false},items}}
  const catalog={observedAt,pullRequests:[],pullRequestsComplete:true,viewsComplete:true,views:[{id:'view',number:1,name:'All',filter:'',layout:'TABLE_LAYOUT'}],fields:[],limitations:[]}
  const progress={ref:{projectId:'p',taskId:'child-task'},title:child.title,children:[],stage:'in-progress' as const,summary:'',next:'',blockers:[],criteria:{passed:0,total:1,assessed:0,current:true},breakdown:[],source:{nodeId:child.nodeId,number:child.number,url:child.url,state:child.state,observedAt},execution:{id:'e',session:{runtimeId:'r',sessionId:'session-child-session'},state:'ready' as const,runtime:'idle' as const}}
  const openedSessions:string[]=[]
  const controller=new WorkPanelController({command:async()=>{throw Error('list interaction must remain read-only')},query:async q=>({status:'completed',...(q.type==='project.detail'?{tasks:[],progressItems:[progress]}:q.type==='source.list'?{sources:[source]}:q.type==='source.catalog'?{source,catalog}:q.type==='source.issues'?{source,page:{identity,items:records.slice(0,100),...(records.length>100?{nextPage:2}:{}),observedAt}}:{})})},{selectPanel(){},openSession(id){openedSessions.push(id)}})
  await controller.selectProject('p');await controller.selectSourceTab('project')
  const h=mountProductionComponent({controller,issues:null,panel:'none',onPanel(){}},'SourceDirectory',new URL('../../src/client/source-directory.tsx',import.meta.url))
  const search=()=>h.inputs().find(node=>node.props['aria-label']==='搜索 Project 条目')
  const rows=()=>h.nodes('tr').filter(node=>node.props['data-row-key'])
  const folds=()=>h.nodes('button').filter(node=>['收起子项','展开子项'].includes(node.props['aria-label']))
  return {h,search,rows,folds,openedSessions}
}
describe('Project query hierarchy',()=>{
  it('retains matching parent/child nesting and working collapse controls after search',async()=>{
    const {h,search,rows,folds,openedSessions}=await setup()
    expect(rows()).toHaveLength(2);expect(folds()).toHaveLength(1)
    h.change(search(),'acme/app')
    expect(rows()).toHaveLength(2)
    expect(folds(),'search matching both records must retain hierarchy controls').toHaveLength(1)
    expect(h.nodes('div').some(node=>node.props.style?.paddingLeft===22)).toBe(true)
    expect(h.text()).toContain('session-child-se')
    folds()[0].props.onClick();expect(rows()).toHaveLength(1)
    expect(folds()[0].props['aria-label']).toBe('展开子项')
    folds()[0].props.onClick();expect(rows()).toHaveLength(2)
    expect(h.text()).toContain('session-child-se')
    h.click('session-child-se');expect(openedSessions).toEqual(['session-child-session'])
    h.unmount()
  })
  it('applies collapse before the 100-row window and searches children beyond that window',async()=>{
    const {h,search,rows,folds}=await setup(100)
    expect(rows()).toHaveLength(100)
    folds()[0].props.onClick();expect(rows()).toHaveLength(1)
    folds()[0].props.onClick();expect(rows()).toHaveLength(100)
    h.change(search(),'Extra 99')
    expect(rows()).toHaveLength(1);expect(folds()).toHaveLength(0)
    expect(h.text()).toContain('#102 Extra 99');expect(h.text()).not.toContain('#1 Parent work')
    h.unmount()
  })
  it('promotes a child-only match to a root without adding a nonmatching parent',async()=>{
    const {h,search,rows,folds,openedSessions}=await setup()
    h.change(search(),'Child work')
    expect(rows()).toHaveLength(1);expect(h.text()).not.toContain('#1 Parent work')
    expect(folds()).toHaveLength(0)
    expect(h.nodes('div').some(node=>node.props.style?.paddingLeft===22)).toBe(false)
    expect(h.text()).toContain('session-child-se')
    h.click('session-child-se');expect(openedSessions).toEqual(['session-child-session'])
    h.unmount()
  })
})
