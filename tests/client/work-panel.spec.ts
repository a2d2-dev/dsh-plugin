import { afterEach, describe, expect, it, vi } from 'vitest'
const getRandomValues = crypto.getRandomValues.bind(crypto)
afterEach(() => vi.unstubAllGlobals())
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { WorkClient } from '../../src/client/work-api.ts'
import type { WorkQuery, WorkTask } from '../../src/work-types.ts'

const task: WorkTask = {id:'t1',projectId:'p1',title:'保存本地工作',goal:'可离线浏览',version:1,agentId:'a1',specification:{version:1,text:'真实保存',acceptance:['刷新仍可读']},specificationHistory:[],breakdown:[],children:[],sessions:[],activity:[]}
function setup() {
  const queries: WorkQuery[] = []
  const client: WorkClient = {command: vi.fn(), query: async query => {
    queries.push(query)
    if(query.type==='projects.list') return {status:'completed',projects:[{id:'p1',name:'本地项目',version:1,defaultAgentId:'a1',resources:[]},{id:'p2',name:'另一个项目',version:1,defaultAgentId:'a2',resources:[]}]}
    if(query.type==='project.detail') return {status:'completed', tasks:query.projectId==='p1'?[task]:[]}
    if(query.type==='task.detail') return {status:'completed',task}
    if(query.type==='source.list') return {status:'completed',sources:[{id:'s1',projectId:query.projectId,provider:'github',githubProject:{owner:'acme',type:'org',number:1},enabled:true,version:1,sequence:0,requests:{},observations:[],pages:[]}]}
    return {status:'completed'}
  }}
  const navigation = {selectPanel:vi.fn(),openSession:vi.fn()}
  return {panel:new WorkPanelController(client,navigation),client,queries,navigation}
}
describe('work panel public navigation',()=>{
  it('opens the delegation tab without commands, remote refresh or execution admission',async()=>{
    const {panel,client,queries}=setup()
    await panel.load();queries.length=0
    await panel.selectSourceTab('delegation')
    expect(panel.getSnapshot().source.tab).toBe('delegation')
    expect(queries).toEqual([])
    expect(client.command).not.toHaveBeenCalled()
  })
  it('opens the queue current session with a fresh detail read and never reconciles execution',async()=>{
    const {panel,client,navigation}=setup()
    await panel.load()
    const original=client.query
    client.query=async query=>query.type==='task.detail'?{status:'completed',task,execution:{ref:{projectId:'p1',taskId:'t1'},actual:{runtimeId:'host'},session:{runtimeId:'host',sessionId:'current'}} as any}:original(query)
    await panel.openQueueSession({projectId:'p1',taskId:'t1'})
    expect(navigation.openSession).toHaveBeenCalledExactlyOnceWith('current')
    expect(client.command).not.toHaveBeenCalled()
  })
  it('keeps an uncreated queue session on the existing page without implicit recovery',async()=>{
    const {panel,client,navigation}=setup()
    await panel.load()
    const original=client.query
    client.query=async query=>query.type==='task.detail'?{status:'completed',task,execution:{ref:{projectId:'p1',taskId:'t1'},session:{runtimeId:'host',sessionId:'reserved-only'}} as any}:original(query)
    await panel.openQueueSession({projectId:'p1',taskId:'t1'})
    expect(navigation.openSession).not.toHaveBeenCalled()
    expect(panel.getSnapshot().error).toContain('当前处理会话暂不可进入')
    expect(client.command).not.toHaveBeenCalled()
  })
  it('does not open a stale queue session after switching project during its read',async()=>{
    const {panel,client,navigation}=setup()
    await panel.load()
    let release!:(result:any)=>void
    const original=client.query
    client.query=async query=>query.type==='task.detail'?new Promise(resolve=>{release=resolve}):original(query)
    const pending=panel.openQueueSession({projectId:'p1',taskId:'t1'})
    await panel.selectProject('p2')
    release({status:'completed',task,execution:{session:{runtimeId:'host',sessionId:'stale'}}});await pending
    expect(navigation.openSession).not.toHaveBeenCalled()
    expect(client.command).not.toHaveBeenCalled()
  })
  it('opens the canonical Task of a retained queue problem independently of queue ownership',async()=>{
    const {panel,client}=setup()
    await panel.load()
    const open=vi.spyOn(panel,'openTask').mockResolvedValue()
    const select=vi.spyOn(panel,'selectConnectedSource')
    await panel.openQueueItem({nodeId:'I1',number:1,title:'Retained problem',url:'https://github.com/acme/repo/issues/1',state:'blocked',attempts:1,taskRef:{projectId:'p1',taskId:'t1'},sourceId:'old-source'},'new-source')
    expect(open).toHaveBeenCalledExactlyOnceWith({projectId:'p1',taskId:'t1'})
    expect(select).not.toHaveBeenCalled()
    expect(client.command).not.toHaveBeenCalled()
  })
  it('opens queue history in the existing Task session page and returns to the same queue tab',async()=>{
    const {panel,client,navigation}=setup()
    await panel.load();await panel.selectSourceTab('delegation')
    await panel.openQueueSession({projectId:'p1',taskId:'t1'},true)
    expect(panel.getSnapshot()).toMatchObject({detail:{task:{id:'t1'}},detailTab:'sessions'})
    panel.back()
    expect(panel.getSnapshot().source.tab).toBe('delegation')
    expect(client.command).not.toHaveBeenCalled();expect(navigation.openSession).not.toHaveBeenCalled()
  })
  it('initializes the mounted panel without superseding an in-flight task return',async()=>{
    const {panel}=setup()
    const reveal=panel.revealTask({projectId:'p1',taskId:'t1'})
    await panel.initialize();await reveal
    expect(panel.getSnapshot().detail?.task?.id).toBe('t1')
    panel.setDetailTab('related')
    await panel.initialize()
    expect(panel.getSnapshot()).toMatchObject({detail:{task:{id:'t1'}},detailTab:'related'})
  })
  it('queries concrete projects and retains list position across details, clears it on project change',async()=>{
    const {panel,client,navigation,queries}=setup()
    await panel.load()
    panel.setSearch('保存'); panel.setView('associated')
    await panel.openTask({projectId:'p1',taskId:'t1'})
    panel.back()
    expect(panel.getSnapshot()).toMatchObject({projectId:'p1',search:'保存',view:'associated',detail:null})
    await panel.selectProject('p2')
    expect(panel.getSnapshot()).toMatchObject({projectId:'p2',search:'',view:'all',detail:null,tasks:[]})
    expect(queries).toContainEqual({type:'project.detail',projectId:'p2'})
    expect(client.command).not.toHaveBeenCalled()
    expect(navigation.openSession).not.toHaveBeenCalled()
    panel.close()
    expect(navigation.selectPanel).toHaveBeenLastCalledWith(null)
  })
  it('does not reveal an earlier task when its project query resolves after a newer project selection',async()=>{
    const {panel,client}=setup()
    let release!:()=>void
    const oldQuery=client.query
    client.query=async query=>{
      if(query.type==='project.detail' && query.projectId==='p1') await new Promise<void>(resolve=>{release=resolve})
      return oldQuery(query)
    }
    const earlier=panel.openTask({projectId:'p1',taskId:'t1'})
    await panel.selectProject('p2')
    release(); await earlier
    expect(panel.getSnapshot()).toMatchObject({projectId:'p2',detail:null,tasks:[]})
  })
  it('does not revive a superseded task intent after switching away and back to its project',async()=>{
    const {panel,client}=setup()
    let release!:()=>void, delayed=false
    const oldQuery=client.query
    client.query=async query=>{
      if(query.type==='project.detail' && query.projectId==='p1' && !delayed){delayed=true;await new Promise<void>(resolve=>{release=resolve})}
      return oldQuery(query)
    }
    const earlier=panel.openTask({projectId:'p1',taskId:'t1'})
    await panel.selectProject('p2'); await panel.selectProject('p1')
    release(); await earlier
    expect(panel.getSnapshot()).toMatchObject({projectId:'p1',detail:null})
  })
  it('keeps the user-selected detail tab when a refresh resolves',async()=>{
    const {panel,client}=setup()
    await panel.openTask({projectId:'p1',taskId:'t1'});panel.setDetailTab('related')
    let release!:()=>void
    const oldQuery=client.query
    client.query=async query=>{await new Promise<void>(resolve=>{release=resolve});return oldQuery(query)}
    const refresh=panel.refreshTask()
    panel.setDetailTab('sessions');release();await refresh
    expect(panel.getSnapshot().detailTab).toBe('sessions')
  })
  it('filters saved content by local association view and search together',async()=>{
    const {panel,client}=setup()
    client.query=async query=>query.type==='projects.list'?{status:'completed',projects:[{id:'p1',name:'本地项目',version:1,defaultAgentId:'a1',resources:[]}]}:{status:'completed',tasks:[task,{...task,id:'t2',title:'评审记录',sessions:[{session:{runtimeId:'host-A',sessionId:'native'},purpose:'review'}]}]}
    await panel.load();await panel.selectProject('p1')
    panel.setView('associated'); expect(panel.visibleTasks().map(item=>item.title)).toEqual(['评审记录'])
    panel.setSearch('保存本地工作'); expect(panel.visibleTasks()).toEqual([])
    panel.setView('unassociated'); expect(panel.visibleTasks().map(item=>item.id)).toEqual(['t1'])
  })
  it('submits UUID v4 commands with HTTP Crypto and reuses identity after an unknown network result',async()=>{
    vi.stubGlobal('crypto', { getRandomValues })
    expect(crypto.randomUUID).toBeUndefined()
    const {panel,client}=setup()
    const command=vi.mocked(client.command)
    command.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue({status:'completed'})
    const intent={type:'source.connect' as const,githubProject:{owner:'acme',type:'org' as const,number:1}}
    await expect(panel.submit(intent)).rejects.toThrow('connection lost')
    await panel.submit(intent)
    const first=command.mock.calls[0]![0]
    expect(first.commandId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(command.mock.calls[1]![0]).toEqual(first)
    await panel.submit(intent)
    expect(command.mock.calls[2]![0].commandId).not.toBe(first.commandId)
  })
  it('retries an uncertain spec save with the same command identity and backend version',async()=>{
    const {panel,client}=setup()
    const command = vi.mocked(client.command)
    command.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce({status:'completed',task})
    const save = {type:'task.update-spec' as const,ref:{projectId:'p1',taskId:'t1'},expectedVersion:1,goal:'修订目标',specification:'修订规格',acceptance:['保存成功']}
    await expect(panel.submit(save)).rejects.toThrow('connection lost')
    await panel.submit(save)
    expect(command.mock.calls[0]?.[0]).toEqual(command.mock.calls[1]?.[0])
    expect(command.mock.calls[1]?.[0]).toMatchObject({...save,commandId:expect.any(String)})
  })
  it('opens an existing associated native session through host navigation and returns to the exact task',async()=>{
    const {panel,navigation}=setup()
    await panel.load()
    await panel.openTask({projectId:'p1',taskId:'t1'})
    panel.openSession({runtimeId:'host-A',sessionId:'native-existing'})
    expect(navigation.openSession).toHaveBeenCalledExactlyOnceWith('native-existing')
    await panel.revealTask({projectId:'p1',taskId:'t1'})
    expect(navigation.selectPanel).toHaveBeenLastCalledWith('a2d2-panel')
    expect(panel.getSnapshot().detail?.task?.title).toBe('保存本地工作')
    expect(panel.getSnapshot().detailTab).toBe('overview')
  })

  it('loads the target project sources before selecting a connected source from another project', async () => {
    const source = (id: string, projectId: string, extra: Record<string, unknown>) => ({ id, projectId, provider: 'github' as const, enabled: true, version: 1, sequence: 0, requests: {}, observations: [], pages: [], ...extra })
    const sources: Record<string, unknown[]> = {
      p1: [source('s1', 'p1', { repository: { owner: 'acme', repository: 'app' } })],
      p2: [source('s2', 'p2', { githubProject: { owner: 'acme', type: 'org', number: 1 } })],
    }
    const client: WorkClient = { command: vi.fn(), query: async query => {
      if (query.type === 'projects.list') return { status: 'completed', projects: [{ id: 'p1', name: 'one', version: 1, defaultAgentId: 'a1', resources: [] }, { id: 'p2', name: 'two', version: 1, defaultAgentId: 'a2', resources: [] }] }
      if (query.type === 'project.detail') return { status: 'completed', tasks: [] }
      if (query.type === 'source.list') return { status: 'completed', sources: (sources[query.projectId ?? ''] ?? []) as never }
      return { status: 'completed' }
    } }
    const panel = new WorkPanelController(client, { selectPanel: vi.fn(), openSession: vi.fn() })
    await panel.load()
    await panel.selectConnectedSource('p2', 's2')
    expect(panel.getSnapshot()).toMatchObject({ projectId: 'p2', source: { sourceId: 's2', sources: [{ id: 's2' }] } })
    expect(panel.getSnapshot().detail).toBeNull()
    panel.close()
  })
})
