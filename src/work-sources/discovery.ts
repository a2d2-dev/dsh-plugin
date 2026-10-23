import { randomUUID } from 'node:crypto'
import type { SourceTransaction } from './application.ts'
import { SourceError } from './errors.ts'
import { projectPageSchema } from './schema.ts'
import type { GitHubSourcePort, ProjectCheckpoint, SourceDiscovery, WorkSource } from './types.ts'

export interface DiscoveryOptions {
  sourceId?: string; projectId?: string; force?: boolean; now?: () => number
  /** A full scan may span several ticks. Completed membership is published atomically. */
  maxPagesPerSource?: number; maxSources?: number; perPage?: number; intervalMs?: number
}
const iso = (time: number) => new Date(time).toISOString()
const due = (value: string | undefined) => value ? Date.parse(value) : 0
function checkpoint(source: WorkSource, now: number): ProjectCheckpoint {
  return { sourceVersion: source.version, startedAt: iso(now), pages: 0, items: [], issues: [] }
}
function current(source: WorkSource | undefined, version: number, reservation: string): source is WorkSource & { discovery: SourceDiscovery } {
  return !!source?.enabled && source.version === version && source.discovery?.inFlight?.id === reservation
}
function merge<T>(previous: T[], values: T[], key: (value: T) => string): T[] {
  const map = new Map(previous.map(value => [key(value), value]))
  for (const value of values) map.set(key(value), value)
  return [...map.values()]
}
/** Deterministic observation only: never imports Tasks, sends prompts, or claims execution. */
export async function reconcileProjectSources(transaction: SourceTransaction, port: GitHubSourcePort | undefined, options: DiscoveryOptions = {}): Promise<void> {
  const now = options.now ?? Date.now, maxPages = options.maxPagesPerSource ?? 2, maxSources = options.maxSources ?? 10, perPage = options.perPage ?? 50, interval = options.intervalMs ?? 300_000
  for (const value of [maxPages, maxSources, perPage, interval]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Discovery limits must be positive integers')
  if (maxPages > 20 || maxSources > 100 || perPage > 100) throw new Error('Discovery read limits are too large')
  const sources = await transaction(async state => state.sources.filter(source => source.enabled && source.githubProject
    && (!options.sourceId || source.id === options.sourceId) && (!options.projectId || source.projectId === options.projectId)
    && (options.force || due(source.discovery?.nextAttemptAt) <= now()) && due(source.lastError?.retryAt) <= now())
    .sort((a, b) => due(a.discovery?.lastAttemptAt) - due(b.discovery?.lastAttemptAt)).slice(0, maxSources).map(source => source.id))
  for (const sourceId of sources) {
    const reserved = await transaction(async state => {
      const source = state.sources.find(item => item.id === sourceId), time = now()
      if (!source?.enabled || !source.githubProject || (!options.force && due(source.discovery?.nextAttemptAt) > time)
        || due(source.lastError?.retryAt) > time || due(source.discovery?.inFlight?.expiresAt) > time) return undefined
      const discovery = source.discovery ?? { state: 'idle' as const, nextAttemptAt: iso(time), failures: 0 }
      source.discovery = discovery
      if (!discovery.checkpoint || discovery.checkpoint.sourceVersion !== source.version) discovery.checkpoint = checkpoint(source, time)
      discovery.state = 'syncing'
      discovery.lastAttemptAt = iso(time)
      discovery.inFlight = { id: randomUUID(), expiresAt: iso(time + 90_000) }
      return structuredClone(source) as WorkSource & { githubProject: NonNullable<WorkSource['githubProject']>; discovery: SourceDiscovery & { checkpoint: ProjectCheckpoint; inFlight: NonNullable<SourceDiscovery['inFlight']> } }
    })
    if (!reserved) continue
    const reservation = reserved.discovery.inFlight.id, version = reserved.version
    let cursor = reserved.discovery.checkpoint.cursor
    try {
      if (!port?.project) throw new SourceError('github-capability-unavailable', 'GitHub Project reads are unavailable on this server')
      for (let index = 0; index < maxPages; index++) {
        const page = projectPageSchema.parse(await port.project(reserved.githubProject, { perPage, ...(cursor ? { cursor } : {}) }))
        if (page.nextCursor === cursor && cursor !== undefined) throw new SourceError('github-invalid-response', 'GitHub Project pagination did not advance')
        const result = await transaction(async state => {
          const source = state.sources.find(item => item.id === sourceId)
          if (!current(source, version, reservation)) return 'superseded' as const
          const discovery = source.discovery, pending = discovery.checkpoint!
          if (pending.identity && pending.identity.nodeId !== page.identity.nodeId) {
            delete discovery.checkpoint
            throw new SourceError('github-identity-changed', 'GitHub account changed during Project discovery; a fresh scan is required')
          }
          if (pending.project && pending.project.nodeId !== page.project.nodeId) {
            delete discovery.checkpoint
            throw new SourceError('github-project-changed', 'GitHub Project identity changed during discovery; a fresh scan is required')
          }
          pending.identity = page.identity
          pending.project = page.project
          pending.items = merge(pending.items, page.items, item => item.id)
          pending.issues = merge(pending.issues, page.issues, issue => issue.nodeId)
          pending.pages++
          if (page.total !== undefined) pending.total = page.total
          pending.cursor = page.nextCursor
          discovery.inFlight!.expiresAt = iso(now() + 90_000)
          if (pending.items.length > 10_000 || pending.pages > 1000) throw new SourceError('github-project-too-large', 'Project discovery exceeded the supported scan size')
          if (page.nextCursor) return 'more' as const
          source.sequence++
          for (const issue of pending.issues) {
            const previous = source.observations.find(item => item.issue.nodeId === issue.nodeId)
            if (previous && previous.issue.updatedAt > issue.updatedAt) continue
            if (previous) { previous.issue = issue; previous.sequence = source.sequence }
            else source.observations.push({ issue, sequence: source.sequence })
            const binding = state.externalBindings.find(item => item.nodeId === issue.nodeId)
            if (binding && issue.updatedAt >= binding.lastObserved.updatedAt) binding.lastObserved = issue
          }
          source.projectSnapshot = { identity: page.identity, project: page.project, items: pending.items, observedAt: page.observedAt }
          source.identity = page.identity
          delete source.lastError
          discovery.state = 'idle'
          discovery.lastSuccessAt = iso(now())
          discovery.nextAttemptAt = iso(now() + interval)
          discovery.failures = 0
          delete discovery.checkpoint
          delete discovery.inFlight
          return 'complete' as const
        })
        if (result !== 'more') break
        cursor = page.nextCursor
      }
      await transaction(async state => {
        const source = state.sources.find(item => item.id === sourceId)
        if (!current(source, version, reservation)) return
        delete source.discovery.inFlight
        source.discovery.nextAttemptAt = iso(now())
      })
    } catch (caught) {
      const error = caught instanceof SourceError ? caught : new SourceError('github-invalid-response', 'GitHub Project did not return a usable observation')
      await transaction(async state => {
        const source = state.sources.find(item => item.id === sourceId)
        if (!current(source, version, reservation)) return
        const discovery = source.discovery
        discovery.state = 'error'
        discovery.failures++
        discovery.nextAttemptAt = iso(Math.max(now() + Math.min(300_000, 5_000 * 2 ** Math.min(discovery.failures - 1, 6)), due(error.retryAt)))
        source.lastError = { code: error.code, message: error.message, ...(error.retryAt ? { retryAt: error.retryAt } : {}) }
        if (['github-identity-changed', 'github-project-changed', 'github-project-too-large', 'github-cursor-invalid'].includes(error.code)) delete discovery.checkpoint
        delete discovery.inFlight
      })
    }
  }
}

/** Lifecycle owns the timer and joins its current read; browser presence is irrelevant. */
export function startProjectDiscovery(options: { reconcile: () => Promise<void>; pollMs?: number; onError?: (error: unknown) => void }): () => Promise<void> {
  const pollMs = options.pollMs ?? 300_000
  if (!Number.isSafeInteger(pollMs) || pollMs < 1) throw new Error('Discovery poll interval must be a positive integer')
  let closed = false, running: Promise<void> | undefined
  const tick = () => {
    if (closed || running) return
    running = Promise.resolve().then(options.reconcile).catch(error => options.onError?.(error)).finally(() => { running = undefined })
  }
  const timer = setInterval(tick, pollMs)
  timer.unref()
  tick()
  return async () => { closed = true; clearInterval(timer); await running }
}
