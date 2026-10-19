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
import { WorkPanel, SessionWorkEntry } from './work-panel.tsx'
import { createWorkClient } from './work-api.ts'
import { WorkPanelController } from './work-panel-controller.ts'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { A2d2ClientContext } from './context.ts'

/** Services this bundle needs before it can mount anything. */
// `remote.session` is guarded by cordis: reading it from a fiber that did not
// inject it throws "cannot get property … without inject" (title, route and
// model-catalog reads all go through it).
export const inject = ['slots', 'sessions', 'remote', 'remote.session', 'remote.workspace', 'layout', 'uiWorkspace']


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

  const controller = new WorkPanelController(createWorkClient(), {
    selectPanel: id => ctx.layout.selectPanel(id as MainPanelId | null),
    openSession: id => ctx.uiWorkspace.openSession(id as Parameters<typeof ctx.uiWorkspace.openSession>[0]),
  })
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'a2d2-panel' as MainPanelId,
  }, () => createElement(WorkPanel, { controller }))), 'a2d2 main panel')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'a2d2-panel', order: 40,
    label: () => 'A²D² 控制面板',
  }, props => createElement(IconA2d2AgentsOutline16, {size: props.size}))), 'a2d2 panel entry')
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'a2d2-session-work', order: 40,
  }, props => createElement(SessionWorkEntry, {controller, sessionId: props.sessionId}))), 'a2d2 session work')
}
