import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ContinuousWorkRule } from '../work-types.ts'
import type { WorkClient } from './work-api.ts'
import { ContinuousDelegationController } from './continuous-controller.ts'
import styles from './continuous-delegation.module.css'

export interface ContinuousDelegationProps {
  client: WorkClient
  projectId: string
  sourceId: string
  sourceTitle: string
  rule?: ContinuousWorkRule
  onRuleChanged?: (rule: ContinuousWorkRule) => void
}
/** Mount from the selected source header's right-side continuous-processing disclosure. */
export function ContinuousDelegation(props: ContinuousDelegationProps) {
  const controller = useMemo(() => new ContinuousDelegationController(props.client, { projectId: props.projectId, sourceId: props.sourceId }, props.rule), [props.client, props.projectId, props.sourceId])
  useEffect(() => { controller.updateRule(props.rule) }, [controller, props.rule])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => { if (state.rule) props.onRuleChanged?.(state.rule) }, [state.rule, props.onRuleChanged])
  const [blockCandidate, setBlockCandidate] = useState('')
  useEffect(() => { setBlockCandidate('') }, [controller])
  const rule = state.rule
  const planning = rule?.planning
  const plan = planning?.plans.at(-1)
  const disabled = state.busy || !!state.pending || !rule
  const canEnable = !!plan && plan.draftVersion === planning?.draftVersion && !state.draft.trim()
  return <section className={styles.panel} aria-label={`${props.sourceTitle} 持续委托`} aria-busy={state.busy}>
    <header className={styles.toolbar}>
      <div><strong>持续委托</strong><p>来源：{props.sourceTitle} · {rule?.enabled ? '已启用' : '接新工作已暂停'}</p></div>
      {rule?.enabled && <button type="button" disabled={disabled} onClick={() => void controller.enable(false)}>暂停接新</button>}
    </header>
    {!rule && <p role="status">请先配置此来源的负责人范围与执行资源，再保存委托。</p>}
    {rule && <p>授权范围：{rule.scope.assignee === '@me' ? rule.scope.identity?.login ?? '当前账号' : '所有负责人'}；标签：{rule.scope.labels.join('、') || '不限'}。暂停接新会保留当前处理与必要收尾。</p>}
    {planning && <details><summary>已保存委托与补充</summary><p>{planning.instruction}</p>{planning.supplements.map((text, index) => <p key={index}>{text}</p>)}</details>}
    <label className={styles.form}> {planning ? '补充委托或纠偏' : '希望持续推进什么工作'}
      <textarea value={state.draft} rows={4} maxLength={100_000} onChange={event => controller.setDraft(event.target.value)} placeholder="描述目标、优先事项与边界；保存后预览具体安排。" />
    </label>
    <div className={styles.actions}>
      <button type="button" disabled={disabled || !state.draft.trim()} onClick={() => void controller.save()}>保存{planning ? '补充' : '委托'}</button>
      <button type="button" disabled={disabled || !planning || !!state.draft.trim()} onClick={() => void controller.preview()}>{state.busy ? '请求处理中…' : '生成计划预览'}</button>
      <button type="button" disabled={disabled || !canEnable || rule?.enabled} onClick={() => void controller.enable(true)}>启用此计划</button>
    </div>
    {state.draft.trim() && <p role="status">草稿已保留；先保存再预览，预览不会启动工作。</p>}
    {(state.error || planning?.error || rule?.error) && <p role="alert" className={styles.cardError}>{state.error ?? (planning?.error ? `${planning.error.code}: ${planning.error.message}` : `${rule?.error?.code}: ${rule?.error?.message}`)}</p>}
    {state.pending && !state.busy && <div><p>请求回执尚未确认。核对原请求后再继续操作。</p><button type="button" onClick={() => void controller.retry()}>核对并重试原请求</button></div>}
    {plan && <div>
      <h3>计划 v{plan.version}{planning?.enabledPlanVersion === plan.version ? ' · 已明确启用' : ' · 预览'}</h3>
      {plan.draftVersion !== planning?.draftVersion && <p role="status">委托或 Block 已变化，需要重新预览再启用。</p>}
      <ol className={styles.queue}>{plan.steps.map(step => {
        const issue = plan.basis.candidates.find(candidate => candidate.issue.nodeId === step.nodeId)?.issue
        const existing = plan.basis.candidates.find(candidate => candidate.issue.nodeId === step.nodeId)?.execution as { resource?: { runtimeId: string; workspaceId: string }; model?: { provider: string; model: string }; permissionPreset?: string; session?: { sessionId: string } } | undefined
        const blocked = planning?.blocks.includes(step.nodeId)
        const item = rule?.items.find(item => item.nodeId === step.nodeId)
        return <li key={step.nodeId} className={styles.card}>
          <div className={styles.toolbar}><strong>{issue ? <a href={issue.url} target="_blank" rel="noreferrer">{issue.repository.owner}/{issue.repository.repository} #{issue.number} · {issue.title}</a> : step.nodeId}</strong><button type="button" disabled={disabled} onClick={() => void controller.block(step.nodeId, !blocked)}>{blocked ? '解除 Block' : 'Block 后续接入'}</button></div>
          <p>{step.mode === 'existing' ? '复用已有执行' : step.mode === 'new' ? '新建执行' : '等待 / 观察'}{item ? ` · ${item.state}` : ''}{blocked ? ' · 已 Block' : ''}</p>
          <p>纳入原因：{step.why}</p><p>下一步：{step.nextAction}</p>
          {existing && <details><summary>已有执行与资源</summary><p>资源：{existing.resource?.runtimeId} / {existing.resource?.workspaceId}</p><p>模型：{existing.model?.provider}/{existing.model?.model} · 权限方案：{existing.permissionPreset}</p><p>当前会话：{existing.session?.sessionId}。启用将保留原执行的资源和策略。</p></details>}
          {item?.reason && <p role="status">{item.reason}</p>}
        </li>
      })}</ol>
      {!plan.steps.length && <p>当前计划没有可接入项；补充委托或调整 Block 后重新预览。</p>}
    </div>}
    <details open={!!planning?.blocks.length}><summary>Block 名单（{planning?.blocks.length ?? 0}）</summary>
      <p>Block 约束后续安排；已在途工作保留当前会话和必要收尾。</p>
      <div className={styles.actions}><select aria-label="选择要 Block 的 Issue" disabled={disabled || !planning} value={blockCandidate} onChange={event => setBlockCandidate(event.target.value)}>
        <option value="">选择来源内的 Issue</option>{rule?.items.filter(item => !planning?.blocks.includes(item.nodeId)).map(item => <option key={item.nodeId} value={item.nodeId}>{item.url.replace('https://github.com/', '')} · {item.title}</option>)}
      </select><button type="button" disabled={disabled || !planning || !blockCandidate} onClick={() => { void controller.block(blockCandidate, true); setBlockCandidate('') }}>加入 Block</button></div>
      <ul>{planning?.blocks.map(nodeId => {
        const issue = planning.plans.flatMap(plan => plan.basis.candidates).find(candidate => candidate.issue.nodeId === nodeId)?.issue
        return <li key={nodeId}>{issue ? `${issue.repository.owner}/${issue.repository.repository} #${issue.number} ${issue.title}` : nodeId} <button type="button" disabled={disabled} onClick={() => void controller.block(nodeId, false)}>解除 Block</button></li>
      })}</ul>
    </details>
  </section>
}
