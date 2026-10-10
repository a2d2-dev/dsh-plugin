import { describe, expect, it, vi } from 'vitest'
import {
  OTHER_MOVE_OPTIONS,
  CONSULT_ROUTE_PATH,
  SESSION_AGENT_ROUTE_PATH,
  candidateModelEffect,
  chipAgentTarget,
  consultAttributionLine,
  requestConsult,
  selectConsultCandidate,
  selectModel,
  selectOtherMove,
  sessionAgentRegistrar,
} from '../../src/client/consult-actions.ts'
import type {
  ConsultCandidate,
  ConsultPhase,
  ConsultSelectionDeps,
} from '../../src/client/consult-actions.ts'
import { DEFAULT_STAGE_AGENTS } from '../../src/stage-agent-data.ts'
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

  it('carries answer attribution, fallbacks, and stage Agents into the ready card', async () => {
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
          stageAgents: { stages: DEFAULT_STAGE_AGENTS.stages, agents: DEFAULT_STAGE_AGENTS.agents },
          sessionAgent: 'ceo',
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
      stageAgents: { stages: DEFAULT_STAGE_AGENTS.stages, agents: DEFAULT_STAGE_AGENTS.agents },
      sessionAgent: 'ceo',
    })
  })

  it('accepts standalone skill station names in the ready card', async () => {
    const setPhase = vi.fn<(phase: ConsultPhase) => void>()
    await requestConsult({
      fetch: async () => jsonResponse({
        ok: true,
        value: {
          position: '正在做独立 research。',
          location: { zone: 'standalone', station: 'research', phaseDone: true },
          next: { station: 'research', move: 'continue', reason: '继续独立技能' },
          candidates: [{ label: '继续 research', input: '/research', move: 'continue', station: 'research' }],
          degraded: false,
        },
      }),
      setPhase,
    }, 'session-a')
    expect(setPhase).toHaveBeenLastCalledWith({
      kind: 'ready',
      position: '正在做独立 research。',
      location: { zone: 'standalone', station: 'research', phaseDone: true },
      next: { station: 'research', move: 'continue', reason: '继续独立技能' },
      candidates: [{ label: '继续 research', input: '/research', move: 'continue', station: 'research' }],
      degraded: false,
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

  it('rejects a response with an illegal session Agent', async () => {
    const setPhase = vi.fn<(phase: ConsultPhase) => void>()
    await requestConsult({
      fetch: async () => jsonResponse({
        ok: true,
        value: {
          candidates: [{ label: '继续', input: '继续', move: 'continue' }],
          degraded: false,
          sessionAgent: 'boss',
        },
      }),
      setPhase,
    }, 'session-a')
    expect(setPhase).toHaveBeenLastCalledWith({ kind: 'error', message: '下一步咨询返回了无效响应' })
  })

  it.each([
    ['standalone station with punctuation', { location: { zone: 'standalone', station: 'research!', phaseDone: true } }],
    ['next station with invisible suffix', { next: { station: 'implement\u200b', move: 'clear', reason: 'bad station' } }],
    ['candidate station using a prototype property', { candidates: [{ label: '继续', input: '继续', move: 'continue', station: 'constructor' }] }],
  ])('rejects a response with %s', async (_name, override) => {
    const setPhase = vi.fn<(phase: ConsultPhase) => void>()
    await requestConsult({
      fetch: async () => jsonResponse({
        ok: true,
        value: {
          location: { zone: 'standalone', station: 'research', phaseDone: true },
          next: { station: 'research', move: 'clear', reason: '继续 research' },
          candidates: [{ label: '继续', input: '继续', move: 'clear', station: 'research' }],
          degraded: false,
          ...override,
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

/**
 * Per-session model directories recording `load:<session>` and
 * `select:<session>:<route>`; `catalogs` overrides one session's catalog.
 */
function modelDirectory(
  current: string,
  catalog: readonly string[],
  events: string[] = [],
  options: {
    readonly catalogs?: Readonly<Record<string, readonly string[]>>
    readonly select?: () => Promise<unknown>
  } = {},
): NonNullable<ConsultSelectionDeps['modelDirectories']> {
  return {
    directoryFor: (sessionId: string) => ({
      load: vi.fn(async () => {
        events.push(`load:${sessionId}`)
        return {
          current: routeSelection(current),
          catalog: options.catalogs?.[sessionId] ?? catalog,
        }
      }),
      select: vi.fn(async (selection) => {
        events.push(`select:${sessionId}:${selection.provider}/${selection.model}`)
        return await options.select?.()
      }),
    }),
  }
}

function registrar(
  events: string[],
  outcome: () => Promise<void> = async () => {},
): NonNullable<ConsultSelectionDeps['registerSessionAgent']> {
  return vi.fn(async (sessionId: string, agent: string) => {
    events.push(`register:${sessionId}:${agent}`)
    await outcome()
  })
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
  stageAgents: { stages: DEFAULT_STAGE_AGENTS.stages, agents: DEFAULT_STAGE_AGENTS.agents },
}

const implementClear: ConsultCandidate = { label: '实现', input: '/implement #15', move: 'clear', station: 'implement' }

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

describe('session Agent registrar', () => {
  it('posts the session and Agent to the host registration route', async () => {
    const fetch = vi.fn(async (_input: string, _init: { method: 'POST'; headers: Record<string, string>; body: string }) =>
      jsonResponse({ ok: true, value: { session: 'session-new', agent: 'engineer' } }))

    await expect(sessionAgentRegistrar(fetch)('session-new', 'engineer')).resolves.toBeUndefined()

    expect(SESSION_AGENT_ROUTE_PATH).toBe('/a2d2/api/session-agent')
    expect(fetch).toHaveBeenCalledWith('/a2d2/api/session-agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: 'session-new', agent: 'engineer' }),
    })
  })

  it('rejects with the route message when the host refuses the registration', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      ok: false,
      error: { code: 'record-rejected', message: 'session already recorded session as reviewer' },
    }))

    await expect(sessionAgentRegistrar(fetch)('session-new', 'engineer'))
      .rejects.toThrow('session already recorded session as reviewer')
  })

  it('rejects an answer that is not a route envelope', async () => {
    await expect(sessionAgentRegistrar(async () => jsonResponse('nope'))('session-new', 'engineer'))
      .rejects.toThrow('登记会话 Agent 返回了无效响应')
  })
})

describe('chip Agent target', () => {
  it('reads closed stations from the stage Agent table and runs standalone skills as CEO', () => {
    expect(chipAgentTarget('implement', readyWithModels.stageAgents)).toEqual({
      agent: 'engineer',
      label: '工程师',
      routes: ['codex/gpt-5.5', 'claude-bray/claude-opus-5-5'],
    })
    expect(chipAgentTarget('research', readyWithModels.stageAgents)?.agent).toBe('ceo')
    expect(chipAgentTarget('implement', undefined)).toBeUndefined()
    expect(chipAgentTarget(undefined, readyWithModels.stageAgents)).toBeUndefined()
  })
})

describe('candidate model effect', () => {
  it('writes no side effect on a continue chip, because it never switches this session', () => {
    expect(candidateModelEffect(readyWithModels.candidates[0]!, readyWithModels, {
      current: routeSelection('codex/gpt-6'),
      catalog: ['claude-bray/claude-fable-5-1', 'codex/gpt-6'],
    })).toBeUndefined()
    expect(candidateModelEffect(readyWithModels.candidates[0]!, readyWithModels, undefined)).toBeUndefined()
  })

  it('writes the subagent Agent on a subagent chip', () => {
    expect(candidateModelEffect(
      { label: '派评审', input: '让子代理评审当前分支', move: 'subagent', station: 'code-review' },
      readyWithModels,
      undefined,
    )).toBe('子代理 · 评审')
    expect(candidateModelEffect(
      { label: '派研究', input: '派子代理调研', move: 'subagent', station: 'research' },
      readyWithModels,
      undefined,
    )).toBe('子代理 · CEO')
  })

  it('writes the next stage Agent and its first available model on a clear chip', () => {
    expect(candidateModelEffect(implementClear, readyWithModels, {
      current: routeSelection('claude-bray/claude-fable-5-1'),
      catalog: ['claude-bray/claude-opus-5-5', 'codex/gpt-5.5', 'claude-bray/claude-fable-5-1'],
    })).toBe('新会话 · 工程师（gpt-5.5）')
  })

  it('writes CEO with its model on a clear chip into a standalone skill', () => {
    expect(candidateModelEffect({ label: '调研', input: '/research DSH', move: 'clear', station: 'research' }, readyWithModels, {
      current: routeSelection('codex/gpt-5.5'),
      catalog: ['codex/gpt-6'],
    })).toBe('新会话 · CEO（gpt-6）')
  })

  it('writes that the Agent has no usable model when none of its candidates is in the catalog', () => {
    expect(candidateModelEffect(implementClear, readyWithModels, {
      current: routeSelection('claude-bray/claude-fable-5-1'),
      catalog: ['claude-bray/claude-fable-5-1'],
    })).toBe('工程师无可用模型')
  })

  it('writes the Agent alone while the session model directory is not loaded', () => {
    expect(candidateModelEffect(implementClear, readyWithModels, undefined)).toBe('新会话 · 工程师')
  })

  it('writes the default model on a clear chip when the host sent no stage Agent table', () => {
    const { stageAgents: _omitted, ...oldHost } = readyWithModels
    expect(candidateModelEffect(implementClear, oldHost, {
      current: routeSelection('codex/gpt-6'),
      catalog: ['codex/gpt-5.5'],
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

describe('chip selection by Agent', () => {
  /** Doubles for a clear chip whose every capability records into `events`. */
  function clearDeps(events: string[], overrides: Partial<ConsultSelectionDeps> & {
    readonly connect?: () => Promise<string>
  } = {}) {
    const { connect, ...rest } = overrides
    return {
      ...selectionDoubles(),
      ...clearSessionDeps(events, connect),
      appendToDraft: vi.fn((input: string, target?: string) => {
        events.push(`draft:${target ?? 'current'}:${input}`)
        return true
      }),
      focusComposer: vi.fn(() => { events.push('focus') }),
      notify: vi.fn((message: string) => { events.push(`notify:${message}`) }),
      modelDirectories: modelDirectory(
        'claude-bray/claude-fable-5-1',
        ['claude-bray/claude-opus-5-5', 'codex/gpt-5.5', 'claude-bray/claude-fable-5-1'],
        events,
      ),
      registerSessionAgent: registrar(events),
      ...rest,
    }
  }

  const clearContext = { sessionId: 'session-a', phase: readyWithModels }

  it('creates a clear successor, records it as the next stage Agent, selects that Agent model, opens it, and fills it', async () => {
    const events: string[] = []
    const deps = clearDeps(events)

    await expect(selectConsultCandidate(deps, implementClear, clearContext)).resolves.toBe(true)

    expect(events).toEqual([
      'load:session-a',
      'connect:workspace-1',
      'register:session-new:engineer',
      'open:session-new',
      'draft:session-new:/implement #15',
      'focus',
    ])
    expect(deps.closeConsult).toHaveBeenCalledOnce()
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('starts a clear successor into a standalone skill as CEO', async () => {
    const events: string[] = []
    const deps = clearDeps(events)

    await expect(selectConsultCandidate(deps, {
      label: '调研', input: '/research DSH', move: 'clear', station: 'research',
    }, clearContext)).resolves.toBe(true)

    expect(events).toContain('register:session-new:ceo')
    expect(events.filter(event => event.startsWith('select:'))).toEqual([])
    expect(events.at(-2)).toBe('draft:session-new:/research DSH')
  })

  it('only fills this session and says why when no candidate of the Agent is in the catalog', async () => {
    const events: string[] = []
    const deps = clearDeps(events, {
      modelDirectories: modelDirectory('claude-bray/claude-fable-5-1', ['claude-bray/claude-fable-5-1'], events),
    })

    await expect(selectConsultCandidate(deps, implementClear, clearContext)).resolves.toBe(true)

    expect(events).toEqual([
      'load:session-a',
      'notify:工程师无可用模型，已只填入本会话输入框',
      'draft:current:/implement #15',
      'focus',
    ])
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('falls back to this session draft when clear cannot create a successor', async () => {
    const events: string[] = []
    const deps = clearDeps(events, { connect: async () => { throw new Error('workspace unavailable') } })

    await expect(selectConsultCandidate(deps, implementClear, clearContext)).resolves.toBe(true)

    expect(events).toEqual([
      'load:session-a',
      'connect:workspace-1',
      'notify:创建新会话失败：workspace unavailable，已只填入本会话输入框',
      'draft:current:/implement #15',
      'focus',
    ])
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('still selects the model and fills the successor when the Agent registration fails', async () => {
    const events: string[] = []
    const deps = clearDeps(events, {
      registerSessionAgent: registrar(events, async () => { throw new Error('session-new is a task issue main session') }),
    })

    await expect(selectConsultCandidate(deps, implementClear, clearContext)).resolves.toBe(true)

    expect(events).toEqual([
      'load:session-a',
      'connect:workspace-1',
      'register:session-new:engineer',
      'notify:登记新会话 Agent 失败：session-new is a task issue main session',
      'open:session-new',
      'draft:session-new:/implement #15',
      'focus',
    ])
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('still fills the successor when its model selection is refused', async () => {
    const events: string[] = []
    const deps = clearDeps(events, {
      registerSessionAgent: registrar(events, async () => { throw new Error('adapter rejected the model') }),
    })

    await expect(selectConsultCandidate(deps, implementClear, clearContext)).resolves.toBe(true)

    expect(events).toEqual([
      'load:session-a',
      'connect:workspace-1',
      'register:session-new:engineer',
      'notify:登记新会话 Agent 失败：adapter rejected the model',
      'open:session-new',
      'draft:session-new:/implement #15',
      'focus',
    ])
  })

  it('still fills the successor when its own catalog holds none of the Agent candidates', async () => {
    const events: string[] = []
    const deps = clearDeps(events, {
      registerSessionAgent: registrar(events, async () => { throw new Error('工程师无可用模型') }),
      modelDirectories: modelDirectory(
        'claude-bray/claude-fable-5-1',
        ['codex/gpt-5.5'],
        events,
        { catalogs: { 'session-new': ['claude-bray/claude-fable-5-1'] } },
      ),
    })

    await expect(selectConsultCandidate(deps, implementClear, clearContext)).resolves.toBe(true)

    expect(events).toEqual([
      'load:session-a',
      'connect:workspace-1',
      'register:session-new:engineer',
      'notify:登记新会话 Agent 失败：工程师无可用模型',
      'open:session-new',
      'draft:session-new:/implement #15',
      'focus',
    ])
  })

  it.each([
    ['model directory', { modelDirectories: undefined }, '模型目录服务不可用，已只填入本会话输入框'],
    ['Agent registration', { registerSessionAgent: undefined }, '登记会话 Agent 的能力不可用，已只填入本会话输入框'],
    ['workspace navigation', { navigation: undefined }, '创建新会话能力不可用，已只填入本会话输入框'],
  ] as const)('degrades to filling this session when the %s capability is missing', async (_name, missing, message) => {
    const events: string[] = []
    const deps = clearDeps(events, missing)

    await expect(selectConsultCandidate(deps, implementClear, clearContext)).resolves.toBe(true)

    expect(events.filter(event => !event.startsWith('load:'))).toEqual([
      `notify:${message}`,
      'draft:current:/implement #15',
      'focus',
    ])
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('creates an other-moves clear successor without recording an Agent or selecting a model', async () => {
    const events: string[] = []
    const deps = clearDeps(events)

    await expect(selectOtherMove(deps, 'clear', clearContext)).resolves.toBe(true)

    expect(events).toEqual([
      'connect:workspace-1',
      'open:session-new',
      'draft:session-new:开空会话继续：',
      'focus',
    ])
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('never selects a model on this session, whatever the move', async () => {
    const events: string[] = []
    const deps = clearDeps(events)
    for (const candidate of [
      { label: '写 spec', input: '/to-spec', move: 'continue', station: 'to-spec' },
      { label: '派评审', input: '评审当前分支', move: 'subagent', station: 'code-review' },
      implementClear,
      { label: '压缩', input: '保留实现状态', move: 'compact', station: 'implement' },
      { label: '交接', input: '交接实现', move: 'handoff', station: 'implement' },
    ] as const satisfies readonly ConsultCandidate[]) {
      await selectConsultCandidate(deps, candidate, clearContext)
    }
    for (const move of OTHER_MOVE_OPTIONS.map(option => option.move)) {
      await selectOtherMove(deps, move, clearContext)
    }

    expect(events.filter(event => event.startsWith('select:session-a'))).toEqual([])
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('fills and focuses this session for a continue chip without loading or switching its model', async () => {
    const events: string[] = []
    const deps = {
      ...selectionDoubles(),
      appendToDraft: vi.fn((input: string, target?: string) => {
        events.push(`draft:${target ?? 'current'}:${input}`)
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

    expect(events).toEqual(['draft:current:/to-spec', 'focus'])
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('fills a continue chip without complaint when no model directory service is composed', async () => {
    const deps = selectionDoubles()

    await expect(selectConsultCandidate(deps, readyWithModels.candidates[0]!, {
      sessionId: 'session-a',
      phase: readyWithModels,
    })).resolves.toBe(true)

    expect(deps.appendToDraft).toHaveBeenCalledWith('/to-spec')
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('keeps this session untouched for subagent chips and names the subagent Agent in the input', async () => {
    const events: string[] = []
    const deps = {
      ...selectionDoubles(),
      appendToDraft: vi.fn((input: string, target?: string) => {
        events.push(`draft:${target ?? 'current'}:${input}`)
        return true
      }),
      focusComposer: vi.fn(() => { events.push('focus') }),
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

    expect(events).toEqual(['draft:current:让子代理评审当前分支\n\n子代理 · 评审', 'focus'])
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.command).not.toHaveBeenCalled()
  })

  it('names CEO as the subagent Agent for a standalone skill', async () => {
    const deps = selectionDoubles()

    await expect(selectConsultCandidate(deps, {
      label: '派研究',
      input: '派子代理调研 DSH 子代理接口',
      move: 'subagent',
      station: 'research',
    }, {
      sessionId: 'session-a',
      phase: readyWithModels,
    })).resolves.toBe(true)

    expect(deps.appendToDraft).toHaveBeenCalledWith('派子代理调研 DSH 子代理接口\n\n子代理 · CEO')
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('leaves a subagent input unchanged when the host sent no stage Agent table', async () => {
    const deps = selectionDoubles()
    const { stageAgents: _omitted, ...oldHost } = readyWithModels

    await expect(selectConsultCandidate(deps, {
      label: '派评审',
      input: '让子代理评审当前分支',
      move: 'subagent',
      station: 'code-review',
    }, { sessionId: 'session-a', phase: oldHost })).resolves.toBe(true)

    expect(deps.appendToDraft).toHaveBeenCalledWith('让子代理评审当前分支')
    expect(deps.notify).not.toHaveBeenCalled()
  })
})
