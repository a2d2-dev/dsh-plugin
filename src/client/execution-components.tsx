import type { ContinuationPolicy, SessionRef, TaskRef, WorkExecution } from '../work-types.ts'
import type { ExecutionGraph, ExecutionJob, ObservedSession } from '../work-execution/observation.ts'
import styles from './execution-components.module.css'

export interface ExecutionNavigation {
  onReadIssue?: (issue: import('../work-sources/types.ts').GitHubIssueReference) => void
  onOpenTask?: (ref: TaskRef) => void
  onEnterTask?: (ref: TaskRef) => void
  onOpenSession?: (session: SessionRef) => void
  onReadHistory?: (session: SessionRef) => void
}
const roles = { current: '当前协调', retired: '接续历史 · 只读', related: '关联执行', review: '评审执行', 'native-child': '原生子会话' }
const statuses = { running: '运行中', idle: '空闲', inactive: '未激活', unknown: '状态未知', stopping: '停止中', completed: '已返回', failed: '失败', killed: '已停止' }
const sessionId = (session: SessionRef) => `${session.runtimeId} / ${session.sessionId}`
/** Short handles keep the page scannable; the full value stays in the text or the element title. */
const short = (value: string, length = 8) => value.length > length ? `${value.slice(0, length)}…` : value
const shortSession = (session: SessionRef) => session.sessionId.startsWith('session-') ? `session-${session.sessionId.slice(8, 16)}` : short(session.sessionId)
const attemptReasons: Record<string, string> = { aborted: '已中止', blocked: '已阻塞', failed: '失败', timeout: '超时' }
const reasonLabel = (reason?: string) => reason ? attemptReasons[reason] ?? reason : '结果未知'
const firstLine = (text: string, length = 96) => {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > length ? `${line.slice(0, length)}…` : line
}
const deliveryLabel = (delivery: ExecutionJob['delivery']) => delivery === 'delivered' ? '输出已交付' : delivery === 'pending' ? '输出待交付' : '输出交付未知'
const resultLabel = (result: ExecutionJob['result']) => result === 'consumed' ? '已消费' : result === 'pending' ? '消费待确认' : '消费未知'
const nonzeroExit = (job: ExecutionJob) => /exit code: [1-9]/u.test(job.detail ?? '')
const jobKey = (job: ExecutionJob) => `${job.owner.sessionId}/${job.id}/${job.instanceId ?? job.registryEpoch ?? ''}`

/** One background job: its head line is scannable, the command and registry stay one click away. */
function JobRow({ job }: { job: ExecutionJob }) {
  return <li>
    <details className={styles.jobItem}>
      <summary><span className={styles.jobSummary}>
        <code className={styles.jobId}>{job.id}</code>
        <span className={styles.statusTag} data-state={job.status}>{job.availability === 'lost' ? '旧作业不可恢复' : statuses[job.status]}</span>
        {nonzeroExit(job) ? <span className={styles.failTag}>非零退出</span> : job.detail && job.status !== 'completed' && <span className={styles.jobMeta}>{job.detail}</span>}
        <span className={styles.jobPreview}>{firstLine(job.label || job.kind)}</span>
      </span></summary>
      <div className={styles.jobBody}>
        <p className={styles.identity} title={sessionId(job.owner)}>执行者：{shortSession(job.owner)}</p>
        <p>{deliveryLabel(job.delivery)} · {resultLabel(job.result)} · 未验收{job.detail ? ` · ${job.detail}` : ''}</p>
        {job.label && <pre className={styles.command}>{job.label}</pre>}
        <small>{job.registryEpoch && job.instanceId ? `Registry ${short(job.registryEpoch)} · Instance ${short(job.instanceId)}` : '宿主未提供稳定作业身份'} · {job.persistence === 'session-journal' ? '持久生命周期记录' : '宿主进程内作业'}</small>
      </div>
    </details>
  </li>
}

/** One input or result fact: a single-line preview, full text behind the disclosure. */
function EventRow({ event }: { event: WorkExecution['events'][number] }) {
  return <li>
    <details className={styles.eventItem}>
      <summary><span className={styles.eventSummary}>
        <strong>{event.kind === 'result' ? '结果' : '输入'}</strong>
        <span>{event.delivery === 'discarded' ? '已废弃' : event.delivery === 'consumed' ? '已消费' : event.delivery === 'delivered' ? '已投递' : '已接受'} · 未验收</span>
        <span className={styles.eventPreview}>{firstLine(event.text)}</span>
      </span></summary>
      <p className={styles.eventText}>{event.text}</p>
    </details>
  </li>
}

/** Identity, attempts and native children are shared by the primary card and the other-session rows. */
function SessionBody({ row }: { row: ObservedSession }) {
  return <>
    <p className={styles.identity}><code title={sessionId(row.session)}>{sessionId(row.session)}</code></p>
    {row.attempt && <p className={styles.identity}>第 {row.attempt.turn} 次 turn · {reasonLabel(row.attempt.reason)}</p>}
    {row.parent && <p className={styles.identity}>原生父会话：{sessionId(row.parent)}</p>}
    {row.children.length > 0 && <details className={styles.subGroup}><summary>原生子会话 · {row.children.length}</summary><ul>{row.children.map(child => <li key={sessionId(child.session)}><code title={sessionId(child.session)}>{shortSession(child.session)}</code> · {child.mode} · {child.returned ? '已返回' : '尚未返回'} · {child.result === 'consumed' ? '结算通知已消费' : child.result === 'pending' ? '结算通知待消费' : '消费未知'}</li>)}</ul></details>}
  </>
}

function SessionFacts({ row, navigation, showJobs = false }: { row: ObservedSession; navigation: ExecutionNavigation; showJobs?: boolean }) {
  return <article className={styles.sessionItem}>
    <div className={styles.row}><strong>{roles[row.role]}</strong><span className={styles.statusTag} data-state={row.status}>{statuses[row.status]}</span>
      {row.waitingHuman && <span role="status">等待人类确认</span>}
      {row.role === 'retired'
        ? navigation.onReadHistory && <button type="button" onClick={() => navigation.onReadHistory!(row.session)}>只读历史</button>
        : navigation.onOpenSession && <button type="button" onClick={() => navigation.onOpenSession!(row.session)}>查看会话</button>}
    </div>
    <SessionBody row={row}/>
    {showJobs && row.jobs.length > 0 && <details className={styles.subGroup}><summary>后台作业 · {row.jobs.length}</summary><ul className={styles.jobs}>{row.jobs.map(job => <JobRow key={jobKey(job)} job={job}/>)}</ul></details>}
  </article>
}

/** Independently wired Issue component: the graph supplies facts; callbacks own navigation. */
export function ExecutionSessions({ graph, ...navigation }: { graph: ExecutionGraph } & ExecutionNavigation) {
  const current = graph.sessions.filter(row => row.role !== 'retired')
  const history = graph.sessions.filter(row => row.role === 'retired')
  const primary = current.find(row => row.role === 'current')
  const others = current.filter(row => row !== primary)
  const jobs = current.flatMap(row => row.jobs)
  const failures = jobs.filter(nonzeroExit).length
  return <section className={styles.surface} aria-label="会话与执行">
    <header className={styles.overview}>
      <div className={styles.row}>
        <h2>会话与执行</h2>
        {primary && <span className={styles.statusTag} data-state={primary.status}>{statuses[primary.status]}</span>}
        {primary && <code className={styles.sessionShort} title={sessionId(primary.session)}>{shortSession(primary.session)}</code>}
        {primary?.waitingHuman && <span role="status">等待人类确认</span>}
        {primary && navigation.onOpenSession && <button type="button" onClick={() => navigation.onOpenSession!(primary.session)}>查看会话</button>}
      </div>
      {graph.owner && <p className={styles.identity} title={`协调负责人 ${graph.owner.id} · Agent ${graph.owner.agentId}`}>代次 {graph.owner.epoch} · 协调负责人：{short(graph.owner.id)} · Agent {short(graph.owner.agentId)}</p>}
    </header>
    {!graph.executionId ? <p>此 Task 尚未启动执行。</p> : primary ? <article className={styles.card}><SessionBody row={primary}/></article> : null}
    {others.length > 0 && <details className={styles.group}><summary>其他执行会话 · {others.length}</summary>{others.map(row => <SessionFacts key={sessionId(row.session)} row={row} navigation={navigation}/>)}</details>}
    {jobs.length > 0 && <details className={styles.group}><summary>后台作业 · {jobs.length}{failures ? ` · ${failures} 个非零退出` : ''}</summary><ul className={styles.jobs}>{jobs.map(job => <JobRow key={jobKey(job)} job={job}/>)}</ul></details>}
    {graph.childTasks.length > 0 && <details className={styles.group}><summary>独立子 Issue / Task · {graph.childTasks.length}</summary>{graph.childTasks.map(child => <article className={styles.card} key={`${child.ref.projectId}/${child.ref.taskId}`}>
      <div className={styles.row}><strong>{child.issue ? `#${child.issue.number} ` : ''}{child.title}</strong>{navigation.onOpenTask && <button type="button" onClick={() => navigation.onOpenTask!(child.ref)}>子工作</button>}{child.currentSession && navigation.onEnterTask && <button type="button" onClick={() => navigation.onEnterTask!(child.ref)}>进入会话</button>}</div>
      <p>负责人：{child.owner ?? child.agentId}{child.issue && ` · Issue 负责人：${child.issue.assignees.join('、') || '未指派'}`}</p>
      <p>{child.currentSession ? sessionId(child.currentSession) : '尚未启动独立执行'}</p>
      {child.observation && <p>子执行结算：{child.observation.settlement === 'settled' ? '已结算' : child.observation.settlement === 'pending' ? '等待结果' : '未知'}</p>}
    </article>)}</details>}
    {!!graph.nativeIssues?.length && <details className={styles.group}><summary>原生子 Issue · {graph.nativeIssues.length}</summary>{graph.nativeIssues.map(child => <article className={styles.card} key={child.issue.nodeId}>
      <strong>{child.issue.repository.owner}/{child.issue.repository.repository} #{child.issue.number} · {child.issue.title}</strong>
      <p>{child.status === 'started' ? '已有独立执行' : child.status === 'not-started' ? '尚未开始' : '尚未读取完整要求'} · Issue 负责人：{child.assignees ? child.assignees.join('、') || '未指派' : '未知'}</p>
      {child.owner && <p>协调负责人：{short(child.owner)} · 代次 {child.epoch}</p>}
      <div className={styles.row}>{child.ref && navigation.onOpenTask ? <button type="button" onClick={() => navigation.onOpenTask!(child.ref!)}>工作详情</button> : navigation.onReadIssue && <button type="button" onClick={() => navigation.onReadIssue!(child.issue)}>读取要求</button>}{child.ref && child.currentSession && navigation.onEnterTask && <button type="button" onClick={() => navigation.onEnterTask!(child.ref!)}>进入会话</button>}<a href={child.issue.url} target="_blank" rel="noreferrer">GitHub 原文</a></div>
    </article>)}</details>}
    {graph.events.length > 0 && <details className={styles.group}><summary>输入与结果 · {graph.events.length}</summary><ul className={styles.events}>{graph.events.map(event => <EventRow key={event.id} event={event}/>)}</ul></details>}
    {history.length > 0 && <details className={styles.group}><summary>历史会话与尝试 · {history.length}</summary>{history.map(row => <SessionFacts key={sessionId(row.session)} row={row} navigation={navigation} showJobs/>)}</details>}
    {graph.history.length > 0 && <details className={styles.group}><summary>执行尝试记录 · 只读 · {graph.history.length}</summary><ol>{graph.history.map((attempt, index) => <li key={`${attempt.commandId}/${index}`}>{attempt.state} · {attempt.commandId}</li>)}</ol></details>}
    {graph.limitations.map((text, index) => <p className={styles.limit} role="status" key={index}>{text}</p>)}
    {graph.reminders.map((text, index) => <p className={styles.limit} role="status" key={`reminder:${index}`}>{text}</p>)}
  </section>
}

const phases = { reserved: '准备接续', 'material-requested': '等待原段保存决定与未完成项', 'material-saved': '已保存接续材料', 'successor-created': '后继已准备，等待安全接任', taken: '已正式接任，等待投递', delivered: '接续内容已投递', received: '后继已确认材料可读' }
/** Read-only parameters stay visible; the Issue header owns the unique policy editor. */
export function ExecutionContinuation({ graph, execution, policy, busy = false, completed = false, onContinue, onRecover, onResume }: { graph?: ExecutionGraph; execution?: WorkExecution; policy?: ContinuationPolicy; busy?: boolean; completed?: boolean; onContinue?: () => void; onRecover?: () => void; onResume?: () => void }) {
  const op = execution?.continuation
  const observation = execution?.continuationObservation
  const failed = execution?.state === 'failed'
  const suspended = execution?.state === 'waiting' || execution?.state === 'paused'
  const pendingControl = execution?.control?.status === 'accepted' && execution.control.action !== 'resume'
  const blocked = failed || suspended || pendingControl || execution?.state === 'accepted' || execution?.state === 'creating'
  return <section className={styles.surface} aria-label="接续">
    <div className={styles.sectionHead}><h2>接续</h2>
      {(onContinue || completed) && <button type="button" className={styles.primaryAction} disabled={completed || busy || blocked || !execution?.actual || !onContinue} onClick={completed ? undefined : onContinue}>{completed ? '准备接续' : busy ? '正在准备接续…' : op?.phase === 'taken' ? '重试内容投递' : op && op.phase !== 'received' ? '重试本次接续' : '准备接续'}</button>}
      {!completed && failed && onRecover && <button type="button" disabled={busy} onClick={onRecover}>重试原执行</button>}
      {!completed && suspended && !pendingControl && onResume && <button type="button" disabled={busy} onClick={onResume}>恢复处理</button>}
    </div>
    {!completed && failed && <p role="alert">原执行恢复失败：{execution?.error ? `${execution.error.code}：${execution.error.message}` : '原因未知'}。请先重试原执行，恢复成功后再准备接续。</p>}
    {!completed && suspended && <p role="status">原执行{execution?.state === 'paused' ? '已暂停' : '正在等待回复'}；请先恢复处理，再准备接续。</p>}
    {!completed && pendingControl && !failed && <p role="status">原执行的等待或暂停请求尚未生效，请等待结算后刷新观察。</p>}
    {!completed && (execution?.state === 'accepted' || execution?.state === 'creating') && <p role="status">原执行尚未就绪，请等待创建或恢复后刷新观察。</p>}
    {completed && <p role="status">任务阶段：done（已验收完成） · 任务已验收完成，不能继续接续</p>}
    {op?.phase === 'taken' && <p role={op.error ? 'alert' : 'status'}>后继已接任，但交接内容尚未确认送达。{op.error ? '接续尚未完成，请重试确认内容投递。' : '正在等待内容投递。'}</p>}
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
    {op && <article className={styles.card}><h3>{phases[op.phase]}</h3><p>原段：{sessionId(op.source)}</p><p>固定后继：{sessionId(op.successor)}</p><p>{['taken', 'delivered', 'received'].includes(op.phase) ? '正式接任已提交，当前入口以有效协调记录为准。' : '原段仍负责，准备后继不切换当前入口。'}</p>{op.error && <p role="alert">{op.error.code}：{op.error.message} · 重试复用同一操作与后继。</p>}{op.material && <details><summary>已保存决定与未完成项</summary><p>决定：{op.material.decisions}</p><p>证据：{op.material.evidence}</p><p>未完成：{op.material.unfinished}</p><p>下一步：{op.material.next}</p></details>}</article>}
    {execution?.continuationBlocked && <p role="status">{execution.continuationBlocked.code}：{execution.continuationBlocked.message}</p>}
    {!!execution?.continuationHistory?.length && <details><summary>接续历史 · 只读</summary>{execution.continuationHistory.map(item => <p key={item.operationId}>{phases[item.phase]} · {item.source.sessionId} → {item.successor.sessionId}{item.error && ` · ${item.error.message}`}</p>)}</details>}
  </section>
}
