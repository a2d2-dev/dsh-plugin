import { useState, useSyncExternalStore } from 'react'
import type { WorkPanelController } from './work-panel-controller.ts'
import { message } from './work-panel-controller.ts'
import styles from './work-panel.module.css'

export function SourceConnect({ controller, onSaved }: { controller: WorkPanelController; onSaved: () => void }) {
  const { connection } = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const candidate = connection.candidate
  return <section aria-label="添加来源"><h2>添加 GitHub 来源</h2><p>粘贴 Project 或仓库链接，使用此宿主已连接的 GitHub 账号识别，确认后添加。</p>
    <form className={styles.form} onSubmit={event => { event.preventDefault(); void controller.identifySource() }}>
      <label>GitHub Project / 仓库链接<input type="url" required value={connection.url} disabled={saving} onChange={event => { setError(''); controller.setSourceURLDraft(event.target.value) }} placeholder="https://github.com/owner/repository"/></label>
      <button disabled={saving || connection.loading} type="submit">{connection.loading ? '正在真实识别…' : '识别来源'}</button>
    </form>
    {candidate && <div className={styles.sourceSummary}><strong>{candidate.title}</strong><span>{candidate.kind === 'project' ? `GitHub Project · ${candidate.githubProject?.type === 'org' ? '组织' : '个人'} ${candidate.githubProject?.owner}` : `仓库 · ${candidate.repository?.owner}`}</span><span>读取账号：{candidate.identity.login} · 已确认可读取</span><p>{candidate.entryUrl}</p><button className={styles.primary} disabled={saving} onClick={() => { setSaving(true); setError(''); void controller.connectSource().then(onSaved, error => setError(message(error))).finally(() => setSaving(false)) }}>{saving ? '正在添加…' : '确认添加并进入概览'}</button></div>}
    {(error || connection.error) && <p className={styles.failure} role="alert">{error || connection.error}</p>}
  </section>
}
