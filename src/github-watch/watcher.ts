/**
 * Turns the hooks service's PR states into session messages.
 *
 * For every state it receives, the watcher compares it with what each watching
 * session was last told and wakes the session only on a difference. The first
 * state of a watch answers the `github_watch` call itself; a watch ends once a
 * terminal state (merged, closed, not found) has been told.
 *
 * @module @a2d2-dev/dsh-a2d2/src/github-watch/watcher
 */

import { createHash } from 'node:crypto'
import { RepoConnection } from './relay.ts'
import type { RelayEvent, RelayOptions } from './relay.ts'
import { isTerminal, noticeSummary, noticeText, sameState } from './state.ts'
import type { PrState } from './state.ts'
import type { Watch, WatchStore } from './store.ts'

/** Delivers one message to a session; `gone` means the session no longer exists. */
export type Inject = (session: string, message: { text: string; summary: string; repo: string; pr: number; eventId?: string }, watch?: Watch) => Promise<'delivered' | 'gone'>

/** State identity survives a crash between task enqueue and watch acknowledgement. */
export function watchEventId(watch: Watch, state: PrState | RelayEvent): string {
  const digest = createHash('sha256').update(JSON.stringify(Object.entries(state).sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
  return `github:${watch.repo.toLowerCase()}:${watch.pr}:${watch.session}:${watch.since}:${(watch.revision ?? 0) + 1}:${digest}`
}

/** How a `github_watch` call ended. */
export type WatchResult =
  | { readonly status: 'watching'; readonly state: PrState }
  | { readonly status: 'ended'; readonly state: PrState }
  | { readonly status: 'pending'; readonly message: string }
  | { readonly status: 'not_installed'; readonly message: string; readonly installUrl: string }
  | { readonly status: 'denied'; readonly message: string }

export interface WatcherOptions {
  readonly store: WatchStore
  readonly relay: RelayOptions
  readonly inject: Inject
  readonly log?: (message: string) => void
  /** How long a `github_watch` call waits for the first state. */
  readonly answerTimeoutMs?: number
  readonly connect?: (repo: string, onEvent: (event: RelayEvent) => void) => Pick<RepoConnection, 'watch' | 'unwatch' | 'stop' | 'watching'>
}

type Key = string
const keyOf = (repo: string, pr: number, session: string): Key => `${repo.toLowerCase()}#${pr}#${session}`
const repoKey = (repo: string) => repo.toLowerCase()

interface Waiter {
  resolve(result: WatchResult): void
}

export class Watcher {
  private readonly connections = new Map<string, Pick<RepoConnection, 'watch' | 'unwatch' | 'stop' | 'watching'>>()
  private readonly waiters = new Map<Key, Waiter>()
  private chain: Promise<unknown> = Promise.resolve()
  private readonly options: WatcherOptions

  constructor(options: WatcherOptions) {
    this.options = options
  }

  /** Reconnect every stored watch; the snapshots that follow report what was missed. */
  async start(): Promise<void> {
    const byRepo = new Map<string, { repo: string; prs: Set<number> }>()
    for (const watch of await this.options.store.list()) {
      const entry = byRepo.get(repoKey(watch.repo)) ?? { repo: watch.repo, prs: new Set() }
      entry.prs.add(watch.pr)
      byRepo.set(repoKey(watch.repo), entry)
    }
    for (const { repo, prs } of byRepo.values()) this.connection(repo).watch([...prs])
  }

  stop(): void {
    for (const connection of this.connections.values()) connection.stop()
    this.connections.clear()
    for (const waiter of this.waiters.values()) waiter.resolve({ status: 'pending', message: 'the watcher is shutting down' })
    this.waiters.clear()
  }

  /** Start watching `repo#pr` for `session`; resolves with the PR's current state. */
  async watch(repo: string, pr: number, session: string, task?: Watch['task']): Promise<WatchResult> {
    const key = keyOf(repo, pr, session)
    await this.options.store.add({ repo, pr, session, last: null, since: new Date().toISOString(), ...(task ? { task } : {}) })
    let waiter: Waiter | undefined
    const answered = new Promise<WatchResult>(resolve => {
      this.waiters.get(key)?.resolve({ status: 'pending', message: 'superseded by a newer watch call' })
      waiter = { resolve }
      this.waiters.set(key, waiter)
    })
    const timeout = new Promise<WatchResult>(resolve => {
      const timer = setTimeout(() => resolve({
        status: 'pending',
        message: 'the watch service has not answered yet; the session will be told the PR state once it does',
      }), this.options.answerTimeoutMs ?? 20_000)
      void answered.finally(() => clearTimeout(timer))
    })
    this.connection(repo).watch([pr])
    const result = await Promise.race([answered, timeout])
    // Timed out: from now on the first state is reported to the session as a message.
    if (this.waiters.get(key) === waiter) this.waiters.delete(key)
    return result
  }

  private connection(repo: string) {
    let connection = this.connections.get(repoKey(repo))
    if (connection === undefined) {
      const onEvent = (event: RelayEvent) => {
        void this.serial(() => this.handle(repo, event)).catch(error => {
          this.options.log?.(`github watch: handling ${event.type} for ${repo} failed: ${String(error)}`)
        })
      }
      connection = this.options.connect?.(repo, onEvent) ?? new RepoConnection(repo, this.options.relay, onEvent)
      this.connections.set(repoKey(repo), connection)
    }
    return connection
  }

  private async handle(repo: string, event: RelayEvent): Promise<void> {
    if (event.type === 'unavailable') {
      this.options.log?.(`github watch: ${repo}: ${event.message}`)
      return
    }
    const watches = (await this.options.store.list()).filter(w => repoKey(w.repo) === repoKey(repo))
    if (event.type === 'states') {
      for (const state of event.prs) {
        for (const watch of watches.filter(w => w.pr === state.number)) await this.report(watch, state)
      }
    } else {
      await this.refuse(watches, event)
    }
    await this.prune(repo)
  }

  /** Tell one watching session about `state` if it differs from what it was told. */
  private async report(watch: Watch, state: PrState): Promise<void> {
    const key = keyOf(watch.repo, watch.pr, watch.session)
    const waiter = this.waiters.get(key)
    if (waiter !== undefined) {
      // The first state answers the tool call; the session reads it there.
      this.waiters.delete(key)
      await this.settle(watch, state)
      waiter.resolve({ status: isTerminal(state) ? 'ended' : 'watching', state })
      return
    }
    if (watch.last !== null && sameState(watch.last, state)) return
    const delivered = await this.options.inject(watch.session, {
      text: noticeText(watch.repo, watch.last ?? undefined, state),
      summary: noticeSummary(watch.repo, watch.last ?? undefined, state),
      repo: watch.repo,
      pr: watch.pr,
      eventId: watchEventId(watch, state),
    }, watch)
    if (delivered === 'gone') {
      await this.options.store.remove(watch)
      return
    }
    await this.settle(watch, state)
  }

  private async settle(watch: Watch, state: PrState): Promise<void> {
    if (isTerminal(state)) await this.options.store.remove(watch)
    else await this.options.store.told(watch, state)
  }

  /** The service will not serve this repository: say so once and drop its watches. */
  private async refuse(watches: readonly Watch[], event: Extract<RelayEvent, { type: 'not_installed' | 'denied' }>): Promise<void> {
    const result: WatchResult = event.type === 'not_installed'
      ? { status: 'not_installed', message: event.message, installUrl: event.installUrl }
      : { status: 'denied', message: event.message }
    for (const watch of watches) {
      const key = keyOf(watch.repo, watch.pr, watch.session)
      const waiter = this.waiters.get(key)
      this.waiters.delete(key)
      if (waiter !== undefined) {
        waiter.resolve(result)
      } else {
        const why = event.type === 'not_installed'
          ? `the a2d2-bot GitHub App is not installed on ${watch.repo}. Ask the user to install it: ${event.installUrl}`
          : `GitHub denied access to ${watch.repo}: ${event.message}`
        await this.options.inject(watch.session, {
          text: `The watch on ${watch.repo} PR #${watch.pr} has stopped: ${why}`,
          summary: `${watch.repo}#${watch.pr}: watch stopped`,
          repo: watch.repo,
          pr: watch.pr,
          eventId: watchEventId(watch, event),
        }, watch)
      }
      await this.options.store.remove(watch)
    }
  }

  /** Unregister PRs nobody watches any more, and close idle connections. */
  private async prune(repo: string): Promise<void> {
    const connection = this.connections.get(repoKey(repo))
    if (connection === undefined) return
    const still = new Set((await this.options.store.list()).filter(w => repoKey(w.repo) === repoKey(repo)).map(w => w.pr))
    const idle = connection.watching().filter(pr => !still.has(pr))
    if (idle.length > 0) connection.unwatch(idle)
    if (still.size === 0) {
      connection.stop()
      this.connections.delete(repoKey(repo))
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.chain.then(operation)
    this.chain = run.catch(() => undefined)
    return run
  }
}
