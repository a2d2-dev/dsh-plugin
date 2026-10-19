import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { WorkTask } from '../../src/work-types.ts'

const task: WorkTask={id:'t1',projectId:'p1',agentId:'a1',version:3,title:'本地规格工作',goal:'保留真实目标',specification:{version:2,text:'已保存的规格',acceptance:['刷新可读取','无Issue也可使用']},specificationHistory:[],breakdown:[],children:[],sessions:[{session:{runtimeId:'host',sessionId:'existing'},purpose:'review'}],activity:[{commandId:'c1',type:'task.create',version:1}]}
describe('local work detail presentation',()=>{
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
