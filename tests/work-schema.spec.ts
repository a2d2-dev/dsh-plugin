import { expect, it } from 'vitest'
import { executionSchema } from '../src/work-schema.ts'
import type { WorkEvent } from '../src/work-types.ts'

it('round-trips existing superseded event records without dropping their saved discard reason', () => {
  const events = Array.from({ length: 8 }, (_, index) => ({
    id: `existing-result-${index}`, text: `Original saved result ${index}`, kind: 'result',
    delivery: 'discarded', acceptance: 'unassessed', discardReason: 'superseded',
    nativeMessage: { id: `native-${index}`, role: 'user', content: [{ type: 'text', text: `Original native result ${index}` }], source: { kind: 'a2d2-work-child-result', endSeq: index + 1 } },
  }))
  const parsed: WorkEvent[] = executionSchema.shape.events.parse(JSON.parse(JSON.stringify(events)))
  expect(parsed).toEqual(events)
  expect(JSON.parse(JSON.stringify(parsed))).toEqual(events)
})

it('accepts old events without a discard reason and rejects unrecognized reason values and fields', () => {
  const event = { id: 'legacy', text: 'Original input', kind: 'input', delivery: 'discarded', acceptance: 'unassessed' }
  expect(executionSchema.shape.events.parse([event])).toEqual([event])
  for (const discardReason of ['unknown', '', null, 42]) {
    expect(executionSchema.shape.events.safeParse([{ ...event, discardReason }]).success).toBe(false)
  }
  expect(executionSchema.shape.events.safeParse([{ ...event, unrelatedField: true }]).success).toBe(false)
})
