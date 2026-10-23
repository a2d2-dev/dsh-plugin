import type { WorkResult } from './work-types.ts'

/** Model-only whitelist. Domain receipts, persistence and GUI keep the full result. */
export function compactWorkResult(result: WorkResult, kind: 'status' | 'control' | 'report' | 'organize', knownSpecificationVersion?: number) {
  if (result.status !== 'completed') return { status: result.status, error: result.error, ...(kind === 'status' ? { coordinator: false } : {}) }
  const { task, execution } = result
  const versions = {
    ...(execution ? { epoch: execution.epoch } : {}),
    ...(task ? { taskVersion: task.version, specificationVersion: task.specification.version } : {}),
  }
  if (kind === 'status') return {
    status: result.status, coordinator: !!execution, ...versions,
    ...(task ? { specificationState: task.specification.missing?.length || !task.specification.acceptance.length || !task.specification.text.trim()
      ? 'missing' : knownSpecificationVersion === undefined ? 'compare-startup' : knownSpecificationVersion === task.specification.version ? 'current' : 'changed' } : {}),
  }
  return {
    status: result.status, saved: true, ...versions,
    ...(task?.progress ? { stage: task.progress.stage, reportSpecificationVersion: task.progress.specificationVersion } : {}),
    ...(execution ? { executionState: execution.state, ...(execution.control ? { control: { action: execution.control.action, status: execution.control.status } } : {}) } : {}),
    ...(result.reminders?.length ? { reminders: result.reminders } : {}),
  }
}
