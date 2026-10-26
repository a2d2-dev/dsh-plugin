import { z } from 'zod'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFiles } from '@excalidraw/excalidraw/types'

const point = z.tuple([z.number().finite(), z.number().finite()])
const element = z.object({
  id: z.string().min(1),
  type: z.enum(['rectangle', 'diamond', 'ellipse', 'text', 'arrow', 'line', 'freedraw', 'image', 'frame', 'magicframe', 'embeddable', 'iframe']),
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(),
}).passthrough().superRefine((value, ctx) => {
  if (value.type === 'text' && typeof value.text !== 'string') ctx.addIssue({ code: 'custom', message: '文字元素缺少 text' })
  if (['arrow', 'line', 'freedraw'].includes(value.type) && !z.array(point).min(1).safeParse(value.points).success) {
    ctx.addIssue({ code: 'custom', message: '连线或笔画缺少有效 points' })
  }
})
const sceneSchema = z.object({
  type: z.literal('excalidraw'), version: z.literal(2),
  elements: z.array(element),
  appState: z.record(z.string(), z.unknown()).optional().default({}),
  files: z.record(z.string(), z.object({
    id: z.string(), dataURL: z.string().startsWith('data:'), mimeType: z.string(), created: z.number().finite(),
  }).passthrough()).optional().default({}),
}).passthrough()

export interface CanvasScene {
  readonly document: Record<string, unknown>
  readonly elements: readonly ExcalidrawElement[]
  readonly appState: Record<string, unknown>
  readonly files: BinaryFiles
}

/** Validate the file boundary before Excalidraw can repair or discard scene data. */
export function parseCanvas(content: string | undefined, truncated = false): CanvasScene {
  if (truncated) throw new Error('文件读取被截断，已禁用画布编辑和保存。请使用文件工具读取完整文件。')
  if (content === undefined) throw new Error('未读取到完整的 Excalidraw 文件')
  const parsed = sceneSchema.safeParse(JSON.parse(content))
  if (!parsed.success) throw new Error(`无效的 Excalidraw 文件，已禁用保存：${parsed.error.issues[0]?.message ?? '格式错误'}`)
  const scene = parsed.data
  if (new Set(scene.elements.map(item => item.id)).size !== scene.elements.length) throw new Error('元素 ID 重复，已禁用保存')
  for (const item of scene.elements) {
    if (item.type === 'image' && item.isDeleted !== true && (typeof item.fileId !== 'string' || scene.files[item.fileId] === undefined)) {
      throw new Error('图像元素缺少内嵌文件，已禁用保存')
    }
  }
  return {
    document: scene,
    elements: scene.elements as unknown as ExcalidrawElement[],
    appState: scene.appState,
    files: scene.files as BinaryFiles,
  }
}
