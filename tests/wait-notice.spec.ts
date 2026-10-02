/**
 * Wait notices: a task issue's main session that stops for LF pushes one
 * A²D²-worded message through an optional `notifier` service (ADR 0010).
 *
 * The plugin is mounted in a real cordis context with the real task store; the
 * only stand-in is the `notifier` provider, which records what it was asked to
 * push.
 *
 * @module dsh-a2d2/tests/wait-notice
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { setTimeout as settle } from 'node:timers/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import A2d2Service from '../src/index.ts'

const run = promisify(execFile)
const roots: string[] = []
const mainSession = SessionId('session-main')
const childSession = SessionId('session-child')

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A project root whose `origin` is a GitHub repository, so issue links resolve. */
async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2d2-wait-notice-'))
  roots.push(root)
  await run('git', ['init', '-q', root])
  await run('git', ['-C', root, 'remote', 'add', 'origin', 'git@github.com:a2d2-dev/dsh-plugin.git'])
  return root
}

interface PushCall {
  readonly message: { readonly title?: string; readonly content?: string; readonly level?: string }
  readonly options: { readonly sourceName?: string; readonly sessionId?: string }
}

/** A `notifier` provider that records every push and answers like dsh-notifier 0.7. */
class StubNotifier extends Service {
  readonly calls: PushCall[] = []
  readonly push = vi.fn(async (message: PushCall['message'], options: PushCall['options']) => {
    this.calls.push({ message, options })
    return { ok: true, delivered: ['stub'], skipped: [], failed: [], source: { kind: 'plugin', name: options.sourceName } }
  })

  constructor(ctx: Context) {
    super(ctx, 'notifier')
  }
}

async function mount(root: string, options: { readonly notifier?: boolean } = {}): Promise<{
  readonly ctx: Context
  readonly service: A2d2Service
  readonly notifier: StubNotifier | undefined
}> {
  const ctx = new Context()
  if (options.notifier !== false) await ctx.plugin(StubNotifier)
  await ctx.plugin(A2d2Service, { root })
  const notifier = options.notifier === false ? undefined : ctx.get('notifier' as never) as unknown as StubNotifier
  return { ctx, service: ctx.a2d2, notifier }
}

let seq = 0

/** Append one session event the way DSH's `session/event` feed delivers it. */
function emit(ctx: Context, root: string, session: SessionId, type: string, data: unknown): void {
  const subject = { id: session, header: { version: 0, id: session, createdAt: 0, cwd: root } }
  seq += 1
  ;(ctx.emit as unknown as (name: string, ...args: unknown[]) => void)('session/event', subject, { type, seq, time: 0, data })
}

function assistantSays(ctx: Context, root: string, session: SessionId, turn: number, text: string): void {
  emit(ctx, root, session, 'assistant/message', {
    turn,
    step: 1,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    stream: [],
  })
}

describe('wait notices', () => {
  it('pushes "等你回复" with the last reply and the task issue link once the grace window after a main session turn passes', async () => {
    const root = await projectRoot()
    const { ctx, service, notifier } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 86, mainSession, now: new Date() })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    emit(ctx, root, mainSession, 'turn/start', { turn: 1 })
    assistantSays(ctx, root, mainSession, 1, '先看一下现状。')
    assistantSays(ctx, root, mainSession, 1, 'PR #90 已开，等你确认是否合并。')
    emit(ctx, root, mainSession, 'turn/end', { turn: 1, reason: { kind: 'completed' } })

    await vi.advanceTimersByTimeAsync(29_000)
    await settle(50)
    expect(notifier?.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(notifier?.calls).toHaveLength(1))

    expect(notifier?.calls[0]).toEqual({
      message: {
        title: '#86 · 等你回复',
        content: 'PR #90 已开，等你确认是否合并。\n\nhttps://github.com/a2d2-dev/dsh-plugin/issues/86',
        level: 'active',
      },
      options: { sourceName: 'dsh-a2d2', sessionId: mainSession },
    })
  })

  it('cuts the reply excerpt to 300 characters', async () => {
    const root = await projectRoot()
    const { ctx, service, notifier } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 86, mainSession, now: new Date() })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    emit(ctx, root, mainSession, 'turn/start', { turn: 1 })
    assistantSays(ctx, root, mainSession, 1, '长'.repeat(400))
    emit(ctx, root, mainSession, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(notifier?.calls).toHaveLength(1))

    const [excerpt] = (notifier?.calls[0]?.message.content ?? '').split('\n\n')
    expect(excerpt).toBe(`${'长'.repeat(299)}…`)
  })

  it.each([
    ['LF sends a message', 'user/message', { role: 'user', content: [{ type: 'text', text: '合并吧' }], source: { kind: 'user' } }],
    ['the session runs again', 'turn/start', { turn: 2 }],
  ])('retracts a turn notice when %s within the grace window', async (_label, type, data) => {
    const root = await projectRoot()
    const { ctx, service, notifier } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 86, mainSession, now: new Date() })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    emit(ctx, root, mainSession, 'turn/start', { turn: 1 })
    assistantSays(ctx, root, mainSession, 1, '等你确认。')
    emit(ctx, root, mainSession, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    await vi.advanceTimersByTimeAsync(10_000)
    emit(ctx, root, mainSession, type, data)
    await vi.advanceTimersByTimeAsync(60_000)
    await settle(50)

    expect(notifier?.calls).toEqual([])
  })

  it('pushes nothing for a subagent or an unbound session', async () => {
    const root = await projectRoot()
    const { ctx, service, notifier } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 86, mainSession, now: new Date() })
    await service.recordSessionAgent(root, childSession, 'engineer')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    for (const session of [childSession, SessionId('session-unbound')]) {
      emit(ctx, root, session, 'turn/start', { turn: 1 })
      assistantSays(ctx, root, session, 1, '实现完成。')
      emit(ctx, root, session, 'tool/call', {
        turn: 1, step: 1, callId: 'call-ask', name: 'ask_user_question',
        arguments: JSON.stringify({ questions: [{ id: 'q', question: '要合并吗？' }] }),
      })
      emit(ctx, root, session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    }
    await vi.advanceTimersByTimeAsync(60_000)
    await settle(50)

    expect(notifier?.calls).toEqual([])
  })

  it('pushes "需要你决定" with the question text at once when the main session asks LF', async () => {
    const root = await projectRoot()
    const { ctx, service, notifier } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 86, mainSession, now: new Date() })

    emit(ctx, root, mainSession, 'turn/start', { turn: 1 })
    emit(ctx, root, mainSession, 'tool/call', {
      turn: 1, step: 1, callId: 'call-ask', name: 'ask_user_question',
      arguments: JSON.stringify({ questions: [
        { id: 'deploy', question: '要发布到生产吗？', options: [{ label: '发布' }, { label: '不发' }] },
        { id: 'scope', question: '范围要包含飞书桥吗？' },
      ] }),
    })
    await vi.waitFor(() => expect(notifier?.calls).toHaveLength(1))

    expect(notifier?.calls[0]).toEqual({
      message: {
        title: '#86 · 需要你决定',
        content: '要发布到生产吗？\n范围要包含飞书桥吗？\n\nhttps://github.com/a2d2-dev/dsh-plugin/issues/86',
        level: 'timeSensitive',
      },
      options: { sourceName: 'dsh-a2d2', sessionId: mainSession },
    })
  })

  it('pushes "已完成" with the completion summary when the main session completes its task issue', async () => {
    const root = await projectRoot()
    const { service, notifier } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 86, mainSession, now: new Date() })

    await service.completeTask({ cwd: root, caller: mainSession, summary: 'PR #95 已合并，验收通过。' })
    await vi.waitFor(() => expect(notifier?.calls).toHaveLength(1))

    expect(notifier?.calls[0]).toEqual({
      message: { title: '#86 · 已完成', content: 'PR #95 已合并，验收通过。', level: 'active' },
      options: { sourceName: 'dsh-a2d2', sessionId: mainSession },
    })
  })

  it('starts and runs without a notifier provider, sending nothing and raising nothing', async () => {
    const root = await projectRoot()
    const { ctx, service } = await mount(root, { notifier: false })
    await service.bindMainSession({ cwd: root, issue: 86, mainSession, now: new Date() })

    emit(ctx, root, mainSession, 'turn/start', { turn: 1 })
    emit(ctx, root, mainSession, 'tool/call', {
      turn: 1, step: 1, callId: 'call-ask', name: 'ask_user_question',
      arguments: JSON.stringify({ questions: [{ id: 'q', question: '要合并吗？' }] }),
    })
    emit(ctx, root, mainSession, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    const completed = await service.completeTask({ cwd: root, caller: mainSession, summary: '完成。' })

    expect(completed.task.state).toBe('done')
  })

  it.each([
    ['rejects', () => Promise.reject(new Error('channel down'))],
    ['throws', () => { throw new Error('provider bug') }],
  ])('keeps the session unaffected when push %s', async (_label, failure) => {
    const root = await projectRoot()
    const { ctx, service, notifier } = await mount(root)
    await service.bindMainSession({ cwd: root, issue: 86, mainSession, now: new Date() })
    notifier?.push.mockImplementation(failure as never)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      emit(ctx, root, mainSession, 'turn/start', { turn: 1 })
      emit(ctx, root, mainSession, 'tool/call', {
        turn: 1, step: 1, callId: 'call-ask', name: 'ask_user_question',
        arguments: JSON.stringify({ questions: [{ id: 'q', question: '要合并吗？' }] }),
      })
      const completed = await service.completeTask({ cwd: root, caller: mainSession, summary: '完成。' })
      await vi.waitFor(() => expect(notifier?.push).toHaveBeenCalledTimes(2))
      await settle(50)

      expect(completed.task.state).toBe('done')
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
