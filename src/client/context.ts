/**
 * Structural faces of the client services this bundle uses.
 *
 * The browser half runs inside a bundle that may not value-import another
 * plugin's package — cross-plugin collaboration goes through cordis services —
 * so the services it reaches are named here as the members it actually calls
 * rather than imported from the packages that own them. A service read through
 * `ctx.get` is typed as possibly absent, and every caller below degrades to a
 * no-op rather than throwing.
 *
 * @module @a2d2-dev/dsh-a2d2/client/context
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
// Value-free imports of the declaration merges: they type `ctx.slots` and the
// slot map. Only the types travel — the bundle reaches the services through
// cordis at runtime, because a cross-plugin value import is forbidden.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Session-scoped slots receive `sessionId` through ui-session's standard-props merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// The conversation shell declares the slot this bundle registers into.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SubagentSessionSummary } from './subagent-model.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** DSH settings page contributed by this plugin when the settings shell is present. */
    'settings.section': { kind: 'list'; scope: 'root'; owner: { close: () => void } }
  }
}

/** The composer draft face reached through `ctx.conversation.input`. */
export interface ComposerInput {
  /** The live input store, read for the current draft. */
  readonly state: { getSnapshot(): { readonly draft: string } }
  /** Replace the whole draft; the input machine's single public write path. */
  setDraft(text: string): void
}

/** The conversation service face this bundle needs. */
export interface ComposerService {
  readonly input: { for(actx: Context): ComposerInput }
}

/** Context-length thresholds, as the `a2d2Indicator` projection carries them. */
export interface HostThresholds {
  readonly warnAtTokens: number
  readonly criticalAtTokens: number
}

/** The `a2d2Indicator` projection value. */
export interface HostIndicatorProjection {
  readonly thresholds: HostThresholds
  /** The route's context capacity, absent until an adapter advertises one. */
  readonly contextWindow?: number
  /** The resolved per-million price for the session's route, absent when unpriced. */
  readonly price?: { readonly inputPerMillion: number; readonly outputPerMillion: number }
  /** Currency the rates are quoted in. */
  readonly currency: string
}

/**
 * One projection's read face; absence is an `undefined` snapshot, never a
 * missing face. Mirrors the runtime's `ObservableSnapshot` without importing it,
 * which this bundle may not value-import.
 */
export interface ProjectionFace {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}

/** Admission result of one slash-command line, as the session face returns it. */
export type ClientCommandResult =
  | { readonly ok: true; readonly value: { readonly matched: boolean } }
  | { readonly ok: false }

/**
 * The conversation state the orb reads.
 *
 * `running` is the host's own answer to "this session is in a turn", published
 * over the session transport rather than inferred from the DOM: the orb uses it
 * to know when the handoff summary has been written, and a signal read from
 * another plugin's rendered markup would break with that plugin's UI.
 *
 * The remaining fields feed the 现状 card and are read through the same
 * snapshot; each is optional there so an older runtime degrades the card
 * rather than breaking it.
 */
export interface ClientConversationState {
  readonly running: boolean
  readonly removed?: boolean
  readonly openState?: string
  readonly blank?: boolean
  readonly lastAgentError?: string | null
  readonly promptError?: { readonly op: string } | null
  /** Local prompt-submission echoes; `queued` ones are the 现状 card's queue. */
  readonly pendingSubmissions?: readonly { readonly placement: string }[]
}

/** The client session face this bundle needs. */
export interface ClientSessionFace {
  readonly projections: { faceOf(key: string): ProjectionFace }
  /**
   * Execute one slash-command line against this session's agent. The orb runs
   * `/handoff` on the session it sits on to have that session write its own
   * summary, and `/handoff take …` against the created successor to have the
   * host inject the handoff as its first prompt.
   */
  command(line: string): Promise<ClientCommandResult>
  /**
   * Rename this session (explicit user title). The orb gives the successor the
   * handing-off session's title so a handoff chain keeps one readable name; only
   * the accept/reject bit is read, because a failed rename is non-fatal and
   * leaves the successor on its automatic title rather than stopping the handoff.
   * @param title - the raw title text; the host normalizes acceptance.
   * @returns whether the host accepted the rename.
   */
  rename(title: string): Promise<{ readonly ok: boolean }>
  /** The current conversation state, read for {@link ClientConversationState.running}. */
  getSnapshot(): ClientConversationState
  /**
   * Subscribe to conversation-state changes.
   * @param listener - called after any change.
   * @returns the disposer removing the listener.
   */
  subscribe(listener: () => void): () => void
}

/** One workspace row this bundle reads to find a session's owning workspace. */
export interface ClientWorkspaceView {
  readonly workspaceId: string
  readonly sessionIds: readonly string[]
}

/** The workspaces-service face this bundle needs to find a session's workspace. */
export interface ClientWorkspacesService {
  /** The workspace list, read to map the current session to its workspace id. */
  readonly list: { getSnapshot(): { readonly items: readonly ClientWorkspaceView[] } }
}

/** A durable direct-parent subagent address, as UI navigation accepts it. */
export interface ClientSubagentAddress {
  readonly parentSessionId: string
  readonly childSessionId: string
  readonly mode: 'one-shot' | 'continuable'
}

/** The `uiWorkspace` navigation face: the one owner of "show this session". */
export interface ClientWorkspaceNavigation {
  /**
   * Select a session, or a subagent through its parent address, and show its conversation.
   * @param target - a session id or a durable subagent address.
   */
  openSession(target: string | ClientSubagentAddress): void
  /**
   * Connect a workspace to its reusable or freshly created blank session.
   * @param workspaceId - the workspace the successor session is created under.
   * @returns the connected session id.
   */
  connectWorkspace(workspaceId: string): Promise<string>
}

/** One pending user interaction as `uiSession.sessionStatus` reports it (approval fields when an approval). */
export interface ClientPendingInteraction {
  readonly kind: string
  readonly toolName?: string
  readonly reason?: string
}

/** The `uiSession` face: per-session UI status, including the pending interaction. */
export interface ClientUiSessionService {
  readonly sessionStatus: {
    getSnapshot(): ReadonlyMap<string, { readonly pendingInteraction?: ClientPendingInteraction }>
    subscribe(listener: () => void): () => void
  }
}

/** The `remote` face: one session's projection baseline, read without opening it. */
export interface ClientProjectionsRemote {
  readonly session: {
    projections(
      payload: { readonly sessionId: string },
      signal?: AbortSignal,
    ): Promise<
      | { readonly ok: true; readonly value: { readonly values?: Readonly<Record<string, unknown>> } | null }
      | { readonly ok: false }
    >
  }
}

/**
 * The sessions service face this bundle needs.
 *
 * There is no "current session" getter: a session-scoped slot component is
 * handed its `sessionId` as a framework-standard prop, and the service is used
 * only to turn that id into the faces the indicator reads.
 */
export interface ClientSessionsService {
  /** The session face for an already-retained id, or `undefined` when nothing retains it. */
  binding(id: string): { readonly session: ClientSessionFace } | undefined
  /** The session-scoped context for an id, which the composer facade requires. */
  scope(id: string): Context | undefined
  /**
   * Hold a session open for one operation: retain it under `source`, wait for
   * its binding, run `operation`, and release.
   */
  using<T>(
    target: string,
    options: { readonly source: string },
    operation: (reference: { readonly binding: { readonly session: ClientSessionFace } }) => T | Promise<T>,
  ): Promise<T>
  /**
   * The session list store: every host row with the projection values the host
   * folded for it, plus each loaded session's projection baseline — a parent's
   * `subagentCatalog` among them.
   *
   * This is the only client-side source of ANOTHER session's route. `binding(id)`
   * answers for a session the shell holds a transport for, which a child the user
   * never opened is not; the list carries a projection row for every session the
   * host enumerates, children included.
   */
  readonly list: ClientSessionListStore
  /**
   * Load one session's projection baseline once per connection, without opening
   * it; live frames keep it current after that. A parent's direct subagent
   * catalog arrives this way.
   * @param sessionId - the session to read.
   * @returns fulfillment after the store publishes the baseline, or after the read fails.
   */
  refreshProjections(sessionId: string): Promise<void>
}

/** One session's route, as the `a2d2Indicator` projection publishes it. */
export interface ClientRouteSource {
  /** The route the session's newest request named, absent before its first request. */
  readonly route?: { readonly provider: string; readonly model: string }
}

/** The session list store's read face, mirroring the runtime's `SnapshotStore`. */
export interface ClientSessionListStore {
  getSnapshot(): ClientSessionListSnapshot
  subscribe(listener: () => void): () => void
}

/** One `subagentCatalog` projection row: a direct child in parent catalog order. */
export interface ClientSubagentCatalogEntry {
  readonly id: string
  readonly mode: 'one-shot' | 'continuable' | 'unknown'
  readonly label?: string
}

/** One session's projection baseline in the list store. */
export interface ClientSessionProjectionSnapshot {
  readonly values: Readonly<{ readonly subagentCatalog?: readonly ClientSubagentCatalogEntry[] } & Record<string, unknown>>
  readonly state: 'idle' | 'loading' | 'ready' | 'error'
  readonly error: unknown
}

/** The published session list, narrowed to the two maps this bundle reads. */
export interface ClientSessionListSnapshot {
  /** Every host row keyed by id, each carrying its display title and the projections the host folded for it. */
  readonly byId: Readonly<Record<string, (SubagentSessionSummary & {
    readonly title?: string | null
    readonly blank?: boolean
  }) | undefined>>
  /** Projection baselines of the sessions read so far, keyed by session id. */
  readonly projectionsBySession: Readonly<Record<string, ClientSessionProjectionSnapshot | undefined>>
}

/** Props the sidebar hands one tab component (the subset this bundle reads). */
export interface ClientTabProps {
  /** The session scope the tab belongs to. */
  readonly scope: { readonly sessionId: string }
  /** Whether this tab is the active one and its panel is open; live views pause otherwise. */
  readonly visible?: boolean
}

/** The sidebar tab a plugin declares, in the fields this bundle fills. */
export interface ClientTabDescriptor {
  /** Unique tab type id, also the `SidebarTab.type` value. */
  readonly id: string
  /** Tab title in the sidebar's `+` menu. */
  readonly title: string
  /** Tab glyph in the sidebar rail and `+` menu. */
  readonly icon?: ReactNode | ((size: number) => ReactNode)
  /** Position among the `+` menu entries, ascending. */
  readonly order?: number
  /** Whether opening focuses an existing tab of this type instead of adding another. */
  readonly single?: boolean
  /** The tab body. */
  readonly component: (props: ClientTabProps) => unknown
}

/**
 * The sidebar service face this bundle registers into.
 *
 * Declared here rather than imported: a cross-plugin value import is forbidden
 * in this bundle, and the sidebar is an optional peer — a deployment without it
 * registers the handoff orb alone, exactly as it did before this list existed.
 */
export interface ClientSidebarService {
  /**
   * Contribute one tab type.
   * @param descriptor - the tab to add.
   * @returns the disposer removing it.
   */
  registerTab(descriptor: ClientTabDescriptor): () => void
}

/** The client context this bundle's plugin is applied to. */
export type A2d2ClientContext = Context
