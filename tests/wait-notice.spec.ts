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
})
