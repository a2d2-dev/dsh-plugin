import { expect, it } from 'vitest'
import { projectChildResult } from '../src/work-execution/dsh-host.ts'

it('projects original visible child output with exact log pointers and terminal failure, excluding replay and configuration', () => {
  const events = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'agent/inbox/spliced', data: { inserted: [{ role: 'system', content: [{ type: 'text', text: 'SECRET_SCHEMA'.repeat(10000) }] }] } },
    { seq: 3, type: 'assistant/message', data: { message: { id: 'answer-1', role: 'assistant', content: [{ type: 'text', text: 'Original business evidence\nverbatim.' }], source: { replayState: 'ENCRYPTED'.repeat(10000) } } } },
    { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'Verification failed' } } } },
  ]
  const projected = projectChildResult(events)
  expect(projected).toMatchObject([{ seq: 1, type: 'turn/start' }, { seq: 3, type: 'assistant/message', data: { message: { id: 'answer-1', content: [{ type: 'text', text: 'Original business evidence\nverbatim.' }] } } }, { seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'Verification failed' } } } }])
  expect(JSON.stringify(projected)).not.toMatch(/SECRET_SCHEMA|ENCRYPTED|replayState/)
  expect(JSON.stringify(projected).length).toBeLessThan(1000)
})


it('keeps successful tool payloads trace-addressable and preserves failed tool text', () => {
  const projected = projectChildResult([
    { seq: 5, type: 'tool/result', data: { message: { id: 'large-result', toolCallId: 'call-1', isError: false, content: [{ type: 'text', text: 'large original tool evidence'.repeat(10000) }] } } },
    { seq: 6, type: 'tool/result', data: { message: { id: 'failure', toolCallId: 'call-2', isError: true, content: [{ type: 'text', text: 'Exact failed verification detail' }] } } },
  ])
  expect(projected).toMatchObject([{ seq: 5, data: { toolCallId: 'call-1', isError: false } }, { seq: 6, data: { message: { toolCallId: 'call-2', isError: true, content: [{ text: 'Exact failed verification detail' }] } } }])
  expect(JSON.stringify(projected)).not.toContain('large original tool evidence')
})
