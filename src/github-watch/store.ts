/**
 * The durable list of watches: which session waits on which pull request, and
 * the PR state it was last told about.
 *
 * It lives in the DSH home (not a project) because the watcher must reconnect
 * every watch after a restart without knowing which projects to look in. The
 * last-told state is what makes "changes while DSH was down are reported
 * exactly once" hold: the snapshot after reconnecting is compared with it.
 *
 * @module @deepseek-ai/dsh-a2d2/src/github-watch/store
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isPrState } from './state.ts'
import type { PrState } from './state.ts'

/** File name of the watch list inside the A²D² home directory. */
export const WATCHES_FILE = 'github-watches.json'

export interface Watch {
  /** `owner/name`, as GitHub spells it. */
  readonly repo: string
  readonly pr: number
  /** The session to wake. */
  readonly session: string
  /** The state this session was last told about; `null` before the first one. */
  readonly last: PrState | null
  readonly since: string
}

const sameWatch = (a: Pick<Watch, 'repo' | 'pr' | 'session'>, b: Pick<Watch, 'repo' | 'pr' | 'session'>) =>
  a.repo.toLowerCase() === b.repo.toLowerCase() && a.pr === b.pr && a.session === b.session

function parse(text: string): Watch[] {
  const data = JSON.parse(text) as { version?: unknown; watches?: unknown }
  if (data.version !== 1 || !Array.isArray(data.watches)) throw new Error('unrecognized watch list format')
  return data.watches.filter((w): w is Watch => typeof w === 'object' && w !== null
    && typeof w.repo === 'string' && Number.isSafeInteger(w.pr) && typeof w.session === 'string'
    && (w.last === null || isPrState(w.last)) && typeof w.since === 'string')
}

/** Serialized, write-through access to the watch list file. */
export class WatchStore {
  private readonly file: string
  private cache: Watch[] | undefined
  private chain: Promise<unknown> = Promise.resolve()

  constructor(directory: string) {
    this.file = join(directory, WATCHES_FILE)
  }

  /** Every watch, in insertion order. */
  async list(): Promise<readonly Watch[]> {
    return this.serial(async () => [...(await this.load())])
  }

  /** Add a watch, or keep the existing one for the same repo, PR, and session. */
  async add(watch: Watch): Promise<void> {
    await this.mutate(watches => (watches.some(w => sameWatch(w, watch)) ? watches : [...watches, watch]))
  }

  /** Record what the session has now been told. */
  async told(watch: Pick<Watch, 'repo' | 'pr' | 'session'>, state: PrState): Promise<void> {
    await this.mutate(watches => watches.map(w => (sameWatch(w, watch) ? { ...w, last: state } : w)))
  }

  async remove(watch: Pick<Watch, 'repo' | 'pr' | 'session'>): Promise<void> {
    await this.mutate(watches => watches.filter(w => !sameWatch(w, watch)))
  }

  private async mutate(change: (watches: Watch[]) => Watch[]): Promise<void> {
    // The lock file sits beside the list, so its directory must exist first.
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    await this.serial(() => withFileLock(this.file, async () => {
      this.cache = undefined
      const next = change(await this.load())
      await writeFileAtomic(this.file, `${JSON.stringify({ version: 1, watches: next }, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
      this.cache = next
    }))
  }

  private async load(): Promise<Watch[]> {
    if (this.cache !== undefined) return this.cache
    try {
      this.cache = parse(await readFile(this.file, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.cache = []
    }
    return this.cache
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.chain.then(operation)
    this.chain = run.catch(() => undefined)
    return run
  }
}
