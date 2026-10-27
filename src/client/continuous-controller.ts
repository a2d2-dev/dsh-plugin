import { browserUUID } from './browser-uuid.ts'
import { WorkClientError } from './work-api.ts'
import type { WorkClient } from './work-api.ts'
import type { ContinuousWorkRule, WorkCommand } from '../work-types.ts'

type Scope = { projectId: string; sourceId: string }
export interface ContinuousDraftState {
  rule?: ContinuousWorkRule; draft: string; busy: boolean; error?: string; pending?: WorkCommand
}
/** The server owns rule/plan versions. This controller owns only this source's unsent text. */
export class ContinuousDelegationController {
  private state: ContinuousDraftState
  private listeners = new Set<() => void>()
  private readonly key: string
  private afterReceipt?: () => void
  constructor(private readonly client: WorkClient, private readonly scope: Scope, rule?: ContinuousWorkRule) {
    this.key = `a2d2-continuous-draft:${scope.projectId}:${scope.sourceId}`
    let draft = ''
    try { draft = globalThis.localStorage?.getItem(this.key) ?? '' } catch { /* Server-saved instructions remain available when local storage is unavailable. */ }
    let pending: WorkCommand | undefined
    try {
      const saved = globalThis.localStorage?.getItem(`${this.key}:pending`)
      const value = saved ? JSON.parse(saved) as WorkCommand : undefined
      if (value && 'projectId' in value && value.projectId === scope.projectId && 'sourceId' in value && value.sourceId === scope.sourceId && value.type.startsWith('continuous.')) pending = value
    } catch { /* A malformed browser draft cannot grant server authority. */ }
    this.state = { rule, draft, busy: false, pending }
    if (pending?.type === 'continuous.instruct') {
      const text = pending.text
      this.afterReceipt = () => { if (this.state.draft === text) this.setDraft('') }
    }
  }
  getSnapshot = (): ContinuousDraftState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private change(patch: Partial<ContinuousDraftState>): void {
    this.state = { ...this.state, ...patch }
    if ('pending' in patch) try {
      if (patch.pending) globalThis.localStorage?.setItem(`${this.key}:pending`, JSON.stringify(patch.pending))
      else globalThis.localStorage?.removeItem(`${this.key}:pending`)
    } catch { /* Server command receipts still fence replay when browser storage is unavailable. */ }
    for (const listener of this.listeners) listener()
  }
  updateRule(rule?: ContinuousWorkRule): void { if (rule && rule.projectId === this.scope.projectId && rule.sourceId === this.scope.sourceId && (!this.state.rule || rule.version >= this.state.rule.version)) this.change({ rule }) }
  setDraft(draft: string): void {
    try { globalThis.localStorage?.setItem(this.key, draft) } catch { /* Keep the live input even when browser persistence is unavailable. */ }
    this.change({ draft })
  }
  private command(type: 'continuous.end' | 'continuous.preview' | 'continuous.refresh' | 'continuous.instruct' | 'continuous.set-enabled' | 'continuous.block', fields: Record<string, unknown> = {}): WorkCommand {
    return { type, commandId: `continuous-ui:${browserUUID()}`, ...this.scope, expectedVersion: this.state.rule?.version ?? 0, ...fields } as WorkCommand
  }
  private async run(command: WorkCommand, afterReceipt?: () => void): Promise<void> {
    if (this.state.busy || this.state.pending) return
    this.afterReceipt = afterReceipt
    this.change({ busy: true, error: undefined, pending: command })
    await this.send(command)
  }
  private async send(command: WorkCommand): Promise<void> {
    try {
      const result = await this.client.command(command)
      this.updateRule(result.continuousRule)
      this.afterReceipt?.(); this.afterReceipt = undefined
      this.change({ pending: undefined, busy: false })
    } catch (error) {
      const known = error instanceof WorkClientError
      this.change({ busy: false, error: error instanceof Error ? error.message : '持续委托请求失败', ...(known ? { pending: undefined } : {}) })
      if (known) this.afterReceipt = undefined
    }
  }
  save = async (): Promise<void> => {
    const text = this.state.draft
    if (!text.trim()) return
    await this.run(this.command('continuous.instruct', { text }), () => { if (this.state.draft === text) this.setDraft('') })
  }
  refresh = async (): Promise<void> => this.run(this.command('continuous.refresh'))
  preview = async (): Promise<void> => this.run(this.command('continuous.preview'))
  enable = async (enabled: boolean): Promise<void> => this.run(this.command('continuous.set-enabled', { enabled }))
  end = async (nodeId: string): Promise<void> => this.run(this.command('continuous.end', { nodeId }))
  block = async (nodeId: string, blocked: boolean): Promise<void> => this.run(this.command('continuous.block', { nodeId, blocked }))
  retry = async (): Promise<void> => {
    if (this.state.busy || !this.state.pending) return
    const command = this.state.pending
    this.change({ busy: true, error: undefined })
    await this.send(command)
  }
}
