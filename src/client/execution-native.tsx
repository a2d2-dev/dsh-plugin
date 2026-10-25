import { useEffect, useRef, useState } from 'react'
import type { AssociatedWork, ContinuationPolicy, WorkCompleted } from '../work-types.ts'
import type { ExecutionGraph } from '../work-execution/observation.ts'
import type { WorkPanelController } from './work-panel-controller.ts'
import { ExecutionContinuation } from './execution-components.tsx'
import styles from './execution-components.module.css'

type ExecutionDetail = WorkCompleted & { executionGraph?: ExecutionGraph }
function useSessionWork(controller: WorkPanelController, sessionId: string) {
  const [work, setWork] = useState<AssociatedWork[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setWork([]); setError(null)
    return controller.watchSessionWork(sessionId, setWork, setError)
  }, [controller, sessionId])
  return { work, error }
}

/** One compact association popover; blank Hero keeps its own visible dock seat. */
export function ExecutionSessionWorkEntry({ controller, sessionId, blank, placement }: { controller: WorkPanelController; sessionId: string; blank: boolean; placement: 'header' | 'dock' }) {
  const { work, error } = useSessionWork(controller, sessionId)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const scope = useRef<AbortController>()
  useEffect(() => { const abort = new AbortController(); scope.current = abort; setNavigationError(null); setOpening(false); return () => abort.abort() }, [sessionId])
  if (!work.length && !error) return null
  if (placement === 'header' && blank) return null
  if (placement === 'dock' && !blank && !work.some(item => item.purpose === 'history')) return null
  const enter = async (item: AssociatedWork) => {
    const abort = scope.current
    if (!abort || abort.signal.aborted || opening) return
    setOpening(true); setNavigationError(null)
    try { await controller.openCurrentTask(item.ref, abort.signal) }
    catch (error) { if (!abort.signal.aborted) setNavigationError(error instanceof Error ? error.message : String(error)) }
    finally { if (!abort.signal.aborted) setOpening(false) }
  }
  if (placement === 'dock' && work.some(item => item.purpose === 'history')) return <div className={`${styles.entry} ${styles.card}`} role="status">
    {work.filter(item => item.purpose === 'history').map(item => <div key={`${item.ref.projectId}/${item.ref.taskId}`}>
      <p>“{item.title}”的处理会话已切换。交接内容是否送达，请查看「A²D² 接续」。你仍可在这里继续对话。</p>
      <button type="button" disabled={opening} onClick={() => void enter(item)}>进入会话</button>
    </div>)}
    {navigationError && <p role="alert">{navigationError}</p>}
  </div>
  return <details className={`${styles.entry} ${placement === 'dock' ? styles.dock : ''}`}><summary>关联任务{work.length ? ` · ${work.length}` : ''}</summary><div className={styles.popover}>
    {error && <p role="status">关联读取失败：{error}</p>}
    {work.map(item => <article key={`${item.ref.projectId}/${item.ref.taskId}`}><p>{item.projectName} / {item.title}</p><p>{item.purpose === 'control' ? '当前协调' : item.purpose === 'history' ? '已交接 · 可继续对话' : item.purpose === 'review' ? '评审关联' : '工作关联'}</p><div className={styles.row}><button type="button" onClick={() => void controller.revealTask(item.ref)}>工作详情</button>{item.purpose === 'history' && <button type="button" disabled={opening} onClick={() => void enter(item)}>进入会话</button>}</div></article>)}
    {navigationError && <p role="alert">{navigationError}</p>}
  </div></details>
}

function NativeTaskContinuation({ controller, sessionId, work }: { controller: WorkPanelController; sessionId: string; work: AssociatedWork }) {
  const [detail, setDetail] = useState<ExecutionDetail>()
  const [policy, setPolicy] = useState<ContinuationPolicy>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const lifetime = useRef<AbortController>()
  useEffect(() => { const scope = new AbortController(); lifetime.current = scope; setBusy(false); setDetail(undefined); setPolicy(undefined); setError(null); return () => scope.abort() }, [controller, sessionId, work.ref.projectId, work.ref.taskId])
  useEffect(() => {
    const abort = new AbortController()
    setError(null)
    void Promise.all([
      controller.client.query({ type: 'task.detail', ref: work.ref }, abort.signal),
      controller.client.query({ type: 'project.detail', projectId: work.ref.projectId }, abort.signal),
    ]).then(([next, project]) => {
      if (abort.signal.aborted) return
      if (next.task?.id !== work.ref.taskId || next.task.projectId !== work.ref.projectId) throw Error('工作身份与会话关联不一致')
      setDetail(next); setPolicy(next.execution?.continuationPolicy ?? project.project?.continuationPolicy)
    }).catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : String(error)) })
    return () => abort.abort()
  }, [controller, sessionId, work.ref.projectId, work.ref.taskId, work.executionId, work.epoch, work.purpose, revision])
  const controlWork = async (action: 'continue' | 'reconcile' | 'resume') => {
    const scope = lifetime.current
    if (busy || !scope || scope.signal.aborted) return
    setBusy(true); setError(null)
    try {
      const latest = await controller.client.query({ type: 'task.detail', ref: work.ref }, scope.signal)
      if (scope.signal.aborted) return
      const execution = latest.execution
      if (!execution || (action === 'continue' && !execution.actual) || execution.session.sessionId !== sessionId || latest.task?.id !== work.ref.taskId || latest.task.projectId !== work.ref.projectId
        || execution.ref.taskId !== work.ref.taskId || execution.ref.projectId !== work.ref.projectId) throw Error('此会话已不是当前协调，请从关联任务进入有效会话。')
      const fence = { ref: work.ref, executionId: execution.id, owner: execution.owner, epoch: execution.epoch }
      const result = await controller.submit(action === 'resume'
        ? { type: 'task.control', ...fence, action, text: '用户明确恢复处理' }
        : { type: action === 'reconcile' ? 'task.reconcile' : 'task.continue', ...fence })
      if (!scope.signal.aborted) {
        setDetail({ ...latest, ...result })
        setRevision(value => value + 1)
      }
    } catch (error) { if (!scope.signal.aborted) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (!scope.signal.aborted) setBusy(false) }
  }
  const completed = Boolean(detail?.task?.completion || detail?.progress?.completion || detail?.progress?.processingState === 'completed')
  const purpose = work.purpose === 'control' ? '当前协调' : work.purpose === 'history' ? '已交接 · 可继续对话' : work.purpose === 'review' ? '评审关联' : '工作关联'
  return <section className={styles.nativeView}>
    <div className={styles.split}>
      <aside className={styles.taskPanel}>
        <div className={styles.taskCard}>
          <small>{work.projectName}</small>
          <strong>{work.title}</strong>
          <p>{purpose}</p>
        </div>
        <div className={styles.taskActions}>
          <button type="button" onClick={() => void controller.revealTask(work.ref)}>返回工作</button>
          <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>刷新</button>
        </div>
        {error && <p role="alert">{error}</p>}
      </aside>
      <div className={styles.configPane}>
        {detail ? <ExecutionContinuation graph={detail.executionGraph} execution={detail.execution} policy={policy} busy={busy} completed={completed} {...(work.purpose === 'control' && !completed && detail.execution?.session.sessionId === sessionId ? { onContinue: () => void controlWork('continue'), onRecover: () => void controlWork('reconcile'), onResume: () => void controlWork('resume') } : {})}/> : !error && <p role="status">正在读取接续事实…</p>}
      </div>
    </div>
  </section>
}

/** Native conversation.view occupant: never owns the host title, composer or draft. */
export function ExecutionConversationContinuation({ controller, sessionId }: { controller: WorkPanelController; sessionId: string }) {
  const { work, error } = useSessionWork(controller, sessionId)
  return <div>{error && <p role="alert">{error}</p>}{!work.length && !error && <p className={styles.surface}>此会话尚未关联 Task。关联后可查看原段、固定后继与接续参数。</p>}{work.map(item => <NativeTaskContinuation key={`${item.ref.projectId}/${item.ref.taskId}`} controller={controller} sessionId={sessionId} work={item}/>)}</div>
}
