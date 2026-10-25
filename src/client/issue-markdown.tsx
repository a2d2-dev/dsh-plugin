import { Children, isValidElement, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { PanelIcon } from './icons.tsx'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './work-panel.module.css'

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] }
// GitHub tables commonly contain <br>; allow that single formatting tag as a break.
function remarkBreakTags() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === 'html' && /^<br\s*\/?\s*>$/i.test(node.value?.trim() ?? '')) { node.type = 'break'; delete node.value }
      else if (node.type === 'html') node.type = 'text'
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}
function codeText(value: ReactNode): string {
  return Children.toArray(value).map(child => isValidElement<{ children?: ReactNode }>(child) ? codeText(child.props.children) : typeof child === 'string' || typeof child === 'number' ? String(child) : '').join('')
}
export function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState(false)
  const code = Children.toArray(children).find(child => isValidElement(child))
  const language = isValidElement<{ className?: string }>(code) ? code.props.className?.replace(/^language-/, '') : undefined
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = async () => {
    setError(false)
    try { await navigator.clipboard.writeText(codeText(children)); setCopied(true) }
    catch { setCopied(false); setError(true) }
  }
  return <div className={styles.markdownCode}><div className={styles.codeToolbar}><span>{language}</span><button type="button" aria-label={copied?'已复制':'复制代码'} title={copied?'已复制':'复制代码'} onClick={()=>void copy()}><PanelIcon name={copied?'check':'copy'}/></button></div><pre>{children}</pre><span className={error?styles.failure:styles.visuallyHidden} role="status">{copied?'已复制':error?'复制失败，请选择代码手动复制。':''}</span></div>
}
export function IssueMarkdown({ text, sourceUrl }: { text: string | null; sourceUrl?: string }) {
  const resolve = (url: string, key: string) => {
    const safe = defaultUrlTransform(url)
    if (!safe || !sourceUrl || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(safe)) return safe
    const source = new URL(sourceUrl), repository = source.pathname.split('/').slice(1, 3).join('/')
    return new URL(safe, key === 'src' ? `https://raw.githubusercontent.com/${repository}/HEAD/` : `https://github.com/${repository}/blob/HEAD/`).href
  }
  return <div className={styles.issueMarkdown}><Markdown remarkPlugins={[remarkGfm, remarkBreakTags]} skipHtml urlTransform={resolve} components={{
    pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
    img: ({ node: _node, ...props }) => <img {...props} loading="lazy"/>,
    a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer"/>,
    table: ({ node: _node, ...props }) => <div className={styles.markdownTable}><table {...props}/></div>,
  }}>{text || '暂无正文'}</Markdown></div>
}
