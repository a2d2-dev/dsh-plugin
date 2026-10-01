/**
 * The browser half of the A²D² plugin.
 *
 * Two contributions, both browser-only views of host folds: the floating handoff
 * indicator, mounted into the composer's dock slot, and the subagent model list,
 * registered as a sidebar tab. The indicator registers into an existing
 * session-scoped list slot rather than the root slot, which the layout frame
 * owns. This half collaborates with the host only through cordis services and
 * the host-published `a2d2Indicator` projection — never through another plugin's
 * package.
 *
 * The sidebar is an optional peer: a deployment without it gets the indicator
 * alone, and the tab registration waits for the service rather than failing the
 * bundle.
 *
 * @module @deepseek-ai/dsh-a2d2/client
 */

import { createElement } from 'react'
import { A2d2ConfigSection, loadModelRouteCatalog } from './config-page.tsx'
import { IconA2d2AgentsOutline16 } from './icons.tsx'
import { HandoffOrb } from './orb.tsx'
import type { OrbChatFacts } from './orb.tsx'
import { A2d2Panel } from './panel.tsx'
import type { A2d2ClientContext, ClientSidebarService } from './context.ts'

/** Services this bundle needs before it can mount anything. */
// `remote.session` is guarded by cordis: reading it from a fiber that did not
// inject it throws "cannot get property … without inject" (title, route and
// model-catalog reads all go through it).
export const inject = ['slots', 'sessions', 'remote', 'remote.session']

/** The sidebar tab this bundle contributes, in the fields the sidebar's `+` menu reads. */
const A2D2_PANEL_TAB = {
  /** Stable tab type id; the sidebar keys deduplication and activation on it. */
  id: 'a2d2-panel',
  /** Menu title, in the language the indicator's own copy uses. */
  title: 'A²D²',
  /** Sidebar/menu glyph matching the host's 16px outline tab icon style. */
  icon: (size: number) => createElement(IconA2d2AgentsOutline16, { size }),
  /** Menu position, after the sidebar's own browsing tabs. */
  order: 40,
} as const

/**
 * Mount the indicator for every composed conversation shell, and the subagent
 * model list for every sidebar that accepts one.
 *
 * `slots.inject` waits for the conversation shell to declare the slot this
 * registers into: a client entry may activate before the shell does, and
 * registering into an undeclared slot fails the whole plugin. The registration
 * therefore happens inside the declaration's lifetime and is torn down with it.
 *
 * The slot is session-scoped, so the renderer hands the component its
 * `sessionId`; the plugin never has to name the current session itself, which is
 * what keeps it correct when several sessions are open and the user switches.
 * The sidebar hands its tab the same id through the tab's own scope.
 * @param ctx - the client context carrying the slot registry, the sessions service, and the optional sidebar.
 */
export function apply(ctx: A2d2ClientContext): void {
  ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'a2d2-handoff-orb',
    order: 50,
  }, function OrbEntry(props): ReturnType<typeof createElement> | null {
    // ui-chat merges `useChat` into session-scoped slots; the Chat store, not the
    // session snapshot, carries a turn's running calls and timings in DSH 0.2.
    // Fixed per mount, so the hook call order never changes.
    const { useChat } = props as { useChat?: (select: (chat: { readonly legacy: OrbChatFacts }) => OrbChatFacts) => OrbChatFacts }
    const chat = useChat?.(snapshot => snapshot.legacy)
    return createElement(HandoffOrb, { ctx, sessionId: props.sessionId, ...(chat === undefined ? {} : { chat }) })
  })), 'a2d2 handoff orb')

  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'a2d2-config',
    order: 60,
    label: () => 'A2D2 配置',
    inject: () => {
      const remote = ctx.get('remote') as Parameters<typeof loadModelRouteCatalog>[0] | undefined
      return {
        fetch: globalThis.fetch.bind(globalThis),
        loadModelRoutes: () => loadModelRouteCatalog(remote),
      }
    },
  }, A2d2ConfigSection)), 'a2d2 config settings section')

  ctx.inject(['betterSidebar'], (sidebarCtx) => {
    const sidebar = sidebarCtx.get('betterSidebar') as ClientSidebarService | undefined
    if (sidebar === undefined) return
    sidebarCtx.effect(() => sidebar.registerTab({
      ...A2D2_PANEL_TAB,
      single: true,
      component: function A2d2PanelEntry(props): ReturnType<typeof createElement> {
        return createElement(A2d2Panel, {
          ctx,
          sessionId: props.scope.sessionId,
          visible: props.visible,
        })
      },
    }), 'a2d2 panel tab')
  })
}
