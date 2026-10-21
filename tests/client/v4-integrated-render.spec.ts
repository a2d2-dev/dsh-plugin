import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { WorkPanel } from '../../src/client/work-panel.tsx'
import { WorkPanelController } from '../../src/client/work-panel-controller.ts'
import type { WorkCompleted } from '../../src/work-types.ts'

it('wires authoritative execution, continuation and completion into one Issue workbench', async () => {
  const ref = { projectId: 'p', taskId: 't' }, session = { runtimeId: 'r', sessionId: 'current' }
  const detail: WorkCompleted = { status: 'completed', task: { id: 't', projectId: 'p', title: 'One issue title', goal: 'goal', version: 1, agentId: 'a', specification: { version: 1, text: 'scope', acceptance: [] }, specificationHistory: [], breakdown: [], children: [], sessions: [], activity: [], completion: { operationId: 'op', commandId: 'done', specificationVersion: 1, executionId: 'e', owner: 'owner', epoch: 3, completedAt: '2026-01-01T00:00:00Z', closeout: { status: 'pending' } } }, executionGraph: { ref, executionId: 'e', owner: { id: 'owner', epoch: 3, agentId: 'a' }, currentSession: session, childTasks: [], sessions: [], events: [], history: [], settlement: 'unknown', blockers: [], limitations: ['观察未知'] } }
  const controller = new WorkPanelController({ command: async () => { throw Error('Unexpected write') }, query: async q => q.type === 'task.detail' ? detail : { status: 'completed', sources: [] } }, { selectPanel: () => {}, openSession: () => {} })
  await controller.openTask(ref)
  let html = renderToStaticMarkup(createElement(WorkPanel, { controller }))
  expect(html).toContain('本地已验收')
  expect(html).toContain('执行收口待处理')
  expect(html.match(/<h1/g)).toHaveLength(1)
  expect(html).toContain('会话与执行')
  controller.setDetailTab('sessions')
  html = renderToStaticMarkup(createElement(WorkPanel, { controller }))
  expect(html).toContain('协调负责人：owner')
  controller.setDetailTab('continuation')
  html = renderToStaticMarkup(createElement(WorkPanel, { controller }))
  expect(html).toContain('提前接续目标')
  expect(html).toContain('相关执行结算未知')
})
