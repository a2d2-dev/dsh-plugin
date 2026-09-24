import { describe, expect, it, vi } from 'vitest'
import {
  CONSULT_ROUTE_PATH,
  requestConsult,
  selectConsultCandidate,
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
      candidates: [{ label: 'old', input: 'old', kind: 'stay' }],
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
        candidates: [{ label: '继续', input: '继续完成测试', kind: 'stay' }],
        degraded: false,
      },
    }))
    await request
    expect(phases.at(-1)).toEqual({
      kind: 'ready',
      candidates: [{ label: '继续', input: '继续完成测试', kind: 'stay' }],
      degraded: false,
    })
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
      candidates: [{ label: '降级继续', input: '继续当前工作', kind: 'other' }],
      degraded: true,
    })
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
  { label: '留在当前会话', input: '继续实现客户端', kind: 'stay' },
  { label: '执行其他动作', input: '/review current branch', kind: 'other' },
])('$kind candidate selection', (candidate) => {
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

describe('handoff candidate selection', () => {
  it('only opens the handoff card with a prefilled focus', () => {
    const deps = selectionDoubles()
    const candidate: ConsultCandidate = {
      label: '交接实施',
      input: '在新会话完成客户端实现',
      kind: 'handoff',
    }
    expect(selectConsultCandidate(deps, candidate)).toBe(true)
    expect(deps.openHandoff).toHaveBeenCalledWith(candidate.input)
    expect(deps.appendToDraft).not.toHaveBeenCalled()
    expect(deps.focusComposer).not.toHaveBeenCalled()
    expect(deps.closeConsult).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })
})
