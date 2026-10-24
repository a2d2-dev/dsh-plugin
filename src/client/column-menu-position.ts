/** Keep a fixed column menu inside the viewport, including when its contents grow. */
export function columnMenuPosition(anchor: { left: number; bottom: number }, viewport: { width: number; height: number }): { left: number; top: number; maxHeight: number } {
  const width = Math.max(0, Math.min(304, viewport.width - 16))
  const left = Math.max(8, Math.min(anchor.left, viewport.width - width - 8))
  const top = Math.max(8, Math.min(anchor.bottom + 4, viewport.height - 420))
  return { left, top, maxHeight: Math.max(0, Math.min(600, viewport.height - top - 8)) }
}
