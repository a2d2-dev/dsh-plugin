import type { TaskProgressView } from '../work-progress.ts'
import type { WorkExecution } from '../work-types.ts'
import styles from './work-panel.module.css'

export type SessionEntry = { session: WorkExecution['session']; runtime?: 'running' | 'idle' | 'inactive'; state?: WorkExecution['state'] }
/** The session currently attached to a Task, when the projection exposes one. */
export function sessionOf(progress?: TaskProgressView): SessionEntry | undefined {
  return progress?.execution ? { session: progress.execution.session, runtime: progress.execution.runtime, state: progress.execution.state } : undefined
}
/** A compact, clickable session reference shared by the Project, Issue and PR tables. */
export function SessionCell({ entry, onOpen }: { entry?: SessionEntry; onOpen: (session: WorkExecution['session']) => void }) {
  if (!entry) return <span className={styles.sessionEmpty}>—</span>
  const short = entry.session.sessionId.replace(/^session-/, '').slice(0, 8)
  return <span className={styles.sessionCell} title={`${entry.session.sessionId} · ${entry.state ?? ''}${entry.runtime ? ` · ${entry.runtime}` : ''}`}>
    <span className={styles.sessionDot} data-runtime={entry.runtime ?? 'inactive'}/>
    <button className={styles.sessionLink} onClick={() => onOpen(entry.session)}>session-{short}</button>
  </span>
}
