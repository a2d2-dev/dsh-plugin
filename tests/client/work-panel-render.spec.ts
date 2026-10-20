import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { WorkExecution, WorkTask } from '../../src/work-types.ts'

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

const execution: WorkExecution={
  id:'execution-1',ref:{projectId:'p1',taskId:'t1'},agentId:'agent-1',owner:'owner',epoch:2,
  resource:{runtimeId:'host',workspaceId:'workspace'},session:{runtimeId:'host',sessionId:'current-session'},sessionMode:'create',
  agentPreset:'requested-preset',model:{provider:'requested-provider',model:'requested-model'},permissionPreset:'requested-permission',policy:{version:1,modelCandidates:[],instructions:'',capabilities:[]},
  state:'running',history:[],events:[],actual:{runtimeId:'host',cwd:'/actual/work',agentPreset:'effective-preset',provider:'effective-provider',model:'effective-model',permissionPreset:'effective-permission',sandbox:'workspace-write',approval:'never'},
}
async function renderExecution(value:WorkExecution|undefined|Error,tab:'overview'|'sessions'='overview') {
  const panel=new WorkPanelController({command:async()=>{throw Error('unexpected write')},query:async query=>query.type==='task.execution'?(value instanceof Error?Promise.reject(value):{status:'completed',execution:value}):query.type==='task.detail'?{status:'completed',task}:{status:'completed',projects:[{id:'p1',name:'本地项目',version:1,defaultAgentId:'a1',resources:[]}]}},{selectPanel:()=>{},openSession:()=>{}})
  await panel.load();await panel.openTask({projectId:'p1',taskId:'t1'});panel.setDetailTab(tab)
  return renderToStaticMarkup(createElement(WorkPanel,{controller:panel}))
}
describe('authoritative execution presentation',()=>{
  it.each<[WorkExecution['state'],string,boolean]>([
    ['accepted','已登记',false],['creating','创建中',false],['ready','就绪',true],['running','处理中',true],['waiting','等待',true],['paused','暂停',true],['failed','失败',false],
  ])('shows %s as %s and gates navigation by execution facts',async(state,label,enterable)=>{
    const html=await renderExecution({...execution,state,...(state==='failed'?{error:{code:'host-create-unknown',message:'创建回执未知'}}:{})})
    expect(html).toContain(`执行状态：${label}`)
    if(enterable) expect(html).toContain('进入当前会话'); else expect(html).not.toContain('进入当前会话')
    if(state!=='running') expect(html).not.toContain('执行状态：处理中')
    if(state==='failed') expect(html).toContain('host-create-unknown: 创建回执未知')
  })
  it('does not navigate a reserved ready session without actual host confirmation',async()=>{
    const html=await renderExecution({...execution,state:'ready',actual:undefined})
    expect(html).toContain('执行状态：就绪')
    expect(html).toContain('尚未确认实际执行环境')
    expect(html).not.toContain('进入当前会话')
  })
  it('keeps query failures visible alongside saved specification instead of claiming no execution',async()=>{
    const html=await renderExecution(Error('execution-forbidden: 无权读取执行'))
    expect(html).toContain('execution-forbidden: 无权读取执行')
    expect(html).toContain('已保存的规格')
    expect(html).not.toContain('尚未开始处理')
    expect(html).not.toContain('进入当前会话')
  })
  it('keeps progress and accepted pause separate from runtime and business acceptance',async()=>{
    const html=await renderExecution({...execution,progress:'已完成目录核查，等待评审',control:{commandId:'pause-1',action:'pause',status:'accepted',reason:'请先暂停'},events:[{id:'input-1',text:'补充验收材料',kind:'input',delivery:'delivered',acceptance:'unassessed'}]})
    for(const text of ['执行状态：处理中','已完成目录核查，等待评审','暂停请求已接受，等待生效','请先暂停','补充验收材料','已投递','尚未验收']) expect(html).toContain(text)
    expect(html).not.toContain('执行状态：暂停')
    expect(html).not.toContain('工作已完成')
  })
  it('shows real execution, effective environment and current session apart from review associations',async()=>{
    const html=await renderExecution(execution)
    for(const text of ['执行状态：处理中','current-session','进入当前会话','/actual/work','effective-preset','effective-provider','effective-model','effective-permission','workspace-write','never']) expect(html).toContain(text)
    expect(html).not.toContain('尚未开始处理')
    expect(html).not.toContain('requested-model')
    expect(html).not.toContain('工作已完成')
    const sessions=await renderExecution(execution,'sessions')
    for(const text of ['当前处理会话','current-session','进入当前会话','关联会话','评审','打开会话']) expect(sessions).toContain(text)
  })
})
