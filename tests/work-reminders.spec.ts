import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { supersededReminders } from '../src/work-execution/reminders.ts'

const item = (schedule = 'schedule', prompt = 'prompt', at = '2026-11-01T00:00:00Z') => ({ schedule_id: schedule, reminder_prompt: prompt, occurrence_at: at })
const message = (items: unknown[], kind = 'schedule') => createUserMessage({ source: { kind } as never, content: [{ type: 'text', text: '[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\nreminders_json: ' + JSON.stringify(items) }] })
it('uses occurrence time, preserves exact instruction/schedule identity, and does not touch human or malformed envelopes', () => {
  const newest = message([item('same', 'instruction', '2026-11-01T09:00:00Z')])
  const older = message([item('same', 'instruction', '2026-10-28T09:00:00Z')])
  const changed = message([item('same', 'changed')])
  const another = message([item('another', 'instruction')])
  const human = message([item('same', 'instruction')], 'user')
  const malformed = message([{ schedule_id: 'same', reminder_prompt: 'instruction', occurrence_at: 'unknown' }])
  const invalidJson = createUserMessage({ source: { kind: 'schedule' } as never, content: [{ type: 'text', text: '[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\nreminders_json: nope' }] })
  const original = structuredClone([newest, older, changed, another, human, malformed, invalidJson])
  expect(supersededReminders(original)).toEqual(new Set([older.id]))
  expect(original).toEqual([newest, older, changed, another, human, malformed, invalidJson])
})
it('preserves a mixed batch until every reminder has a newer replacement', () => {
  const mixed = message([item('A'), item('B')])
  const a = message([item('A', 'prompt', '2026-11-01T01:00:00Z')])
  const b = message([item('B', 'prompt', '2026-11-01T01:00:00Z')])
  expect(supersededReminders([mixed, a])).toEqual(new Set())
  expect(supersededReminders([mixed, a, b])).toEqual(new Set([mixed.id]))
})
it('retains the latest full envelope on tied occurrences without changing its metadata', () => {
  const old = message([item()])
  const newest = message([item()])
  expect(supersededReminders([old, newest])).toEqual(new Set([old.id]))
})
