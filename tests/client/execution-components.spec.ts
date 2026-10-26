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

it('renders verified collection, settlement, profile, Goal activation and read proof without inferring receipt', async () => {
  const ref = { projectId: 'p', taskId: 't' }, source = { runtimeId: 'runtime', sessionId: 'source' }, successor = { ...source, sessionId: 'fixed-successor' }
  const execution: WorkExecution = { id: 'e', ref, owner: 'owner', epoch: 2, agentId: 'agent', resource: { runtimeId: 'runtime', workspaceId: 'ws' }, session: successor, sessionMode: 'create', agentPreset: 'standard', model: { provider: 'test', model: 'test' }, permissionPreset: 'read-only', policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] }, state: 'waiting', history: [], events: [], continuation: { protocolVersion: 1, operationId: 'fixed-operation', commandId: 'cmd', automatic: false, phase: 'delivered', source, successor, sourceEpoch: 1, materialRequestId: 'refresh-request', kickoffId: 'kickoff', goal: 'Continue', specification: { version: 1, text: 'Scope', acceptance: ['Accepted'] }, title: 'Long task title', history: { ref, session: source }, collections: [{ session: source, jobs: [{ id: 'bash-pending' }], requestId: 'collect-request', delivery: 'consumed', status: 'requested' }], settlements: [{ parent: source, child: { ...source, sessionId: 'native-child' }, endSeq: 42, messageId: 'notice', delivery: 'delivered' }], goalActivation: { status: 'disarmed', goalId: 'old-goal', revision: 4, phase: 'active' }, profile: { runtimeId: 'runtime', cwd: '/workspace', agentPreset: 'standard', provider: 'codex', model: 'gpt-6.1-sol', permissionPreset: 'read-only', sandbox: 'none', approval: 'never' } } }
  const html = renderToStaticMarkup(createElement(ExecutionContinuation, { execution }))
  for (const text of ['会话运行', 'Task 控制', '协调归属', 'fixed-operation', 'bash-pending', '补收未确认', 'native-child', '结算通知已投递', '旧 Goal activation 已停用', 'old-goal', '持久 phase：active', 'gpt-6.1-sol', '材料可读尚未确认', 'refresh-request', '插件持续负责接续流程']) expect(html).toContain(text)
  expect(html).not.toContain('原段仍负责')
  expect(html).not.toContain('后继已确认材料可读')
  if (process.env.A2D2_LIFECYCLE_ARTIFACTS === '1') {
    const directory = resolve('docs/artifacts/issue-270-2026-10-26')
    await mkdir(directory, { recursive: true })
    let css = await readFile(new URL('../../src/client/execution-components.module.css', import.meta.url), 'utf8')
    for (const name of new Set([...css.matchAll(/\.([a-z][\w-]*)/g)].map(match => match[1]!))) css = css.replace(new RegExp(`\\.${name}\\b`, 'g'), `.${styles[name as keyof typeof styles]}`)
    await writeFile(resolve(directory, 'operation-facts.html'), `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>#275 步骤事实合同</title><style>body{margin:0;background:Canvas;color:CanvasText;color-scheme:light dark;font:14px system-ui}main{max-width:1000px;margin:auto}header{padding:16px}${css}</style><main><header><h1>#275 步骤事实合同渲染</h1><p>合成合同夹具，真实生产组件与样式。3080 实例未更新；不代表部署或 Task 接任。</p></header>${html}</main></html>`)
  }
  execution.continuation!.phase = 'received'
  execution.continuation!.readable = { callId: 'read-call', materialCommandId: 'material-command' }
  const received = renderToStaticMarkup(createElement(ExecutionContinuation, { execution }))
  expect(received).toContain('后继已确认材料可读')
  expect(received).toContain('read-call')
  delete execution.continuation!.protocolVersion
  execution.continuation!.phase = 'delivered'
  delete execution.continuation!.readable
  expect(renderToStaticMarkup(createElement(ExecutionContinuation, { execution }))).toContain('历史协议：已投递，无读取凭据')
})

it('locates an unconfirmed collection at its real step and exact owner rather than the reserved phase', () => {
  const source = { runtimeId: 'runtime', sessionId: 'source' }, collector = { ...source, sessionId: 'exact-owner' }
  const execution: WorkExecution = { id: 'e', ref: { projectId: 'p', taskId: 't' }, owner: 'owner', epoch: 1, agentId: 'agent', resource: { runtimeId: 'runtime', workspaceId: 'ws' }, session: source, sessionMode: 'create', agentPreset: 'standard', model: { provider: 'test', model: 'test' }, permissionPreset: 'read-only', policy: { version: 1, modelCandidates: [], instructions: '', capabilities: [] }, state: 'paused', history: [], events: [], continuation: { operationId: 'same-operation', commandId: 'cmd', automatic: false, phase: 'reserved', source, successor: { ...source, sessionId: 'same-successor' }, sourceEpoch: 1, materialRequestId: 'material', kickoffId: 'kickoff', goal: 'Keep scope', specification: { version: 1, text: 'Scope', acceptance: ['accepted'] }, title: 'Task', history: { ref: { projectId: 'p', taskId: 't' }, session: source }, collections: [{ session: collector, jobs: [{ id: 'job-1' }, { id: 'job-2' }], requestId: 'collect', delivery: 'consumed', status: 'requested' }], error: { code: 'continuation-collection-unconfirmed', message: 'Owner exact-owner consumed the collection request without formal output delivery' } } }
  const html = renderToStaticMarkup(createElement(ExecutionContinuation, { execution, onContinue: () => {} }))
  for (const term of ['失败步骤：结果补收', '执行者：runtime / exact-owner', '正式 job_output', '同一操作与后继', 'same-operation', 'same-successor']) expect(html).toContain(term)
  expect(html).not.toContain('当前步骤：准备接续')
  expect(html).toContain('补收未确认')
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
