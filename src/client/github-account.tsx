import { PanelIcon } from './icons.tsx'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorkPanelController } from './work-panel-controller.ts'
import styles from './work-panel.module.css'

export function GitHubAccountControl({ controller, onManageSources }: { controller: WorkPanelController; onManageSources?: () => void }) {
  const { github } = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const details = useRef<HTMLDetailsElement>(null)
  const account = github.account, login = account?.login
  const connected = account?.status === 'connected', username = account?.identity?.login
  const status = connected ? '已连接' : login?.state === 'pending' ? '等待授权' : github.busy ? '正在检查…' : account?.status === 'unavailable' ? '状态待确认' : '未连接'
  const close = () => { setConfirmLogout(false); if (details.current) details.current.open = false }
  useEffect(() => { void controller.refreshGitHubAccount() }, [controller])
  useEffect(() => {
    const dismiss = (event: MouseEvent) => { if (event.target instanceof Node && !details.current?.contains(event.target)) close() }
    document.addEventListener('click', dismiss)
    return () => document.removeEventListener('click', dismiss)
  }, [])
  useEffect(() => {
    if (login?.state !== 'pending') return
    const timer = setInterval(() => { void controller.refreshGitHubAccount() }, 2000)
    return () => clearInterval(timer)
  }, [controller, login?.state])
  return <details ref={details} className={styles.githubAccount} onKeyDown={event => { if (event.key === 'Escape') { close(); details.current?.querySelector('summary')?.focus() } }}>
    <summary aria-label={`GitHub 账号：${connected ? username : '未连接'}`} title={connected ? `GitHub @${username} · ${status}` : `GitHub · ${status}`}>
      <span className={styles.githubAvatar} aria-hidden="true">{username?.slice(0, 1).toUpperCase() ?? 'GH'}</span>
    </summary>
    <section className={styles.githubAccountMenu} aria-label="GitHub 连接状态">
      <div className={styles.githubAccountHeading}><strong>{connected ? `@${username}` : '尚未连接'}</strong><span className={styles.githubAccountStatus}>GitHub · {status}</span></div>
      {confirmLogout && connected ? <div className={styles.githubLoginContent} role="group" aria-label="确认退出 GitHub">
        <p>退出 @{username}？这会移除该账号在此宿主的 gh 登录，影响同一宿主使用此账号的 GitHub 功能。</p>
        <div className={styles.logoutConfirmActions}><button disabled={github.busy} onClick={() => setConfirmLogout(false)}>取消</button><button className={styles.dangerAction} disabled={github.busy} onClick={() => { void controller.logoutGitHub().then(() => setConfirmLogout(false)) }}>{github.busy ? '退出中…' : '确认退出'}</button></div>
      </div> : login?.state === 'pending' ? <div className={styles.githubLoginContent}>
        <p role="status">在 GitHub 页面完成授权后自动更新。</p>
        {login.code ? <p>一次性验证码：<code>{login.code}</code></p> : <p role="status">正在获取验证码…</p>}
        {login.url && <a href="https://github.com/login/device" target="_blank" rel="noreferrer">打开 GitHub 授权页 ↗</a>}
        <button disabled={github.busy} onClick={() => void controller.loginGitHub('cancel')}>取消授权</button>
      </div> : <div className={styles.githubAccountActions}>
        {connected && username && <a href={`https://github.com/${encodeURIComponent(username)}`} target="_blank" rel="noreferrer"><PanelIcon name="external"/>个人主页</a>}
        {onManageSources && <button onClick={() => { close(); onManageSources() }}><PanelIcon name="repo"/>来源管理</button>}
        <button disabled={github.busy} onClick={() => void controller.refreshGitHubAccount()}><PanelIcon name="refresh" className={github.busy?styles.iconSpin:undefined}/>刷新状态</button>
        <button disabled={github.busy} onClick={() => void controller.loginGitHub('start')}><PanelIcon name="link"/>{connected ? '重新授权' : '连接 GitHub'}</button>
        {connected && <button className={styles.dangerAction} disabled={github.busy || account.canLogout === false} title={account.canLogout === false ? '凭据由宿主环境管理，请在宿主配置中退出。' : '退出此宿主保存的 GitHub 账号'} onClick={() => setConfirmLogout(true)}><PanelIcon name="logout"/>退出登录</button>}
      </div>}
      {!connected && account?.message && <p className={styles.githubAccountNote}>{account.message}</p>}
      {login?.state === 'error' && <p role="alert" className={styles.failure}>{login.message}</p>}
      {github.error && <p role="alert" className={styles.failure}>{github.error}</p>}
    </section>
  </details>
}
