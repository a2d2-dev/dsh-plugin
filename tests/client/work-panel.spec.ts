import { describe, expect, it, vi } from 'vitest'
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
    return {status:'completed'}
  }}
  const navigation = {selectPanel:vi.fn(),openSession:vi.fn()}
  return {panel:new WorkPanelController(client,navigation),client,queries,navigation}
}
describe('work panel public navigation',()=>{
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
})
