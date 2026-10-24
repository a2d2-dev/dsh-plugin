import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { GitHubIssue, SourceCatalog, WorkSource } from '../../src/work-sources/types.ts'

const identity={login:'reader',nodeId:'U',name:null}
const issue:GitHubIssue={nodeId:'I',number:246,title:'Private snapshot sentinel',url:'https://github.com/acme/app/issues/246',body:null,repository:{owner:'acme',repository:'app'},state:'open',assignees:['reader'],labels:['real-label'],updatedAt:'2026-10-24T00:00:00Z',observedAt:'2026-10-24T00:00:00Z'}
const catalog:SourceCatalog={observedAt:issue.observedAt,pullRequests:[],pullRequestsComplete:true,views:[{id:'v1',number:1,name:'Actual view',filter:'',layout:'TABLE_LAYOUT'}],fields:[{id:'a',name:'Assignees',dataType:'ASSIGNEES'}],viewsComplete:true,limitations:[]}
async function setup(view=1,available=true){
  const source:WorkSource={id:'s',projectId:'p',provider:'github',githubProject:{owner:'acme',type:'org',number:1},enabled:true,version:1,sequence:1,requests:{},pages:[],observations:[{issue,sequence:1}],entryUrls:[`https://github.com/orgs/acme/projects/1/views/${view}`],projectSnapshot:{identity,project:{nodeId:'P',title:'Project',url:'https://github.com/orgs/acme/projects/1',closed:false},observedAt:issue.observedAt,items:[{id:'item',kind:'issue',archived:false,issueNodeId:issue.nodeId,title:issue.title,url:issue.url,fields:[],fieldsPartial:false}]}}
  const commands:unknown[]=[]
  const controller=new WorkPanelController({command:async value=>{commands.push(value);throw Error('Browsing cannot send commands')},query:async query=>({status:'completed',...(query.type==='projects.list'?{projects:[{id:'p',name:'Project',version:1,defaultAgentId:'agent',resources:[]}]}:query.type==='source.list'?{sources:[source]}:query.type==='source.catalog'?{source,...(available?{catalog}:{})}:query.type==='source.issues'?{source,page:{identity,items:[issue],observedAt:issue.observedAt}}:{tasks:[]})})},{selectPanel:()=>{},openSession:()=>{}})
  await controller.load()
  return {controller,commands,render:()=>renderToStaticMarkup(createElement(WorkPanel,{controller}))}
}
it.each([{view:999,available:true,reason:'保存的 view 不在当前可读取目录中'},{view:1,available:false,reason:'尚无可读缓存'}])('does not substitute the snapshot for an unavailable view: $reason',async({view,available,reason})=>{
  const {controller,commands,render}=await setup(view,available)
  await controller.selectSourceTab('project')
  const html=render()
  expect(html).toContain(reason)
  expect(html).toContain('搜索 Project 条目')
  expect(html).not.toContain(issue.title)
  expect(commands).toEqual([])
})
it('reuses discoverable column entries and visible scoped search across Project, Issue and PR tables',async()=>{
  const {controller,commands,render}=await setup()
  for(const [tab,search] of [['project','搜索 Project 条目'],['issues','搜索已加载 Issues'],['prs','搜索 PR']] as const){
    await controller.selectSourceTab(tab)
    const html=render()
    expect(html).toContain(`aria-label="${search}"`)
    const headers=[...html.matchAll(/<th\s[^>]*scope="col"[^>]*>(.*?)<\/th>/g)]
    expect(headers.length).toBeGreaterThanOrEqual(3)
    for(const header of headers)expect(header[1]).toContain('列操作')
    expect(html).toContain('当前')
  }
  expect(commands).toEqual([])
})
