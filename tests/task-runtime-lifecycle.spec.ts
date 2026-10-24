import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { TaskRuntimeService } from '../src/task-runtime.ts'
import { TaskRunner } from '../src/task-runtime/runner.ts'

it('joins recovery before closing the runner and stops polling during disposal', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  let releaseRecovery!: () => void
  const recovery = new Promise<void>(resolve => { releaseRecovery = resolve })
  const recover = vi.spyOn(TaskRunner.prototype, 'recover').mockReturnValue(recovery)
  const close = vi.spyOn(TaskRunner.prototype, 'close').mockResolvedValue(undefined)
  const ctx = new Context()
  let disposal: Promise<void> | undefined
  let disposed = false
  try {
    ctx.provide('a2d2', { installRuntimeExecutionGuard() {} } as never)
    new TaskRuntimeService(ctx, { enabled: true, pollMs: 10 })
    expect(recover).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30)
    expect(recover).toHaveBeenCalledTimes(1)

    disposal = ctx.fiber.dispose().then(() => { disposed = true })
    await vi.advanceTimersByTimeAsync(30)
    expect(close).not.toHaveBeenCalled()
    expect(disposed).toBe(false)
    expect(recover).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    releaseRecovery()
    await disposal
    expect(close).toHaveBeenCalledTimes(1)
    expect(disposed).toBe(true)
    await vi.advanceTimersByTimeAsync(30)
    expect(recover).toHaveBeenCalledTimes(1)
  } finally {
    releaseRecovery()
    try { await (disposal ?? ctx.fiber.dispose()) }
    finally {
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  }
})
