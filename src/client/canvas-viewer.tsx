import { createElement, useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import type { CanvasViewerProps } from './canvas-contract.ts'

interface CanvasModule { CanvasEditor: ComponentType<CanvasViewerProps> }
interface Modules { import(specifier: string): Promise<unknown> }
type Factory = (require: (specifier: string) => unknown) => CanvasModule
let pending: Promise<CanvasModule> | undefined

/** The editor is a separate plugin-owned script; the core never imports its code. */
export function loadCanvas(modules: Modules): Promise<CanvasModule> {
  if (pending !== undefined) return pending
  pending = (async () => {
    const words = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']
    const values = await Promise.all(words.map(word => modules.import(word)))
    const table = new Map(words.map((word, index) => [word, values[index]]))
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = '/a2d2/canvas/assets/editor.js'
      script.onload = () => { script.remove(); resolve() }
      script.onerror = () => { script.remove(); reject(new Error('无法加载 Excalidraw 编辑器')) }
      document.head.append(script)
    })
    const factory = (globalThis as typeof globalThis & { __a2d2CanvasFactory__?: Factory }).__a2d2CanvasFactory__
    if (factory === undefined) throw new Error('Excalidraw 编辑器未注册')
    return factory(word => {
      if (!table.has(word)) throw new Error(`Excalidraw 缺少模块 ${word}`)
      return table.get(word)
    })
  })().catch(error => { pending = undefined; throw error })
  return pending
}

export function CanvasViewer(props: CanvasViewerProps) {
  const [loaded, setLoaded] = useState<CanvasModule>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    const modules = props.ctx.get('modules') as Modules
    loadCanvas(modules).then(value => { if (active) setLoaded(value) }, reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [props.ctx, attempt])
  if (error) return <div role="alert">{error} <button onClick={() => setAttempt(value => value + 1)}>重试</button></div>
  if (loaded === undefined) return <div role="status">正在加载 Excalidraw…</div>
  return createElement(loaded.CanvasEditor, { ...props, key: `${props.scope.sessionId}:${props.path}` })
}
