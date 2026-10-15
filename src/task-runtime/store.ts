import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { Delivery, RunRecord, TaskAddress } from './types.ts'

/** One registry per DSH home; no project scan and no implicit adoption. */
export class RuntimeStore {
  constructor(readonly directory: string) {}
  key(address: TaskAddress): string {
    return createHash('sha256').update(JSON.stringify([address.projectRoot, address.task])).digest('hex')
  }
  private file(address: TaskAddress): string { return join(this.directory, `${this.key(address)}.json`) }
  private inboxFile(address: TaskAddress): string { return join(this.directory, 'inbox', `${this.key(address)}.json`) }
  async pending(address: TaskAddress): Promise<Delivery[]> {
    try {
      const value = JSON.parse(await readFile(this.inboxFile(address), 'utf8')) as { version: number; events: Delivery[] }
      if (value.version !== 1 || !Array.isArray(value.events) || value.events.some(event => !event.id || !event.message?.id)) {
        throw new Error('Invalid task event inbox; refusing to discard events')
      }
      return value.events
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  /** This short inbox transaction never waits on an operation or model-selection lock. */
  private async changeInbox(address: TaskAddress, change: (events: Delivery[]) => Delivery[]): Promise<void> {
    await mkdir(join(this.directory, 'inbox'), { recursive: true, mode: 0o700 })
    const file = this.inboxFile(address)
    await withFileLock(file, async () => {
      const events = change(await this.pending(address))
      await writeFileAtomic(file, `${JSON.stringify({ version: 1, events })}\n`, { mode: 0o600, dirMode: 0o700 })
    })
  }
  async enqueue(address: TaskAddress, event: Delivery): Promise<boolean> {
    const record = await this.read(address)
    if (!record) return false
    if (record.inbox.some(item => item.id === event.id)) return true
    await this.changeInbox(address, events => events.some(item => item.id === event.id) ? events : [...events, event])
    return true
  }
  /** Called under the record writer lock; commit the ledger before removing staged events. */
  async importInbox(record: RunRecord): Promise<void> {
    const pending = await this.pending(record)
    if (pending.length === 0) return
    for (const event of pending) if (!record.inbox.some(item => item.id === event.id)) record.inbox.push(event)
    await this.save(record)
    const imported = new Set(pending.map(event => event.id))
    await this.changeInbox(record, events => events.filter(event => !imported.has(event.id)))
  }
  async read(address: TaskAddress): Promise<RunRecord | undefined> {
    try { return this.parse(await readFile(this.file(address), 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  }
  private parse(text: string): RunRecord {
    const value = JSON.parse(text) as RunRecord
    if (value.version !== 1 || !value.projectRoot || !value.task || !value.current
      || !Array.isArray(value.sessions) || !Array.isArray(value.inbox)
      || !['running', 'waiting-human', 'waiting-event', 'paused', 'blocked', 'done'].includes(value.state)) {
      throw new Error('Invalid task runtime record; refusing recovery')
    }
    return value
  }
  async list(): Promise<RunRecord[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const files = (await readdir(this.directory)).filter(file => file.endsWith('.json')).sort()
    return Promise.all(files.map(async file => this.parse(await readFile(join(this.directory, file), 'utf8'))))
  }
  async save(record: RunRecord): Promise<void> {
    record.updatedAt = new Date().toISOString()
    await writeFileAtomic(this.file(record), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  }
  /** Callers must save inside this transaction, including before each external side effect. */
  async locked<T>(address: TaskAddress, body: (record: RunRecord | undefined) => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    return withFileLock(this.file(address), async () => body(await this.read(address)))
  }
  /** The ownership lock spans active turns, idle waits, and all operation checkpoints. */
  async own(address: TaskAddress, acquired: () => Promise<void>): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    return withFileLock(`${this.file(address)}.owner`, acquired, { waitMs: 50 })
  }
}
