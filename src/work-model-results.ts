import type { WorkResult } from './work-types.ts'

export type WorkResultKind = 'status' | 'control' | 'report' | 'organize'
export const MODEL_WORK_RESULT_BUDGET_BYTES = 2048
/** Budget the JSON representation, including escaped controls and surrogate pairs. */
function summary(text: string, encodedBytes: number): string {
  if (Buffer.byteLength(JSON.stringify(text)) <= encodedBytes) return text
  let prefix = ''
  for (const point of text) {
    if (Buffer.byteLength(JSON.stringify(`${prefix}${point}…`)) > encodedBytes) break
    prefix += point
  }
  return `${prefix}…`
}

/** Model-only whitelist. Full diagnostic content is retained by the detail adapter. */
export function compactWorkResult(result: WorkResult, kind: WorkResultKind, knownSpecificationVersion?: number) {
  if (result.status !== 'completed') {
    const message = summary(result.error.message, 600)
    return { status: result.status, error: { ...result.error, message,
      ...(message !== result.error.message ? { messageTruncated: true, originalBytes: Buffer.byteLength(result.error.message) } : {}) },
      ...(kind === 'status' ? { coordinator: false } : {}) }
  }
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
  const reminders = result.reminders?.slice(0, 2).map(text => summary(text, 256))
  const remindersTruncated = !!result.reminders?.length && (result.reminders.length > 2 || reminders!.some((text, index) => text !== result.reminders![index]))
  return {
    status: result.status, saved: true, ...versions,
    ...(task?.progress ? { stage: task.progress.stage, reportSpecificationVersion: task.progress.specificationVersion } : {}),
    ...(execution ? { executionState: execution.state, ...(execution.control ? { control: { action: execution.control.action, status: execution.control.status } } : {}) } : {}),
    ...(result.reminders?.length ? { reminders, reminderCount: result.reminders.length, remindersTruncated,
      ...(remindersTruncated ? { remindersOriginalBytes: Buffer.byteLength(JSON.stringify(result.reminders)) } : {}) } : {}),
  }
}
