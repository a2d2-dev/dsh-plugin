/**
 * One repository's connection to the a2d2 hooks service (`hooks.a2d2.dev`):
 * mint a ticket with the user's GitHub token, open the WebSocket, keep the
 * watched PR numbers registered across reconnects, and report what arrives.
 *
 * The connection is outbound only. It never reads GitHub itself; the service
 * owns PR state and answers every `watch` with a snapshot, which is how a
 * reconnect catches up.
 *
 * @module @a2d2/dsh-a2d2/src/github-watch/relay
 */

import { isPrState } from './state.ts'
import type { PrState } from './state.ts'

export const DEFAULT_RELAY_URL = 'https://hooks.a2d2.dev'

/** What a connection reports to its owner. */
export type RelayEvent =
  /** PR states from a snapshot or a change push. */
  | { readonly type: 'states'; readonly prs: readonly PrState[] }
  /** a2d2-bot is not installed on the repository; the connection has stopped. */
  | { readonly type: 'not_installed'; readonly message: string; readonly installUrl: string }
  /** GitHub denied the user's token for this repository; the connection has stopped. */
  | { readonly type: 'denied'; readonly message: string }
  /** A transient failure; the connection keeps retrying. */
  | { readonly type: 'unavailable'; readonly message: string }

/** The subset of the WHATWG WebSocket this module uses (Node 22 ships one). */
export interface SocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
  onerror: ((event: unknown) => void) | null
}

export interface RelayOptions {
  readonly baseUrl: string
  /** The user's GitHub token (e.g. `gh auth token`); asked for on every ticket. */
  readonly token: () => Promise<string>
  readonly fetch?: typeof fetch
  readonly openSocket?: (url: string) => SocketLike
  readonly pingMs?: number
  readonly minBackoffMs?: number
  readonly maxBackoffMs?: number
}

const OPEN = 1

/** A live subscription to one repository's watched PRs. */
export class RepoConnection {
  private readonly prs = new Set<number>()
  private socket: SocketLike | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private ping: ReturnType<typeof setInterval> | undefined
  private backoff: number
  private stopped = false
  private connecting = false
  readonly repo: string
  private readonly options: RelayOptions
  private readonly onEvent: (event: RelayEvent) => void

  constructor(repo: string, options: RelayOptions, onEvent: (event: RelayEvent) => void) {
    this.repo = repo
    this.options = options
    this.onEvent = onEvent
    this.backoff = options.minBackoffMs ?? 1_000
  }

  /** PR numbers currently registered. */
  watching(): readonly number[] {
    return [...this.prs]
  }

  /** Register PRs; sends a `watch` now if connected, otherwise on connect. */
  watch(prs: readonly number[]): void {
    for (const n of prs) this.prs.add(n)
    if (this.stopped) {
      // A new watch after not_installed/denied is the user's cue that it may work now.
      this.stopped = false
      this.backoff = this.options.minBackoffMs ?? 1_000
    }
    if (this.socket?.readyState === OPEN) this.send({ type: 'watch', prs })
    else this.connect()
  }

  unwatch(prs: readonly number[]): void {
    for (const n of prs) this.prs.delete(n)
    if (this.socket?.readyState === OPEN) this.send({ type: 'unwatch', prs })
    if (this.prs.size === 0) this.stop()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.retry)
    clearInterval(this.ping)
    this.retry = undefined
    const socket = this.socket
    this.socket = undefined
    socket?.close(1000, 'done')
  }

  private connect(): void {
    if (this.stopped || this.connecting || this.socket !== undefined || this.retry !== undefined) return
    this.connecting = true
    void this.open().finally(() => {
      this.connecting = false
    })
  }

  private async open(): Promise<void> {
    let streamUrl: string
    try {
      const doFetch = this.options.fetch ?? fetch
      const response = await doFetch(`${this.options.baseUrl}/v1/tickets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await this.options.token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ repo: this.repo }),
      })
      const body = (await response.json().catch(() => ({}))) as { streamUrl?: string; message?: string; installUrl?: string }
      if (response.status === 409) {
        this.halt({ type: 'not_installed', message: body.message ?? `a2d2-bot is not installed on ${this.repo}`, installUrl: body.installUrl ?? '' })
        return
      }
      if (response.status === 401 || response.status === 403) {
        this.halt({ type: 'denied', message: body.message ?? `GitHub denied access to ${this.repo}` })
        return
      }
      if (!response.ok || typeof body.streamUrl !== 'string') throw new Error(body.message ?? `ticket request answered ${response.status}`)
      streamUrl = body.streamUrl
    } catch (error) {
      this.onEvent({ type: 'unavailable', message: `cannot reach the watch service: ${errorText(error)}` })
      this.scheduleReconnect()
      return
    }
    if (this.stopped) return

    const socket = (this.options.openSocket ?? defaultOpenSocket)(streamUrl)
    this.socket = socket
    socket.onopen = () => {
      this.backoff = this.options.minBackoffMs ?? 1_000
      if (this.prs.size > 0) this.send({ type: 'watch', prs: [...this.prs] })
      clearInterval(this.ping)
      this.ping = setInterval(() => {
        if (socket.readyState === OPEN) socket.send('ping')
      }, this.options.pingMs ?? 30_000)
    }
    socket.onmessage = event => this.receive(String(event.data))
    socket.onerror = () => undefined
    socket.onclose = event => {
      if (this.socket !== socket) return
      this.socket = undefined
      clearInterval(this.ping)
      if (this.stopped) return
      // 4001: the socket outlived its ticket's authority; a fresh ticket fixes it at once.
      if (event.code === 4001) this.connect()
      else this.scheduleReconnect()
    }
  }

  private receive(text: string): void {
    if (text === 'pong') return
    let message: { type?: unknown; prs?: unknown; pr?: unknown; code?: unknown; message?: unknown; installUrl?: unknown }
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    if (message.type === 'snapshot' && Array.isArray(message.prs)) {
      this.onEvent({ type: 'states', prs: message.prs.filter(isPrState) })
    } else if (message.type === 'pr' && isPrState(message.pr)) {
      this.onEvent({ type: 'states', prs: [message.pr] })
    } else if (message.type === 'error' && message.code === 'not_installed') {
      this.halt({
        type: 'not_installed',
        message: String(message.message ?? ''),
        installUrl: typeof message.installUrl === 'string' ? message.installUrl : '',
      })
    } else if (message.type === 'error') {
      this.onEvent({ type: 'unavailable', message: String(message.message ?? message.code) })
    }
  }

  private halt(event: RelayEvent): void {
    this.stop()
    this.onEvent(event)
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retry !== undefined) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, this.options.maxBackoffMs ?? 60_000)
    this.retry = setTimeout(() => {
      this.retry = undefined
      this.connect()
    }, delay)
  }

  private send(message: unknown): void {
    try {
      this.socket?.send(JSON.stringify(message))
    } catch {
      // The close handler reconnects and re-sends the whole watch set.
    }
  }
}

function defaultOpenSocket(url: string): SocketLike {
  return new WebSocket(url) as unknown as SocketLike
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
