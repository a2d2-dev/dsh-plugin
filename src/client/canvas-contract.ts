import type { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'

/** Better Sidebar's public file-viewer face, kept structural across plugins. */
export interface CanvasViewerProps {
  readonly ctx: Context
  readonly scope: { readonly sessionId: string; readonly cwd?: string; readonly repoRoot?: string }
  readonly path: string
  readonly content?: string
  readonly truncated?: boolean
}

export interface CanvasSidebar {
  registerFileViewer(descriptor: {
    id: string
    title: string
    exts: readonly string[]
    priority: number
    fetchStrategy: 'fsRead'
    component: (props: CanvasViewerProps) => ReactNode
  }): () => void
}
