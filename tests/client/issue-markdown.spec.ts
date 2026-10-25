import { mountProductionComponent } from './production-component-harness.ts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { IssueMarkdown } from '../../src/client/issue-markdown.tsx'
const render = (text: string) => renderToStaticMarkup(createElement(IssueMarkdown, { text, sourceUrl: 'https://github.com/acme/app/issues/1' }))
it('renders GitHub tables, inline breaks, task lists and fenced code', () => {
  const html = render('## 要求\n\n| 名称 | 说明 |\n| --- | --- |\n| API | 输入<br>输出 |\n\n- [x] 已完成\n\n```ts\nconst count = 1\n```')
  for (const value of ['<h2>要求</h2>', '<table>', '<th>名称</th>', '输入<br/>\n输出', 'type="checkbox"', 'checked=""', 'language-ts']) expect(html).toContain(value)
  expect(html).not.toContain('&lt;br&gt;')
})
it('does not execute raw HTML or dangerous links and resolves repository paths', () => {
  const html = render('<script>alert(1)</script>\n\n[bad](javascript:alert) [doc](docs/readme.md) ![image](images/demo.png)')
  expect(html).not.toContain('<script')
  expect(html).not.toContain('href="javascript:')
  expect(html).toContain('https://github.com/acme/app/blob/HEAD/docs/readme.md')
  expect(html).toContain('https://raw.githubusercontent.com/acme/app/HEAD/images/demo.png')
  expect(html).toContain('rel="noopener noreferrer"')
})

it('copies code as plain text and reports success or clipboard failure', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  let reset = () => {}
  const h = mountProductionComponent({ children: createElement('code', { className: 'language-ts' }, 'const answer = 42\n') }, 'MarkdownCodeBlock', new URL('../../src/client/issue-markdown.tsx', import.meta.url), {
    navigator: { clipboard: { writeText } }, setTimeout: (callback: () => void) => { reset = callback; return 1 }, clearTimeout() {},
  })
  try {
    h.nodes('button')[0].props.onClick(); await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith('const answer = 42\n')
    await expect.poll(()=>h.nodes('button')[0].props['aria-label']).toBe('已复制')
    reset(); h.render()
    expect(h.nodes('button')[0].props['aria-label']).toBe('复制代码')
    writeText.mockRejectedValueOnce(Error('Clipboard denied'))
    h.nodes('button')[0].props.onClick(); await Promise.resolve()
    await expect.poll(()=>h.text()).toContain('复制失败，请选择代码手动复制。')
  } finally { h.unmount() }
})
