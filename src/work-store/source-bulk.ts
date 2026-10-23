/**
 * Per-source bulk sidecars.
 *
 * The control-plane snapshot (`work-v3.json`) stays small: projects, tasks,
 * executions, bindings and each source's configuration. A GitHub Project of a
 * few thousand items would otherwise turn every periodic reconcile into a
 * megabyte-scale JSON parse. Observations, repository issue pages, the
 * published Project snapshot and the discovery checkpoint live beside it in
 * `work-v3.sources/<sourceId>.json`, loaded only when a caller reads them.
 *
 * The files are plain JSON so an operator can inspect one source without a
 * database client.
 *
 * @module @a2d2/dsh-a2d2/src/work-store/source-bulk
 */
import { statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { ProjectCheckpoint, ProjectSnapshot, SourceObservation, SourcePage, WorkSource } from '../work-sources/types.ts'

/** Everything a source carries outside the control plane. */
export interface SourceBulk {
  observations: SourceObservation[]
  pages: SourcePage[]
  repositorySnapshot?: WorkSource['repositorySnapshot']
  projectSnapshot?: ProjectSnapshot
  checkpoint?: ProjectCheckpoint
}

const directory = (root: string) => join(root, 'work-v3.sources')
/** Absolute sidecar path for one source; the id is a UUID, so it is path-safe. */
export const bulkPath = (root: string, sourceId: string) => join(directory(root), `${sourceId}.json`)

/** One parsed sidecar plus the file identity it was read from. */
export interface BulkRead { key: string; bulk: SourceBulk }

/** File identity of one sidecar, so a cached parse can be reused without reading it. */
export function bulkKeySync(path: string): string | undefined {
  try {
    const info = statSync(path)
    return `${info.ino}:${info.size}:${info.mtimeMs}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Read one sidecar synchronously; callers attach it to an already-parsed control state. */
export function readBulkSync(path: string): BulkRead | undefined {
  try {
    const info = statSync(path)
    return { key: `${info.ino}:${info.size}:${info.mtimeMs}`, bulk: JSON.parse(readFileSync(path, 'utf8')) as SourceBulk }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Replace one sidecar atomically (same-directory temp + rename). */
export async function writeBulk(path: string, bulk: SourceBulk): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(bulk)}\n`, { mode: 0o600, dirMode: 0o700 })
}

/** The bulk fields one source currently holds, ready to persist. */
export function bulkOf(source: WorkSource): SourceBulk {
  return {
    observations: source.observations, pages: source.pages,
    ...(source.repositorySnapshot ? { repositorySnapshot: source.repositorySnapshot } : {}),
    ...(source.projectSnapshot ? { projectSnapshot: source.projectSnapshot } : {}),
    ...(source.discovery?.checkpoint ? { checkpoint: source.discovery.checkpoint } : {}),
  }
}

/** True when the only place a source's bulk exists is still the control file. */
export function hasInlineBulk(source: WorkSource): boolean {
  return source.observations.length > 0 || source.pages.length > 0 || !!source.projectSnapshot || !!source.discovery?.checkpoint
}

/** Attach one sidecar to a control-plane source; the source mutates in place. */
export function attachBulk(source: WorkSource, bulk: SourceBulk): WorkSource {
  source.observations = bulk.observations ?? []
  source.pages = bulk.pages ?? []
  if (bulk.repositorySnapshot) source.repositorySnapshot = bulk.repositorySnapshot
  else delete source.repositorySnapshot
  if (bulk.projectSnapshot) source.projectSnapshot = bulk.projectSnapshot
  else delete source.projectSnapshot
  if (source.discovery && bulk.checkpoint) source.discovery.checkpoint = bulk.checkpoint
  else if (source.discovery) delete source.discovery.checkpoint
  return source
}

/**
 * A control-plane projection that never carries bulk. Written to `work-v3.json`
 * and used for change detection, so a Project's items never enter that file.
 */
export function controlSource(source: WorkSource): WorkSource {
  const { observations, pages, repositorySnapshot, projectSnapshot, discovery, ...rest } = source
  return {
    ...rest, observations: [], pages: [],
    ...(discovery ? { discovery: { ...discovery, checkpoint: undefined } } : {}),
  } as WorkSource
}

/** Cheap change detector for one source's bulk, used to decide sidecar writes. */
export function bulkFingerprint(source: WorkSource): string {
  let maxSequence = 0
  for (const observation of source.observations) if (observation.sequence > maxSequence) maxSequence = observation.sequence
  const checkpoint = source.discovery?.checkpoint
  return [
    source.observations.length, maxSequence, source.pages.length,
    source.repositorySnapshot?.observedAt ?? '', source.projectSnapshot?.observedAt ?? '',
    checkpoint?.pages ?? -1, checkpoint?.items.length ?? -1, checkpoint?.cursor ?? '', checkpoint?.total ?? -1,
  ].join('|')
}
