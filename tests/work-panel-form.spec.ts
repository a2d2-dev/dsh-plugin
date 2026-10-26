import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import type { WorkHost } from '../src/work.ts'
import { WorkPanelController } from '../src/client/work-panel-controller.ts'
import type { GitHubSourcePort } from '../src/work-sources/types.ts'
import { mountProductionComponent } from './client/production-component-harness.ts'
import { afterEach } from 'vitest'
afterEach(() => vi.unstubAllGlobals())

// Execute production TSX, extracted children and their actual callbacks in memory.
// Only React's scheduler is substituted; integration commands use the real app/disk.
async function mountWorkPanel(props: Record<string, unknown>, component = 'SourceConnect') {
  return mountProductionComponent(props, component, component === 'SourceConnect'
    ? new URL('../src/client/source-connect.tsx', import.meta.url)
    : new URL('../src/client/work-panel.tsx', import.meta.url), { document: { addEventListener() {}, removeEventListener() {} } })
}

async function withPanel(run: (panel: WorkPanelController) => Promise<void>, host: WorkHost = { resources: async () => [], sessions: async () => [] }, source?: GitHubSourcePort) {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-work-form-'))
  const expected = resolve(directory)
  const app = new WorkApplication(directory, host, source)
  const operator = { operator: true }
  const panel = new WorkPanelController({
    command: async command => {
      const result = await app.execute(command, operator)
      if (result.status !== 'completed') throw Error(JSON.stringify(result))
      return result
    },
    query: async query => {
      const result = await app.query(query, operator)
      if (result.status !== 'completed') throw Error(JSON.stringify(result))
      return result
    },
  }, { selectPanel() {}, openSession() {} })
  try {
    const created=await panel.submit({ type: 'project.create', name: '表单往返' })
    await panel.load();await panel.selectProject(created.project!.id)
    await run(panel)
  } finally {
    expect(directory).toBe(expected)
    expect(await realpath(directory)).toBe(expected)
    expect(directory.startsWith(join(tmpdir(), 'a2d2-work-form-'))).toBe(true)
    await rm(directory, { recursive: true, force: true })
  }
}

const goal = '\n  保留完整目标\n'
const specification = '\n    preserve code indentation\n'
const acceptance = ['先验证A\n再验证B']

describe('production Issue source acceptance controls', () => {
  it('keeps an accepted import saved without changing navigation after the production panel unmounts', async () => {
    const identity={login:'source-reader',nodeId:'U1',name:null}
    const issue={nodeId:'I124',number:124,url:'https://github.com/a2d2-dev/dsh-plugin/issues/124',repository:{owner:'a2d2-dev',repository:'dsh-plugin'},title:'Unmounted import',body:'Accepted body',state:'open' as const,assignees:[],labels:[],updatedAt:'2026-10-20T00:00:00Z',observedAt:'2026-10-21T00:00:00Z'}
    await withPanel(async panel => {
      await panel.configureSource('a2d2-dev','dsh-plugin');await panel.openIssue(124)
      const mounted=await mountWorkPanel({controller:panel},'WorkPanel')
      let release!:()=>void, saved!:()=>void
      const response=new Promise<void>(done=>{release=done}), committed=new Promise<void>(done=>{saved=done})
      const command=panel.client.command.bind(panel.client)
      panel.client.command=async value=>{const result=await command(value);saved();await response;return result}
      const pending=panel.acceptIssue()
      try {
        await committed
        mounted.unmount()
      } finally { release() }
      await pending
      expect(panel.getSnapshot()).toMatchObject({object:'issues',detail:null,source:{loading:false,issue:{number:124}}})
      expect((await panel.client.query({type:'project.detail',projectId:panel.getSnapshot().projectId!})).tasks).toMatchObject([{title:'Unmounted import'}])
    },undefined,{list:async()=>({identity,items:[issue],observedAt:issue.observedAt}),detail:async()=>({identity,issue})})
  })
  it('imports an observed null body only after explicit start and preserves missing acceptance indicators', async () => {
    const identity={login:'imneov',nodeId:'U1',name:'LiuFeng'}
    const issue={nodeId:'I112',number:112,url:'https://github.com/a2d2-dev/dsh-plugin/issues/112',repository:{owner:'a2d2-dev',repository:'dsh-plugin'},title:'Observed empty Issue body',body:null,state:'open' as const,assignees:['imneov'],labels:[],updatedAt:'2026-10-20T00:00:00Z',observedAt:'2026-10-21T00:00:00Z'}
    await withPanel(async panel => {
      await panel.configureSource('a2d2-dev','dsh-plugin');await panel.openIssue(112)
      const writes=vi.spyOn(panel.client,'command')
      expect((await panel.client.query({type:'project.detail',projectId:panel.getSnapshot().projectId!})).tasks).toEqual([])
      const form=await mountWorkPanel({controller:panel},'WorkPanel')
      expect(writes).not.toHaveBeenCalled()
      form.click('开始处理')
      await vi.waitFor(()=>expect(panel.getSnapshot().detail?.task?.specification).toMatchObject({text:'',acceptance:[],missing:['body','acceptance']}))
      expect(writes.mock.calls.filter(([command])=>command.type==='source.import')).toHaveLength(1)
      const detail=await mountWorkPanel({controller:panel},'WorkPanel')
      const paragraphs=detail.nodes('p').map(node=>[node.props.children].flat(Infinity).join('')).join('\n')
      expect(paragraphs).toContain('结构化验收标准尚待确认')
      expect(paragraphs).toContain('规格正文尚待补充')
      detail.unmount()
      form.unmount()
    },undefined,{list:async()=>({identity,items:[issue],observedAt:issue.observedAt}),detail:async()=>({identity,issue})})
  })
})

describe('production session work entry', () => {
  it('returns linked blank/nonblank session references to the correct task and renders nothing for an unassociated session', async () => {
    const resource = { ref: { runtimeId: 'host-entry', workspaceId: 'workspace-entry' }, title: '已有资源' }
    const sessionIds = ['blank-existing', 'nonblank-existing']
    const host: WorkHost = { resources: async () => [resource], sessions: async () => [...sessionIds, 'unassociated'].map(sessionId => ({ ref: { runtimeId: resource.ref.runtimeId, sessionId }, resource: resource.ref, title: sessionId })) }
    await withPanel(async panel => {
      const project = panel.getSnapshot().projects[0]!
      await panel.submit({ type: 'project.attach-resource', projectId: project.id, expectedVersion: project.version, resource: resource.ref })
      let task = (await panel.submit({ type: 'task.create', projectId: project.id, title: '返回准确工作', goal, specification, acceptance })).task!
      const ref = { projectId: project.id, taskId: task.id }
      for (const sessionId of sessionIds) task = (await panel.submit({ type: 'task.associate-session', ref, expectedVersion: task.version, session: { runtimeId: resource.ref.runtimeId, sessionId }, purpose: 'related' })).task!
      const write = vi.spyOn(panel, 'submit')
      let reads = 0
      const query = panel.client.query.bind(panel.client)
      panel.client.query = async (request, signal) => {
        const result = await query(request, signal)
        if (request.type === 'session.work') reads++
        return result
      }
      for (const sessionId of sessionIds) {
        panel.back()
        const entry = await mountWorkPanel({ controller: panel, sessionId }, 'SessionWorkEntry')
        try {
          await vi.waitFor(() => expect(entry.nodes('button')).toHaveLength(1))
          const button = entry.nodes('button')[0]
          expect(entry.text()).toContain('返回准确工作')
          button.props.onClick()
          await vi.waitFor(() => expect(panel.getSnapshot().detail?.task?.id).toBe(ref.taskId))
          expect(panel.getSnapshot()).toMatchObject({ projectId: ref.projectId, detailTab: 'overview' })
        } finally { entry.unmount() }
      }
      const entry = await mountWorkPanel({ controller: panel, sessionId: 'unassociated' }, 'SessionWorkEntry')
      try {
        await vi.waitFor(() => expect(reads).toBe(3))
        expect(entry.render()).toBeNull()
        expect(write).not.toHaveBeenCalled()
      } finally { entry.unmount() }
    }, host)
  })
})


const identity={login:'viewer',nodeId:'U1',name:null}
const source={id:'s1',projectId:'p1',provider:'github' as const,githubProject:{owner:'acme',type:'org' as const,number:7},enabled:true,version:1,sequence:1,requests:{},observations:[],pages:[],identity}
const project={id:'p1',name:'Product roadmap',version:1,defaultAgentId:'a1',resources:[]}
const resource={runtimeId:'host',workspaceId:'work'}
const options={agentId:'a1',resources:[{ref:resource,title:'/work/repo'}],models:[{provider:'real',model:'fast'},{provider:'real',model:'quality'}],agentPresets:['standard'],permissionPresets:['review'],defaults:{model:{provider:'real',model:'quality',reasoningEffort:'high'},agentPreset:'standard',permissionPreset:'review'}}
function fixture() {
  let rule:import('../src/work-types.ts').ContinuousWorkRule|undefined
  const command=vi.fn(async(value:import('../src/work-types.ts').WorkCommand):Promise<import('../src/work-types.ts').WorkCompleted>=>{
    if(value.type==='source.connect')return {status:'completed',project,source}
    if(value.type==='continuous.configure'){rule={...rule,id:'r1',projectId:'p1',sourceId:'s1',version:(rule?.version??0)+1,enabled:value.enabled,scope:{assignee:value.assignee,labels:value.labels,identity},resource:value.resource,model:value.model,agentPreset:value.agentPreset,permissionPreset:value.permissionPreset,queue:value.queue,items:rule?.items??[]};return {status:'completed',continuousRule:rule}}
    if(value.type==='continuous.set-enabled'){rule={...rule!,version:rule!.version+1,enabled:value.enabled};return {status:'completed',continuousRule:rule}}
    throw Error('Unexpected write '+value.type)
  })
  const query=vi.fn(async(value:import('../src/work-types.ts').WorkQuery):Promise<import('../src/work-types.ts').WorkCompleted>=>{
    if(value.type==='source.identify')return {status:'completed',candidate:{kind:'project',nodeId:'P7',url:value.url,entryUrl:value.url,githubProject:{owner:'acme',type:'user',number:7},title:'Product roadmap',identity}}
    if(value.type==='projects.list')return {status:'completed',projects:[project]}
    if(value.type==='project.detail')return {status:'completed',project,tasks:[]}
    if(value.type==='source.list')return {status:'completed',sources:[source]}
    if(value.type==='resources.list')return {status:'completed',resources:[...options.resources,{ref:{runtimeId:'host',workspaceId:'owned'},title:'/other',owner:{projectId:'another',projectName:'Another project'}}]}
    if(value.type==='source.execution-options')return {status:'completed',executionOptions:options}
    if(value.type==='continuous.status')return {status:'completed',continuousRule:rule}
    return {status:'completed'}
  })
  return {panel:new WorkPanelController({command,query},{selectPanel(){},openSession(){}}),command,query,getRule:()=>rule,setRule:(value:typeof rule)=>{rule=value}}
}
describe('GitHub Project onboarding production controls',()=>{
  it('identifies the Project URL and confirms owner, account type and number before connecting',async()=>{
    const h=fixture(),saved=vi.fn(),form=await mountWorkPanel({controller:h.panel,onSaved:saved})
    try {
      form.click('通过链接');form.change(form.inputs()[0],'https://github.com/users/acme/projects/7');form.submit()
      await vi.waitFor(()=>expect(form.text()).toContain('Product roadmap'))
      expect(h.panel.getSnapshot().connection.candidate).toMatchObject({githubProject:{owner:'acme',type:'user',number:7}})
      expect(h.panel.getSnapshot().connection.candidate?.identity.login).toBe('viewer')
      expect(h.command).not.toHaveBeenCalled()
      form.click('添加');await vi.waitFor(()=>expect(saved).toHaveBeenCalledOnce())
      expect(h.command).toHaveBeenCalledExactlyOnceWith({type:'source.connect',url:'https://github.com/users/acme/projects/7',commandId:expect.any(String)})
      expect(h.panel.getSnapshot()).toMatchObject({projectId:'p1',object:'issues',detail:null,source:{tab:'overview'}})
      expect(h.query.mock.calls.some(([q])=>q.type==='resources.list'||q.type==='source.execution-options')).toBe(false)
    }finally{form.unmount()}
  })
  it('retries an uncertain connection with the same command ID and no extra local-create command',async()=>{
    const h=fixture(),saved=vi.fn(),form=await mountWorkPanel({controller:h.panel,onSaved:saved})
    h.command.mockRejectedValueOnce(Error('connection lost'))
    try {
      form.click('通过链接');form.change(form.inputs()[0],'https://github.com/users/acme/projects/7');form.submit()
      await vi.waitFor(()=>expect(h.panel.getSnapshot().connection.candidate).not.toBeNull())
      form.click('添加')
      await vi.waitFor(()=>expect(form.text()).toContain('connection lost'))
      expect(saved).not.toHaveBeenCalled();form.click('添加');await vi.waitFor(()=>expect(saved).toHaveBeenCalledOnce())
      expect(h.command).toHaveBeenCalledTimes(2);expect(h.command.mock.calls[0]![0]).toEqual(h.command.mock.calls[1]![0])
      expect(h.command.mock.calls[0]![0]).not.toHaveProperty('resource')
    }finally{form.unmount()}
  })
})
const savedRule=():import('../src/work-types.ts').ContinuousWorkRule=>({id:'r1',projectId:'p1',sourceId:'s1',version:3,enabled:false,scope:{assignee:'*',labels:['ready-for-agent','approved'],identity},resource,model:options.defaults.model,agentPreset:'standard',permissionPreset:'review',active:{projectId:'p1',taskId:'t1'},items:[{nodeId:'I1',number:1,title:'Requirement',url:'https://github.com/acme/repo/issues/1',state:'waiting',reason:'Waiting for acceptance evidence',attempts:1,ref:{projectId:'p1',taskId:'t1'}}]})
function planned(rule:import('../src/work-types.ts').ContinuousWorkRule) {
  const instruction='持续处理已批准的工作',issue={nodeId:'I1',number:1,title:'Requirement',url:'https://github.com/acme/repo/issues/1',repository:{owner:'acme',repository:'repo'},state:'open' as const,labels:['ready-for-agent','approved'],assignees:[]}
  return {instruction,supplements:[],scopeVersion:1,draftVersion:1,blocks:[],plans:[{version:1,draftVersion:1,createdAt:'2026-10-21T00:00:00Z',steps:[{nodeId:'I1',why:'Approved requirement',nextAction:'Collect acceptance evidence',mode:'existing' as const}],basis:{instruction,supplements:[],scopeVersion:1,blocks:[],scope:rule.scope,executionStrategy:{resource:rule.resource,model:rule.model,agentPreset:rule.agentPreset,permissionPreset:rule.permissionPreset},relationshipAvailability:{nativeParentChildren:'observed-when-present' as const,nativeDependencies:'unavailable-in-source-port' as const},source:{...source,sourceVersion:1,candidateCount:1},candidates:[{issue}]}}]}
}
describe('continuous processing production scope controls',()=>{
  it('mounts the queue only in its permanent tab and makes the menu target that same tab',async()=>{
    const h=fixture();h.setRule(savedRule());await h.panel.load()
    const form=await mountWorkPanel({controller:h.panel},'WorkPanel')
    try {
      expect(form.text()).not.toContain('任务队列')
      const tabs=form.nodes('nav').find(node=>node.props['aria-label']==='来源目录').props.children
      expect(tabs.map((node:any)=>node.props.children)).toEqual(['概览','项目','Issue','PR','持续委托'])
      expect(h.query.mock.calls.some(([value])=>value.type==='continuous.status')).toBe(false)
      form.click('持续委托');await vi.waitFor(()=>expect(form.text()).toContain('任务队列'))
      expect(form.text()).not.toContain('来源概览')
      form.click('概览');await vi.waitFor(()=>expect(form.text()).not.toContain('任务队列'))
      form.nodes('button').find(node=>node.props['aria-label']==='来源操作').props.onClick({stopPropagation(){}})
      form.nodes('button').find(node=>node.props.role==='menuitem'&&node.props.children==='持续委托').props.onClick({stopPropagation(){}})
      await vi.waitFor(()=>expect(form.text()).toContain('任务队列'))
      expect(h.panel.getSnapshot().source.tab).toBe('delegation')
      expect(h.command).not.toHaveBeenCalled()
    }finally{form.unmount()}
  })
  it('preserves explicit scope and real defaults, saves queue settings, then pauses only later work',async()=>{
    const h=fixture();h.setRule(savedRule());await h.panel.load()
    const form=await mountWorkPanel({controller:h.panel},'ContinuousProcessing')
    try {
      await vi.waitFor(()=>expect(form.text()).toContain('所有负责人 · 标签：ready-for-agent、approved'))
      expect(h.command).not.toHaveBeenCalled();form.click('设置')
      await vi.waitFor(()=>expect(form.nodes('form')).toHaveLength(1))
      expect(form.nodes('select').find(node=>node.props.children?.some?.((child:any)=>[child?.props?.children].flat(Infinity).join('')==='real/quality'))?.props.value).toBe(1)
      form.submit();await vi.waitFor(()=>expect(h.command).toHaveBeenCalledOnce())
      expect(h.command.mock.calls[0]![0]).toMatchObject({type:'continuous.configure',projectId:'p1',sourceId:'s1',expectedVersion:3,assignee:'*',labels:['ready-for-agent','approved'],resource,model:options.defaults.model,agentPreset:'standard',permissionPreset:'review',enabled:false,queue:{concurrency:1,refreshMinutes:10,order:'oldest'}})
      await vi.waitFor(()=>expect(form.nodes('form')).toHaveLength(0))
      expect(form.textareas()).toHaveLength(0)
      expect(form.text()).not.toContain('计划 v1')
      form.click('继续处理');await vi.waitFor(()=>expect(h.getRule()?.enabled).toBe(true))
      await vi.waitFor(()=>expect(form.nodes('button').some(node=>node.props.children==='暂停后续')).toBe(true))
      form.click('暂停后续');await vi.waitFor(()=>expect(h.getRule()?.enabled).toBe(false))
      expect(h.command.mock.calls.slice(-2).map(([value])=>value)).toMatchObject([{type:'continuous.set-enabled',expectedVersion:4,enabled:true},{type:'continuous.set-enabled',expectedVersion:5,enabled:false}])
      expect(h.command.mock.calls.some(([value])=>value.type==='task.control'||value.type==='task.start')).toBe(false)
      expect(form.nodes('button').find(node=>node.props.children==='继续处理')?.props.title).toContain('在途处理和历史保留')
      expect(form.nodes('div').find(node=>node.props['aria-label']==='持续委托队列 滚动区域')?.props).toMatchObject({role:'region',tabIndex:0})
    }finally{form.unmount()}
  })
  it('saves, restores and clears the semantic screening prompt in the production settings form',async()=>{
    const h=fixture();h.setRule(savedRule());await h.panel.load()
    const form=await mountWorkPanel({controller:h.panel},'ContinuousProcessing')
    try {
      await vi.waitFor(()=>expect(form.text()).toContain('任务队列'))
      form.click('设置');await vi.waitFor(()=>expect(form.textareas()).toHaveLength(1))
      form.change(form.textareas()[0],'  只处理独立缺陷\n排除文档与产品决策  ')
      form.submit();await vi.waitFor(()=>expect(h.command).toHaveBeenCalledOnce())
      expect(h.command.mock.calls[0]![0]).toMatchObject({queue:{filterPrompt:'只处理独立缺陷\n排除文档与产品决策'}})
      await vi.waitFor(()=>expect(form.nodes('form')).toHaveLength(0))
      expect(form.text()).toContain('大模型筛选条件')
      form.click('设置');await vi.waitFor(()=>expect(form.textareas()[0]?.props.value).toBe('只处理独立缺陷\n排除文档与产品决策'))
      form.change(form.textareas()[0],'');form.submit()
      await vi.waitFor(()=>expect(h.command).toHaveBeenCalledTimes(2))
      expect(h.command.mock.calls[1]![0]).toMatchObject({queue:{filterPrompt:''}})
    }finally{form.unmount()}
  })
  it('renders persisted queue reasons and opens its active Issue without starting or pausing it',async()=>{
    const h=fixture(),rule=savedRule();h.setRule({...rule,planning:planned(rule)})
    await h.panel.load();const open=vi.spyOn(h.panel,'openTask').mockResolvedValue()
    const form=await mountWorkPanel({controller:h.panel,onClose(){}},'ContinuousProcessing')
    try {
      await vi.waitFor(()=>expect(form.nodes('td')).toHaveLength(4))
      expect(form.text()).toContain('Waiting for acceptance evidence')
      form.click('#1 Requirement')
      expect(open).toHaveBeenCalledExactlyOnceWith({projectId:'p1',taskId:'t1'})
      expect(h.command).not.toHaveBeenCalled()
    }finally{form.unmount()}
  })
})
