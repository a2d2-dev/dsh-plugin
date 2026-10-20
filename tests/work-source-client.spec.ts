import { createServer } from 'node:http'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import { createWorkHandler } from '../src/work-route.ts'
import { createWorkClient } from '../src/client/work-api.ts'
import { WorkPanelController } from '../src/client/work-panel-controller.ts'
import type { GitHubIssue, GitHubSourcePort } from '../src/work-sources/types.ts'

/** Real TCP HTTP, application transactions and disk. Only external GitHub/host read ports use fixed responses. */
describe('source UI controller to production HTTP and disk',()=>{
  it('links existing work and Session without overwriting it, observes remote changes and retains accepted content offline',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'a2d2-source-client-'))
    const expectedDirectory=resolve(directory)
    const identity={login:'imneov',nodeId:'U1',name:'LiuFeng'}
    const repository={owner:'a2d2-dev',repository:'dsh-plugin'}
    let remote:GitHubIssue={nodeId:'I112',url:'https://github.com/a2d2-dev/dsh-plugin/issues/112',number:112,title:'Fixed external response',body:'Original remote body\n  preserved',repository,assignees:['imneov'],labels:['ready-for-agent'],state:'open',updatedAt:'2026-10-20T00:00:00Z',observedAt:'2026-10-20T00:01:00Z'}
    const github:GitHubSourcePort={list:async()=>({identity,items:[remote],observedAt:remote.observedAt}),detail:async()=>({identity,issue:remote})}
    const resource={ref:{runtimeId:'host-source',workspaceId:'workspace-source'},title:'Existing workspace'}
    const session={runtimeId:'host-source',sessionId:'existing-session'}
    const host={resources:async()=>[resource],sessions:async()=>[{ref:session,resource:resource.ref,title:'Existing Session'}]}
    let handler=createWorkHandler(new WorkApplication(directory,host,github),()=>undefined)
    const server=createServer((request,response)=>{void handler(request,response)})
    await new Promise<void>(done=>server.listen(0,'127.0.0.1',done))
    const address=server.address()
    if(!address||typeof address==='string')throw Error('Expected isolated test port')
    const base=`http://127.0.0.1:${address.port}`
    const client=createWorkClient((url,init)=>fetch(new URL(String(url),base),init))
    const navigation={selectPanel:vi.fn(),openSession:vi.fn()}
    try {
      const panel=new WorkPanelController(client,navigation)
      const project=(await panel.submit({type:'project.create',name:'HTTP source integration',resource:resource.ref})).project!
      const local=(await panel.submit({type:'task.create',projectId:project.id,title:'Existing local Task',goal:'Keep local goal',specification:'Keep local specification',acceptance:['Keep confirmed criterion']})).task!
      const ref={projectId:project.id,taskId:local.id}
      const associated=(await panel.submit({type:'task.associate-session',ref,expectedVersion:local.version,session,purpose:'related'})).task!
      await panel.initialize();await panel.configureSource(repository.owner,repository.repository)
      await panel.openIssue(112)
      expect((await client.query({type:'project.detail',projectId:project.id})).tasks).toHaveLength(1)
      expect(panel.getSnapshot().source).toMatchObject({issue:{body:'Original remote body\n  preserved'},listing:{identity:{login:'imneov'}}})
      await panel.acceptIssue(associated)
      expect(panel.getSnapshot().detail).toMatchObject({task:{id:local.id,goal:'Keep local goal',specification:{text:'Keep local specification',acceptance:['Keep confirmed criterion']},sessions:[{session,purpose:'related'}]},bindings:[{accepted:{body:'Original remote body\n  preserved'}}]})
      panel.setDetailTab('sessions');panel.openSession(session)
      expect(navigation.openSession).toHaveBeenCalledExactlyOnceWith('existing-session')
      await panel.revealTask(ref)
      expect(panel.getSnapshot().detail?.task?.id).toBe(local.id)
      panel.back()
      remote={...remote,title:'Remote changed',body:'Remote changed body',state:'closed',assignees:['another-user'],updatedAt:'2026-10-21T00:00:00Z',observedAt:'2026-10-21T00:01:00Z'}
      await panel.openIssue(112)
      await panel.openTask(ref)
      expect(panel.getSnapshot().detail).toMatchObject({task:{id:local.id,goal:'Keep local goal',sessions:[{session}]},bindings:[{accepted:{state:'open',body:'Original remote body\n  preserved'},lastObserved:{state:'closed',body:'Remote changed body',assignees:['another-user']}}]})
      panel.back();await panel.setSourceEnabled(false)
      expect(panel.getSnapshot().source).toMatchObject({sources:[{enabled:false}],issue:{state:'closed'}})
      // Restart the actual application without any GitHub port: local accepted work is still available.
      handler=createWorkHandler(new WorkApplication(directory,host),()=>undefined)
      const offline=new WorkPanelController(client,navigation)
      await offline.initialize();await offline.openTask(ref)
      expect(offline.getSnapshot().detail).toMatchObject({task:{id:local.id,specification:{text:'Keep local specification'},sessions:[{session}]},bindings:[{accepted:{body:'Original remote body\n  preserved'},lastObserved:{body:'Remote changed body'}}]})
      offline.back();await offline.showSources();await offline.openIssue(112,false)
      expect(offline.getSnapshot().source).toMatchObject({cached:true,issue:{body:'Remote changed body'},sources:[{enabled:false}]})
      expect((await client.query({type:'project.detail',projectId:project.id})).tasks).toHaveLength(1)
      expect((await client.query({type:'session.work',session})).work).toEqual([{ref,title:'Existing local Task',projectName:'HTTP source integration',purpose:'related'}])
    } finally {
      await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()))
      expect(await realpath(directory)).toBe(expectedDirectory)
      expect(directory.startsWith(join(tmpdir(),'a2d2-source-client-'))).toBe(true)
      await rm(directory,{recursive:true,force:true})
    }
  })
})
