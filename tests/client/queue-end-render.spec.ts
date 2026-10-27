import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ContinuousDelegation } from '../../src/client/continuous-delegation.tsx'
import type { ContinuousWorkRule } from '../../src/work-types.ts'
import type { WorkClient } from '../../src/client/work-api.ts'
import type { WorkPanelController } from '../../src/client/work-panel-controller.ts'

it('presents explicit end and retry alongside retained history without implying business acceptance', () => {
  const item = { nodeId: 'one', title: '等待业务负责者', number: 1, url: 'https://github.com/acme/repo/issues/1', attempts: 0 }
  const rule = { id: 'rule', projectId: 'project', sourceId: 'source', version: 1, enabled: false, resource: { runtimeId: 'host', workspaceId: 'workspace' }, model: { provider: 'provider', model: 'model' }, agentPreset: 'agent', permissionPreset: 'safe', scope: { assignee: '*', labels: [] }, queue: { concurrency: 1, refreshMinutes: 5, order: 'oldest' }, items: [
    { ...item, state: 'paused' },
    { ...item, nodeId: 'two', number: 2, state: 'active', end: { commandId: 'end', status: 'accepted' }, reason: '停止仍在进行，请重试结束' },
    { ...item, nodeId: 'three', number: 3, state: 'completed', ref: { projectId: 'project', taskId: 'task' }, executionId: 'execution', end: { commandId: 'end-history', status: 'applied' }, reason: '队列已结束，业务验收未确认' },
  ] } as ContinuousWorkRule
  const html = renderToStaticMarkup(createElement(ContinuousDelegation, { client: {} as WorkClient, projectId: 'project', sourceId: 'source', projectTitle: '项目', sourceTitle: '项目', rule, navigation: {} as WorkPanelController, onConfigure() {} }))
  for (const text of ['结束处理', '重试结束', '正在结束', '会话记录', '业务验收未确认', '历史']) expect(html).toContain(text)
  expect(html).not.toContain('已验收')
  expect(html.match(/>结束处理<\/button>/g)).toHaveLength(1)
  expect(html.match(/>重试结束<\/button>/g)).toHaveLength(1)
})
