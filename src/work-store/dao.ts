import { z } from 'zod'
import { screeningArchiveSchema, type ScreeningReview } from '../work-screening-record.ts'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { mkdir, readFile, stat, readdir, lstat, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { executionSchema, historyRefSchema, receiptSchema, snapshotSchema, type WorkSnapshot } from '../work-schema.ts'
import { normalizeLegacyLocalChildren } from '../work-migrate.ts'
import { checkpointSchema, sourceSchema } from '../work-sources/schema.ts'
import type { WorkExecution, WorkResult } from '../work-types.ts'
import type { WorkSource } from '../work-sources/types.ts'
import { checkpointChunkSchema, checkpointChunk, applyCheckpointChunk, type CheckpointChunk } from './checkpoint.ts'
import { attachBulk, bulkOf, bulkPath, hasInlineBulk, readBulkSync, type SourceBulk } from './source-bulk.ts'

type History = WorkExecution['history']
type Receipt = WorkSnapshot['commands'][number]
export interface HistoryRef { head: string; length: number; first?: History[number] }
export interface StorageRefs { version: 1; receipts: Record<string, string>; histories: Record<string, HistoryRef>; sources: Record<string, string>; checkpoints: Record<string, string | null> }
export interface ArchiveCollection {
  version: 1; dryRun: boolean; controlBytes: number; controlSha256: string; reachableBytes: number; candidateBytes: number
  reachable: string[]; roles: Record<string, string>; candidates: { file: string; bytes: number }[]; ignored: string[]; manifest: string
}
interface HistoryState { ref?: HistoryRef; pending: History; loaded?: History }
interface SourceState { checkpointRef?: string | null; checkpointBase: () => SourceBulk['checkpoint']; checkpointValue?: SourceBulk['checkpoint']; checkpointLoaded?: boolean; ref?: string; base: () => SourceBulk; value?: SourceBulk; mutable: boolean; legacy: boolean; hadDiscovery?: boolean }
const empty = (): WorkSnapshot => snapshotSchema.parse({ schemaVersion: 3, projects: [], agents: [], tasks: [], commands: [], legacyMappings: [] })
const options = { mode: 0o600, dirMode: 0o700 }
const instances = new Map<string, WeakRef<WorkDao>>()
const histories = new WeakMap<WorkExecution, HistoryState>()
const receipts = new WeakMap<Receipt, string>()
const sources = new WeakMap<WorkSource, SourceState>()
/** Skip getters: cold fields stay cold during control projection and freezing. */
function omit<T extends object>(value: T, keys: string[]): T {
  return Object.fromEntries(Object.keys(value).filter(key => !keys.includes(key)).map(key => [key, (value as Record<string, unknown>)[key]])) as T
}
function replace<T extends object>(value: T, fields: Partial<Record<keyof T, unknown>>): T {
  return Object.fromEntries(Object.keys(value).map(key => [key, Object.hasOwn(fields, key) ? (fields as Record<string, unknown>)[key] : (value as Record<string, unknown>)[key]])) as T
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if ('value' in descriptor) freeze(descriptor.value)
    Object.freeze(value)
  }
  return value
}
function sourceControl(source: WorkSource): WorkSource {
  const copy = omit(source, ['observations', 'pages', 'repositorySnapshot', 'projectSnapshot', 'discovery'])
  return { ...copy, observations: [], pages: [], ...(source.discovery ? { discovery: omit(source.discovery, ['checkpoint']) } : {}) }
}
function control(state: WorkSnapshot): WorkSnapshot {
  return { ...state, commands: state.commands.map(item => ({ commandId: item.commandId, fingerprint: item.fingerprint, result: { status: 'completed' as const } })),
    executions: state.executions.map(item => ({ ...omit(item, ['history']), history: [] })), sources: state.sources.map(sourceControl) }
}
function comparable(state: WorkSnapshot): string {
  const value = control(state)
  delete value.storage
  for (const source of value.sources) if (source.discovery) delete (source.discovery as Partial<NonNullable<WorkSource['discovery']>>).nextAttemptAt
  return JSON.stringify(value)
}

/** One in-process authority per canonical directory. The control rename is the commit point. */
export class WorkDao {
  static forDirectory(directory: string): WorkDao {
    let key = resolve(directory)
    try { key = realpathSync(key) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    let dao = instances.get(key)?.deref()
    if (!dao) { dao = new WorkDao(key); instances.set(key, new WeakRef(dao)) }
    return dao
  }
  readonly file: string
  private cached?: { key: string; content?: Buffer; state: WorkSnapshot }
  private loading?: Promise<WorkSnapshot>
  private writers: Promise<void> = Promise.resolve()
  private listeners = new Set<() => void>()
  // Immutable identities let cold values survive unrelated control commits, without retaining unused history forever.
  private historyCache = new Map<string, WeakRef<History>>()
  private receiptCache = new Map<string, WeakRef<Receipt['result']>>()
  private checkpointCache = new Map<string, WeakRef<NonNullable<SourceBulk['checkpoint']>>>()
  private sourceCache = new Map<string, WeakRef<SourceBulk>>()
  private constructor(readonly directory: string) { this.file = join(directory, 'work-v3.json') }
  /** Observers re-read after commit; listener failures never turn a durable commit into failure. */
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private notify(): void { for (const listener of this.listeners) { try { listener() } catch { /* Observer isolation. */ } } }
  private async key(): Promise<string> {
    try { const info = await stat(this.file, { bigint: true }); return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}` }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'; throw error }
  }
  /** Every caller shares the entire stat/load flight, including cold schema validation. */
  read(): Promise<WorkSnapshot> {
    if (this.loading) return this.loading
    const flight = this.readCommitted()
    this.loading = flight
    void flight.finally(() => { if (this.loading === flight) this.loading = undefined }).catch(() => {})
    return flight
  }
  private async readCommitted(): Promise<WorkSnapshot> {
    for (;;) {
      const key = await this.key()
      // Same-inode, same-size writes can share timestamps on real filesystems.
      // Recheck the hot control bytes; immutable archives remain lazy and cold.
      const content = key === 'missing' ? undefined : await readFile(this.file)
      // An external writer can rename between stat and read. Never label that data with an older revision.
      if (await this.key() !== key) continue
      if (this.cached?.key === key && (content === undefined ? this.cached.content === undefined : this.cached.content?.equals(content))) return this.cached.state
      const parsed = content === undefined ? empty() : snapshotSchema.parse(JSON.parse(content.toString('utf8')))
      const state = this.materialize(parsed)
      const changed = this.cached !== undefined
      this.cached = { key, content, state }
      if (changed) this.notify()
      return state
    }
  }
  private materialize(parsed: WorkSnapshot): WorkSnapshot {
    const state = normalizeLegacyLocalChildren(parsed)
    for (const item of state.commands) {
      const ref = state.storage?.receipts[item.commandId]
      if (ref) { receipts.set(item, ref); let result: WorkResult | undefined
        Object.defineProperty(item, 'result', { enumerable: true, configurable: true, get: () => result ??= this.readReceipt(ref) })
      }
    }
    for (const execution of state.executions) {
      const ref = state.storage?.histories[execution.id]
      this.attachHistory(execution, { ...(ref && execution.history.length === 0 ? { ref } : {}), pending: execution.history })
    }
    for (const source of state.sources) {
      const ref = state.storage?.sources[source.id]
      const inline = hasInlineBulk(source)
      const bulk = inline ? bulkOf(source) : undefined
      const base = () => bulk ?? (state.storage ? this.readSource(ref!, source) : this.validateSource(source, readBulkSync(bulkPath(this.directory, source.id))?.bulk ?? { observations: [], pages: [] }))
      const checkpointRef = inline ? undefined : state.storage?.checkpoints?.[source.id]
      this.attachSource(source, { ref: inline ? undefined : ref, legacy: !ref || inline || !state.storage?.checkpoints, mutable: false, checkpointRef,
        checkpointBase: () => checkpointRef === null ? undefined : checkpointRef ? this.readCheckpoint(checkpointRef) : base().checkpoint,
        // Only unmarked legacy stores may consult mutable sidecars or have no saved bulk.
        base })
    }
    return freeze(state)
  }
  private blobPath(ref: string): string {
    if (!/^[0-9a-f-]{36}\.json$/.test(ref)) throw new Error('Invalid work archive reference')
    return join(this.directory, 'work-v3.archive', ref)
  }
  private blob(ref: string): unknown { return JSON.parse(readFileSync(this.blobPath(ref), 'utf8')) }
  private async put(value: unknown): Promise<string> {
    const ref = `${randomUUID()}.json`
    await writeFileAtomic(this.blobPath(ref), `${JSON.stringify(value)}\n`, options)
    return ref
  }
  async archiveScreening(review: ScreeningReview, previous?: string): Promise<string> {
    return this.put(screeningArchiveSchema.parse({ review, previous }))
  }
  readScreening(ref: string): ScreeningReview { return screeningArchiveSchema.parse(this.blob(ref)).review }
  private validateSource(source: WorkSource, bulk: SourceBulk): SourceBulk {
    if (!bulk || !Array.isArray(bulk.observations) || !Array.isArray(bulk.pages)) throw new Error('Invalid work source archive')
    return freeze(bulkOf(sourceSchema.parse(attachBulk(sourceControl(source), bulk))))
  }
  private readSource(ref: string, source: WorkSource): SourceBulk {
    const cached = this.sourceCache.get(ref)?.deref()
    if (cached) return cached
    const bulk = this.validateSource(source, this.blob(ref) as SourceBulk)
    this.sourceCache.set(ref, new WeakRef(bulk))
    return bulk
  }
  private readCheckpoint(ref: string): NonNullable<SourceBulk['checkpoint']> {
    const cached = this.checkpointCache.get(ref)?.deref()
    if (cached) return cached
    const chunks: CheckpointChunk[] = [], seen = new Set<string>()
    let next: string | undefined = ref, value: SourceBulk['checkpoint']
    while (next) {
      if (seen.has(next)) throw new Error('Cyclic work checkpoint archive')
      seen.add(next)
      const cached = this.checkpointCache.get(next)?.deref()
      if (cached) { value = cached; break }
      const chunk = checkpointChunkSchema.parse(this.blob(next))
      chunks.push(chunk); next = chunk.previous
    }
    for (const chunk of chunks.reverse()) value = applyCheckpointChunk(chunk, value)
    const result = freeze(value!)
    this.checkpointCache.set(ref, new WeakRef(result))
    return result
  }
  private attachSource(source: WorkSource, meta: SourceState): void {
    sources.set(source, meta)
    meta.hadDiscovery = !!source.discovery
    const get = () => meta.value ??= meta.mutable ? structuredClone(meta.base()) : freeze(meta.base())
    for (const key of ['observations', 'pages', 'repositorySnapshot', 'projectSnapshot'] as const) {
      Object.defineProperty(source, key, { enumerable: true, configurable: true, get: () => get()[key], set: value => { if (Object.isFrozen(source)) throw new Error('Cannot modify a committed work source'); get()[key] = value } })
    }
    const checkpoint = () => {
      if (!meta.checkpointLoaded) {
        const value = meta.checkpointBase()
        meta.checkpointValue = meta.mutable ? structuredClone(value) : freeze(value)
        meta.checkpointLoaded = true
      }
      return meta.checkpointValue
    }
    if (source.discovery) Object.defineProperty(source.discovery, 'checkpoint', { enumerable: true, configurable: true, get: checkpoint, set: value => { if (Object.isFrozen(source)) throw new Error('Cannot modify a committed work source'); meta.checkpointValue = value; meta.checkpointLoaded = true } })
  }
  private history(meta: HistoryState): History {
    if (meta.loaded) return meta.loaded
    if (meta.ref && meta.pending.length === 0) {
      const cached = this.historyCache.get(meta.ref.head)?.deref()
      if (cached && cached.length === meta.ref.length) return meta.loaded = cached
    }
    const chunks: History[] = []; let ref = meta.ref?.head; const seen = new Set<string>()
    while (ref) {
      if (seen.has(ref)) throw new Error('Cyclic work history archive')
      seen.add(ref)
      const chunk = this.blob(ref) as { previous?: string; entries: unknown }
      chunks.push(executionSchema.shape.history.parse(chunk.entries)); ref = chunk.previous
    }
    const loaded = chunks.reverse().flat()
    if (meta.ref && loaded.length !== meta.ref.length) throw new Error('Incomplete work history archive')
    meta.loaded = freeze([...loaded, ...meta.pending])
    if (meta.ref && meta.pending.length === 0) this.historyCache.set(meta.ref.head, new WeakRef(meta.loaded))
    return meta.loaded
  }
  private attachHistory(execution: WorkExecution, meta: HistoryState): void {
    histories.set(execution, meta)
    Object.defineProperty(execution, 'history', { enumerable: true, configurable: true, get: () => this.history(meta),
      set: (value: History) => { if (Object.isFrozen(execution)) throw new Error('Cannot modify a committed work execution'); meta.ref = undefined; meta.pending = value; meta.loaded = undefined } })
  }
  firstHistory(execution: WorkExecution): History[number] | undefined {
    const meta = histories.get(execution)
    return meta?.ref?.first ?? meta?.pending[0] ?? execution.history[0]
  }
  appendHistory(execution: WorkExecution, entry: History[number]): void {
    if (Object.isFrozen(execution)) throw new Error('Cannot modify a committed work execution')
    const meta = histories.get(execution)
    if (!meta) { execution.history.push(entry); return }
    meta.pending.push(entry); meta.loaded = undefined
  }
  private copyExecution(execution: WorkExecution): WorkExecution {
    const copy = structuredClone(replace(execution, { history: [] }))
    const meta = histories.get(execution)
    this.attachHistory(copy, meta ? { ref: meta.ref, pending: [...meta.pending] } : { pending: structuredClone(execution.history) })
    return copy
  }
  /** Detach a command result without expanding the execution's archived history. */
  recordCommand(state: WorkSnapshot, commandId: string, fingerprint: string, result: WorkResult): void {
    const execution = result.status === 'completed' ? result.execution : undefined
    const copy = structuredClone(execution ? replace(result, { execution: undefined } as Partial<Record<keyof WorkResult, unknown>>) : result) as WorkResult
    if (execution && copy.status === 'completed') copy.execution = this.copyExecution(execution)
    if (copy.status !== 'completed') throw new Error('Only completed commands have durable receipts')
    state.commands.push({ commandId, fingerprint, result: copy })
  }
  private readReceipt(ref: string): Receipt['result'] {
    const cached = this.receiptCache.get(ref)?.deref()
    if (cached) return cached
    const stored = this.blob(ref) as { result: unknown; history?: HistoryRef }
    receiptSchema.parse(stored.result)
    const result = stored.result as Receipt['result']
    if (stored.history && result.status === 'completed' && result.execution) this.attachHistory(result.execution, { ref: historyRefSchema.parse(stored.history), pending: [] })
    freeze(result)
    this.receiptCache.set(ref, new WeakRef(result))
    return result
  }
  fork(state: WorkSnapshot): WorkSnapshot {
    const draft: WorkSnapshot = structuredClone({ ...state, executions: [], commands: [], sources: [] })
    draft.commands = [...state.commands]
    draft.executions = state.executions.map(execution => this.copyExecution(execution))
    draft.sources = state.sources.map(source => {
      const copy = structuredClone(sourceControl(source)), meta = sources.get(source)!
      this.attachSource(copy, { ref: meta.ref, legacy: meta.legacy, mutable: true, base: () => meta.value ?? meta.base(), checkpointRef: meta.checkpointRef, checkpointBase: () => meta.checkpointLoaded ? meta.checkpointValue : meta.checkpointBase() })
      return copy
    })
    return draft
  }
  /** Local queue precedes the cross-process lock, sharing the existing 30-second budget. */
  async transaction<T>(apply: (state: WorkSnapshot) => Promise<T>, accept: (result: T) => boolean = () => true): Promise<T> {
    const previous = this.writers, deadline = Date.now() + 30_000
    let release!: () => void
    const turn = new Promise<void>(resolve => { release = resolve })
    this.writers = previous.then(() => turn)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([previous, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`atomic-write: timed out waiting for the writer lock at ${this.file}.lock`)), 30_000) })])
      clearTimeout(timer)
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      return await withFileLock(this.file, async () => {
        // A read started before lock acquisition is not a transaction's freshness check.
        if (this.loading) await this.loading
        const committed = await this.read(), draft = this.fork(committed)
        const result = await apply(draft)
        if (accept(result)) await this.commit(committed, draft)
        return result
      }, { waitMs: Math.max(0, deadline - Date.now()) })
    } finally { clearTimeout(timer); release() }
  }
  private async saveHistory(execution: WorkExecution): Promise<HistoryRef | undefined> {
    const meta = histories.get(execution) ?? { pending: execution.history }
    if (meta.pending.length === 0) return meta.ref
    const entries = executionSchema.shape.history.parse(meta.pending)
    const head = await this.put({ previous: meta.ref?.head, entries })
    const ref = { head, length: (meta.ref?.length ?? 0) + entries.length, first: meta.ref?.first ?? entries[0] }
    meta.ref = ref; meta.pending = []; meta.loaded = undefined; histories.set(execution, meta)
    return ref
  }
  private async commit(before: WorkSnapshot, draft: WorkSnapshot): Promise<void> {
    const refs: StorageRefs = { version: 1, receipts: Object.create(null), histories: Object.create(null), sources: Object.create(null), checkpoints: Object.create(null) }
    let changed = !before.storage?.checkpoints || comparable(before) !== comparable(draft)
    // Validate only live facts here. New cold records are validated separately once.
    const live = control(draft); delete live.storage
    snapshotSchema.parse(live)
    for (const execution of draft.executions) {
      const ref = await this.saveHistory(execution)
      if (ref) refs.histories[execution.id] = ref
      if (ref?.head !== before.storage?.histories[execution.id]?.head) changed = true
    }
    for (const receipt of draft.commands) {
      let ref = receipts.get(receipt)
      if (!ref) {
        const result = receipt.result
        const execution = result.status === 'completed' ? result.execution : undefined
        const history = execution && await this.saveHistory(execution)
        const compact = execution ? { ...result, execution: replace(execution, { history: [] }) } : result
        receiptSchema.parse(compact)
        ref = await this.put({ result: compact, history }); receipts.set(receipt, ref); changed = true
      }
      refs.receipts[receipt.commandId] = ref
    }
    for (const source of draft.sources) {
      const meta = sources.get(source)
      let ref = meta?.ref
      const deleted = ['observations', 'pages', 'repositorySnapshot', 'projectSnapshot'].some(key => !Object.getOwnPropertyDescriptor(source, key)?.get)
      if (!meta || meta.legacy || meta.value !== undefined || deleted) {
        const { checkpoint: ignored, ...bulk } = bulkOf(source)
        // Validate body independently: progress updates must not traverse the body.
        this.validateSource(source, bulk)
        const original = meta && meta.base()
        const base = original && omit(original, ['checkpoint'])
        if (!ref || meta?.legacy || JSON.stringify(bulk) !== JSON.stringify(base)) {
          ref = await this.put(bulk); changed = true
        }
      }
      if (ref) refs.sources[source.id] = ref
      let checkpointRef = meta?.checkpointRef ?? null
      const checkpointDeleted = (meta?.hadDiscovery && !source.discovery) || (source.discovery && !Object.getOwnPropertyDescriptor(source.discovery, 'checkpoint')?.get)
      if (!meta || meta.legacy || meta.checkpointLoaded || checkpointDeleted) {
        const checkpoint = source.discovery?.checkpoint
        if (checkpoint) checkpointSchema.parse(checkpoint)
        if (!meta || meta.legacy || JSON.stringify(checkpoint) !== JSON.stringify(meta.checkpointBase())) {
          const original = meta?.checkpointBase()
          checkpointRef = checkpoint ? await this.put(checkpointChunk(checkpoint, meta?.checkpointRef && original ? { ref: meta.checkpointRef, value: original } : undefined)) : null
          if (checkpointRef && checkpoint) this.checkpointCache.set(checkpointRef, new WeakRef(freeze(checkpoint)))
          changed = true
        }
      }
      refs.checkpoints[source.id] = checkpointRef
    }
    if (!changed) return
    const persisted = control(draft); persisted.storage = refs
    // Validate references and prepare a detached snapshot before the durable commit.
    const state = this.materialize(snapshotSchema.parse(persisted))
    const content = `${JSON.stringify(persisted)}\n`
    await writeFileAtomic(this.file, content, options)
    const key = await this.key()
    const bytes = Buffer.from(content, 'utf8')
    if (this.cached?.key !== key || !this.cached.content?.equals(bytes)) { this.cached = { key, content: bytes, state }; this.notify() }
  }
  /** All readers and writers must be stopped: readers may still hold an older root.
   * The normal writer lock additionally excludes cooperating accidental writers.
   * Only reachable blobs are parsed; unreachable large source bodies stay unopened.
   */
  async collectArchives(options: { offline: true; dryRun?: boolean }): Promise<ArchiveCollection> {
    if (options.offline !== true) throw new Error('Archive collection requires stopped readers and writers')
    return this.transaction(async state => {
      if (!state.storage) throw new Error('Migrate the store before archive collection')
      type Job = { kind: 'history' | 'receipt' | 'source' | 'checkpoint' | 'screening'; ref: string; source?: WorkSource }
      const checkpointRoots: string[] = [], checkpointChunks = new Map<string, CheckpointChunk>()
      const queue: Job[] = [], seen = new Map<string, Job['kind']>(), historyRefs: HistoryRef[] = []
      const chunks = new Map<string, { previous?: string; length: number }>(), screening = new Map<string, string | undefined>(), checkpoints = new Map<string, string | undefined>()
      const addHistory = (ref: HistoryRef) => { historyRefs.push(ref); queue.push({ kind: 'history', ref: ref.head }) }
      for (const ref of Object.values(state.storage.histories)) addHistory(ref)
      for (const ref of Object.values(state.storage.receipts)) queue.push({ kind: 'receipt', ref })
      for (const [id, ref] of Object.entries(state.storage.sources)) {
        const source = state.sources.find(source => source.id === id)
        if (!source) throw new Error('Source archive index has no source')
        queue.push({ kind: 'source', ref, source })
      }
      for (const [id, ref] of Object.entries(state.storage.checkpoints ?? {})) {
        if (!state.sources.some(source => source.id === id)) throw new Error('Checkpoint archive index has no source')
        if (ref) { checkpointRoots.push(ref); queue.push({ kind: 'checkpoint', ref }) }
      }
      for (const rule of state.continuousRules ?? []) if (rule.screeningReview) queue.push({ kind: 'screening', ref: rule.screeningReview.ref })
      const historyChunk = z.object({ previous: historyRefSchema.shape.head.optional(), entries: executionSchema.shape.history }).strict()
      const receiptArchive = z.object({ result: receiptSchema, history: historyRefSchema.optional() }).strict()
      for (let index = 0; index < queue.length; index++) {
        const job = queue[index]!, prior = seen.get(job.ref)
        if (prior) { if (prior !== job.kind) throw new Error('Archive reference has conflicting kinds'); continue }
        const info = await lstat(this.blobPath(job.ref))
        if (!info.isFile()) throw new Error('Reachable archive is not a regular file')
        const value = this.blob(job.ref)
        seen.set(job.ref, job.kind)
        switch (job.kind) {
          case 'source': this.validateSource(job.source!, value as SourceBulk); break
          case 'checkpoint': {
            const chunk = checkpointChunkSchema.parse(value)
            checkpoints.set(job.ref, chunk.previous); checkpointChunks.set(job.ref, chunk)
            if (chunk.previous) queue.push({ kind: 'checkpoint', ref: chunk.previous })
            break
          }
          case 'history': {
            const chunk = historyChunk.parse(value)
            chunks.set(job.ref, { previous: chunk.previous, length: chunk.entries.length })
            if (chunk.previous) queue.push({ kind: 'history', ref: chunk.previous })
            break
          }
          case 'receipt': {
            const receipt = receiptArchive.parse(value)
            if (receipt.history) {
              if (!receipt.result.execution) throw new Error('History archive without receipt execution')
              addHistory(receipt.history)
            }
            const review = receipt.result.continuousRule?.screeningReview
            if (review) queue.push({ kind: 'screening', ref: review.ref })
            break
          }
          case 'screening': {
            const archive = screeningArchiveSchema.parse(value)
            screening.set(job.ref, archive.previous)
            if (archive.previous) queue.push({ kind: 'screening', ref: archive.previous })
            break
          }
        }
      }
      // Memoize chain lengths: many receipts share long history prefixes.
      const lengths = new Map<string, number>()
      for (const root of historyRefs) {
        const path: string[] = [], visiting = new Set<string>(); let ref: string | undefined = root.head
        while (ref && !lengths.has(ref)) {
          if (visiting.has(ref)) throw new Error('Cyclic work history archive')
          visiting.add(ref); path.push(ref); ref = chunks.get(ref)!.previous
        }
        let length = ref ? lengths.get(ref)! : 0
        for (const ref of path.reverse()) { length += chunks.get(ref)!.length; lengths.set(ref, length) }
        if (lengths.get(root.head) !== root.length) throw new Error('Incomplete work history archive')
      }
      for (const chain of [screening, checkpoints]) {
        const checked = new Set<string>()
        for (const root of chain.keys()) {
          const path = new Set<string>(); let ref: string | undefined = root
          while (ref && !checked.has(ref)) {
            if (path.has(ref)) throw new Error('Cyclic screening/checkpoint archive')
            path.add(ref); ref = chain.get(ref)
          }
          for (const ref of path) checked.add(ref)
        }
      }
      for (const root of checkpointRoots) {
        const path: CheckpointChunk[] = []; let ref: string | undefined = root, value: SourceBulk['checkpoint']
        while (ref) { const chunk: CheckpointChunk = checkpointChunks.get(ref)!; path.push(chunk); ref = chunk.previous }
        for (const chunk of path.reverse()) value = applyCheckpointChunk(chunk, value)
      }
      const archiveDirectory = join(this.directory, 'work-v3.archive')
      const report: ArchiveCollection = { version: 1, dryRun: options.dryRun !== false, controlBytes: (await stat(this.file)).size,
        controlSha256: createHash('sha256').update(await readFile(this.file)).digest('hex'), reachableBytes: 0, candidateBytes: 0, reachable: [...seen.keys()].sort(), roles: Object.fromEntries(seen), candidates: [], ignored: [], manifest: join(this.directory, `work-v3.gc-${randomUUID()}.json`) }
      const files = await readdir(archiveDirectory, { withFileTypes: true })
      for (const file of files) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/.test(file.name) || !file.isFile()) { report.ignored.push(file.name); continue }
        const info = await lstat(join(archiveDirectory, file.name))
        if (!info.isFile()) throw new Error('Archive changed during offline collection')
        if (seen.has(file.name)) report.reachableBytes += info.size
        else { report.candidates.push({ file: file.name, bytes: info.size }); report.candidateBytes += info.size }
      }
      report.candidates.sort((a, b) => a.file.localeCompare(b.file)); report.ignored.sort()
      // Write the complete plan before any deletion. Failed/corrupt graphs never reach this point.
      await writeFileAtomic(report.manifest, `${JSON.stringify(report)}\n`, { mode: 0o600, dirMode: 0o700 })
      if (!report.dryRun) for (const candidate of report.candidates) await unlink(this.blobPath(candidate.file))
      return report
    }, () => false)
  }
  /** Explicit offline downgrade/audit boundary: materializes all cold data. */
  async exportSnapshot(): Promise<WorkSnapshot> {
    const state = structuredClone(await this.read())
    delete state.storage
    snapshotSchema.parse(state)
    return state
  }
  /** Migration uses the same lock/commit path and retains all old files. */
  async migrate(): Promise<void> { if (await this.key() !== 'missing') await this.transaction(async () => {}) }
}
