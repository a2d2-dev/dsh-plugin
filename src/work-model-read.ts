import { createHash } from 'node:crypto'
import type { WorkResult } from './work-types.ts'

export type WorkMaterialSection = 'specification' | 'progress' | 'sources' | 'continuation'
export interface WorkReadRequest { section: WorkMaterialSection; expected_version: number; expected_epoch?: number; cursor?: number; revision?: string }
const pageCharacters = 2000
/** Explicit detail reads are JSON fragments: concatenate all pages before interpreting requirements. */
export function workMaterialPage(result: WorkResult, request: WorkReadRequest) {
  if (result.status !== 'completed') return { status: result.status, error: result.error }
  const { task, execution } = result
  const fail = (code: string, message: string) => ({ status: 'failed', error: { code, message } })
  if (!task || !execution) return fail('material-unavailable', 'Current Task material is unavailable')
  if (request.expected_epoch !== undefined && request.expected_epoch !== execution.epoch) return fail('stale-execution-authority', 'Execution identity, owner or epoch is stale')
  if (request.expected_version !== task.version) return { status: 'conflict', error: { code: 'version-conflict', message: 'Task changed; read status and restart the material read', currentVersion: task.version } }
  const cursor = request.cursor ?? 0
  if (!Number.isSafeInteger(cursor) || cursor < 0) return fail('invalid-material-cursor', 'Cursor must be a non-negative safe integer')
  if (cursor > 0 && !request.revision) return fail('material-revision-required', 'Continue reading with the revision from the first page')
  const sections = {
    specification: () => ({ goal: task.goal, specification: task.specification, children: task.children,
      requiredNativeChildren: (result.bindings ?? []).map(binding => ({ nodeId: binding.nodeId, children: binding.acceptedChildren ?? binding.accepted.subIssues })) }),
    progress: () => ({ progress: task.progress, breakdown: task.breakdown, completion: task.completion }),
    sources: () => ({ sourceIssues: result.sourceIssues, bindings: result.bindings }),
    continuation: () => ({ material: execution.continuationMaterial, continuation: execution.continuation, history: execution.continuationHistory }),
  }
  const content = JSON.stringify(sections[request.section]())
  const revision = createHash('sha256').update(JSON.stringify([request.section, task.version, execution.epoch, content])).digest('hex')
  if (request.revision && request.revision !== revision) return fail('material-changed', 'Material changed between pages; restart at cursor 0 with the current Task version')
  if (cursor > content.length) return fail('invalid-material-cursor', 'Cursor is beyond the current material')
  const next = Math.min(cursor + pageCharacters, content.length)
  return { status: 'completed', section: request.section, format: 'json-fragment', epoch: execution.epoch,
    taskVersion: task.version, specificationVersion: task.specification.version, revision, cursor,
    totalCharacters: content.length, content: content.slice(cursor, next), complete: next === content.length,
    ...(next < content.length ? { nextCursor: next } : {}) }
}
