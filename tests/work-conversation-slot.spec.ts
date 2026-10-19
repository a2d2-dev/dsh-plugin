import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'

// Render the installed public Conversation artifact, without loading its browser
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
