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
 * alone, and the tab registration is skipped rather than failing the bundle.
 *
 * @module @deepseek-ai/dsh-a2d2/client
 */

import { createElement } from 'react'
import { HandoffOrb } from './orb.tsx'
import { SubagentModelTab } from './subagent-tab.tsx'
import type { A2d2ClientContext, ClientSidebarService } from './context.ts'

/** Services this bundle needs before it can mount anything. */
export const inject = ['slots', 'sessions']

/** The sidebar tab this bundle contributes, in the fields the sidebar's `+` menu reads. */
const SUBAGENT_TAB = {
  /** Stable tab type id; the sidebar keys deduplication and activation on it. */
  id: 'a2d2-subagent-models',
  /** Menu title, in the language the indicator's own copy uses. */
  title: '任务管理 plus',
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
    return createElement(HandoffOrb, { ctx, sessionId: props.sessionId })
  })), 'a2d2 handoff orb')

  const sidebar = ctx.get('betterSidebar') as ClientSidebarService | undefined
  if (sidebar === undefined) return
  ctx.effect(() => sidebar.registerTab({
    ...SUBAGENT_TAB,
    single: true,
    component: function SubagentModelEntry(props): ReturnType<typeof createElement> {
      return createElement(SubagentModelTab, {
        ctx,
        sessionId: props.scope.sessionId,
        visible: props.visible,
      })
    },
  }), 'a2d2 subagent model tab')
}
