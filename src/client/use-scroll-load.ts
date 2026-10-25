import { useEffect } from 'react'
import type { RefObject } from 'react'

/** Observe the end of a list within its own scrolling surface. */
export function useScrollLoad({ target, root, enabled, busy, error, loadMore }: {
  target: RefObject<HTMLElement>
  root?: RefObject<HTMLElement>
  enabled: boolean
  busy: boolean
  error?: unknown
  loadMore: () => void
}) {
  useEffect(() => {
    const element = target.current
    if (!element || !enabled || busy || error || typeof IntersectionObserver === 'undefined') return
    let requested = false
    const observer = new IntersectionObserver(entries => {
      if (requested || !entries.some(entry => entry.isIntersecting)) return
      requested = true
      observer.disconnect()
      loadMore()
    }, { root: root?.current ?? element.closest('[role="tabpanel"]') ?? element.closest('main'), rootMargin: '120px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [target, root, enabled, busy, error, loadMore])
}
