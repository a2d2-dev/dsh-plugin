import { describe, expect, it } from 'vitest'
import { parseCanvas } from '../../src/client/canvas-document.ts'

const document = {
  type: 'excalidraw', version: 2,
  elements: [{ id: 'box', type: 'rectangle', x: 10, y: 20, width: 120, height: 80, customData: { owner: 'LF' } }],
  appState: { viewBackgroundColor: '#ffffff' }, files: {}, customMetadata: 'preserve me',
}

describe('canvas file boundary', () => {
  it('preserves editing data and plugin metadata', () => {
    const scene = parseCanvas(JSON.stringify(document))
    expect(scene.document.customMetadata).toBe('preserve me')
    expect(scene.elements[0]?.customData).toEqual({ owner: 'LF' })
  })
  it('rejects a truncated read even when its prefix is valid JSON', () => {
    expect(() => parseCanvas(JSON.stringify(document), true)).toThrow('截断')
  })
  it.each(['', '{"type":"excalidraw",', '{}', JSON.stringify({ ...document, version: 3 }),
    JSON.stringify({ ...document, elements: [{ id: 'bad', type: 'text', x: 0, y: 0, width: 20, height: 20 }] }),
    JSON.stringify({ ...document, elements: [{ ...document.elements[0], type: 'arrow', points: [[1, null]] }] }),
    JSON.stringify({ ...document, elements: [{ ...document.elements[0], type: 'image', fileId: 'missing' }] }),
  ])('refuses malformed or unsupported documents: %s', content => {
    expect(() => parseCanvas(content)).toThrow()
  })
  it('rejects duplicate IDs before restoration can silently remove data', () => {
    expect(() => parseCanvas(JSON.stringify({ ...document, elements: [document.elements[0], document.elements[0]] }))).toThrow('ID 重复')
  })
})
