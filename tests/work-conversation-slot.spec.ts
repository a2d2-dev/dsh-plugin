import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'

async function publicSessionHeader() {
  const directory = dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json')))
  const bundle = await readFile(join(directory, 'lib/client.js'), 'utf8')
  const marker = '//#region lib/types/client/skeleton/ConversationSession.js'
  const start = bundle.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const end = bundle.indexOf('//#endregion', start)
  return runInNewContext(`${bundle.slice(start + marker.length, end)}; ConversationSessionHeader`, {
    react: React, react_jsx_runtime: jsx,
    clsx: (...values: unknown[]) => values.filter(Boolean).join(' '),
    ConversationRoot_module_css_default: {},
    resolveActiveView: (tabs: { id: string }[], selected: string) => tabs.find(tab => tab.id === selected) ?? tabs[0],
  }) as React.ComponentType<Record<string, unknown>>
}

it.each([true, false])('public header keeps host title/actions and continuation tab visibility when blank=%s', async blank => {
  const Header = await publicSessionHeader()
  const slots: string[] = []
  const html = renderToStaticMarkup(React.createElement(Header, {
    sessionId: 'related-current', hideChrome: blank,
    useSessions: (select: (value: unknown) => unknown) => select({ byId: { 'related-current': { id: 'related-current', origin: 'root', displayTitle: 'Only native title' } } }),
    useConversationViews: (select: (value: unknown) => unknown) => select([{ id: 'chat', label: '对话' }, { id: 'trajectory', label: '轨迹' }, { id: 'a2d2-continuation', label: '接续' }]),
    useStore: (select: (value: unknown) => unknown) => select({ view: 'a2d2-continuation' }),
    renderSlot: (name: string) => { slots.push(name); return name === 'conversation.session.header.actions' ? React.createElement('button', {}, '关联任务') : null },
    open: () => {}, selectView: () => {}, t: (key: string) => key,
  }))
  expect(slots.includes('conversation.session.header.actions')).toBe(!blank)
  expect(html.includes('接续')).toBe(!blank)
  expect(html.includes('Only native title')).toBe(!blank)
  if (!blank) expect(html.match(/Only native title/g)).toHaveLength(1)
})
// Render the installed public Conversation artifact without loading its browser
// module loader or starting Web. This locks down the host seam chosen by the
// registration regression; actual screenshots remain with the browser lane.
async function publicConversationContent() {
  const directory = dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json')))
  const bundle = await readFile(join(directory, 'lib/client.js'), 'utf8')
  const marker = '//#region lib/types/client/skeleton/ConversationContent.js'
  const start = bundle.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const end = bundle.indexOf('//#endregion', start)
  expect(end).toBeGreaterThan(start)
  return runInNewContext(`${bundle.slice(start + marker.length, end)}; ConversationContent`, {
    react: React, react_jsx_runtime: jsx,
    clsx: (...values: unknown[]) => values.filter(Boolean).join(' '),
    ConversationRoot_module_css_default: {},
    WorkspaceChip: () => null, HeroShell: () => null,
    workspaceDisplayTitle: (title: string) => title,
  }) as React.ComponentType<Record<string, unknown>>
}

it.each([true, false])('public input list dock composes work with existing entries when blank=%s', async blank => {
  const Content = await publicConversationContent()
  const slots: string[] = []
  const html = renderToStaticMarkup(React.createElement(Content, {
    sessionId: 'existing-session', phase: blank ? 'blank' : 'idle', hero: blank,
    useSession: (select: (value: unknown) => unknown) => select({ blank }),
    useSessions: (select: (value: unknown) => unknown) => select({ byId: {} }),
    useSessionStatus: (select: (value: unknown) => unknown) => select(new Map()),
    useWorkspaces: (select: (value: unknown) => unknown) => select({ phase: 'ready', items: [] }),
    useInput: (select: (value: unknown) => unknown) => select({ draft: '' }),
    useComposerBlock: (select: (value: unknown) => unknown) => select(undefined),
    useFactorySlot: () => () => null,
    renderSlot: (name: string) => {
      slots.push(name)
      if (name === 'conversation.input.dock') return React.createElement('div', {},
        ...['existing-todo', 'existing-queue', 'associated-work'].map(id => React.createElement('span', { key: id }, id)))
      return name === 'conversation.composer.bar' ? React.createElement('textarea', { 'aria-label': 'native-input' }) : null
    },
    renderSlotChain: (_name: string, _owner: unknown, options: { fallback: React.ReactNode }) => options.fallback,
    selectWorkspace: async () => {}, t: (key: string) => key,
  }))
  expect(slots.filter(name => name === 'conversation.input.dock')).toHaveLength(1)
  for (const text of ['existing-todo', 'existing-queue', 'associated-work', 'native-input']) expect(html).toContain(text)
})
