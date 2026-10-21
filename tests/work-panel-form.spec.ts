import { createRequire } from 'node:module'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import type { WorkHost } from '../src/work.ts'
import { WorkPanelController, message } from '../src/client/work-panel-controller.ts'
import type { GitHubSourcePort } from '../src/work-sources/types.ts'
import { browserUUID } from '../src/client/browser-uuid.ts'
import { afterEach } from 'vitest'
afterEach(() => vi.unstubAllGlobals())

// Execute the production TSX and its actual JSX onChange/onSubmit callbacks in memory.
// Only React's mounting/state scheduler is substituted: commands use the real controller,
// WorkApplication and disk. This does not claim DOM or browser coverage.
async function mountWorkPanel(props: Record<string, unknown>, component = 'GitHubProjectForm') {
  const state: unknown[] = []
  let cursor = 0
  const require = createRequire(import.meta.url)
  const effects: (() => void)[] = [], cleanups: (() => void)[] = []
  const module = { exports: {} as Record<string, (props: Record<string, unknown>) => any> }
  const source = await readFile(new URL('../src/client/work-panel.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(`${source}\nexport { GitHubProjectForm, ContinuousProcessing, CurrentExecution, Requirements, IssueSourcePanel }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023 },
  }).outputText
  runInNewContext(compiled, {
    module, exports: module.exports, AbortController, crypto: globalThis.crypto, setInterval, clearInterval,
    require: (id: string) => id === 'react' ? {
      useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
        const index = cursor++, previous = state[index] as unknown[] | undefined
        if (previous && dependencies.every((value, index) => value === previous[index])) return
        state[index] = dependencies
        effects.push(() => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) })
      },
      useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
      useState: (initial: unknown) => {
        const index = cursor++
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
        return [state[index], (value: unknown) => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
      },
    } : id.endsWith('.css') ? { default: {} } : id === './work-panel-controller.ts' ? { message } : id === './browser-uuid.ts' ? { browserUUID } : require(id),
  })
  const render = () => {
    cursor = 0
    const element = module.exports[component]!(props)
    effects.splice(0).forEach(effect => effect())
    return element
  }
  function nodes(type: string): any[] {
    const result: any[] = []
    const walk = (node: any) => {
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (!node || typeof node !== 'object') return
      if (node.type === type) result.push(node)
      walk(node.props?.children)
    }
    walk(render())
    return result
  }
  render()
  return {
    render, nodes, unmount: () => cleanups.splice(0).forEach(cleanup => cleanup()),
    inputs: () => nodes('input'), textareas: () => nodes('textarea'),
    change: (node: any, value: string) => node.props.onChange({ target: { value } }),
    click: (text: string) => {
      const button = nodes('button').find(node => [node.props.children].flat(Infinity).join('') === text)
      expect(button, `button ${text}`).toBeDefined()
      expect(button.props.disabled, `button ${text} must be enabled`).not.toBe(true)
      button.props.onClick()
    },
    submit: () => nodes('form')[0].props.onSubmit({ preventDefault() {} }),
  }
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
      const form=await mountWorkPanel({controller:panel},'CurrentExecution')
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
          expect(button.props.children.join('')).toContain('返回准确工作')
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
    if(value.type==='continuous.configure'){rule={id:'r1',projectId:'p1',sourceId:'s1',version:(rule?.version??0)+1,enabled:value.enabled,scope:{assignee:value.assignee,labels:value.labels,identity},resource:value.resource,model:value.model,agentPreset:value.agentPreset,permissionPreset:value.permissionPreset,items:[]};return {status:'completed',continuousRule:rule}}
    if(value.type==='continuous.set-enabled'){rule={...rule!,version:rule!.version+1,enabled:value.enabled};return {status:'completed',continuousRule:rule}}
    throw Error('Unexpected write '+value.type)
  })
  const query=vi.fn(async(value:import('../src/work-types.ts').WorkQuery):Promise<import('../src/work-types.ts').WorkCompleted>=>{
    if(value.type==='projects.list')return {status:'completed',projects:[project]}
    if(value.type==='project.detail')return {status:'completed',project,tasks:[]}
    if(value.type==='source.list')return {status:'completed',sources:[source]}
    if(value.type==='resources.list')return {status:'completed',resources:[...options.resources,{ref:{runtimeId:'host',workspaceId:'owned'},title:'/other',owner:{projectId:'another',projectName:'Another project'}}]}
    if(value.type==='source.execution-options')return {status:'completed',executionOptions:options}
    if(value.type==='continuous.status')return {status:'completed',continuousRule:rule}
    return {status:'completed'}
  })
  return {panel:new WorkPanelController({command,query},{selectPanel(){},openSession(){}}),command,query,setRule:(value:typeof rule)=>{rule=value}}
}
describe('GitHub Project onboarding production controls',()=>{
  it('submits owner, account type and number in one form with an optional execution directory',async()=>{
    const h=fixture(),saved=vi.fn(),form=await mountWorkPanel({controller:h.panel,onSaved:saved})
    try {
      await vi.waitFor(()=>expect(form.nodes('option')).toHaveLength(5))
      form.change(form.inputs()[0],' acme ');form.change(form.inputs()[1],'7')
      form.change(form.nodes('select')[0],'user');form.change(form.nodes('select')[1],'0')
      form.submit();await vi.waitFor(()=>expect(saved).toHaveBeenCalledOnce())
      expect(h.command).toHaveBeenCalledExactlyOnceWith({type:'source.connect',githubProject:{owner:'acme',type:'user',number:7},resource,commandId:expect.any(String)})
      expect(h.panel.getSnapshot()).toMatchObject({projectId:'p1',object:'issues',detail:null})
      expect(form.nodes('option').find(node=>node.props.value===1)?.props.disabled).toBe(true)
    }finally{form.unmount()}
  })
  it('retries an uncertain connection with the same command ID and no extra local-create command',async()=>{
    const h=fixture(),saved=vi.fn(),form=await mountWorkPanel({controller:h.panel,onSaved:saved})
    h.command.mockRejectedValueOnce(Error('connection lost'))
    try {
      form.change(form.inputs()[0],'acme');form.change(form.inputs()[1],'7');form.submit()
      await vi.waitFor(()=>expect(form.nodes('button')[0].props.disabled).toBe(false))
      expect(saved).not.toHaveBeenCalled();form.submit();await vi.waitFor(()=>expect(saved).toHaveBeenCalledOnce())
      expect(h.command).toHaveBeenCalledTimes(2);expect(h.command.mock.calls[0]![0]).toEqual(h.command.mock.calls[1]![0])
      expect(h.command.mock.calls[0]![0]).not.toHaveProperty('resource')
    }finally{form.unmount()}
  })
})
describe('continuous processing production scope controls',()=>{
  it('configures explicit scope and real defaults, then pauses only new work with the saved version',async()=>{
    const h=fixture();await h.panel.load()
    const form=await mountWorkPanel({controller:h.panel},'ContinuousProcessing')
    try {
      await vi.waitFor(()=>expect(form.nodes('button')[0].props.disabled).toBe(false))
      expect(h.command).not.toHaveBeenCalled();form.click('开启持续处理')
      await vi.waitFor(()=>expect(form.nodes('form')).toHaveLength(1))
      expect(form.nodes('select')[2].props.value).toBe(1)
      form.change(form.nodes('select')[0],'*');form.change(form.inputs()[0],'ready-for-agent, approved, ready-for-agent')
      form.submit();await vi.waitFor(()=>expect(h.command).toHaveBeenCalledOnce())
      expect(h.command.mock.calls[0]![0]).toMatchObject({type:'continuous.configure',projectId:'p1',sourceId:'s1',expectedVersion:0,assignee:'*',labels:['ready-for-agent','approved'],resource,model:options.defaults.model,agentPreset:'standard',permissionPreset:'review',enabled:true})
      await vi.waitFor(()=>expect(form.nodes('form')).toHaveLength(0))
      form.click('暂停接新工作');await vi.waitFor(()=>expect(h.command).toHaveBeenCalledTimes(2))
      expect(h.command.mock.calls[1]![0]).toMatchObject({type:'continuous.set-enabled',expectedVersion:1,enabled:false})
      expect(h.command.mock.calls.some(([value])=>value.type==='task.control')).toBe(false)
      expect(form.nodes('p').map(node=>[node.props.children].flat(Infinity).join('')).join(' ')).toContain('当前执行继续处理')
    }finally{form.unmount()}
  })
  it('renders persisted queue reasons and opens its active Issue without starting or pausing it',async()=>{
    const h=fixture();h.setRule({id:'r1',projectId:'p1',sourceId:'s1',version:3,enabled:false,scope:{assignee:'@me',labels:['ready-for-agent'],identity},resource,model:options.defaults.model,agentPreset:'standard',permissionPreset:'review',active:{projectId:'p1',taskId:'t1'},items:[{nodeId:'I1',number:1,title:'Requirement',url:'https://github.com/acme/repo/issues/1',state:'waiting',reason:'Waiting for acceptance evidence',attempts:1,ref:{projectId:'p1',taskId:'t1'}}]})
    await h.panel.load();const open=vi.spyOn(h.panel,'openTask').mockResolvedValue()
    const form=await mountWorkPanel({controller:h.panel},'ContinuousProcessing')
    try {
      await vi.waitFor(()=>expect(form.nodes('li')).toHaveLength(1))
      expect(form.nodes('p').map(node=>[node.props.children].flat(Infinity).join('')).join(' ')).toContain('Waiting for acceptance evidence')
      form.click('查看当前执行 / 暂停处理')
      expect(open).toHaveBeenCalledExactlyOnceWith({projectId:'p1',taskId:'t1'})
      expect(h.command).not.toHaveBeenCalled()
    }finally{form.unmount()}
  })
})
