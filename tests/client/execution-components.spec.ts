/// <reference types="node" />
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import styles from '../../src/client/execution-components.module.css'
import { ExecutionSessions, ExecutionContinuation } from '../../src/client/execution-components.tsx'
import type { ExecutionGraph } from '../../src/work-execution/observation.ts'
import type { WorkExecution } from '../../src/work-types.ts'

it('keeps the prepare action visible but disabled with Task completion facts, even with a handler', () => {
  const execution: WorkExecution = { id: 'e', ref: { projectId: 'p', taskId: 't' }, owner: 'owner', epoch: 1, agentId: 'agent', resource: { runtimeId: 'runtime', workspaceId: 'ws' }, session: { runtimeId: 'runtime', sessionId: 'current' }, sessionMode: 'create', agentPreset: 'standard', model: { provider: 'test', model: 'test' }, permissionPreset: 'read-only', policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] }, state: 'ready', history: [], events: [], actual: { runtimeId: 'runtime', cwd: '/workspace', agentPreset: 'standard', provider: 'test', model: 'test', permissionPreset: 'read-only', sandbox: 'none', approval: 'never' } }
  for (const onContinue of [undefined, () => {}]) {
    const html = renderToStaticMarkup(createElement(ExecutionContinuation, { execution, completed: true, onContinue }))
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>准备接续<\/button>/)
    expect(html).toContain('任务阶段：done（已验收完成）')
    expect(html).toContain('任务已验收完成，不能继续接续')
  }
})

it('shows an undelivered takeover as a delivery failure with a retry action', () => {
  const ref = { projectId: 'p', taskId: 't' }
  const source = { runtimeId: 'runtime', sessionId: 'source' }
  const successor = { ...source, sessionId: 'successor' }
  const execution: WorkExecution = { id: 'e', ref, owner: 'owner', epoch: 2, agentId: 'agent', resource: { runtimeId: 'runtime', workspaceId: 'ws' }, session: successor, sessionMode: 'create', agentPreset: 'standard', model: { provider: 'test', model: 'test' }, permissionPreset: 'read-only', policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] }, state: 'ready', history: [], events: [], continuation: { operationId: 'op', commandId: 'cmd', automatic: false, phase: 'taken', source, successor, sourceEpoch: 1, materialRequestId: 'material', kickoffId: 'kickoff', goal: 'Continue', specification: { version: 1, text: 'Keep decisions', acceptance: ['Delivered'] }, title: 'Task', history: { ref, session: source }, error: { code: 'delivery-failed', message: 'Host temporarily unavailable' } } }
  const html = renderToStaticMarkup(createElement(ExecutionContinuation, { execution, onContinue: () => {} }))
  expect(html).toContain('交接内容尚未确认送达')
  expect(html).toContain('接续尚未完成')
  expect(html).toContain('重试内容投递')
  expect(html).toContain('Host temporarily unavailable')
  expect(html).not.toContain('接续内容已投递')
})

it('renders independent child entry, real job owner and distinct delivery/consumption with visible continuation parameters', async () => {
  const session = { runtimeId: 'runtime', sessionId: 'current' }
  const graph: ExecutionGraph = { settlement: 'pending', ref: { projectId: 'p', taskId: 't' }, executionId: 'execution', owner: { id: 'owner', epoch: 2, agentId: 'agent' }, currentSession: session, childTasks: [{ ref: { projectId: 'p', taskId: 'child' }, title: 'Independent issue', agentId: 'child-agent', owner: 'child-owner', currentSession: { ...session, sessionId: 'child-current' } }], sessions: [{ session, role: 'current', status: 'idle', children: [], jobs: [{ id: 'bash-1', owner: session, label: 'checks', kind: 'bash', status: 'completed', delivery: 'delivered', result: 'unknown', acceptance: 'unassessed', persistence: 'process-local' }] }], events: [], history: [], blockers: [], reminders: ['作业 bash-641 的注册表实例已不可达，只提醒不阻断完成。'], limitations: [] }
  const html = renderToStaticMarkup(createElement(ExecutionSessions, { graph, onOpenTask: () => {}, onOpenSession: () => {} }))
  for (const text of ['会话与执行', 'Independent issue', 'child-owner', 'current', '输出已交付', '消费未知', '未验收']) expect(html).toContain(text)
  // Evidence stays reachable but folded: counts on the summary, details on demand.
  for (const text of ['独立子 Issue / Task · 1', '后台作业 · 1']) expect(html).toContain(text)
  expect(html).toContain('注册表实例已不可达')
  expect(html).not.toContain('标记已消费')
  const stableJob = { ...graph.sessions[0]!.jobs[0]!, registryEpoch: 'registry', instanceId: 'instance' }
  for (const persistence of ['process-local', 'session-journal'] as const) {
    const persisted = renderToStaticMarkup(createElement(ExecutionSessions, { graph: { ...graph, sessions: [{ ...graph.sessions[0]!, jobs: [{ ...stableJob, persistence }] }] } }))
    expect(persisted.match(/持久生命周期记录/g) ?? []).toHaveLength(persistence === 'session-journal' ? 1 : 0)
    expect(persisted).toContain(persistence === 'session-journal' ? '持久生命周期记录' : '宿主进程内作业')
  }
  const continuation = renderToStaticMarkup(createElement(ExecutionContinuation, { graph, policy: { version: 1, enabled: true, targetTokens: 200000, reserveTokens: 12000 } }))
  expect(continuation).toContain('200,000')
  expect(continuation).toContain('12,000')
  expect(continuation).toContain('等待相关执行结算')
  expect(continuation).not.toContain('dialog')
  if (process.env.A2D2_EXECUTION_ARTIFACTS === '1') {
    const directory = resolve('.artifacts/v4-execution')
    await mkdir(directory, { recursive: true })
    let css = await readFile(new URL('../../src/client/execution-components.module.css', import.meta.url), 'utf8')
    const classNames = new Set([...css.matchAll(/\.([a-z][\w-]*)/g)].map(match => match[1]!))
    for (const name of classNames) css = css.replace(new RegExp(`\\.${name}\\b`, 'g'), `.${styles[name as keyof typeof styles]}`)
    await writeFile(resolve(directory, 'component-contract.html'), `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>#138 公开组件合同</title><style>body{margin:0;background:#141820;color:#e3e7ef;font:14px system-ui}main{max-width:980px;margin:auto;padding:24px}h1{font-size:20px}aside{padding:12px;background:#303747;border-radius:8px}main>section{margin-top:16px}${css}</style><main><h1>#138 公开组件合同验证</h1><aside>此页为合同测试夹具，非运行实例数据。复用实际产品组件与样式；最终宿主整合与原生聊天交互由 #141 在既有实例验收。</aside>${html}${continuation}</main></html>`)
  }
})
