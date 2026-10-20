import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import { createWorkHandler } from '../src/work-route.ts'
import { createWorkClient } from '../src/client/work-api.ts'
import { WorkPanelController } from '../src/client/work-panel-controller.ts'

/** Real HTTP + production application + disk; only the host read port and operator are controlled. */
describe('client to production work HTTP integration',()=>{
  it('saves local work, child/spec/breakdown and session associations, reloads through the same client boundary',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'a2d2-work-client-'))
    const runtimeId=randomUUID(),workspaceId=randomUUID(),sessionId=randomUUID()
    const resource={ref:{runtimeId,workspaceId},title:'已有本地资源'}
    const host={resources:async()=>[resource],sessions:async()=>[{ref:{runtimeId,sessionId},resource:resource.ref,title:'已有原生会话'}]}
    let handler=createWorkHandler(new WorkApplication(directory,host),()=>undefined)
    const server=createServer((request,response)=>{void handler(request,response)})
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const address=server.address()
    if(!address || typeof address==='string') throw Error('Expected isolated TCP port')
    const base=`http://127.0.0.1:${address.port}`
    const client=createWorkClient((url,init)=>fetch(new URL(String(url),base),init))
    try {
      const panel=new WorkPanelController(client,{selectPanel:vi.fn(),openSession:vi.fn()})
      const project=(await panel.submit({type:'project.create',name:'离线项目',resource:resource.ref})).project!
      const task=(await panel.submit({type:'task.create',projectId:project.id,title:'无Issue本地工作',goal:'保存完整材料',specification:'第一版规格',acceptance:['可重载']})).task!
      const ref={projectId:project.id,taskId:task.id}
      const updated=(await panel.submit({type:'task.update-spec',ref,expectedVersion:1,goal:'保留修订目标',specification:'第二版规格',acceptance:['刷新保留修订','不要求GitHub']})).task!
      const broken=(await panel.submit({type:'task.replace-breakdown',ref,expectedVersion:updated.version,blocks:[{id:randomUUID(),title:'数据保存',description:'从真实记录回读'}]})).task!
      const child=(await panel.submit({type:'task.create-child',ref,expectedVersion:broken.version,title:'本地子工作',goal:'独立验收',specification:'子工作规格',acceptance:['父子均可读']})).task!
      let detail=await client.query({type:'task.detail',ref})
      const candidates=await client.query({type:'session.candidates',projectId:project.id})
      expect(candidates.candidates?.map(item=>item.title)).toEqual(['已有原生会话'])
      await panel.submit({type:'task.associate-session',ref,expectedVersion:detail.task!.version,session:{runtimeId,sessionId},purpose:'related'})
      detail=await client.query({type:'task.detail',ref})
      await panel.submit({type:'task.associate-session',ref,expectedVersion:detail.task!.version,session:{runtimeId,sessionId},purpose:'related'})
      handler=createWorkHandler(new WorkApplication(directory,host),()=>undefined)
      const querySpy=vi.spyOn(client,'query')
      const reloaded=new WorkPanelController(client,{selectPanel:vi.fn(),openSession:vi.fn()})
      await reloaded.initialize();await reloaded.openTask(ref)
      const saved=reloaded.getSnapshot().detail!
      expect(saved.task).toMatchObject({id:task.id,goal:'保留修订目标',specification:{version:2,text:'第二版规格',acceptance:['刷新保留修订','不要求GitHub']},breakdown:[{title:'数据保存',description:'从真实记录回读'}],sessions:[{session:{runtimeId,sessionId},purpose:'related'}]})
      expect(querySpy).toHaveBeenCalledWith({type:'task.execution',ref},expect.any(AbortSignal))
      expect(reloaded.getSnapshot()).toMatchObject({execution:null,executionError:null})
      expect(saved.children?.map(item=>item.id)).toEqual([child.id])
      expect((await client.query({type:'session.work',session:{runtimeId,sessionId}})).work).toEqual([{ref,title:'无Issue本地工作',projectName:'离线项目',purpose:'related'}])
      expect((await client.query({type:'session.work',session:{runtimeId,sessionId:randomUUID()}})).work).toEqual([])
    } finally {
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
      if(!directory.startsWith(join(tmpdir(),'a2d2-work-client-'))) throw Error('Unexpected cleanup directory')
      await rm(directory,{recursive:true,force:true})
    }
  })
})
