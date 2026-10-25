import { useScrollLoad } from './use-scroll-load.ts'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorkPanelController } from './work-panel-controller.ts'
import { message } from './work-panel-controller.ts'
import styles from './work-panel.module.css'
import { PanelIcon } from './icons.tsx'

export function SourceConnect({ controller, onSaved, onBack }: { controller: WorkPanelController; onSaved: () => void; onBack?: () => void }) {
  const { connection, github, projectSources } = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [mode, setMode] = useState<'repositories' | 'link'>('repositories')
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [search, setSearch] = useState(''), [owner, setOwner] = useState(''), [visibility, setVisibility] = useState('all')
  const list=useRef<HTMLDivElement>(null), sentinel=useRef<HTMLDivElement>(null)
  useScrollLoad({target:sentinel,root:list,enabled:mode==='repositories'&&github.account?.status==='connected'&&Boolean(github.nextPage),busy:github.repositoriesLoading,error:github.error,loadMore:()=>void controller.loadGitHubRepositories()})
  const candidate = connection.candidate, identity = github.account?.identity?.nodeId
  useEffect(() => {
    if (github.account?.status === 'connected' && !github.repositoriesLoaded && !github.repositoriesLoading && !github.error) void controller.loadGitHubRepositories()
  }, [controller, identity, github.account?.status, github.repositoriesLoaded, github.repositoriesLoading, github.error])
  useEffect(() => { setOwner(''); setSearch('') }, [identity])
  const owners = [...new Set(github.items.map(item => item.owner))].sort()
  const visible = github.items.filter(item => (!owner || item.owner === owner)
    && (visibility === 'all' || item.private === (visibility === 'private'))
    && `${item.owner}/${item.name} ${item.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
  const connected = new Set(Object.values(projectSources).flat().map(source => source.nodeId))
  const confirm = () => { setSaving(true); setError(''); void controller.connectSource().then(onSaved, error => setError(message(error))).finally(() => setSaving(false)) }
  return <section className={styles.sourceConnect} aria-label="添加来源">
    <header><div>{onBack&&<button className={styles.sourceRefresh} aria-label="返回" title="返回" onClick={onBack}><PanelIcon name="back"/></button>}<h2>添加仓库</h2></div>{mode==='repositories'&&<button className={styles.sourceRefresh} aria-label="刷新仓库" title="刷新仓库" disabled={github.repositoriesLoading || github.account?.status !== 'connected'} onClick={() => void controller.loadGitHubRepositories(true)}><PanelIcon name="refresh"/></button>}</header>
    <nav className={styles.tabs} aria-label="添加方式"><button type="button" aria-pressed={mode==='repositories'} onClick={()=>setMode('repositories')}>选择仓库</button><button type="button" aria-pressed={mode==='link'} onClick={()=>setMode('link')}>通过链接</button></nav>
    {mode==='repositories'&&<>
    {github.account?.status === 'connected' ? <>
      <div className={styles.repositoryFilters}>
        <input type="search" aria-label="搜索仓库" placeholder="搜索仓库" value={search} onChange={event => setSearch(event.target.value)}/>
        <select aria-label="仓库所属账号或组织" value={owner} onChange={event => setOwner(event.target.value)}><option value="">全部归属</option>{owners.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label="仓库可见性" value={visibility} onChange={event => setVisibility(event.target.value)}><option value="all">全部可见性</option><option value="private">私有</option><option value="public">公开</option></select>
      </div>
      <p className={styles.repositoryScope} title={github.nextPage ? '搜索和筛选仅作用于已读取的仓库，可加载更多。' : undefined}>{search || owner || visibility !== 'all' ? `${visible.length} 个匹配 · ` : ''}已读取 {github.items.length} 个仓库</p>
      <div ref={list} className={styles.repositoryList} aria-busy={github.repositoriesLoading}>
        {visible.map(item => <button key={item.nodeId} className={styles.repositoryOption} disabled={saving || connection.loading || connected.has(item.nodeId)} aria-pressed={candidate?.nodeId === item.nodeId} onClick={() => { controller.setSourceURLDraft(item.url); void controller.identifySource() }}>
          <span><strong title={`${item.owner}/${item.name}`}>{item.owner}/{item.name}</strong><small>{item.private ? '私有' : '公开'}{item.archived ? ' · 已归档' : ''}{connected.has(item.nodeId) ? ' · 已添加' : ''}</small></span>
          <span title={item.description??undefined}>{item.description??''}</span>
        </button>)}
        {!visible.length && github.repositoriesLoaded && !github.nextPage && !github.repositoriesLoading && !github.error && <p>{github.items.length ? '没有匹配的仓库' : '暂无可访问的仓库，请检查授权。'}</p>}
        {github.repositoriesLoading && <p role="status">正在加载…</p>}
        <div ref={sentinel} className={styles.loadSentinel} aria-label="仓库加载状态"/>
      </div>
      {github.error && <p className={styles.failure} role="alert">{github.error} <button onClick={() => void controller.loadGitHubRepositories(!github.repositoriesLoaded)}>重试</button></p>}
    </> : <p role="status">请先通过右上角头像连接 GitHub。</p>}
    </>}
    {mode==='link'&&<div className={styles.sourceLinkEntry}>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); void controller.identifySource() }}>
        <label>仓库或 Project 链接<input type="url" required value={connection.url} disabled={saving} onChange={event => { setError(''); controller.setSourceURLDraft(event.target.value) }} placeholder="https://github.com/owner/repository"/></label>
        <button disabled={saving || connection.loading} type="submit">{connection.loading ? '正在读取…' : '读取'}</button>
      </form>
    </div>}
    {connection.loading && <p role="status">正在读取…</p>}
    {candidate && <footer className={styles.sourceConfirm} aria-label="确认添加"><div><PanelIcon name={candidate.kind === 'project' ? 'project' : 'repo'}/><strong title={candidate.title}>{candidate.title}</strong></div><button className={styles.primary} disabled={saving} onClick={confirm}>{saving ? '正在添加…' : '添加'}</button></footer>}
    {(error || connection.error) && <p className={styles.failure} role="alert">{error || connection.error}</p>}
  </section>
}
