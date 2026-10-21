/// <reference types="node" />
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import styles from '../../src/client/execution-components.module.css'
import { ExecutionSessions, ExecutionContinuation } from '../../src/client/execution-components.tsx'
import type { ExecutionGraph } from '../../src/work-execution/observation.ts'

it('renders independent child entry, real job owner and distinct delivery/consumption with visible continuation parameters', async () => {
  const session = { runtimeId: 'runtime', sessionId: 'current' }
  const graph: ExecutionGraph = { settlement: 'pending', ref: { projectId: 'p', taskId: 't' }, executionId: 'execution', owner: { id: 'owner', epoch: 2, agentId: 'agent' }, currentSession: session, childTasks: [{ ref: { projectId: 'p', taskId: 'child' }, title: 'Independent issue', agentId: 'child-agent', owner: 'child-owner', currentSession: { ...session, sessionId: 'child-current' } }], sessions: [{ session, role: 'current', status: 'idle', children: [], jobs: [{ id: 'bash-1', owner: session, label: 'checks', kind: 'bash', status: 'completed', delivery: 'delivered', result: 'unknown', acceptance: 'unassessed', persistence: 'process-local' }] }], events: [], history: [], blockers: [], limitations: [] }
  const html = renderToStaticMarkup(createElement(ExecutionSessions, { graph, onOpenTask: () => {}, onOpenSession: () => {} }))
  for (const text of ['会话与执行', 'Independent issue', 'child-owner', 'current', '输出已交付', '消费未知', '未验收']) expect(html).toContain(text)
  expect(html).not.toContain('标记已消费')
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
