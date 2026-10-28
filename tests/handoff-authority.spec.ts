import { describe, expect, it } from 'vitest'
import { handoffInstruction } from '../src/handoff-instruction.ts'
import { materialRequest, successorMessage } from '../src/work-execution/continuation.ts'
import type { ContinuationOperation } from '../src/work-types.ts'

const source = { runtimeId: 'runtime', sessionId: 'source-3335' }
const ref = { projectId: 'project', taskId: 'task-3335' }
const operation: ContinuationOperation = {
  operationId: 'op', commandId: 'rotate', automatic: false, phase: 'material-saved',
  source, successor: { ...source, sessionId: 'next-3335' }, sourceEpoch: 1,
  materialRequestId: 'request', kickoffId: 'kickoff', goal: '继续必要复测', title: '#3335',
  specification: { version: 1, text: '允许禁用、观察与恢复；不卸载。', acceptance: ['测试后恢复 enabled=true'] },
  history: { ref, session: source },
  material: { commandId: 'saved', ref, executionId: 'execution', source, epoch: 1, taskVersion: 1, specificationVersion: 1,
    body: '此前仅只读核查；尚未执行禁用。', decisions: 'U1: 只禁用和恢复，不卸载。',
    evidence: '原用户消息 U1，原工具回执 task-completed 只涉及旧 Task。',
    unfinished: '禁用后观察 enabled=false，最后恢复 enabled=true。', next: '接任后执行必要复测。' },
}

describe('#281 authorization provenance at handoff boundaries', () => {
  it.each([{ status: 'missing' } as const, { status: 'loaded', skill: 'Write continuation content.', resources: [] } as const])(
    'preserves authorization even when the handoff skill is $status', skill => {
      const text = handoffInstruction('/project/handoff.md', undefined, skill)
      expect(text).toContain('original user messages')
      expect(text).toContain('restoration obligations')
      expect(text).toContain('Already performed read-only checks')
      expect(text).toContain('later explicit user restrictions')
    },
  )

  it('asks the source for authorization evidence rather than new prohibitions', () => {
    const text = materialRequest(operation)
    expect(text).toContain('original user messages')
    expect(text).toContain('restoration obligations')
    expect(text).toContain('terminal Task refusals')
    expect(text).toContain('After saving, stop')
  })

  it('keeps receiving maintenance scoped while retaining authorized work and recovery', () => {
    const text = successorMessage(operation, '')
    expect(text).toContain('Agent-authored handoff from source-3335')
    expect(text).toContain('not a new instruction from the human')
    expect(text).toContain('receive-only restriction applies to this maintenance turn')
    expect(text).toContain('Stop after this receipt')
    expect(text).toContain('测试后恢复 enabled=true')
    expect(text).toContain('U1: 只禁用和恢复，不卸载。')
    expect(text).toContain('later explicit user restrictions')
    expect(text).toContain('repeat an existing authorization')
  })

  it('retains a real later user read-only restriction verbatim', () => {
    const limited = structuredClone(operation)
    limited.material!.decisions += '\nU2: 用户后来明确本次只读，暂不禁用。'
    const text = successorMessage(limited, '')
    expect(text).toContain('U2: 用户后来明确本次只读，暂不禁用。')
    expect(text).toContain('later explicit user restrictions')
  })
})
