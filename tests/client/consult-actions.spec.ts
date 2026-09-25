import { describe, expect, it, vi } from 'vitest'
import {
  OTHER_MOVE_OPTIONS,
  CONSULT_ROUTE_PATH,
  consultAttributionLine,
  requestConsult,
  selectConsultCandidate,
  selectOtherMove,
} from '../../src/client/consult-actions.ts'
import type {
  ConsultCandidate,
  ConsultPhase,
} from '../../src/client/consult-actions.ts'

function jsonResponse(value: unknown): { json(): Promise<unknown> } {
  return { json: async () => value }
}

describe('requestConsult', () => {
  it('publishes loading before replacing prior candidates with a fresh result', async () => {
    const phases: ConsultPhase[] = [{
      kind: 'ready',
      candidates: [{ label: 'old', input: 'old', move: 'continue' }],
      degraded: false,
    }]
    let resolveResponse: ((value: { json(): Promise<unknown> }) => void) | undefined
    const fetch = vi.fn(async () => await new Promise<{ json(): Promise<unknown> }>((resolve) => {
      resolveResponse = resolve
    }))
    const request = requestConsult({ fetch, setPhase: phase => { phases.push(phase) } }, 'session/a')

    expect(phases.at(-1)).toEqual({ kind: 'loading' })
    expect(fetch).toHaveBeenCalledWith(
      `${CONSULT_ROUTE_PATH}?session=session%2Fa`,
      { method: 'POST' },
    )

    resolveResponse?.(jsonResponse({
      ok: true,
      value: {
        location: { zone: 'main', station: 'grill', phaseDone: true },
        next: { station: 'to-spec', move: 'continue', reason: '需要当前上下文' },
        candidates: [{ label: '继续', input: '继续完成测试', move: 'continue' }],
        degraded: false,
      },
    }))
    await request
    expect(phases.at(-1)).toEqual({
      kind: 'ready',
      location: { zone: 'main', station: 'grill', phaseDone: true },
      next: { station: 'to-spec', move: 'continue', reason: '需要当前上下文' },
      candidates: [{ label: '继续', input: '继续完成测试', move: 'continue' }],
      degraded: false,
    })
  })

  it('carries the position line into the ready card', async () => {
    const setPhase = vi.fn<(phase: ConsultPhase) => void>()
    await requestConsult({
      fetch: async () => jsonResponse({
        ok: true,
        value: {
          position: ' 实现已完成，尚未验证。 ',
          location: { zone: 'main', station: 'implement', phaseDone: true },
          next: { station: 'code-review', move: 'subagent', reason: '隔离评审上下文' },
          candidates: [{ label: '验证', input: '跑一遍测试', move: 'subagent' }],
          degraded: false,
        },
      }),
      setPhase,
    }, 'session-a')
    expect(setPhase).toHaveBeenLastCalledWith({
      kind: 'ready',
      position: '实现已完成，尚未验证。',
      location: { zone: 'main', station: 'implement', phaseDone: true },
      next: { station: 'code-review', move: 'subagent', reason: '隔离评审上下文' },
      candidates: [{ label: '验证', input: '跑一遍测试', move: 'subagent' }],
      degraded: false,
    })
  })

  it('carries answer attribution, fallbacks, and station models into the ready card', async () => {
    const setPhase = vi.fn<(phase: ConsultPhase) => void>()
    await requestConsult({
      fetch: async () => jsonResponse({
        ok: true,
        value: {
          position: '实现已完成，尚未验证。',
          location: { zone: 'main', station: 'implement', phaseDone: true },
          next: { station: 'code-review', move: 'subagent', reason: '隔离评审上下文' },
          candidates: [{ label: '验证', input: '跑一遍测试', move: 'subagent' }],
          degraded: false,
          answeredBy: 'codex/gpt-6',
          fallbacks: [{ route: 'claude-bray/claude-fable-5-1', reason: 'model refused the consultation' }],
          stationModels: { grill: ['claude-bray/claude-fable-5-1', 'codex/gpt-6'] },
        },
      }),
      setPhase,
    }, 'session-a')
    expect(setPhase).toHaveBeenLastCalledWith({
      kind: 'ready',
      position: '实现已完成，尚未验证。',
      location: { zone: 'main', station: 'implement', phaseDone: true },
      next: { station: 'code-review', move: 'subagent', reason: '隔离评审上下文' },
      candidates: [{ label: '验证', input: '跑一遍测试', move: 'subagent' }],
      degraded: false,
      answeredBy: 'codex/gpt-6',
      fallbacks: [{ route: 'claude-bray/claude-fable-5-1', reason: 'model refused the consultation' }],
      stationModels: { grill: ['claude-bray/claude-fable-5-1', 'codex/gpt-6'] },
    })
  })

  it('carries setup preconditions into the ready card', async () => {
    const setPhase = vi.fn<(phase: ConsultPhase) => void>()
    await requestConsult({
      fetch: async () => jsonResponse({
        ok: true,
        value: {
          position: '新项目还未配置 Matt skills。',
          location: { zone: 'main', station: 'grill', phaseDone: true },
          next: { station: 'to-spec', move: 'continue', reason: '先补前置条件' },
          candidates: [{ label: '首次使用前：/setup-matt-pocock-skills', input: '/setup-matt-pocock-skills', move: 'continue' }],
          degraded: false,
          preconditions: {
            missing: [
              { id: 'context', label: 'CONTEXT.md or CONTEXT-MAP.md', paths: ['CONTEXT.md', 'CONTEXT-MAP.md'] },
              { id: 'issue-tracker', label: 'docs/agents/issue-tracker.md', paths: ['docs/agents/issue-tracker.md'] },
            ],
          },
        },
      }),
      setPhase,
    }, 'session-a')
    expect(setPhase).toHaveBeenLastCalledWith({
      kind: 'ready',
      position: '新项目还未配置 Matt skills。',
      location: { zone: 'main', station: 'grill', phaseDone: true },
      next: { station: 'to-spec', move: 'continue', reason: '先补前置条件' },
      candidates: [{ label: '首次使用前：/setup-matt-pocock-skills', input: '/setup-matt-pocock-skills', move: 'continue' }],
      degraded: false,
      preconditions: {
        missing: [
          { id: 'context', label: 'CONTEXT.md or CONTEXT-MAP.md', paths: ['CONTEXT.md', 'CONTEXT-MAP.md'] },
          { id: 'issue-tracker', label: 'docs/agents/issue-tracker.md', paths: ['docs/agents/issue-tracker.md'] },
        ],
      },
    })
  })

  it('rejects malformed preconditions', async () => {
    const setPhase = vi.fn<(phase: ConsultPhase) => void>()
    await requestConsult({
      fetch: async () => jsonResponse({ ok: true, value: { candidates: [], degraded: false, preconditions: { missing: ['context'] } } }),
      setPhase,
    }, 'session-a')
    expect(setPhase).toHaveBeenLastCalledWith({ kind: 'error', message: '下一步咨询返回了无效响应' })
  })

  it('rejects a non-string position', async () => {
    const setPhase = vi.fn<(phase: ConsultPhase) => void>()
    await requestConsult({
      fetch: async () => jsonResponse({ ok: true, value: { position: 3, candidates: [], degraded: false } }),
      setPhase,
    }, 'session-a')
    expect(setPhase).toHaveBeenLastCalledWith({ kind: 'error', message: '下一步咨询返回了无效响应' })
  })

  it('rejects a response whose highway location is outside the closed catalog', async () => {
    const setPhase = vi.fn<(phase: ConsultPhase) => void>()
    await requestConsult({
      fetch: async () => jsonResponse({
        ok: true,
        value: {
          location: { zone: 'main', station: 'prototype', phaseDone: true },
          next: { station: 'to-spec', move: 'continue', reason: '继续写规格' },
          candidates: [
            { label: '继续', input: '/to-spec', move: 'continue' },
            { label: '代理', input: '整理资料', move: 'subagent' },
          ],
          degraded: false,
        },
      }),
      setPhase,
    }, 'session-a')
    expect(setPhase).toHaveBeenLastCalledWith({ kind: 'error', message: '下一步咨询返回了无效响应' })
  })

  it('shows the route error message unchanged', async () => {
    const setPhase = vi.fn<(phase: ConsultPhase) => void>()
    await requestConsult({
      fetch: async () => jsonResponse({
        ok: false,
        error: { code: 'consult-failed', message: 'The consultation could not be generated.' },
      }),
      setPhase,
    }, 'session-a')
    expect(setPhase).toHaveBeenNthCalledWith(1, { kind: 'loading' })
    expect(setPhase).toHaveBeenNthCalledWith(2, {
      kind: 'error',
      message: 'The consultation could not be generated.',
    })
  })

  it('preserves the degraded marker on successful candidates', async () => {
    const setPhase = vi.fn<(phase: ConsultPhase) => void>()
    await requestConsult({
      fetch: async () => jsonResponse({
        ok: true,
        value: {
          candidates: [{ label: '降级继续', input: '继续当前工作', kind: 'other' }],
          degraded: true,
        },
      }),
      setPhase,
    }, 'session-a')
    expect(setPhase).toHaveBeenLastCalledWith({
      kind: 'ready',
      candidates: [{ label: '降级继续', input: '继续当前工作', move: 'continue' }],
      degraded: true,
    })
  })
})

describe('consult attribution line', () => {
  it('stays absent for old hosts with no attribution fields', () => {
    expect(consultAttributionLine({ kind: 'ready', candidates: [], degraded: false })).toBeUndefined()
  })

  it('names the answering model and the fallback reason', () => {
    expect(consultAttributionLine({
      kind: 'ready',
      candidates: [],
      degraded: false,
      answeredBy: 'codex/gpt-6',
      fallbacks: [{ route: 'claude-bray/claude-fable-5-1', reason: 'model refused the consultation' }],
    })).toBe('由 gpt-6 生成（claude-fable-5-1 拒答，改用 gpt-6）')
  })
})

function selectionDoubles() {
  return {
    command: vi.fn(),
    appendToDraft: vi.fn(() => true),
    focusComposer: vi.fn(),
    closeConsult: vi.fn(),
    openHandoff: vi.fn(),
  }
}

describe.each<ConsultCandidate>([
  { label: '留在当前会话', input: '继续实现客户端', move: 'continue' },
  { label: '派子代理', input: '让子代理评审当前分支', move: 'subagent' },
  { label: '开空会话', input: '/implement #10', move: 'clear' },
])('$move candidate selection', (candidate) => {
  it('only fills and focuses the composer, leaving send to the user', () => {
    const deps = selectionDoubles()
    expect(selectConsultCandidate(deps, candidate)).toBe(true)
    expect(deps.appendToDraft).toHaveBeenCalledWith(candidate.input)
    expect(deps.focusComposer).toHaveBeenCalledOnce()
    expect(deps.closeConsult).toHaveBeenCalledOnce()
    expect(deps.openHandoff).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })
})

describe.each<ConsultCandidate>([
  { label: '压缩继续', input: '保留实现状态后继续', move: 'compact' },
  { label: '交接实施', input: '在新会话完成客户端实现', move: 'handoff' },
])('$move candidate selection', (candidate) => {
  it('only opens the handoff card with a prefilled focus', () => {
    const deps = selectionDoubles()
    expect(selectConsultCandidate(deps, candidate)).toBe(true)
    const expectedFocus = candidate.move === 'compact'
      ? `保留什么：${candidate.input}`
      : candidate.input
    expect(deps.openHandoff).toHaveBeenCalledWith(expectedFocus)
    expect(deps.appendToDraft).not.toHaveBeenCalled()
    expect(deps.focusComposer).not.toHaveBeenCalled()
    expect(deps.closeConsult).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })
})

describe('other move entries', () => {
  it('offer every non-continue move as a general card footer entry', () => {
    expect(OTHER_MOVE_OPTIONS.map(option => option.move)).toEqual([
      'clear',
      'subagent',
      'compact',
      'handoff',
    ])
  })
})

describe.each([
  ['clear', '开空会话继续：'],
  ['subagent', '派子代理处理：'],
] as const)('%s other move selection', (move, input) => {
  it('fills and focuses the composer without sending anything', () => {
    const deps = selectionDoubles()
    expect(selectOtherMove(deps, move)).toBe(true)
    expect(deps.appendToDraft).toHaveBeenCalledWith(input)
    expect(deps.focusComposer).toHaveBeenCalledOnce()
    expect(deps.closeConsult).toHaveBeenCalledOnce()
    expect(deps.openHandoff).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })
})

describe.each([
  ['compact', '保留什么：'],
  ['handoff', ''],
] as const)('%s other move selection', (move, focus) => {
  it('opens the handoff card without sending anything', () => {
    const deps = selectionDoubles()
    expect(selectOtherMove(deps, move)).toBe(true)
    expect(deps.openHandoff).toHaveBeenCalledWith(focus)
    expect(deps.appendToDraft).not.toHaveBeenCalled()
    expect(deps.focusComposer).not.toHaveBeenCalled()
    expect(deps.closeConsult).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })
})
