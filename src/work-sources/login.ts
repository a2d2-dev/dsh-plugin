import { spawn } from 'node:child_process'
import type { GitHubLogin } from './types.ts'

export interface LoginProcess {
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): unknown }
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): unknown }
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'close', listener: (code: number | null) => void): unknown
  kill(): unknown
}
/** The CLI owns credentials. Only the public device code crosses the UI boundary. */
export class GitHubLoginFlow {
  private current: GitHubLogin = { state: 'idle' }
  private child?: LoginProcess
  private timer?: ReturnType<typeof setTimeout>
  constructor(private readonly launch: () => LoginProcess = () => spawn('gh', [
    'auth', 'login', '--hostname', 'github.com', '--web', '--git-protocol', 'https', '--skip-ssh-key',
  ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', LC_ALL: 'C' } })) {}
  status(): GitHubLogin { return { ...this.current } }
  start(): GitHubLogin {
    if (this.child) return this.status()
    this.current = { state: 'pending', url: 'https://github.com/login/device' }
    let child: LoginProcess
    try { child = this.launch() } catch { this.current = { state: 'error', message: '无法启动 GitHub CLI，请确认此宿主已安装 gh。' }; return this.status() }
    this.child = child
    let output = ''
    const consume = (chunk: Buffer) => {
      if (this.child !== child) return
      output = (output + chunk.toString('utf8')).slice(-8192)
      const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(output)?.[1]
      if (code) this.current = { state: 'pending', code, url: 'https://github.com/login/device' }
    }
    child.stdout.on('data', consume)
    child.stderr.on('data', consume)
    const finish = (state: GitHubLogin) => {
      if (this.child !== child) return
      clearTimeout(this.timer)
      this.child = undefined
      this.current = state
    }
    child.once('error', () => finish({ state: 'error', message: '无法启动 GitHub CLI，请确认此宿主已安装 gh。' }))
    child.once('close', code => finish(code === 0 ? { state: 'complete' } : { state: 'error', message: 'GitHub 登录未完成，请重试；若由环境变量提供凭据，请先检查宿主配置。' }))
    this.timer = setTimeout(() => { this.cancel(); this.current = { state: 'error', message: '登录已超时，请重新连接 GitHub。' } }, 10 * 60_000)
    this.timer.unref()
    return this.status()
  }
  cancel(): GitHubLogin {
    const child = this.child
    this.child = undefined
    clearTimeout(this.timer)
    this.current = { state: 'idle' }
    child?.kill()
    return this.status()
  }
}
