import { createRequire } from 'node:module'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import { WorkPanelController, message } from '../src/client/work-panel-controller.ts'
import type { WorkTask } from '../src/work-types.ts'

// Execute the production TSX and its actual JSX onChange/onSubmit callbacks in memory.
// Only React's mounting/state scheduler is substituted: commands use the real controller,
// WorkApplication and disk. This does not claim DOM or browser coverage.
async function mountTaskForm(props: Record<string, unknown>) {
  const state: unknown[] = []
  let cursor = 0
  const require = createRequire(import.meta.url)
  const module = { exports: {} as { TaskForm: (props: Record<string, unknown>) => any } }
  const source = await readFile(new URL('../src/client/work-panel.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(`${source}\nexport { TaskForm }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023 },
  }).outputText
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (id: string) => id === 'react' ? {
      useState: (initial: unknown) => {
        const index = cursor++
        if (!(index in state)) state[index] = initial
        return [state[index], (value: unknown) => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
      },
    } : id.endsWith('.css') ? { default: {} } : id === './work-panel-controller.ts' ? { message } : require(id),
  })
  const render = () => { cursor = 0; return module.exports.TaskForm(props) }
  function nodes(type: string): any[] {
    const result: any[] = []
    const walk = (node: any) => {
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (!node || typeof node !== 'object') return
      if (node.type === type) result.push(node)
      walk(node.props?.children)
    }
    walk(render())
    return result
  }
  return {
    inputs: () => nodes('input'), textareas: () => nodes('textarea'),
    change: (node: any, value: string) => node.props.onChange({ target: { value } }),
    click: (text: string) => {
      const button = nodes('button').find(node => [node.props.children].flat(Infinity).join('') === text)
      expect(button, `button ${text}`).toBeDefined()
      button.props.onClick()
    },
    submit: () => render().props.onSubmit({ preventDefault() {} }),
  }
}

async function withPanel(run: (panel: WorkPanelController) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-work-form-'))
  const expected = resolve(directory)
  const app = new WorkApplication(directory, { resources: async () => [], sessions: async () => [] })
  const operator = { operator: true }
  const panel = new WorkPanelController({
    command: async command => {
      const result = await app.execute(command, operator)
      if (result.status !== 'completed') throw Error(JSON.stringify(result))
      return result
    },
    query: async query => {
      const result = await app.query(query, operator)
      if (result.status !== 'completed') throw Error(JSON.stringify(result))
      return result
    },
  }, { selectPanel() {}, openSession() {} })
  try {
    await panel.submit({ type: 'project.create', name: '表单往返' })
    await panel.load()
    await run(panel)
  } finally {
    expect(directory).toBe(expected)
    expect(await realpath(directory)).toBe(expected)
    expect(directory.startsWith(join(tmpdir(), 'a2d2-work-form-'))).toBe(true)
    await rm(directory, { recursive: true, force: true })
  }
}

const goal = '\n  保留完整目标\n'
const specification = '\n    preserve code indentation\n'
const acceptance = ['先验证A\n再验证B']

describe('production TaskForm material round trips', () => {
  it('preserves an API-created multiline criterion and untouched specification when only the goal changes', async () => {
    await withPanel(async panel => {
      const task = (await panel.submit({ type: 'task.create', projectId: panel.getSnapshot().projectId!, title: 'API 材料', goal, specification, acceptance })).task!
      let saved: WorkTask | undefined
      const form = await mountTaskForm({ controller: panel, kind: 'spec', task, onSaved: async (task: WorkTask) => { saved = task } })
      form.change(form.textareas()[0], '\n  只修改目标\n')
      form.submit()
      await vi.waitFor(() => expect(saved).toBeDefined())
      expect(saved!.goal).toBe('\n  只修改目标\n')
      expect(saved!.specification.text).toBe(specification)
      expect(saved!.specification.acceptance).toEqual(acceptance)
    })
  })

  it('changes item boundaries only through explicit add/remove actions and keeps order and multiline text', async () => {
    await withPanel(async panel => {
      let saved: WorkTask | undefined
      const form = await mountTaskForm({ controller: panel, kind: 'task', onSaved: async (task: WorkTask) => { saved = task } })
      form.change(form.inputs()[0], '条目操作')
      form.change(form.textareas()[0], goal)
      form.change(form.textareas()[1], specification)
      form.change(form.textareas()[2], '  第一条\n继续第一条\n')
      form.click('添加验收标准')
      form.change(form.textareas()[3], '待移除')
      form.click('添加验收标准')
      form.change(form.textareas()[4], '\n  最后一条\n仍是最后一条\n')
      form.click('移除验收标准 2')
      form.submit()
      await vi.waitFor(() => expect(saved).toBeDefined())
      expect(saved!.specification.acceptance).toEqual(['  第一条\n继续第一条\n', '\n  最后一条\n仍是最后一条\n'])
    })
  })

  it('refuses whitespace-only materials without submitting or silently dropping a criterion', async () => {
    await withPanel(async panel => {
      const submit = vi.spyOn(panel, 'submit')
      const form = await mountTaskForm({ controller: panel, kind: 'task', onSaved: async () => { throw Error('unexpected save') } })
      form.change(form.inputs()[0], '判空')
      form.change(form.textareas()[0], goal)
      form.change(form.textareas()[1], specification)
      form.change(form.textareas()[2], acceptance[0]!)
      form.click('添加验收标准')
      form.change(form.textareas()[3], ' \n\t ')
      form.submit()
      expect(submit).not.toHaveBeenCalled()
      form.click('移除验收标准 2')
      for (const index of [0, 1, 2]) {
        const old = form.textareas()[index].props.value
        form.change(form.textareas()[index], ' \n\t ')
        form.submit()
        expect(submit).not.toHaveBeenCalled()
        form.change(form.textareas()[index], old)
      }
      form.click('移除验收标准 1')
      form.submit()
      expect(submit).not.toHaveBeenCalled()
    })
  })

  it('creates through the form and reopens without changing any material bytes or item boundaries', async () => {
    await withPanel(async panel => {
      let saved: WorkTask | undefined
      const onSaved = async (task: WorkTask) => { saved = task }
      const form = await mountTaskForm({ controller: panel, kind: 'task', onSaved })
      form.change(form.inputs()[0], '  普通标题  ')
      for (const [index, value] of [goal, specification, acceptance[0]!].entries()) form.change(form.textareas()[index], value)
      form.submit()
      await vi.waitFor(() => expect(saved).toBeDefined())
      expect(saved).toMatchObject({ title: '普通标题', goal, specification: { text: specification, acceptance } })
      const ref = { projectId: saved!.projectId, taskId: saved!.id }
      await panel.openTask(ref)
      const editor = await mountTaskForm({ controller: panel, kind: 'spec', task: panel.getSnapshot().detail!.task, onSaved })
      saved = undefined
      editor.submit()
      await vi.waitFor(() => expect(saved).toBeDefined())
      const reloaded = await panel.client.query({ type: 'task.detail', ref })
      expect(reloaded.task).toMatchObject({ goal, specification: { text: specification, acceptance } })
    })
  })
})
