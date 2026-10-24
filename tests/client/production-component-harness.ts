import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { expect } from 'vitest'
import * as panelController from '../../src/client/work-panel-controller.ts'
import * as continuousController from '../../src/client/continuous-controller.ts'
import * as uuid from '../../src/client/browser-uuid.ts'

// Run production TSX and callbacks without a DOM. Resolve imports at each source
// module and give every rendered component its own hook slots, including children.
export function mountProductionComponent(props: Record<string, unknown>, component: string, source = new URL('../../src/client/work-panel.tsx', import.meta.url)) {
  type Instance = { slots: any[]; cursor: number; setters: Map<number, (value: any) => void> }
  const instances = new Map<string, Instance>(), modules = new Map<string, any>()
  const effects: (() => void)[] = []
  let active: Instance
  const dependenciesMatch = (left?: unknown[], right?: unknown[]) => !!left && !!right && left.length === right.length && right.every((value, index) => Object.is(value, left[index]))
  const react = {
    useState(initial: any) {
      const instance = active, index = instance.cursor++
      if (!(index in instance.slots)) instance.slots[index] = typeof initial === 'function' ? initial() : initial
      if (!instance.setters.has(index)) instance.setters.set(index, (value: any) => { instance.slots[index] = typeof value === 'function' ? value(instance.slots[index]) : value })
      return [instance.slots[index], instance.setters.get(index)]
    },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    useMemo(factory: () => unknown, dependencies: unknown[]) {
      const instance = active, index = instance.cursor++, previous = instance.slots[index]
      if (!previous || !dependenciesMatch(previous.dependencies, dependencies)) instance.slots[index] = { dependencies, value: factory() }
      return instance.slots[index].value
    },
    useEffect(effect: () => void | (() => void), dependencies?: unknown[]) {
      const instance = active, index = instance.cursor++, previous = instance.slots[index]
      if (previous && dependenciesMatch(previous.dependencies, dependencies)) return
      const slot = { dependencies, cleanup: undefined as void | (() => void) }
      instance.slots[index] = slot
      effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() })
    },
  }
  function load(url: URL): any {
    if (modules.has(url.href)) return modules.get(url.href).exports
    const module = { exports: {} }, require = createRequire(url)
    modules.set(url.href, module)
    const extra = url.href === source.href && url.pathname.endsWith('/work-panel.tsx') ? '\nexport { ContinuousProcessing, CurrentExecution, Requirements, IssueSourcePanel }' : ''
    const compiled = ts.transpileModule(readFileSync(url, 'utf8') + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023 } }).outputText
    runInNewContext(compiled, {
      module, exports: module.exports, AbortController, URL, crypto: globalThis.crypto, setInterval, clearInterval,
      require: (id: string) => {
        if (id === 'react') return react
        if (id.endsWith('.css')) return { default: {} }
        if (id === './work-panel-controller.ts') return panelController
        if (id === './continuous-controller.ts') return continuousController
        if (id === './browser-uuid.ts') return uuid
        return id.startsWith('.') && /\.tsx?$/.test(id) ? load(new URL(id, url)) : require(id)
      },
    }, { filename: fileURLToPath(url) })
    return module.exports
  }
  const root = load(source)[component]
  expect(root, `production export ${component}`).toBeTypeOf('function')
  function expand(node: any, path: string): any {
    if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${child?.key ?? index}`))
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      const key = `${path}/${node.type.name}`
      const instance = instances.get(key) ?? { slots: [], cursor: 0, setters: new Map() }
      instances.set(key, instance); instance.cursor = 0
      active = instance
      return expand(node.type(node.props), key)
    }
    return { ...node, props: { ...node.props, children: expand(node.props?.children, `${path}/children`) } }
  }
  const render = () => {
    const tree = expand({ type: root, props }, 'root')
    effects.splice(0).forEach(effect => effect())
    return tree
  }
  const nodes = (type: string): any[] => {
    const result: any[] = []
    function walk(node: any) {
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (!node || typeof node !== 'object') return
      if (node.type === type) result.push(node)
      walk(node.props?.children)
    }
    walk(render()); return result
  }
  function text(node: any): string {
    if (Array.isArray(node)) return node.map(text).join('')
    return node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node)
  }
  render()
  return {
    render, nodes, text: () => text(render()),
    unmount: () => { for (const instance of instances.values()) for (const slot of instance.slots) if (slot && typeof slot.cleanup === 'function') slot.cleanup() },
    inputs: () => nodes('input'), textareas: () => nodes('textarea'),
    change: (node: any, value: string) => node.props.onChange({ target: { value } }),
    click: (label: string) => {
      const button = nodes('button').find(node => text(node) === label)
      expect(button, `button ${label}`).toBeDefined()
      expect(button.props.disabled, `button ${label} must be enabled`).not.toBe(true)
      return button.props.onClick({ stopPropagation() {} })
    },
    submit: () => nodes('form')[0].props.onSubmit({ preventDefault() {} }),
  }
}
