import { useEffect, useState, useSyncExternalStore } from 'react'
import type { WorkPanelController } from './work-panel-controller.ts'
import type { AssociatedWork, SessionRef } from '../work-types.ts'
import { message } from './work-panel-controller.ts'
import styles from './work-panel.module.css'

export function WorkPanel({ controller }: { controller: WorkPanelController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => { void controller.load() }, [controller])
  return <main className={styles.panel} aria-label="A²D² 控制面板">
    <header className={styles.header}><h1>A²D² 控制面板</h1><button onClick={() => controller.close()}>关闭面板</button></header>
    {state.error && <p role="alert">{state.error}</p>}
    {state.loading && <p role="status">正在读取工作…</p>}
    <label>当前项目 <select value={state.projectId ?? ''} onChange={event => void controller.selectProject(event.target.value)}>
      {state.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select></label>
    {state.projects.length === 0 && !state.loading && <p>尚无项目。接入已有资源或创建本地项目后，可保存工作目标、规格和验收。</p>}
    {state.projectId && <section><h2>项目内容</h2>{controller.visibleTasks().map(task => <button key={task.id} onClick={() => void controller.openTask({projectId: task.projectId, taskId: task.id})}>{task.title}</button>)}</section>}
  </main>
}

/** Query uses host-authorized runtime references; an unassociated session renders nothing. */
export function SessionWorkEntry({controller, sessionId}: {controller: WorkPanelController; sessionId: string}) {
  const [work, setWork] = useState<AssociatedWork[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    async function load() {
      try {
        const resources = await controller.client.query({type:'resources.list'}, abort.signal)
        const runtimes = [...new Set(resources.resources?.map(resource => resource.ref.runtimeId) ?? [])]
        const results = await Promise.all(runtimes.map(runtimeId => controller.client.query({type:'session.work',session:{runtimeId,sessionId}}, abort.signal)))
        if (!abort.signal.aborted) setWork(results.flatMap(result => result.work ?? []))
      } catch (error) { if (!abort.signal.aborted) setError(message(error)) }
    }
    void load()
    return () => abort.abort()
  },[controller,sessionId])
  if (error) return <span title={error}>工作关联读取失败</span>
  if (!work.length) return null
  return <div className={styles.sessionEntry}>{work.map(item => <button key={`${item.ref.projectId}/${item.ref.taskId}`} onClick={() => void controller.revealTask(item.ref)} title="查看工作与进展">{item.projectName} / {item.title} · 工作与进展</button>)}</div>
}
