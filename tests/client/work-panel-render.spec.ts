import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { WorkTask } from '../../src/work-types.ts'

const task: WorkTask={id:'t1',projectId:'p1',agentId:'a1',version:3,title:'本地规格工作',goal:'保留真实目标',specification:{version:2,text:'已保存的规格',acceptance:['刷新可读取','无Issue也可使用']},specificationHistory:[],breakdown:[],children:[],sessions:[{session:{runtimeId:'host',sessionId:'existing'},purpose:'review'}],activity:[{commandId:'c1',type:'task.create',version:1}]}
describe('local work detail presentation',()=>{
  it('renders real source identity and complete hostile Issue text safely, with explicit acceptance actions',async()=>{
    const issue={nodeId:'I112',url:'javascript:alert(1)',number:112,title:'<img src=x onerror=alert(1)>',body:'<script>alert(1)</script>\nFull original body',repository:{owner:'a2d2-dev',repository:'dsh-plugin'},assignees:['imneov'],labels:['ready-for-agent'],state:'closed' as const,updatedAt:'2026-10-20',observedAt:'2026-10-21'}
    const source={id:'s1',projectId:'p1',provider:'github' as const,repository:issue.repository,enabled:true,version:1,sequence:1,requests:{},observations:[],pages:[],identity:{login:'imneov',nodeId:'U1',name:'LiuFeng'}}
    const panel=new WorkPanelController({command:async()=>{throw Error('unexpected write')},query:async q=>({status:'completed',...(q.type==='source.list'?{sources:[source]}:q.type==='source.issue'?{source,issue}:q.type==='source.issues'?{source,page:{identity:source.identity,items:[issue],observedAt:issue.observedAt}}:q.type==='project.detail'?{tasks:[]}:{projects:[{id:'p1',name:'真实来源项目',version:1,defaultAgentId:'a1',resources:[]}]})})},{selectPanel:()=>{},openSession:()=>{}})
    await panel.load();await panel.showSources();await panel.openIssue(112)
    const html=renderToStaticMarkup(createElement(WorkPanel,{controller:panel}))
    for(const text of ['imneov','LiuFeng','Full original body','接入为本地工作','关联已有本地工作','远端状态','closed','返回 Issue 列表']) expect(html).toContain(text)
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript:')
  })
  it('shows retained accepted source and latest observations separately without treating remote closed as completion',async()=>{
    const accepted={nodeId:'I112',url:'https://github.com/a2d2-dev/dsh-plugin/issues/112',number:112,title:'Accepted title',body:'Accepted original body',repository:{owner:'a2d2-dev',repository:'dsh-plugin'},assignees:['old-owner'],labels:['original'],state:'open' as const,updatedAt:'2026-10-20',observedAt:'2026-10-20'}
    const latest={...accepted,title:'Latest remote title',body:'Latest remote body',state:'closed' as const,assignees:['remote-owner'],updatedAt:'2026-10-21',observedAt:'2026-10-22'}
    const imported={...task,specification:{version:1,text:accepted.body,acceptance:[],missing:['acceptance' as const]}}
    const binding={provider:'github' as const,nodeId:accepted.nodeId,urls:[accepted.url],sourceIds:['s1'],ref:{projectId:'p1',taskId:'t1'},accepted,lastObserved:latest}
    const panel=new WorkPanelController({command:async()=>{throw Error('unexpected write')},query:async q=>q.type==='task.detail'?{status:'completed',task:imported,bindings:[binding]}:{status:'completed',projects:[{id:'p1',name:'本地项目',version:1,defaultAgentId:'a1',resources:[]}]}},{selectPanel:()=>{},openSession:()=>{}})
    await panel.openTask(binding.ref)
    const html=renderToStaticMarkup(createElement(WorkPanel,{controller:panel}))
    for(const text of ['结构化验收标准尚待确认','已接受来源','最新观察','Accepted original body','Latest remote body','标题、正文、负责人、远端状态','不代表本地完成或协调权']) expect(html).toContain(text)
    expect(html).toContain('href="https://github.com/a2d2-dev/dsh-plugin/issues/112"')
    expect(html).not.toContain('Task 已完成')
  })
  it('shows four full-page detail tabs and saved content without inventing an active coordinator',async()=>{
    const panel=new WorkPanelController({command:async()=>{throw Error('unexpected write')},query:async query=>query.type==='task.detail'?{status:'completed',task}:{status:'completed',projects:[{id:'p1',name:'本地项目',version:1,defaultAgentId:'a1',resources:[]}]}},{selectPanel:()=>{},openSession:()=>{}})
    await panel.load(); await panel.openTask({projectId:'p1',taskId:'t1'})
    const html=renderToStaticMarkup(createElement(WorkPanel,{controller:panel}))
    for(const text of ['本地规格工作','概览','会话','相关工作','活动','保留真实目标','已保存的规格','刷新可读取','尚未开始处理。可先关联已有会话查看相关工作。']) expect(html).toContain(text)
    expect(html).not.toContain('进入当前会话')
    expect(html).not.toContain('a1')
    panel.setDetailTab('sessions')
    const sessions=renderToStaticMarkup(createElement(WorkPanel,{controller:panel}))
    expect(sessions).toContain('评审')
    expect(sessions).toContain('打开会话')
  })
})
