import type { ContinuationPolicy, SessionRef, TaskRef, WorkExecution } from '../work-types.ts'
import type { ExecutionGraph, ExecutionJob, ObservedSession } from '../work-execution/observation.ts'
import styles from './execution-components.module.css'

export interface ExecutionNavigation {
  onOpenTask?: (ref: TaskRef) => void
  onEnterTask?: (ref: TaskRef) => void
  onOpenSession?: (session: SessionRef) => void
  onReadHistory?: (session: SessionRef) => void
}
const roles = { current: '当前协调', retired: '接续历史 · 只读', related: '关联执行', review: '评审执行', 'native-child': '原生子会话' }
const statuses = { running: '运行中', idle: '空闲', inactive: '未激活', unknown: '状态未知', stopping: '停止中', completed: '已返回', failed: '失败', killed: '已停止' }
const sessionId = (session: SessionRef) => `${session.runtimeId} / ${session.sessionId}`
function JobFacts({ job }: { job: ExecutionJob }) {
  return <li className={styles.job}>
    <div className={styles.row}><strong>{job.label || job.kind}</strong><code>{job.id}</code><span>{job.availability === 'lost' ? '旧作业不可恢复' : statuses[job.status]}</span></div>
    <p>执行者：{sessionId(job.owner)}</p>
    <p>{job.delivery === 'delivered' ? '输出已交付' : job.delivery === 'pending' ? '输出待交付' : '输出交付未知'} · {job.result === 'consumed' ? '已消费' : job.result === 'pending' ? '消费待确认' : '消费未知'} · 未验收</p>
    {job.detail && <p>{job.detail}</p>}
    <small>{job.registryEpoch && job.instanceId ? `Registry ${job.registryEpoch} · Instance ${job.instanceId}` : '宿主未提供稳定作业身份'} · {job.persistence === 'session-journal' ? '持久生命周期记录' : '宿主进程内作业'}</small>
  </li>
}
function SessionFacts({ row, navigation }: { row: ObservedSession; navigation: ExecutionNavigation }) {
  return <article className={styles.card}>
    <div className={styles.row}><strong>{roles[row.role]}</strong><span>{statuses[row.status]}</span>
      {row.role === 'retired'
        ? navigation.onReadHistory && <button type="button" onClick={() => navigation.onReadHistory!(row.session)}>只读历史</button>
        : navigation.onOpenSession && <button type="button" onClick={() => navigation.onOpenSession!(row.session)}>查看会话</button>}
    </div>
    <p className={styles.identity}>{sessionId(row.session)}</p>
    {row.parent && <p>原生父会话：{sessionId(row.parent)}</p>}
    {row.attempt && <p>第 {row.attempt.turn} 次 turn · {row.attempt.reason ?? '结果未知'}</p>}
    {row.waitingHuman && <p role="status">等待人类确认</p>}
    {row.children.length > 0 && <ul>{row.children.map(child => <li key={sessionId(child.session)}><span>原生子会话：{sessionId(child.session)} · {child.mode} · {child.returned ? '已返回' : '尚未返回'} · {child.result === 'consumed' ? '结算通知已消费' : child.result === 'pending' ? '结算通知待消费' : '消费未知'}</span></li>)}</ul>}
    {row.jobs.length > 0 && <ul className={styles.jobs} aria-label="所属后台作业">{row.jobs.map(job => <JobFacts key={`${job.registryEpoch ?? 'unknown'}/${job.instanceId ?? job.id}`} job={job}/>)}</ul>}
  </article>
}

/** Independently wired Issue component: the graph supplies facts; callbacks own navigation. */
export function ExecutionSessions({ graph, ...navigation }: { graph: ExecutionGraph } & ExecutionNavigation) {
  const current = graph.sessions.filter(row => row.role !== 'retired')
  const history = graph.sessions.filter(row => row.role === 'retired')
  return <section className={styles.surface} aria-label="会话与执行"><h2>会话与执行</h2>
    {graph.owner && <p>协调负责人：{graph.owner.id} · Agent {graph.owner.agentId} · 代次 {graph.owner.epoch}</p>}
    {!graph.executionId && <p>此 Task 尚未启动执行。</p>}
    {current.map(row => <SessionFacts key={sessionId(row.session)} row={row} navigation={navigation}/>)}
    <section aria-label="独立子 Issue 入口"><h3>独立子 Issue / Task</h3>
      {!graph.childTasks.length && <p>尚无独立子工作。</p>}
      {graph.childTasks.map(child => <article className={styles.card} key={`${child.ref.projectId}/${child.ref.taskId}`}>
        <div className={styles.row}><strong>{child.issue ? `#${child.issue.number} ` : ''}{child.title}</strong>{navigation.onOpenTask && <button type="button" onClick={() => navigation.onOpenTask!(child.ref)}>查看子工作</button>}{child.currentSession && navigation.onEnterTask && <button type="button" onClick={() => navigation.onEnterTask!(child.ref)}>进入独立处理入口</button>}</div>
        <p>负责人：{child.owner ?? child.agentId}{child.issue && ` · Issue 负责人：${child.issue.assignees.join('、') || '未指派'}`}</p>
        <p>{child.currentSession ? sessionId(child.currentSession) : '尚未启动独立执行'}</p>
        {child.observation && <p>子执行结算：{child.observation.settlement === 'settled' ? '已结算' : child.observation.settlement === 'pending' ? '等待结果' : '未知'}</p>}
      </article>)}
    </section>
    {graph.events.length > 0 && <section aria-label="输入与结果事实"><h3>输入与结果</h3><ul>{graph.events.map(event => <li key={event.id}>{event.kind === 'result' ? '结果' : '输入'} · {event.delivery === 'consumed' ? '已消费' : event.delivery === 'delivered' ? '已投递' : '已接受'} · 未验收<p>{event.text}</p></li>)}</ul></section>}
    {history.length > 0 && <details><summary>历史会话与尝试 · {history.length}</summary>{history.map(row => <SessionFacts key={sessionId(row.session)} row={row} navigation={navigation}/>)}</details>}
    {graph.history.length > 0 && <details><summary>执行尝试记录 · 只读</summary><ol>{graph.history.map((attempt, index) => <li key={`${attempt.commandId}/${index}`}>{attempt.state} · {attempt.commandId}</li>)}</ol></details>}
    {graph.limitations.map((text, index) => <p role="status" key={index}>{text}</p>)}
  </section>
}

const phases = { reserved: '准备接续', 'material-requested': '等待原段保存决定与未完成项', 'material-saved': '已保存接续材料', 'successor-created': '后继已准备，等待安全接任', taken: '已正式接任，等待投递', delivered: '接续内容已投递' }
/** Read-only parameters stay visible; the Issue header owns the unique policy editor. */
export function ExecutionContinuation({ graph, execution, policy, busy = false, onContinue }: { graph?: ExecutionGraph; execution?: WorkExecution; policy?: ContinuationPolicy; busy?: boolean; onContinue?: () => void }) {
  const op = execution?.continuation
  const observation = execution?.continuationObservation
  return <section className={styles.surface} aria-label="接续"><h2>接续</h2>
    <dl className={styles.parameters}>
      <dt>自动接续</dt><dd>{policy ? policy.enabled ? '已开启' : '已关闭' : '尚未配置'}</dd>
      <dt>提前接续目标</dt><dd>{policy ? `${policy.targetTokens.toLocaleString('en-US')} tokens` : '未配置'}</dd>
      <dt>安全余量</dt><dd>{policy ? `${policy.reserveTokens.toLocaleString('en-US')} tokens` : '未配置'}</dd>
      <dt>当前上下文观察</dt><dd>{observation ? `${observation.totalTokens.toLocaleString('en-US')} / ${observation.capacity.toLocaleString('en-US')} tokens · ${observation.baseline} · ${observation.observedAt}` : '暂无宿主计量'}</dd>
      <dt>输出预留</dt><dd>{observation ? `${observation.outputReserve.toLocaleString('en-US')} tokens` : '未知'}</dd>
      <dt>执行结算</dt><dd>{graph?.settlement === 'settled' ? '相关执行已结算' : graph?.settlement === 'pending' ? '等待相关执行结算' : '相关执行结算未知'}</dd>
    </dl>
    <p>阈值为提前接续软目标；正式接任仍须宿主维护边界核验。原生 job_output 收取结果后再观察，收取不代表业务验收。</p>
    {graph?.blockers.length ? <ul aria-label="接续等待项">{graph.blockers.map((blocker, index) => <li key={index}>{blocker.code} · {blocker.session.sessionId}{blocker.jobId && ` / ${blocker.jobId}`}</li>)}</ul> : null}
    {op && <article className={styles.card}><h3>{phases[op.phase]}</h3><p>原段：{sessionId(op.source)}</p><p>固定后继：{sessionId(op.successor)}</p><p>{['taken', 'delivered'].includes(op.phase) ? '正式接任已提交，当前入口以有效协调记录为准。' : '原段仍负责，准备后继不切换当前入口。'}</p>{op.error && <p role="alert">{op.error.code}：{op.error.message} · 重试复用同一操作与后继。</p>}{op.material && <details><summary>已保存决定与未完成项</summary><p>决定：{op.material.decisions}</p><p>证据：{op.material.evidence}</p><p>未完成：{op.material.unfinished}</p><p>下一步：{op.material.next}</p></details>}</article>}
    {execution?.continuationBlocked && <p role="status">{execution.continuationBlocked.code}：{execution.continuationBlocked.message}</p>}
    {onContinue && <button type="button" disabled={busy || !execution?.actual} onClick={onContinue}>{busy ? '正在准备接续…' : op && op.phase !== 'delivered' ? '重试本次接续' : '准备接续'}</button>}
    {!!execution?.continuationHistory?.length && <details><summary>接续历史 · 只读</summary>{execution.continuationHistory.map(item => <p key={item.operationId}>{phases[item.phase]} · {item.source.sessionId} → {item.successor.sessionId}{item.error && ` · ${item.error.message}`}</p>)}</details>}
  </section>
}
