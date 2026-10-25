import { mountProductionComponent } from './production-component-harness.ts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { InteractiveTable } from '../../src/client/interactive-table.tsx'

function render(total: number, complete = true) {
  return renderToStaticMarkup(createElement(InteractiveTable<number>, {
    label: 'Records', columns: [{ id: 'title', label: 'Title', values: n => [String(n)], render: n => `record-${n}` }],
    rows: Array.from({ length: total }, (_, n) => n), rowKey: String, searchText: String,
    searchLabel: 'Search', scope: 'Held source snapshot', complete,
  }))
}
describe('continuous table initial render', () => {
  it.each([0, 99, 100, 101, 250])('starts with at most 100 of %i records and exposes no paging controls', total => {
    const html=render(total)
    expect([...html.matchAll(/<tr data-row-key=/g)]).toHaveLength(Math.min(total,100))
    expect(html).not.toMatch(/上一页|下一页|每页|第 \d+.*页/)
    expect(html).toContain(total>100?'继续滚动加载':`共 ${total} 项`)
  })
  it('keeps partial source exhaustion distinct from complete source exhaustion', () => {
    expect(render(12,false)).toContain('部分结果')
    expect(render(12,false)).not.toContain('已加载全部')
  })
})


it('opens compact list options in a popup, filters locally, resets and closes on Escape', () => {
  const listeners = new Map<string, (event: any) => void>()
  const document = { addEventListener: (name: string, listener: (event: any) => void) => listeners.set(name, listener), removeEventListener: (name: string) => listeners.delete(name), activeElement: null }
  const trigger = { getBoundingClientRect: () => undefined, contains: () => false, focus: vi.fn() }
  const h = mountProductionComponent({
    compact: true, label: 'Records', columns: [{ id: 'title', label: 'Title', values: (row: string) => [row], render: (row: string) => row }],
    rows: ['first-record', 'second-record'], rowKey: String, searchText: String, searchLabel: 'Local filter', scope: 'Loaded only',
  }, 'InteractiveTable', new URL('../../src/client/interactive-table.tsx', import.meta.url), { document })
  const open = () => h.nodes('button').find(button => button.props['aria-label'] === '列表选项')!.props.onClick({ currentTarget: trigger })
  try {
    expect(h.nodes('summary')).toHaveLength(0)
    expect(h.inputs()).toHaveLength(0)
    open()
    expect(h.nodes('div').some(node => node.props.role === 'dialog' && node.props['aria-label'] === '列表选项')).toBe(true)
    h.change(h.inputs()[0], 'missing')
    expect(h.text()).toContain('没有匹配的结果')
    h.click('重置列表')
    expect(h.inputs()).toHaveLength(0)
    expect(h.text()).toContain('first-record')
    expect(h.text()).toContain('second-record')
    expect(trigger.focus).toHaveBeenCalled()
    open(); h.render()
    listeners.get('keydown')!({ key: 'Escape', preventDefault() {} })
    expect(h.nodes('div').some(node => node.props.role === 'dialog')).toBe(false)
  } finally { h.unmount() }
})

it('loads the next batch against the list scroll boundary rather than the panel', () => {
  const observers: { callback: (entries: { isIntersecting: boolean }[]) => void; root: unknown }[] = []
  class Observer {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void, options: { root: unknown }) { observers.push({ callback, root: options.root }) }
    observe() {}
    disconnect() {}
  }
  const h = mountProductionComponent({
    label: 'Records', columns: [{ id: 'title', label: 'Title', values: (row: string) => [row], render: (row: string) => row }],
    rows: Array.from({ length: 190 }, (_, n) => `record-${n}`), rowKey: String, searchText: String, searchLabel: 'Search', scope: 'Loaded only',
  }, 'InteractiveTable', new URL('../../src/client/interactive-table.tsx', import.meta.url), { IntersectionObserver: Observer })
  try {
    const region = { scrollTop: 0, querySelectorAll: () => [], getBoundingClientRect: () => ({ top: 0, bottom: 400 }), addEventListener() {}, removeEventListener() {} }
    h.nodes('div').find(node => node.props['aria-label'] === 'Records 滚动区域').ref.current = region
    h.nodes('div').find(node => node.props['aria-label'] === 'Records 加载状态').ref.current = {}
    h.change(h.inputs()[0], 'record')
    expect(h.nodes('tr').filter(node => node.props['data-row-key'])).toHaveLength(100)
    expect(observers.at(-1)?.root).toBe(region)
    observers.at(-1)!.callback([{ isIntersecting: true }])
    expect(h.nodes('tr').filter(node => node.props['data-row-key'])).toHaveLength(190)
  } finally { h.unmount() }
})
