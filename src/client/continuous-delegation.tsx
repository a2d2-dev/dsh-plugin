import { SCREENING_PENDING } from '../work-screening.ts'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { ContinuousWorkItem, ContinuousWorkRule } from '../work-types.ts'
import type { WorkClient } from './work-api.ts'
import type { WorkPanelController } from './work-panel-controller.ts'
import { ContinuousDelegationController } from './continuous-controller.ts'
import { PanelIcon } from './icons.tsx'
import panelStyles from './work-panel.module.css'
import styles from './continuous-delegation.module.css'

export interface ContinuousDelegationProps {
  client: WorkClient
  projectId: string
  sourceId: string
  projectTitle: string
  sourceTitle: string
  rule?: ContinuousWorkRule
  onRuleChanged?: (rule: ContinuousWorkRule) => void
  navigation: WorkPanelController
  onConfigure: () => void
  configuring?: boolean
  children?: ReactNode
}
type Filter = 'all' | 'active' | 'queued' | 'human' | 'history'
const category = (item: ContinuousWorkItem): Exclude<Filter, 'all'> => item.state === 'completed' || item.state === 'skipped' ? 'history' : item.state === 'active' ? 'active' : item.state === 'queued' || item.reason === SCREENING_PENDING ? 'queued' : 'human'
const labels: Record<ContinuousWorkItem['state'], string> = { queued: '等待处理', active: '正在处理', completed: '已结束', waiting: '等待人工 / 外部条件', paused: 'Task 已暂停', blocked: '需人工处理', skipped: '已移出等待' }

/** One Project queue; filters and links are local/read-only navigation. */
export function ContinuousDelegation(props: ContinuousDelegationProps) {
  const controller = useMemo(() => new ContinuousDelegationController(props.client, { projectId: props.projectId, sourceId: props.sourceId }, props.rule), [props.client, props.projectId, props.sourceId])
  useEffect(() => { controller.updateRule(props.rule) }, [controller, props.rule])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => { if (state.rule) props.onRuleChanged?.(state.rule) }, [state.rule, props.onRuleChanged])
  const [filter, setFilter] = useState<Filter>('all')
  const [blockCandidate, setBlockCandidate] = useState('')
  useEffect(() => { setBlockCandidate('') }, [controller])
  useEffect(() => { setFilter('all') }, [props.projectId])
  const rule = state.rule
  const disabled = state.busy || !!state.pending || !rule || props.configuring
  const items = rule?.items ?? []
  const queueError = rule?.error && !items.some(item=>item.reason===rule.error?.message) ? rule.error : undefined
  const filters: [Filter, string][] = [['all', '全部'], ['active', '正在处理'], ['queued', '等待处理'], ['human', '需人工处理'], ['history', '历史']]
  const rows = items.map((item, index) => ({ item, index })).filter(({ item }) => filter === 'all' || category(item) === filter)
  return <section className={styles.panel} aria-label="持续委托任务队列" aria-busy={state.busy}>
    <header className={styles.toolbar}>
      <div><strong>任务队列</strong><span className={styles.status} title="暂停只影响后续启动，在途处理和历史保留">{!rule ? '尚未配置' : rule.enabled ? '自动处理已开启' : '后续执行已暂停'}</span>
        {props.projectTitle !== props.sourceTitle && <p className={styles.summary}>项目：{props.projectTitle} · 来源：{props.sourceTitle}</p>}
      </div>
      <div className={styles.actions}>
        <button type="button" className={panelStyles.iconButton} aria-label="更新等待任务" title="更新等待任务，保留在途工作与历史" disabled={disabled} onClick={() => void controller.refresh()}><PanelIcon name="refresh"/></button>
        <button type="button" aria-label="队列设置" disabled={state.busy || !!state.pending || props.configuring} onClick={props.onConfigure}>设置</button>
        <button type="button" title={!rule?.queue && !rule?.enabled ? '先保存队列设置，确认后续执行范围' : '只控制后续启动，在途处理和历史保留'} disabled={disabled || (!rule?.queue && !rule?.enabled)} onClick={() => void controller.enable(!rule?.enabled)}>{rule?.enabled ? '暂停后续' : '继续处理'}</button>
      </div>
    </header>
    {rule && <p className={styles.summary}>负责人：{rule.scope.assignee === '@me' ? rule.scope.identity?.login ?? '当前账号' : '所有负责人'} · 标签：{rule.scope.labels.join('、') || '不限'}{rule.queue ? ` · 每 ${rule.queue.refreshMinutes} 分钟更新 · 并发上限 ${rule.queue.concurrency} · ${rule.queue.order === 'oldest' ? '较早创建优先' : '较新创建优先'}` : ''}</p>}
    {rule?.queue?.filterPrompt && <details><summary>大模型筛选条件</summary><p style={{whiteSpace:'pre-wrap'}}>{rule.queue.filterPrompt}</p></details>}
    {rule?.screeningError && <p role="alert" className={styles.cardError}>{rule.screeningError.message}</p>}
    {rule && !rule.queue && <p role="status" className={styles.summary}>旧设置与历史已保留；请在设置中确认后续执行范围。</p>}
    {(state.error || queueError) && <p role="alert" className={styles.cardError}>{state.error ?? `${queueError?.code}: ${queueError?.message}`}</p>}
    {state.pending && !state.busy && <div><p>请求回执尚未确认。</p><button type="button" onClick={() => void controller.retry()}>核对原请求</button></div>}
    {props.children}
    <div className={styles.toolbar}><nav className={styles.filters} aria-label="队列状态筛选">{filters.map(([id, label]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label} <span>{items.filter(item => id === 'all' || category(item) === id).length}</span></button>)}</nav>{rule&&<p className={styles.summary}>并发占用 {(rule.slots??(rule.active?[rule.active]:[])).length} / {rule.queue?.concurrency??1}{rule.lastRefreshedAt?` · 最近更新 ${new Date(rule.lastRefreshedAt).toLocaleString('zh-CN')}`:''}</p>}</div>
    {rows.length ? <div key={`${props.projectId}/${filter}`} className={`${panelStyles.tableScroll} ${styles.queueScroll}`} role="region" aria-label="持续委托队列 滚动区域" tabIndex={0}><table className={styles.queue} aria-label="持续委托队列"><thead><tr><th scope="col">顺序</th><th scope="col">Task</th><th scope="col">处理状态</th><th scope="col">处理会话</th></tr></thead>
      <tbody>{rows.map(({ item, index }) => <tr key={item.nodeId} data-status={category(item)}>
        <td data-cell="order">{index + 1}</td>
        <td data-cell="task"><button className={styles.taskLink} onClick={() => void props.navigation.openQueueItem(item, props.sourceId)}>#{item.number} {item.title}</button></td>
        <td data-cell="status"><span>{item.state==='completed'&&(rule?.slots??(rule?.active?[rule.active]:[])).some(ref=>ref.projectId===item.ref?.projectId&&ref.taskId===item.ref?.taskId)?'已验收 · 正在收口':item.reason===SCREENING_PENDING?SCREENING_PENDING:labels[item.state]}</span>{(item.reason || item.screening?.reason) && <details className={styles.problem}><summary>查看摘要</summary><p>{item.reason || item.screening?.reason}</p></details>}</td>
        <td data-cell="session">{item.ref && item.executionId ? <button className={styles.taskLink} onClick={() => void props.navigation.openQueueSession(item.ref!, item.state === 'completed')}>{item.state === 'completed' ? '会话记录' : '进入会话'}</button> : item.taskRef ? <button className={styles.taskLink} onClick={() => void props.navigation.openQueueSession(item.taskRef!, true)}>会话记录</button> : <span className={styles.summary}>尚未开始</span>}</td>
      </tr>)}</tbody></table></div> : <div className={styles.empty} role="status"><strong>{filter === 'all' ? '队列当前为空' : '当前分类没有任务'}</strong><p>{filter === 'all' ? '保存设置并更新等待任务，匹配工作会出现在这里。' : '可切换到全部查看其他任务。'}</p>{filter !== 'all' && <button onClick={() => setFilter('all')}>查看全部</button>}</div>}
    {rule?.planning && <details><summary>已保存委托与排除项</summary><p>{rule.planning.instruction}</p>{rule.planning.supplements.map((text, index) => <p key={index}>{text}</p>)}
      <div className={styles.actions}><select aria-label="选择后续排除项" disabled={disabled} value={blockCandidate} onChange={event=>setBlockCandidate(event.target.value)}><option value="">选择队列中的工作</option>{items.filter(item=>!rule.planning?.blocks.includes(item.nodeId)).map(item=><option key={item.nodeId} value={item.nodeId}>#{item.number} {item.title}</option>)}</select><button disabled={disabled||!blockCandidate} onClick={()=>{void controller.block(blockCandidate,true);setBlockCandidate('')}}>排除后续接入</button></div>
      <ul>{rule.planning.blocks.map(nodeId => <li key={nodeId}>{items.find(item => item.nodeId === nodeId)?.title ?? nodeId} <button disabled={disabled} onClick={() => void controller.block(nodeId, false)}>解除后续排除</button></li>)}</ul>
    </details>}
  </section>
}
