import { expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { WorkPanelController } from '../src/client/work-panel-controller.ts'
import { WorkClientError, type WorkClient } from '../src/client/work-api.ts'
import type { WorkResult } from '../src/work-types.ts'

it('starts through the panel and real execution application, preserves one Session and model request across return', async ({ signal }) => {
  const fixtures = new ExecutionFixtures(signal)
  try {
    const h = await fixtures.mount(await fixtures.root(), 'read-only')
    const completed = (result: WorkResult) => { if (result.status !== 'completed') throw new WorkClientError(result); return result }
    // The public application boundary is real; only the UI transport and model output are controlled.
    const client: WorkClient = {
      query: async query => completed(await h.app.query(query, { operator: true })),
      command: async command => completed(await h.app.execute(command, { operator: true })),
    }
    const navigation = { selectPanel: vi.fn(), openSession: vi.fn() }
    const panel = new WorkPanelController(client, navigation)
    const resources = await client.query({ type: 'resources.list' })
    const project = (await panel.submit({ type: 'project.create', name: '面板真实启动', resource: resources.resources![0]!.ref })).project!
    const task = (await panel.submit({ type: 'task.create', projectId: project.id, title: '真实执行', goal: '点击后只执行一次', specification: '从面板接入真实宿主', acceptance: ['同一会话回访不增加模型调用'] })).task!
    const ref = { projectId: project.id, taskId: task.id }
    await panel.load(); await panel.openTask(ref); await panel.prepareStart()
    expect(panel.getSnapshot().startup.options?.models).toHaveLength(2)
    await Promise.all([panel.startPrepared(), panel.startPrepared()])
    const execution = panel.getSnapshot().detail?.execution
    expect(execution).toMatchObject({ state: 'ready', actual: { cwd: h.workspace.path, permissionPreset: 'read-only' } })
    expect(panel.getSnapshot().startup.error).toBeNull()
    expect(panel.getSnapshot().detail?.task?.version).toBe(2)
    expect(navigation.openSession).toHaveBeenCalledExactlyOnceWith(execution!.session.sessionId)
    await fixtures.run(() => h.ctx.agents.get(SessionId(execution!.session.sessionId))!.whenIdle())
    expect(h.model.requests).toHaveLength(1)
    const returned = new WorkPanelController(client, navigation)
    await returned.openTask(ref); await returned.prepareStart()
    expect(returned.getSnapshot().detail?.execution?.id).toBe(execution!.id)
    expect(await fixtures.run(() => h.ctx.sessionPersistence.list())).toHaveLength(1)
    expect(h.model.requests).toHaveLength(1)
  } finally { await fixtures.close() }
})
