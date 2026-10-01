import { describe, expect, it } from 'vitest'
import { orbStatusSource } from '../../src/client/orb.tsx'
import { sessionStatus } from '../../src/client/status-model.ts'

const NOW = 1_000_000

describe('orbStatusSource', () => {
  it('folds the session snapshot, the Chat facts and the pending interaction into the card input', () => {
    const source = orbStatusSource(
      {
        running: true,
        lastAgentError: null,
        pendingSubmissions: [{ placement: 'queued' }, { placement: 'transcript' }],
      },
      {
        turnTimings: new Map([[1, { startTime: NOW - 5_000 }]]),
        partial: null,
        runningCalls: [{ name: 'bash', time: NOW - 2_000 }],
      },
      { kind: 'approval', toolName: 'bash', reason: 'writes outside the workspace' },
    )

    const facts = sessionStatus(source, NOW).facts
    expect(facts).toContain('待审批：工具 bash（writes outside the workspace）')
    expect(facts.some(fact => fact.startsWith('正在调用工具 bash'))).toBe(true)
    expect(facts).toContain('队列中还有 1 条待发消息')
  })

  it('leaves the Chat and pending fields absent when the shell supplies neither', () => {
    const source = orbStatusSource({ running: false }, undefined, undefined)

    expect(source).toEqual({ running: false })
  })
})
