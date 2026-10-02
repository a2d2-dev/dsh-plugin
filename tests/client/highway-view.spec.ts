import { describe, expect, it } from 'vitest'
import { highwayView } from '../../src/client/highway-view.ts'

const stageAgents = {
  stages: {
    grill: 'ceo',
    'to-spec': 'ceo',
    'to-tickets': 'ceo',
    implement: 'engineer',
    'code-review': 'reviewer',
    prototype: 'ceo',
    handoff: 'ceo',
    triage: 'ceo',
    'diagnosing-bugs': 'engineer',
    wayfinder: 'ceo',
    'improve-codebase-architecture': 'ceo',
    'domain-modeling': 'ceo',
    'codebase-design': 'ceo',
  },
  agents: {
    ceo: ['claude-bray/claude-fable-5-1', 'codex/gpt-6'],
    engineer: ['codex/gpt-5.5', 'claude-bray/claude-opus-5-5'],
    reviewer: ['claude-bray/claude-fable-5-1'],
  },
} as const

describe('highwayView', () => {
  it('derives passed, current, next, and ahead stations on the main highway', () => {
    const view = highwayView({
      kind: 'ready',
      degraded: false,
      position: 'grilling 已完成。',
      location: { zone: 'main', station: 'grill', phaseDone: true },
      next: { station: 'to-spec', move: 'continue', reason: '需要本轮原始推理' },
      candidates: [
        { label: '写 spec', input: '/to-spec', move: 'continue', station: 'to-spec' },
        { label: '派代理', input: '让子代理整理材料', move: 'subagent', station: 'to-spec' },
      ],
      stageAgents,
    }, ['claude-bray/claude-fable-5-1'])

    expect(view.stations.map(station => [station.id, station.state, station.role, station.agent, station.models])).toEqual([
      ['grill', 'current', '澄清目标与约束', 'CEO', 'claude-fable-5-1'],
      ['to-spec', 'next', '沉淀规格与验收', 'CEO', 'claude-fable-5-1'],
      ['to-tickets', 'ahead', '拆成可实施工单', 'CEO', 'claude-fable-5-1'],
      ['implement', 'ahead', '实现与 TDD', '工程师', '无可用模型'],
      ['code-review', 'ahead', '独立评审与收口', '评审', 'claude-fable-5-1'],
    ])
    expect(view.nextLine).toBe('→ /to-spec · Continue（需要本轮原始推理）· CEO')
    expect(view.aside).toBeUndefined()
    expect(view.placard).toBeUndefined()
  })

  it('shows unfinished phases as continue and does not promote the next station', () => {
    const view = highwayView({
      kind: 'ready',
      degraded: false,
      location: { zone: 'main', station: 'to-spec', phaseDone: false },
      next: { station: 'to-tickets', move: 'continue', reason: 'spec 还没完成' },
      candidates: [
        { label: '继续', input: '/to-spec', move: 'continue' },
        { label: '派代理', input: '整理问题', move: 'subagent' },
      ],
    })

    expect(view.stations.map(station => [station.id, station.state])).toEqual([
      ['grill', 'passed'],
      ['to-spec', 'current'],
      ['to-tickets', 'ahead'],
      ['implement', 'ahead'],
      ['code-review', 'ahead'],
    ])
    expect(view.nextLine).toBe('本阶段未完成 · 继续')
  })

  it('renders service and ramp notes without marking the main road current', () => {
    expect(highwayView({
      kind: 'ready',
      degraded: false,
      location: { zone: 'service', station: 'prototype', returnTo: 'grill', phaseDone: true },
      next: { station: 'grill', move: 'handoff', reason: '原型已完成' },
      candidates: [
        { label: '交回', input: 'handoff prototype results', move: 'handoff' },
        { label: '继续', input: '补原型', move: 'continue' },
      ],
    }).aside).toBe('绕道中：prototype，完成后 handoff 回 grill')

    const ramp = highwayView({
      kind: 'ready',
      degraded: false,
      location: { zone: 'ramp', station: 'wayfinder', phaseDone: true },
      next: { station: 'to-spec', move: 'continue', reason: '已找到入口' },
      candidates: [
        { label: '进入 spec', input: '/to-spec', move: 'continue' },
        { label: '派代理', input: '找相关材料', move: 'subagent' },
      ],
    })
    expect(ramp.aside).toBe('匝道：wayfinder，并入 to-spec')
    expect(ramp.stations.every(station => station.state === 'ahead')).toBe(true)
  })

  it('shows standalone, roadbed, and off-road placards with no main-road highlight', () => {
    expect(highwayView({
      kind: 'ready',
      degraded: false,
      location: { zone: 'standalone', station: 'research', phaseDone: true },
      candidates: [
        { label: '继续研究', input: 'research more', move: 'continue' },
        { label: '交接', input: 'handoff research', move: 'handoff' },
      ],
    }).placard).toBe('独立：research')

    expect(highwayView({
      kind: 'ready',
      degraded: false,
      location: { zone: 'roadbed', station: 'domain-modeling', phaseDone: true },
      candidates: [
        { label: '继续建模', input: 'domain model', move: 'continue' },
        { label: '交接', input: 'handoff model', move: 'handoff' },
      ],
    }).placard).toBe('路基：domain-modeling')

    const offRoad = highwayView({
      kind: 'ready',
      degraded: false,
      location: { zone: 'off-road', phaseDone: true },
      candidates: [
        { label: '继续', input: 'continue', move: 'continue' },
        { label: '交接', input: 'handoff', move: 'handoff' },
      ],
    })
    expect(offRoad.placard).toBe('不在公路上')
    expect(offRoad.stations.every(station => station.state === 'ahead')).toBe(true)
  })

  it('shows a setup placard only when the host reports missing preconditions', () => {
    const view = highwayView({
      kind: 'ready',
      degraded: false,
      location: { zone: 'main', station: 'grill', phaseDone: true },
      next: { station: 'to-spec', move: 'continue', reason: '先完成首次配置' },
      candidates: [
        { label: '首次使用前：/setup-matt-pocock-skills', input: '/setup-matt-pocock-skills', move: 'continue' },
        { label: '继续', input: '/to-spec', move: 'continue' },
      ],
      preconditions: {
        missing: [
          { id: 'context', label: 'CONTEXT.md or CONTEXT-MAP.md', paths: ['CONTEXT.md', 'CONTEXT-MAP.md'] },
          { id: 'issue-tracker', label: 'docs/agents/issue-tracker.md', paths: ['docs/agents/issue-tracker.md'] },
        ],
      },
    })

    expect(view.preconditionPlacard).toEqual({
      title: '首次使用前：/setup-matt-pocock-skills',
      missing: ['CONTEXT.md or CONTEXT-MAP.md', 'docs/agents/issue-tracker.md'],
    })
  })

  it('omits the setup placard for configured projects and old hosts', () => {
    expect(highwayView({
      kind: 'ready',
      degraded: false,
      location: { zone: 'main', station: 'grill', phaseDone: true },
      candidates: [
        { label: '继续', input: '/to-spec', move: 'continue' },
        { label: '代理', input: '整理', move: 'subagent' },
      ],
      preconditions: { missing: [] },
    }).preconditionPlacard).toBeUndefined()

    expect(highwayView({
      kind: 'ready',
      degraded: false,
      location: { zone: 'main', station: 'grill', phaseDone: true },
      candidates: [
        { label: '继续', input: '/to-spec', move: 'continue' },
        { label: '代理', input: '整理', move: 'subagent' },
      ],
    }).preconditionPlacard).toBeUndefined()

    const legacy = highwayView({
      kind: 'ready',
      degraded: false,
      location: { zone: 'main', station: 'grill', phaseDone: true },
      next: { station: 'to-spec', move: 'continue', reason: '旧宿主' },
      candidates: [
        { label: '继续', input: '/to-spec', move: 'continue' },
        { label: '代理', input: '整理', move: 'subagent' },
      ],
    })
    expect(legacy.stations.map(station => station.agent)).toEqual([undefined, undefined, undefined, undefined, undefined])
    expect(legacy.nextLine).toBe('→ /to-spec · Continue（旧宿主）')
  })
})
