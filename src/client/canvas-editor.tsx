import { useEffect, useRef, useState } from 'react'
import { Excalidraw, MainMenu, exportToBlob, exportToSvg, restore, serializeAsJSON } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'
import { parseCanvas } from './canvas-document.ts'
import type { CanvasScene } from './canvas-document.ts'
import type { CanvasViewerProps } from './canvas-contract.ts'
import css from './canvas.module.css'

// Fonts are served by this plugin, including when the host has no internet access.
;(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/a2d2/canvas/assets/'

export function CanvasEditor(props: CanvasViewerProps) {
  const [initial] = useState(() => {
    try {
      const scene = parseCanvas(props.content, props.truncated)
      const restored = restore({ elements: scene.elements, appState: scene.appState, files: scene.files }, null, null)
      if (restored.elements.length !== scene.elements.length || restored.elements.some((item, index) => item.id !== scene.elements[index]?.id)) {
        throw new Error('文件包含无法恢复的元素，已禁用保存')
      }
      return { scene, data: { ...restored, scrollToContent: true } }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })
  if ('error' in initial) return <div className={css.error} role="alert">{initial.error}</div>
  return <EditableCanvas {...props} scene={initial.scene} initialData={initial.data} />
}

function EditableCanvas({ scope, path, scene, initialData }: CanvasViewerProps & {
  scene: CanvasScene
  initialData: ReturnType<typeof restore>
}) {
  const api = useRef<ExcalidrawImperativeAPI | null>(null)
  const latest = useRef('')
  const saved = useRef<string | undefined>(undefined)
  const saving = useRef(false)
  const [dirty, setDirty] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (latest.current !== saved.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  function changed(elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) {
    const serialized = JSON.parse(serializeAsJSON(elements, appState, { ...scene.files, ...files }, 'local')) as Record<string, unknown>
    latest.current = JSON.stringify({ ...scene.document, ...serialized }, null, 2)
    saved.current ??= latest.current
    const unsaved = latest.current !== saved.current
    setDirty(unsaved)
    if (unsaved && !saving.current) setState('idle')
  }

  async function save() {
    if (saving.current || !latest.current || latest.current === saved.current) return
    const snapshot = latest.current
    saving.current = true
    setState('saving')
    setError('')
    try {
      const response = await fetch('/sidebar/api/fs.write', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...scope, path, content: snapshot }),
      })
      const result = await response.json() as { ok?: boolean; value?: { ok?: boolean }; error?: { message?: string } }
      if (!response.ok || result.ok !== true || result.value?.ok !== true) {
        throw new Error(result.error?.message ?? `HTTP ${response.status}`)
      }
      saved.current = snapshot
      setDirty(latest.current !== snapshot)
      setState(latest.current === snapshot ? 'saved' : 'idle')
    } catch (reason) {
      setState('failed')
      setError(`保存失败：${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      saving.current = false
    }
  }

  async function exportImage(format: 'png' | 'svg') {
    const editor = api.current
    if (editor === null || exporting) return
    setExporting(true)
    setError('')
    try {
      const options = {
        elements: editor.getSceneElements(),
        appState: { ...editor.getAppState(), exportBackground: true, exportEmbedScene: false },
        files: editor.getFiles(),
      }
      const blob = format === 'png'
        ? await exportToBlob({ ...options, mimeType: 'image/png' })
        : new Blob([(await exportToSvg(options)).outerHTML], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${path.split(/[\\/]/).pop()?.replace(/\.excalidraw$/i, '') ?? 'drawing'}.${format}`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) {
      setError(`导出失败：${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      setExporting(false)
    }
  }

  return <div className={css.root} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); event.stopPropagation(); void save()
    }
  }}>
    <div className={css.toolbar}>
      <span role="status" aria-live="polite">{state === 'saving' ? '保存中…' : state === 'failed' ? '保存失败 · 未保存' : dirty ? '未保存' : state === 'saved' ? '已保存' : '无修改'}</span>
      <button disabled={!dirty || state === 'saving'} onClick={() => void save()}>保存</button>
      <button disabled={exporting} onClick={() => void exportImage('png')}>导出 PNG</button>
      <button disabled={exporting} onClick={() => void exportImage('svg')}>导出 SVG</button>
    </div>
    {error && <div className={css.error} role="alert">{error}</div>}
    <div className={css.canvas}>
      <Excalidraw excalidrawAPI={value => { api.current = value }} initialData={initialData}
        onChange={changed} langCode="zh-CN" handleKeyboardGlobally={false}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, saveAsImage: false, export: false } }}>
        <MainMenu>
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
    </div>
  </div>
}
