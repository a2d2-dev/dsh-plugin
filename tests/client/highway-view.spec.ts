import { describe, expect, it } from 'vitest'
import { highwayView } from '../../src/client/highway-view.ts'

const stationModels = {
  grill: ['claude-bray/claude-fable-5-1', 'codex/gpt-6'],
  'to-spec': ['claude-bray/claude-fable-5-1'],
  'to-tickets': ['claude-bray/claude-fable-5-1'],
  implement: ['codex/gpt-5.5'],
  'code-review': ['claude-bray/claude-fable-5-1'],
}

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
      stationModels,
    }, ['claude-bray/claude-fable-5-1'])

    expect(view.stations.map(station => [station.id, station.state, station.role, station.models])).toEqual([
      ['grill', 'current', '澄清目标与约束', 'claude-fable-5-1'],
      ['to-spec', 'next', '沉淀规格与验收', 'claude-fable-5-1'],
      ['to-tickets', 'ahead', '拆成可实施工单', 'claude-fable-5-1'],
      ['implement', 'ahead', '实现与 TDD', '保持当前模型'],
      ['code-review', 'ahead', '独立评审与收口', 'claude-fable-5-1'],
    ])
    expect(view.nextLine).toBe('→ /to-spec · Continue（需要本轮原始推理）· claude-fable-5-1')
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
})
