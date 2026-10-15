import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { RunRecord, TaskAddress } from './types.ts'

/** One registry per DSH home; no project scan and no implicit adoption. */
export class RuntimeStore {
  constructor(readonly directory: string) {}
  key(address: TaskAddress): string {
    return createHash('sha256').update(JSON.stringify([address.projectRoot, address.task])).digest('hex')
  }
  private file(address: TaskAddress): string { return join(this.directory, `${this.key(address)}.json`) }
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
