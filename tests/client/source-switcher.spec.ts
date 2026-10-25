import { expect, it, vi } from 'vitest'
import type { WorkSource } from '../../src/work-sources/types.ts'
import { mountProductionComponent } from './production-component-harness.ts'

const source = (id: string, name: string): WorkSource => ({ id, projectId: 'p', provider: 'github', repository: { owner: 'team', repository: name }, enabled: true, version: 1, sequence: 1, requests: {}, observations: [], pages: [] })
function setup() {
  const listeners = new Map<string, (event: unknown) => void>(), onSelect = vi.fn()
  const h = mountProductionComponent({ options: [{ value: 'app', source: source('app', 'console') }, { value: 'api', source: source('api', 'api-server') }], value: 'app', onSelect }, 'SourceSwitcher', new URL('../../src/client/source-switcher.tsx', import.meta.url), {
    document: { addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) },
  })
  const open = () => { h.nodes('button').find(node => node.props['aria-label'] === '当前 GitHub 仓库或 Project').props.onClick(); h.render() }
  const key = (key: string, isComposing = false) => { h.nodes('div').find(node => node.props.onKeyDown).props.onKeyDown({ key, nativeEvent: { isComposing }, preventDefault() {}, stopPropagation() {} }); h.render() }
  return { h, onSelect, open, key, listeners }
}
it('searches by owner and repository and selects only a different source', () => {
  const { h, open, onSelect } = setup()
  try {
    expect(h.nodes('select')).toHaveLength(0)
    open()
    expect(h.nodes('button').filter(node => node.props.role === 'option')).toHaveLength(2)
    h.change(h.inputs()[0], 'TEAM/api')
    const options = h.nodes('button').filter(node => node.props.role === 'option')
    expect(options).toHaveLength(1)
    options[0].props.onClick()
    expect(onSelect).toHaveBeenCalledWith('api')
    expect(h.inputs()).toHaveLength(0)
    open()
    h.nodes('button').find(node => node.props.role === 'option' && node.props['aria-selected']).props.onClick()
    expect(onSelect).toHaveBeenCalledTimes(1)
  } finally { h.unmount() }
})
it('supports arrow selection, Enter, Escape and dismissal outside the popup', () => {
  const { h, open, key, onSelect, listeners } = setup()
  try {
    open(); key('ArrowDown'); key('Enter', true)
    expect(onSelect).not.toHaveBeenCalled()
    key('Enter')
    expect(onSelect).toHaveBeenCalledWith('api')
    open(); key('Escape')
    expect(h.inputs()).toHaveLength(0)
    open(); h.change(h.inputs()[0], 'missing')
    expect(h.text()).toContain('没有匹配的来源')
    key('Enter')
    expect(onSelect).toHaveBeenCalledTimes(1)
    listeners.get('pointerdown')!({ target: {} }); h.render()
    expect(h.inputs()).toHaveLength(0)
  } finally { h.unmount() }
})
