import { describe, expect, it } from 'vitest'
import { STALL_AFTER_MS, formatElapsed, sessionStatus } from '../../src/client/status-model.ts'
import type { StatusSource } from '../../src/client/status-model.ts'

const NOW = 1_800_000_000_000
const MIN = 60_000

function source(overrides: Partial<StatusSource> = {}): StatusSource {
  return { running: false, openState: 'open', blank: false, ...overrides }
}

describe('formatElapsed', () => {
  it('reads coarse units', () => {
    expect(formatElapsed(-5)).toBe('刚刚')
    expect(formatElapsed(30_000)).toBe('刚刚')
    expect(formatElapsed(3 * MIN)).toBe('3 分钟')
    expect(formatElapsed(120 * MIN)).toBe('2 小时')
    expect(formatElapsed(125 * MIN)).toBe('2 小时 5 分钟')
    expect(formatElapsed(3 * 24 * 60 * MIN)).toBe('3 天')
  })
})

describe('sessionStatus', () => {
  it('reports an idle session with when its last turn ended', () => {
    const status = sessionStatus(source({
      turnTimings: new Map([[1, { startTime: NOW - 20 * MIN, endTime: NOW - 15 * MIN }], [2, { startTime: NOW - 6 * MIN, endTime: NOW - 5 * MIN }]]),
    }), NOW)
    expect(status).toEqual({ kind: 'idle', headline: '空闲，等你输入', facts: ['上一轮结束于 5 分钟前'] })
  })

  it('names the in-flight tool call while running', () => {
    const status = sessionStatus(source({
      running: true,
      runningCalls: [{ name: 'bash', time: NOW - 2 * MIN }],
      turnTimings: new Map([[3, { startTime: NOW - 4 * MIN }]]),
    }), NOW)
    expect(status.kind).toBe('running')
    expect(status.facts).toEqual(['正在调用工具 bash（已 2 分钟）', '本轮开始于 4 分钟前'])
  })

  it('reports streaming output when no tool call is in flight', () => {
    const status = sessionStatus(source({ running: true, partial: { turn: 1 }, turnTimings: new Map([[1, { startTime: NOW }]]) }), NOW)
    expect(status.kind).toBe('running')
    expect(status.facts[0]).toBe('正在生成回复')
  })

  it('flags a running session silent past the stall threshold', () => {
    const status = sessionStatus(source({
      running: true,
      runningCalls: [{ name: 'bash', time: NOW - STALL_AFTER_MS - 2 * MIN }],
      turnTimings: new Map([[1, { startTime: NOW - 30 * MIN }]]),
    }), NOW)
    expect(status.kind).toBe('stalled')
    expect(status.headline).toBe('疑似卡住')
    expect(status.facts[0]).toBe('已 12 分钟没有新的工具调用或轮次')
  })

  it('does not call a streaming session stuck', () => {
    const status = sessionStatus(source({
      running: true,
      partial: { turn: 1 },
      turnTimings: new Map([[1, { startTime: NOW - 30 * MIN }]]),
    }), NOW)
    expect(status.kind).toBe('running')
  })

  it('puts a pending approval above everything else, naming the tool and reason', () => {
    const status = sessionStatus(source({
      running: true,
      pending: [{ kind: 'approval', payload: { toolName: 'bash', reason: '写入仓库外' } }],
      lastAgentError: 'boom',
    }), NOW)
    expect(status.kind).toBe('waiting')
    expect(status.headline).toBe('在等你')
    expect(status.facts[0]).toBe('待审批：工具 bash（写入仓库外）')
  })

  it('describes a pending question', () => {
    const status = sessionStatus(source({ running: true, pending: [{ kind: 'question' }] }), NOW)
    expect(status.facts[0]).toBe('待回答：agent 向你提了一个问题')
  })

  it('surfaces the newest agent error once the turn has stopped', () => {
    const status = sessionStatus(source({
      lastAgentError: 'rate limited',
      turnTimings: new Map([[1, { startTime: NOW - 3 * MIN, endTime: NOW - MIN }]]),
    }), NOW)
    expect(status).toEqual({ kind: 'error', headline: '出错了', facts: ['最近错误：rate limited', '上一轮结束于 1 分钟前'] })
  })

  it('reports a failed send', () => {
    expect(sessionStatus(source({ promptError: { op: 'send' } }), NOW).facts).toEqual(['发送失败'])
  })

  it('counts queued messages but not steering ones', () => {
    const status = sessionStatus(source({
      running: true,
      queue: [{ placement: 'queued' }, { placement: 'queued' }, { placement: 'steering' }],
    }), NOW)
    expect(status.facts).toContain('队列中还有 2 条待发消息')
  })

  it('reports blank, removed, and unopened sessions', () => {
    expect(sessionStatus(source({ blank: true }), NOW).kind).toBe('blank')
    expect(sessionStatus(source({ removed: true, running: true }), NOW).kind).toBe('removed')
    expect(sessionStatus(source({ openState: 'loading' }), NOW).headline).toBe('会话加载中')
    expect(sessionStatus(source({ openState: 'error' }), NOW).headline).toBe('会话未能打开')
  })

  it('degrades to running/idle when an older runtime publishes only `running`', () => {
    expect(sessionStatus({ running: true }, NOW)).toEqual({ kind: 'running', headline: '运行中', facts: [] })
    expect(sessionStatus({ running: false }, NOW)).toEqual({ kind: 'idle', headline: '空闲，等你输入', facts: [] })
  })
})
