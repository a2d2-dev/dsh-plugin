import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ExecutionFixtures } from './work-execution-fixture.ts'
import { TaskSessionTitleWriter } from '../src/task-session-title-writer.ts'

let fixtures: ExecutionFixtures
beforeEach(({ signal }) => { fixtures = new ExecutionFixtures(signal) })
afterEach(() => fixtures.close())

it('does not cache a competing cold title written after the writer lease is released', async () => {
  const h = await fixtures.mount(await fixtures.root())
  const id = SessionId('cold-race')
  const initial = await h.ctx.sessionPersistence.create({ version: 4, isSeeded: false, delegationDepth: 0, id, createdAt: 1234, cwd: h.workspace.path, agentPreset: 'contract' })
  await initial.flush()
  await initial.close()
  const open = h.ctx.sessionPersistence.open.bind(h.ctx.sessionPersistence)
  let injected = false
  vi.spyOn(h.ctx.sessionPersistence, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args)
    if (args[0] !== id || args[1] !== 'write' || injected) return handle
    const close = handle.close.bind(handle)
    handle.close = async () => {
      await close()
      if (injected) return
      injected = true
      const rival = await open(id, 'write')
      try {
        const { events } = await rival.read()
        await rival.append([{ type: 'session/title', seq: SessionSeq(events.length), time: Date.now(), data: { title: 'Concurrent other title', messageSeqs: [], source: { kind: 'user' } } }])
        await rival.flush()
      } finally { await rival.close() }
    }
    return handle
  })
  const writer = new TaskSessionTitleWriter(h.ctx, 'runtime')
  const session = { runtimeId: 'runtime', sessionId: id }
  await writer.set(session, '#211 · 会话 1 · 会话命名')
  expect((await h.ctx.sessionQuery.readTitle(id))?.title).toBe('Concurrent other title')
  await writer.set(session, '#211 · 会话 1 · 会话命名')
  expect((await h.ctx.sessionQuery.readTitle(id))?.title).toBe('#211 · 会话 1 · 会话命名')
  expect(h.ctx.sessions.list()).toHaveLength(0)
  expect(h.model.requests).toHaveLength(0)
})

it('uses title events to avoid rescanning live histories and still repairs an external rename', async () => {
  const h = await fixtures.mount(await fixtures.root())
  await h.ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 80, maxTitleBytes: 80 })
  const { sessionId } = await h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' })
  const writer = new TaskSessionTitleWriter(h.ctx, 'runtime')
  const session = { runtimeId: 'runtime', sessionId }
  await writer.set(session, '#211 · 会话 1 · 会话命名')
  const get = vi.spyOn(h.ctx.sessionTitle, 'get')
  for (let i = 0; i < 10; i++) await writer.set(session, '#211 · 会话 1 · 会话命名')
  expect(get).not.toHaveBeenCalled()
  await h.ctx.sessionController.rename({ sessionId, title: 'Different topic' })
  get.mockClear()
  await writer.set(session, '#211 · 会话 1 · 会话命名')
  expect((await h.ctx.sessionQuery.readTitle(sessionId))?.title).toBe('#211 · 会话 1 · 会话命名')
  // The service itself folds once to return the accepted rename; the writer does not poll history.
  expect(get).toHaveBeenCalledTimes(1)
  const events = (await h.ctx.sessionController.inspect(sessionId)).events
  expect(events.filter(event => event.type === 'session/title')).toHaveLength(3)
})

it('retries a failed title durability checkpoint without appending a duplicate title', async () => {
  const h = await fixtures.mount(await fixtures.root())
  await h.ctx.plugin(SessionTitle, { fallbackMaxWords: 8, fallbackMaxBytes: 80, maxTitleBytes: 80 })
  const { sessionId } = await h.ctx.sessionController.create({ workspaceId: h.workspace.id, agentPreset: 'contract' })
  const writer = new TaskSessionTitleWriter(h.ctx, 'runtime')
  const session = { runtimeId: 'runtime', sessionId }
  let attempts = 0
  const dispose = h.ctx.on('session/flush', live => { if (live.id === sessionId && attempts++ === 0) throw new Error('Durability checkpoint failed') })
  await expect(writer.set(session, '#211 · 会话 1 · 会话命名')).rejects.toThrow()
  await writer.set(session, '#211 · 会话 1 · 会话命名')
  dispose()
  expect(attempts).toBe(2)
  expect((await h.ctx.sessionController.inspect(sessionId)).events.filter(event => event.type === 'session/title')).toHaveLength(1)
})
