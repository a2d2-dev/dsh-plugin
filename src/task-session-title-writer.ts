import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionRef } from './work-types.ts'

/** Title-only writes: never resume an Agent or wake a model, including cold history. */
export class TaskSessionTitleWriter {
  private readonly pending = new Map<string, Promise<void>>()
  private readonly accepted = new Map<string, { requested: string; title: string }>()
  private readonly unflushed = new Set<string>()
  private readonly cold = new Map<string, { title: string; revision: unknown; persistence: symbol }>()
  private readonly liveTitles = new WeakMap<Session, { title: string; user: boolean } | null>()
  constructor(private readonly ctx: Context, private readonly runtimeId: string) {
    ctx.on('session/event', (session, event) => {
      if (event.type === 'session/title') this.liveTitles.set(session, { title: event.data.title, user: event.data.source.kind === 'user' })
    })
    ctx.on('session/disposed', session => {
      this.accepted.delete(session.id)
      this.unflushed.delete(session.id)
      this.liveTitles.delete(session)
    })
  }
  async set(session: SessionRef, title: string): Promise<void> {
    if (session.runtimeId !== this.runtimeId) return
    const id = session.sessionId
    const operation = (this.pending.get(id) ?? Promise.resolve()).catch(() => {}).then(() => this.write(SessionId(id), title))
    this.pending.set(id, operation)
    try { await operation } finally { if (this.pending.get(id) === operation) this.pending.delete(id) }
  }
  private async write(id: SessionId, title: string): Promise<void> {
    const live = this.ctx.get('sessions')?.get(id)
    if (live) {
      this.cold.delete(id)
      const titles = this.ctx.get('sessionTitle')
      if (!this.liveTitles.has(live)) {
        const initial = titles?.get(live) ?? await this.ctx.get('sessionQuery')?.readTitle(id)
        // A title event may have arrived while the asynchronous observation ran.
        if (!this.liveTitles.has(live)) this.liveTitles.set(live, initial ? { title: initial.title, user: initial.source.kind === 'user' } : null)
      }
      const current = this.liveTitles.get(live)
      const accepted = this.accepted.get(id)
      const unchanged = current?.user && (current.title === title || (accepted?.requested === title && accepted.title === current.title))
      if (unchanged && !this.unflushed.has(id)) return
      if (!unchanged) {
        this.unflushed.add(id)
        if (titles) this.accepted.set(id, { requested: title, title: titles.rename(live, title).title })
        else { live.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } }); this.accepted.set(id, { requested: title, title }) }
      }
      await this.ctx.parallel('session/flush', live)
      this.unflushed.delete(id)
      return
    }
    const persistence = this.ctx.get('sessionPersistence')
    const stored = await persistence?.stat(id)
    // A reserved successor has no log until ensure creates it. The caller retries afterwards.
    if (!persistence || !stored) return
    const cached = this.cold.get(id)
    if (cached?.title === title && cached.revision === stored.revision && cached.persistence === persistence.identity) return
    const handle = await persistence.open(id, 'write')
    try {
      const { events } = await handle.read()
      const current = events.findLast(event => event.type === 'session/title')
      if (current?.data.title !== title || current.data.source.kind !== 'user') {
        await handle.append([{ type: 'session/title', seq: SessionSeq(events.length), time: Date.now(), data: { title, messageSeqs: [], source: { kind: 'user' } } }])
        await handle.flush()
      }
      const after = await persistence.stat(id)
      if (after) this.cold.set(id, { title, revision: after.revision, persistence: persistence.identity })
    } finally { await handle.close() }
  }
}
