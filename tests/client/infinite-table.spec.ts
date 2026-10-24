import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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
    expect(html).toContain(total>100?'滚动接近底部自动加载更多':'已加载全部当前查询结果')
  })
  it('keeps partial source exhaustion distinct from complete source exhaustion', () => {
    expect(render(12,false)).toContain('当前已观察目录已展示完')
    expect(render(12,false)).not.toContain('已加载全部')
  })
})
