import { describe, expect, it, vi } from 'vitest'
import {
  OTHER_MOVE_OPTIONS,
  CONSULT_ROUTE_PATH,
  candidateModelEffect,
  consultAttributionLine,
  requestConsult,
  selectConsultCandidate,
  selectModel,
  selectOtherMove,
  stationRouteDecision,
} from '../../src/client/consult-actions.ts'
import type {
  ConsultCandidate,
  ConsultPhase,
  ConsultSelectionDeps,
} from '../../src/client/consult-actions.ts'
import type { ClientSessionsService, ClientWorkspaceNavigation, ClientWorkspacesService } from '../../src/client/context.ts'

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
          fallbacks: [{ route: 'claude-bray/claude-fable-5-1', kind: 'refusal', reason: 'policy text without legacy keyword' }],
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
      fallbacks: [{ route: 'claude-bray/claude-fable-5-1', kind: 'refusal', reason: 'policy text without legacy keyword' }],
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
      fallbacks: [{ route: 'claude-bray/claude-fable-5-1', kind: 'refusal', reason: 'policy text without legacy keyword' }],
    })).toBe('由 gpt-6 生成（claude-fable-5-1 拒答，改用 gpt-6）')
  })

  it('keeps legacy fallback reason sniffing for older hosts', () => {
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
    appendToDraft: vi.fn((_input: string, _sessionId?: string) => true),
    focusComposer: vi.fn(),
    closeConsult: vi.fn(),
    openHandoff: vi.fn(),
    notify: vi.fn(),
  }
}

function modelDirectory(
  current: string,
  catalog: readonly string[],
  events: string[] = [],
): NonNullable<ConsultSelectionDeps['modelDirectories']> {
  return {
    directoryFor: () => ({
      load: vi.fn(async () => {
        events.push('load')
        return {
          current: routeSelection(current),
          catalog,
        }
      }),
      select: vi.fn(async (selection) => {
        events.push(`select:${selection.provider}/${selection.model}`)
      }),
    }),
  }
}

function failingModelDirectory(
  current: string,
  catalog: readonly string[],
  error: Error,
  events: string[] = [],
): NonNullable<ConsultSelectionDeps['modelDirectories']> {
  return {
    directoryFor: () => ({
      load: vi.fn(async () => {
        events.push('load')
        return {
          current: routeSelection(current),
          catalog,
        }
      }),
      select: vi.fn(async (selection) => {
        events.push(`select:${selection.provider}/${selection.model}`)
        throw error
      }),
    }),
  }
}

function routeSelection(route: string): { provider: string; model: string } {
  const slash = route.indexOf('/')
  return { provider: route.slice(0, slash), model: route.slice(slash + 1) }
}

function clearSessionDeps(events: string[], connect: () => Promise<string> = async () => 'session-new'): {
  readonly sessions: ClientSessionsService
  readonly workspaces: ClientWorkspacesService
  readonly navigation: ClientWorkspaceNavigation
} {
  return {
    sessions: {} as unknown as ClientSessionsService,
    workspaces: {
      list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-1', sessionIds: ['session-a'] }] }) },
    },
    navigation: {
      openSession: (target) => { events.push(`open:${typeof target === 'string' ? target : target.childSessionId}`) },
      connectWorkspace: async (workspaceId: string) => {
        events.push(`connect:${workspaceId}`)
        return await connect()
      },
    },
  }
}

const readyWithModels: Extract<ConsultPhase, { kind: 'ready' }> = {
  kind: 'ready',
  degraded: false,
  location: { zone: 'main', station: 'grill', phaseDone: true },
  next: { station: 'to-spec', move: 'continue', reason: '需要本轮原始推理' },
  candidates: [{ label: '写 spec', input: '/to-spec', move: 'continue', station: 'to-spec' }],
  stationModels: {
    'to-spec': ['claude-bray/claude-fable-5-1', 'codex/gpt-6'],
    'code-review': ['claude-bray/claude-fable-5-1'],
  },
}

describe('selectModel', () => {
  const selection = { provider: 'codex', model: 'gpt-6' }
  const face = (result: unknown) => ({ load: vi.fn(), select: vi.fn(async () => result) })

  it('treats a resolved { ok: false } selection as a failure', async () => {
    await expect(selectModel(face({ ok: false, error: { message: 'route unavailable' } }), selection))
      .rejects.toThrow('route unavailable')
  })

  it('accepts an { ok: true } result and an older void resolution', async () => {
    await expect(selectModel(face({ ok: true, value: undefined }), selection)).resolves.toBeUndefined()
    await expect(selectModel(face(undefined), selection)).resolves.toBeUndefined()
  })
})

describe('station route decision', () => {
  it('chooses the first station candidate present in the session catalog', () => {
    expect(stationRouteDecision({
      station: 'to-spec',
      stationModels: readyWithModels.stationModels,
      catalog: ['codex/gpt-6', 'claude-bray/claude-fable-5-1'],
      current: routeSelection('codex/gpt-6'),
    })).toEqual({
      kind: 'switch',
      route: 'claude-bray/claude-fable-5-1',
      selection: { provider: 'claude-bray', model: 'claude-fable-5-1' },
      label: '切到 claude-fable-5-1',
    })
  })

  it('keeps the current model when no station candidate is in the catalog', () => {
    expect(stationRouteDecision({
      station: 'to-spec',
      stationModels: readyWithModels.stationModels,
      catalog: ['codex/gpt-5.5'],
      current: routeSelection('codex/gpt-6'),
    })).toEqual({
      kind: 'keep',
      route: 'codex/gpt-6',
      label: '保持当前模型',
    })
  })
})

describe('candidate model effect', () => {
  it('previews a continue chip model switch', () => {
    expect(candidateModelEffect(readyWithModels.candidates[0]!, readyWithModels, {
      current: routeSelection('codex/gpt-6'),
      catalog: ['claude-bray/claude-fable-5-1', 'codex/gpt-6'],
    })).toBe('切到 claude-fable-5-1')
  })

  it('previews keeping the current model when no station candidate is available', () => {
    expect(candidateModelEffect(readyWithModels.candidates[0]!, readyWithModels, {
      current: routeSelection('codex/gpt-6'),
      catalog: ['codex/gpt-6'],
    })).toBe('保持当前模型')
  })

  it('previews a clear chip as a new session with the target station model', () => {
    expect(candidateModelEffect({ label: '实现', input: '/implement #15', move: 'clear', station: 'implement' }, {
      ...readyWithModels,
      stationModels: { implement: ['codex/gpt-5.5', 'claude-bray/claude-opus-5-5'] },
    }, {
      current: routeSelection('claude-bray/claude-fable-5-1'),
      catalog: ['codex/gpt-5.5', 'claude-bray/claude-fable-5-1'],
    })).toBe('新会话 · gpt-5.5')
  })

  it('previews a clear chip as default model when no station candidate is available', () => {
    expect(candidateModelEffect({ label: '实现', input: '/implement #15', move: 'clear', station: 'implement' }, {
      ...readyWithModels,
      stationModels: { implement: ['codex/gpt-5.5'] },
    }, {
      current: routeSelection('claude-bray/claude-fable-5-1'),
      catalog: ['claude-bray/claude-fable-5-1'],
    })).toBe('新会话 · 默认模型')
  })
})

describe.each<ConsultCandidate>([
  { label: '留在当前会话', input: '继续实现客户端', move: 'continue' },
  { label: '派子代理', input: '让子代理评审当前分支', move: 'subagent' },
])('$move candidate selection', (candidate) => {
  it('only fills and focuses the composer, leaving send to the user', async () => {
    const deps = selectionDoubles()
    await expect(selectConsultCandidate(deps, candidate)).resolves.toBe(true)
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
  it('only opens the handoff card with a prefilled focus', async () => {
    const deps = selectionDoubles()
    await expect(selectConsultCandidate(deps, candidate)).resolves.toBe(true)
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
  it('fills and focuses the composer without sending anything', async () => {
    const deps = selectionDoubles()
    await expect(selectOtherMove(deps, move)).resolves.toBe(true)
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
  it('opens the handoff card without sending anything', async () => {
    const deps = selectionDoubles()
    await expect(selectOtherMove(deps, move)).resolves.toBe(true)
    expect(deps.openHandoff).toHaveBeenCalledWith(focus)
    expect(deps.appendToDraft).not.toHaveBeenCalled()
    expect(deps.focusComposer).not.toHaveBeenCalled()
    expect(deps.closeConsult).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })
})

describe('model-aware candidate selection', () => {
  it('creates a clear successor, selects its station model, opens it, and fills its draft without sending', async () => {
    const events: string[] = []
    const deps = {
      ...selectionDoubles(),
      ...clearSessionDeps(events),
      appendToDraft: vi.fn((input: string, target?: string) => {
        events.push(`draft:${target ?? 'current'}:${input}`)
        return true
      }),
      focusComposer: vi.fn(() => { events.push('focus') }),
      modelDirectories: modelDirectory(
        'claude-bray/claude-fable-5-1',
        ['codex/gpt-5.5', 'claude-bray/claude-fable-5-1'],
        events,
      ),
    }

    await expect(selectConsultCandidate(deps, {
      label: '实现',
      input: '/implement #15',
      move: 'clear',
      station: 'implement',
    }, {
      sessionId: 'session-a',
      phase: {
        ...readyWithModels,
        stationModels: { implement: ['codex/gpt-5.5', 'claude-bray/claude-opus-5-5'] },
      },
    })).resolves.toBe(true)

    expect(events).toEqual([
      'connect:workspace-1',
      'load',
      'select:codex/gpt-5.5',
      'open:session-new',
      'draft:session-new:/implement #15',
      'focus',
    ])
    expect(deps.closeConsult).toHaveBeenCalledOnce()
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('falls back to this session draft when clear cannot create a successor', async () => {
    const events: string[] = []
    const deps = {
      ...selectionDoubles(),
      ...clearSessionDeps(events, async () => { throw new Error('workspace unavailable') }),
      appendToDraft: vi.fn((input: string, target?: string) => {
        events.push(`draft:${target ?? 'current'}:${input}`)
        return true
      }),
      modelDirectories: modelDirectory('codex/gpt-6', ['codex/gpt-6'], events),
    }

    await expect(selectConsultCandidate(deps, {
      label: '新会话',
      input: '/implement #15',
      move: 'clear',
      station: 'implement',
    }, {
      sessionId: 'session-a',
      phase: {
        ...readyWithModels,
        stationModels: { implement: ['codex/gpt-5.5'] },
      },
    })).resolves.toBe(true)

    expect(events).toEqual(['connect:workspace-1', 'draft:current:/implement #15'])
    expect(deps.notify).toHaveBeenCalledWith('创建新会话失败：workspace unavailable，已只填入本会话输入框')
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('creates a clear successor without selecting a model when no station is known', async () => {
    const events: string[] = []
    const deps = {
      ...selectionDoubles(),
      ...clearSessionDeps(events),
      appendToDraft: vi.fn((input: string, target?: string) => {
        events.push(`draft:${target ?? 'current'}:${input}`)
        return true
      }),
      focusComposer: vi.fn(() => { events.push('focus') }),
      modelDirectories: modelDirectory('codex/gpt-6', ['codex/gpt-6'], events),
    }

    await expect(selectOtherMove(deps, 'clear', { sessionId: 'session-a' })).resolves.toBe(true)

    expect(events).toEqual([
      'connect:workspace-1',
      'open:session-new',
      'draft:session-new:开空会话继续：',
      'focus',
    ])
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('does not switch before filling when the available station model is already current', async () => {
    const events: string[] = []
    const deps = {
      ...selectionDoubles(),
      appendToDraft: vi.fn((input: string) => {
        events.push(`draft:${input}`)
        return true
      }),
      modelDirectories: modelDirectory(
        'claude-bray/claude-fable-5-1',
        ['claude-bray/claude-fable-5-1', 'codex/gpt-6'],
        events,
      ),
    }

    await expect(selectConsultCandidate(deps, readyWithModels.candidates[0]!, {
      sessionId: 'session-a',
      phase: readyWithModels,
    })).resolves.toBe(true)

    expect(events).toEqual(['load', 'draft:/to-spec'])
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('selects a different available station model before filling and focusing', async () => {
    const events: string[] = []
    const deps = {
      ...selectionDoubles(),
      appendToDraft: vi.fn((input: string) => {
        events.push(`draft:${input}`)
        return true
      }),
      focusComposer: vi.fn(() => { events.push('focus') }),
      modelDirectories: modelDirectory(
        'codex/gpt-6',
        ['claude-bray/claude-fable-5-1', 'codex/gpt-6'],
        events,
      ),
    }

    await expect(selectConsultCandidate(deps, readyWithModels.candidates[0]!, {
      sessionId: 'session-a',
      phase: readyWithModels,
    })).resolves.toBe(true)

    expect(events).toEqual([
      'load',
      'select:claude-bray/claude-fable-5-1',
      'draft:/to-spec',
      'focus',
    ])
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('keeps the current model when station candidates are absent from the session catalog', async () => {
    const events: string[] = []
    const deps = {
      ...selectionDoubles(),
      appendToDraft: vi.fn((input: string) => {
        events.push(`draft:${input}`)
        return true
      }),
      modelDirectories: modelDirectory('codex/gpt-6', ['codex/gpt-6'], events),
    }

    await expect(selectConsultCandidate(deps, readyWithModels.candidates[0]!, {
      sessionId: 'session-a',
      phase: readyWithModels,
    })).resolves.toBe(true)

    expect(events).toEqual(['load', 'draft:/to-spec'])
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('fills the composer and reports the reason when model selection fails', async () => {
    const events: string[] = []
    const deps = {
      ...selectionDoubles(),
      appendToDraft: vi.fn((input: string) => {
        events.push(`draft:${input}`)
        return true
      }),
      modelDirectories: failingModelDirectory(
        'codex/gpt-6',
        ['claude-bray/claude-fable-5-1', 'codex/gpt-6'],
        new Error('adapter rejected the model'),
        events,
      ),
    }

    await expect(selectConsultCandidate(deps, readyWithModels.candidates[0]!, {
      sessionId: 'session-a',
      phase: readyWithModels,
    })).resolves.toBe(true)

    expect(events).toEqual([
      'load',
      'select:claude-bray/claude-fable-5-1',
      'draft:/to-spec',
    ])
    expect(deps.notify).toHaveBeenCalledWith('切换模型失败：adapter rejected the model')
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('fills the composer and reports that the session model directory service is missing', async () => {
    const deps = selectionDoubles()

    await expect(selectConsultCandidate(deps, readyWithModels.candidates[0]!, {
      sessionId: 'session-a',
      phase: readyWithModels,
    })).resolves.toBe(true)

    expect(deps.appendToDraft).toHaveBeenCalledWith('/to-spec')
    expect(deps.notify).toHaveBeenCalledWith('模型目录服务不可用，已只填入输入框')
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('keeps this session model untouched for subagent chips and writes the subagent model into the input', async () => {
    const events: string[] = []
    const deps = {
      ...selectionDoubles(),
      appendToDraft: vi.fn((input: string) => {
        events.push(`draft:${input}`)
        return true
      }),
      modelDirectories: modelDirectory(
        'codex/gpt-5.5',
        ['claude-bray/claude-fable-5-1', 'codex/gpt-5.5'],
        events,
      ),
    }

    await expect(selectConsultCandidate(deps, {
      label: '派评审',
      input: '让子代理评审当前分支',
      move: 'subagent',
      station: 'code-review',
    }, {
      sessionId: 'session-a',
      phase: readyWithModels,
    })).resolves.toBe(true)

    expect(events).toEqual(['load', 'draft:让子代理评审当前分支\n\n子代理使用 claude-bray/claude-fable-5-1'])
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })
})
