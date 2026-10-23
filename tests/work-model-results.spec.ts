import { expect, it } from 'vitest'
import { compactWorkResult } from '../src/work-model-results.ts'

it.each([1, 100, 1000])('bounds encoded JSON diagnostics for %i long reminders and aggregate errors', count => {
  const escaped = '\n\t"\\😀'.repeat(1000)
  const reminders = Array.from({ length: count }, (_, index) => `job-${index}: ${escaped}`)
  const receipt = compactWorkResult({ status: 'completed', reminders }, 'report')
  expect(Buffer.byteLength(JSON.stringify(receipt))).toBeLessThanOrEqual(2048)
  expect(receipt).toMatchObject({ status: 'completed', saved: true, reminderCount: count, remindersTruncated: true })
  const message = `Collect required results: ${escaped.repeat(count)}`
  for (const kind of ['status', 'control', 'report', 'organize'] as const) {
    const error = compactWorkResult({ status: 'conflict', error: { code: 'completion-results-unsettled', message, currentVersion: 42 } }, kind)
    expect(Buffer.byteLength(JSON.stringify(error))).toBeLessThanOrEqual(2048)
    expect(error).toMatchObject({ status: 'conflict', error: { code: 'completion-results-unsettled', currentVersion: 42, originalBytes: Buffer.byteLength(message), messageTruncated: true } })
    if (!('error' in error)) throw Error('Expected a projected error')
    expect(error.error.message).toContain('Collect required results:')
    expect(error.error.message).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)
  }
})
