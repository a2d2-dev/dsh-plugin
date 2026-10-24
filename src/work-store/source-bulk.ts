/**
 * Source bulk shape and legacy sidecar reader used by WorkDao migration.
 * New commits reference immutable work-v3.archive files; this module never writes.
 */
import { statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  return source.observations.length > 0 || source.pages.length > 0 || !!source.repositorySnapshot || !!source.projectSnapshot || !!source.discovery?.checkpoint
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
