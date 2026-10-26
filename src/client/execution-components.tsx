import type { ContinuationPolicy, SessionRef, TaskRef, WorkExecution } from '../work-types.ts'
import type { ExecutionGraph, ExecutionJob, ObservedSession } from '../work-execution/observation.ts'
import { continuationInFlight } from '../work-execution/state.ts'
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
  const current = graph?.sessions.find(row => row.session.runtimeId === execution?.session.runtimeId && row.session.sessionId === execution?.session.sessionId)
  const disabledReason = completed ? '任务已验收完成，不能继续接续' : busy ? '请求处理中' : failed ? '先重试原执行，恢复成功后再接续' : pendingControl ? '等待或暂停请求尚未生效，结算后刷新' : execution?.state === 'accepted' || execution?.state === 'creating' ? '等待创建或恢复后刷新' : current?.status === 'running' || current?.status === 'stopping' ? '等待本轮结束后刷新' : graph?.settlement === 'unknown' ? '结算未知，请核实宿主能力和执行者后刷新' : !execution?.actual ? '实际执行配置尚未核实' : !onContinue ? '请从当前协调会话发起接续' : undefined
  const blocked = Boolean(disabledReason)
  return <section className={styles.surface} aria-label="接续">
    <dl className={styles.parameters} aria-label="生命周期状态">
      <dt>会话运行</dt><dd>{current ? statuses[current.status] : '尚无宿主观察'}{current?.attempt && ` · 第 ${current.attempt.turn} 轮：${reasonLabel(current.attempt.reason)}`}</dd>
      <dt>Task 控制</dt><dd>{completed ? '已验收完成' : execution ? ({ accepted: '启动已接受', creating: '创建中', ready: '允许处理', running: '允许处理', waiting: '等待', paused: '暂停', failed: '执行失败' }[execution.state]) : '尚未启动'}{execution?.control && ` · ${execution.control.action} / ${execution.control.status === 'accepted' ? '请求待生效' : '已生效'}`}</dd>
      <dt>协调归属</dt><dd>{execution ? <><code>{sessionId(execution.session)}</code> · 当前协调 · 代次 {execution.epoch}</> : '尚无有效协调会话'}</dd>
    </dl>
    <div className={styles.sectionHead}><h2>接续</h2>
      {(onContinue || completed) && <button type="button" className={styles.primaryAction} title={disabledReason} disabled={blocked} onClick={completed ? undefined : onContinue}>{completed ? '准备接续' : busy ? '处理中…' : op?.phase === 'taken' ? '重试投递' : execution && continuationInFlight(execution) ? '重试接续' : suspended ? '仅换会话' : '准备接续'}</button>}
      {!completed && failed && onRecover && <button type="button" disabled={busy} onClick={onRecover}>重试原执行</button>}
      {!completed && suspended && !pendingControl && onResume && <button type="button" disabled={busy} onClick={onResume}>恢复处理</button>}
    </div>
    {disabledReason && !completed && !failed && !pendingControl && <p role="status">{disabledReason}</p>}
    {!completed && failed && <p role="alert">原执行恢复失败：{execution?.error ? `${execution.error.code}：${execution.error.message}` : '原因未知'}。请先重试原执行，恢复成功后再准备接续。</p>}
    {!completed && suspended && <p role="status">仅换会话保留{execution?.state === 'paused' ? '暂停' : '等待'}，后继不会自动恢复业务。</p>}
    {execution?.control?.reason && <p className={styles.eventText}>控制原因与恢复条件：{execution.control.reason}</p>}
    {!completed && pendingControl && !failed && <p role="status">原执行的等待或暂停请求尚未生效，请等待结算后刷新观察。</p>}
    {!completed && (execution?.state === 'accepted' || execution?.state === 'creating') && <p role="status">原执行尚未就绪，请等待创建或恢复后刷新观察。</p>}
    {completed && <p role="status">任务阶段：done（已验收完成） · 任务已验收完成，不能继续接续</p>}
    {op?.phase === 'taken' && <p role={op.error ? 'alert' : 'status'}>后继已接任，但交接内容尚未确认送达。{op.error ? '接续尚未完成，请重试确认内容投递。' : '正在等待内容投递。'}</p>}
    <details className={styles.group}><summary>生命周期与操作</summary>
      <dl className={styles.parameters}>
        <dt>创建</dt><dd>普通新建、浏览器协作交接或 Issue 协调绑定不会自动取得 TaskExecution 协调权，也不会撤销独立 Goal activation。已有 Task 请从当前协调会话的「A²D² 接续」或工作详情「接续」进入受控流程。</dd>
        <dt>轮次运行与结束</dt><dd>输入触发模型与工具运行；本轮 Completed 只表示一轮结束。会话空闲、后台作业结束、结果正式收取和 Task 验收分别确认，不能互相替代。</dd>
        <dt>等待与暂停</dt><dd>保留原因与恢复条件；查看页面和普通人工对话不会恢复自动处理。维护前提满足时可「仅换会话」，后继继承等待或暂停。</dd>
        <dt>明确恢复</dt><dd>「恢复处理」才请求恢复 Task 业务，仍受权限和调度资格约束。Goal 的人类 pause/resume 权限独立保留。</dd>
        <dt>受控接续</dt><dd>插件持续核验补收、结算、材料保存、固定后继、正式接任、投递与实际可读。正式接任才切换协调会话；旧 Goal activation 停用不等于持久 phase 暂停，不会跨会话迁移或自动 rearm。</dd>
        <dt>出错与重试</dt><dd>按具体失败步骤与执行者修复缺口，再重试同一操作和固定后继；原执行失败先「重试原执行」。运行中、未知和待生效控制仍须结算核实。</dd>
        <dt>Task 验收完成</dt><dd>按原规格和验收发布完成事实，停止该 Task 自动推进；会话仍可查看和讨论，讨论不会重开任务。</dd>
        <dt>历史归档</dt><dd>只改变历史展示；不代替验收、不恢复业务或授予协调权。历史入口可进入真正当前协调会话。</dd>
      </dl>
    </details>
    <details className={styles.group}><summary>接续参数</summary><dl className={styles.parameters}>
      <dt>自动接续</dt><dd>{policy ? policy.enabled ? '已开启' : '已关闭' : '尚未配置'}</dd>
      <dt>提前接续目标</dt><dd>{policy ? `${policy.targetTokens.toLocaleString('en-US')} tokens` : '未配置'}</dd>
      <dt>安全余量</dt><dd>{policy ? `${policy.reserveTokens.toLocaleString('en-US')} tokens` : '未配置'}</dd>
      <dt>当前上下文观察</dt><dd>{observation ? `${observation.totalTokens.toLocaleString('en-US')} / ${observation.capacity.toLocaleString('en-US')} tokens · ${observation.baseline} · ${observation.observedAt}` : '暂无宿主计量'}</dd>
      <dt>输出预留</dt><dd>{observation ? `${observation.outputReserve.toLocaleString('en-US')} tokens` : '未知'}</dd>
      <dt>执行结算</dt><dd>{graph?.settlement === 'settled' ? '相关执行已结算' : graph?.settlement === 'pending' ? '等待相关执行结算' : '相关执行结算未知'}</dd>
    </dl><p className={styles.limit}>阈值为提前接续软目标；正式接任仍须宿主维护边界核验。</p></details>
    {graph?.blockers.length ? <ul aria-label="接续等待项">{graph.blockers.map((blocker, index) => <li key={index}>{blocker.code} · {blocker.session.sessionId}{blocker.jobId && ` / ${blocker.jobId}`}</li>)}</ul> : null}
    {op && <article className={styles.card}>
      <h3>{phases[op.phase]}</h3>
      <p className={styles.identity}>操作：<code>{op.operationId}</code></p>
      <dl className={styles.parameters}>
        <dt>原会话</dt><dd>{sessionId(op.source)}</dd>
        <dt>固定后继</dt><dd>{sessionId(op.successor)} · {['taken', 'delivered', 'received'].includes(op.phase) ? '已提交接任' : '准备中，尚无协调权'}</dd>
        <dt>材料请求</dt><dd>{op.materialRequestId} · {op.requestDelivery ?? '尚无交付凭据'}</dd>
        <dt>材料保存</dt><dd>{op.material ? `已保存 · ${op.material.commandId} · 规格 v${op.material.specificationVersion}` : '尚未保存'}{op.materialFactsKey && ' · 已记录结果新鲜度依据'}</dd>
        <dt>后继配置</dt><dd>{op.profile ? `${op.profile.provider} / ${op.profile.model}${op.profile.reasoningEffort ? ` / ${op.profile.reasoningEffort}` : ''} · ${op.profile.agentPreset} · ${op.profile.permissionPreset}` : '尚未核实'}</dd>
        <dt>旧 Goal</dt><dd>{op.goalActivation ? op.goalActivation.status === 'disarmed' ? <>旧 Goal activation 已停用 · {op.goalActivation.goalId} · 持久 phase：{op.goalActivation.phase} / revision：{op.goalActivation.revision}</> : '已核实无旧 Goal' : 'activation 尚未核实'}</dd>
        <dt>材料投递</dt><dd>{op.kickoffDelivery ?? '尚无交付凭据'} · 请求 {op.kickoffId}</dd>
        <dt>可读确认</dt><dd>{op.readable ? <>读取凭据：{op.readable.callId} · 材料 {op.readable.materialCommandId}</> : !op.protocolVersion && op.phase === 'delivered' ? '历史协议：已投递，无读取凭据' : '材料可读尚未确认'}{op.readRequestId && ` · 请求 ${op.readRequestId}`}</dd>
      </dl>
      {!!op.collections?.length && <div><h3>结果补收</h3><ul>{op.collections.map(item => <li key={item.requestId}>执行者：{sessionId(item.session)} · {item.jobs.map(job => job.id).join('、')} · {item.status === 'collected' ? '已核实收取' : '补收未确认'} · 请求{item.delivery === 'consumed' ? '已消费' : item.delivery === 'delivered' ? '已投递' : '已接受'} · {item.requestId}</li>)}</ul></div>}
      {!!op.settlements?.length && <div><h3>原生结果结算</h3><ul>{op.settlements.map(item => <li key={item.messageId}>执行者：{sessionId(item.parent)} · 子会话 {sessionId(item.child)} · 结束序号 {item.endSeq} · 结算通知{item.delivery === 'consumed' ? '已消费' : item.delivery === 'delivered' ? '已投递' : '已接受'}</li>)}</ul></div>}
      <p className={styles.limit}>插件持续负责接续流程；{['taken', 'delivered', 'received'].includes(op.phase) ? '正式接任已提交，当前协调以有效记录为准。' : '正式接任前原会话保留业务协调身份。'}</p>
      {op.error && <p role="alert">{op.error.code}：{op.error.message} · 当前步骤：{phases[op.phase]}。修复该缺口后重试接续，复用同一操作与后继。</p>}
      {op.material && <details><summary>接续材料</summary><p className={styles.eventText}>{op.material.body}</p><p>决定：{op.material.decisions}</p><p>证据：{op.material.evidence}</p><p>未完成：{op.material.unfinished}</p><p>下一步：{op.material.next}</p></details>}
    </article>}
    {execution?.continuationBlocked && <p role="status">{execution.continuationBlocked.code}：{execution.continuationBlocked.message}</p>}
    {!!execution?.continuationHistory?.length && <details><summary>接续历史 · 只读</summary>{execution.continuationHistory.map(item => <p key={item.operationId}>{phases[item.phase]} · {item.source.sessionId} → {item.successor.sessionId}{item.error && ` · ${item.error.message}`}</p>)}</details>}
  </section>
}
