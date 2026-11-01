import { z } from 'zod'
import type { NativeWorkMessage } from '../work-types.ts'

const envelope = z.object({ source: z.object({ kind: z.literal('schedule') }), content: z.tuple([z.object({ type: z.literal('text'), text: z.string() })]) })
const batch = z.array(z.object({ schedule_id: z.string().min(1), reminder_prompt: z.string(), occurrence_at: z.iso.datetime({ offset: true }) })).min(1)
const prefix = '[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user\nreminders_json: '

/** Whole envelopes only: a mixed batch remains unless every item has a newer pending replacement. */
export function supersededReminders(messages: readonly NativeWorkMessage[]): Set<string> {
  const parsed: { id: string; items: { key: string; at: number }[] }[] = []
  const latest = new Map<string, { id: string; at: number }>()
  for (const message of messages) {
    const result = envelope.safeParse(message)
    if (!result.success || !result.data.content[0].text.startsWith(prefix)) continue
    let json: unknown
    try { json = JSON.parse(result.data.content[0].text.slice(prefix.length)) } catch { continue }
    const reminders = batch.safeParse(json)
    if (!reminders.success) continue
    const items = reminders.data.map(item => ({ key: JSON.stringify([item.schedule_id, item.reminder_prompt]), at: Date.parse(item.occurrence_at) }))
    parsed.push({ id: message.id, items })
    for (const item of items) if (!latest.has(item.key) || latest.get(item.key)!.at <= item.at) latest.set(item.key, { id: message.id, at: item.at })
  }
  return new Set(parsed.filter(message => message.items.every(item => latest.get(item.key)!.id !== message.id)).map(message => message.id))
}
