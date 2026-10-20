import { createRequire } from 'node:module'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { WorkApplication } from '../src/work.ts'
import type { WorkHost } from '../src/work.ts'
import { WorkPanelController, message } from '../src/client/work-panel-controller.ts'
import type { GitHubSourcePort } from '../src/work-sources/types.ts'
import { browserUUID } from '../src/client/browser-uuid.ts'
import { webcrypto } from 'node:crypto'
import { afterEach } from 'vitest'
afterEach(() => vi.unstubAllGlobals())
import type { WorkTask } from '../src/work-types.ts'

// Execute the production TSX and its actual JSX onChange/onSubmit callbacks in memory.
// Only React's mounting/state scheduler is substituted: commands use the real controller,
// WorkApplication and disk. This does not claim DOM or browser coverage.
async function mountWorkPanel(props: Record<string, unknown>, component = 'TaskForm') {
  const state: unknown[] = []
  let cursor = 0
  const require = createRequire(import.meta.url)
  const effects: (() => void)[] = [], cleanups: (() => void)[] = []
  const module = { exports: {} as Record<string, (props: Record<string, unknown>) => any> }
  const source = await readFile(new URL('../src/client/work-panel.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(`${source}\nexport { TaskForm, SessionWorkEntry, BreakdownForm, ProjectForm, IssueSourcePanel }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023 },
  }).outputText
  runInNewContext(compiled, {
    module, exports: module.exports, AbortController, crypto: globalThis.crypto,
    require: (id: string) => id === 'react' ? {
      useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
        const index = cursor++, previous = state[index] as unknown[] | undefined
        if (previous && dependencies.every((value, index) => value === previous[index])) return
        state[index] = dependencies
        effects.push(() => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) })
      },
      useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
      useState: (initial: unknown) => {
        const index = cursor++
        if (!(index in state)) state[index] = initial
        return [state[index], (value: unknown) => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
      },
    } : id.endsWith('.css') ? { default: {} } : id === './work-panel-controller.ts' ? { message } : id === './browser-uuid.ts' ? { browserUUID } : require(id),
  })
  const render = () => {
    cursor = 0
    const element = module.exports[component]!(props)
    effects.splice(0).forEach(effect => effect())
    return element
  }
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
  render()
  return {
    render, nodes, unmount: () => cleanups.splice(0).forEach(cleanup => cleanup()),
    inputs: () => nodes('input'), textareas: () => nodes('textarea'),
    change: (node: any, value: string) => node.props.onChange({ target: { value } }),
    click: (text: string) => {
      const button = nodes('button').find(node => [node.props.children].flat(Infinity).join('') === text)
      expect(button, `button ${text}`).toBeDefined()
      expect(button.props.disabled, `button ${text} must be enabled`).not.toBe(true)
      button.props.onClick()
    },
    submit: () => render().props.onSubmit({ preventDefault() {} }),
  }
}

async function withPanel(run: (panel: WorkPanelController) => Promise<void>, host: WorkHost = { resources: async () => [], sessions: async () => [] }, source?: GitHubSourcePort) {
  const directory = await mkdtemp(join(tmpdir(), 'a2d2-work-form-'))
  const expected = resolve(directory)
  const app = new WorkApplication(directory, host, source)
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

describe('production Issue source acceptance controls', () => {
  it('accepts an observed null body through the enabled UI action and preserves missing body and acceptance indicators', async () => {
    const identity={login:'imneov',nodeId:'U1',name:'LiuFeng'}
    const issue={nodeId:'I112',number:112,url:'https://github.com/a2d2-dev/dsh-plugin/issues/112',repository:{owner:'a2d2-dev',repository:'dsh-plugin'},title:'Observed empty Issue body',body:null,state:'open' as const,assignees:['imneov'],labels:[],updatedAt:'2026-10-20T00:00:00Z',observedAt:'2026-10-21T00:00:00Z'}
    await withPanel(async panel => {
      await panel.configureSource('a2d2-dev','dsh-plugin');await panel.openIssue(112)
      const form=await mountWorkPanel({controller:panel},'IssueSourcePanel')
      form.click('接入为本地工作')
      await vi.waitFor(()=>expect(panel.getSnapshot().detail?.task?.specification).toMatchObject({text:'',acceptance:[],missing:['body','acceptance']}))
      const detail=await mountWorkPanel({controller:panel},'WorkPanel')
      const paragraphs=detail.nodes('p').map(node=>[node.props.children].flat(Infinity).join('')).join('\n')
      expect(paragraphs).toContain('结构化验收标准尚待确认')
      expect(paragraphs).toContain('规格正文尚待补充')
      detail.unmount()
      form.unmount()
    },undefined,{list:async()=>({identity,items:[issue],observedAt:issue.observedAt}),detail:async()=>({identity,issue})})
  })
})

describe('production resource selection', () => {
  it('labels owned resources as unavailable while allowing a project without a directory', async () => {
    const resource = { ref: { runtimeId: 'host-owner', workspaceId: 'occupied' }, title: 'workspace' }
    await withPanel(async panel => {
      const owner = panel.getSnapshot().projects[0]!
      await panel.submit({ type: 'project.attach-resource', projectId: owner.id, expectedVersion: owner.version, resource: resource.ref })
      for (const attach of [false, true]) {
        const form = await mountWorkPanel({ controller: panel, attach, onSaved: vi.fn() }, 'ProjectForm')
        await vi.waitFor(() => expect(form.nodes('option')).toHaveLength(2))
        const option = form.nodes('option')[1]
        expect(option.props.disabled).toBe(true)
        expect([option.props.children].flat(Infinity).join('')).toContain('已归属：表单往返（不可选）')
        form.unmount()
      }
      const saved = vi.fn()
      const form = await mountWorkPanel({ controller: panel, attach: false, onSaved: saved }, 'ProjectForm')
      await vi.waitFor(() => expect(form.nodes('option')).toHaveLength(2))
      form.change(form.inputs()[0], '无目录的本地项目')
      form.submit()
      await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce())
      const result = await panel.client.query({ type: 'projects.list' })
      expect(result.projects?.find(project => project.name === '无目录的本地项目')?.resources).toEqual([])
      form.unmount()
    }, { resources: async () => [resource], sessions: async () => [] })
  })
})

describe('production HTTP breakdown form', () => {
  it('adds and saves distinct UUID v4 blocks when Crypto only provides getRandomValues', async () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
    await withPanel(async panel => {
      const task = (await panel.submit({ type: 'task.create', projectId: panel.getSnapshot().projectId!, title: 'HTTP 拆解', goal, specification, acceptance })).task!
      const saved = vi.fn()
      const form = await mountWorkPanel({ controller: panel, task, onSaved: saved }, 'BreakdownForm')
      form.click('添加工作块')
      form.change(form.inputs()[0], 'HTTP 工作块一')
      form.change(form.textareas()[0], '使用真实随机源')
      form.click('添加工作块')
      form.change(form.inputs()[1], 'HTTP 工作块二')
      form.change(form.textareas()[1], '独立稳定身份')
      form.submit()
      await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce())
      await panel.openTask({ projectId: task.projectId, taskId: task.id })
      const blocks = panel.getSnapshot().detail!.task!.breakdown
      expect(blocks.map(block => block.title)).toEqual(['HTTP 工作块一', 'HTTP 工作块二'])
      expect(new Set(blocks.map(block => block.id)).size).toBe(2)
      for (const block of blocks) expect(block.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })
  })
})

describe('production session work entry', () => {
  it('returns linked blank/nonblank session references to the correct task and renders nothing for an unassociated session', async () => {
    const resource = { ref: { runtimeId: 'host-entry', workspaceId: 'workspace-entry' }, title: '已有资源' }
    const sessionIds = ['blank-existing', 'nonblank-existing']
    const host: WorkHost = { resources: async () => [resource], sessions: async () => [...sessionIds, 'unassociated'].map(sessionId => ({ ref: { runtimeId: resource.ref.runtimeId, sessionId }, resource: resource.ref, title: sessionId })) }
    await withPanel(async panel => {
      const project = panel.getSnapshot().projects[0]!
      await panel.submit({ type: 'project.attach-resource', projectId: project.id, expectedVersion: project.version, resource: resource.ref })
      let task = (await panel.submit({ type: 'task.create', projectId: project.id, title: '返回准确工作', goal, specification, acceptance })).task!
      const ref = { projectId: project.id, taskId: task.id }
      for (const sessionId of sessionIds) task = (await panel.submit({ type: 'task.associate-session', ref, expectedVersion: task.version, session: { runtimeId: resource.ref.runtimeId, sessionId }, purpose: 'related' })).task!
      const write = vi.spyOn(panel, 'submit')
      let reads = 0
      const query = panel.client.query.bind(panel.client)
      panel.client.query = async (request, signal) => {
        const result = await query(request, signal)
        if (request.type === 'session.work') reads++
        return result
      }
      for (const sessionId of sessionIds) {
        panel.back()
        const entry = await mountWorkPanel({ controller: panel, sessionId }, 'SessionWorkEntry')
        try {
          await vi.waitFor(() => expect(entry.nodes('button')).toHaveLength(1))
          const button = entry.nodes('button')[0]
          expect(button.props.children.join('')).toContain('返回准确工作')
          button.props.onClick()
          await vi.waitFor(() => expect(panel.getSnapshot().detail?.task?.id).toBe(ref.taskId))
          expect(panel.getSnapshot()).toMatchObject({ projectId: ref.projectId, detailTab: 'overview' })
        } finally { entry.unmount() }
      }
      const entry = await mountWorkPanel({ controller: panel, sessionId: 'unassociated' }, 'SessionWorkEntry')
      try {
        await vi.waitFor(() => expect(reads).toBe(3))
        expect(entry.render()).toBeNull()
        expect(write).not.toHaveBeenCalled()
      } finally { entry.unmount() }
    }, host)
  })
})

describe('production TaskForm material round trips', () => {
  it('preserves an API-created multiline criterion and untouched specification when only the goal changes', async () => {
    await withPanel(async panel => {
      const task = (await panel.submit({ type: 'task.create', projectId: panel.getSnapshot().projectId!, title: 'API 材料', goal, specification, acceptance })).task!
      let saved: WorkTask | undefined
      const form = await mountWorkPanel({ controller: panel, kind: 'spec', task, onSaved: async (task: WorkTask) => { saved = task } })
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
      const form = await mountWorkPanel({ controller: panel, kind: 'task', onSaved: async (task: WorkTask) => { saved = task } })
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
      const form = await mountWorkPanel({ controller: panel, kind: 'task', onSaved: async () => { throw Error('unexpected save') } })
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
      const form = await mountWorkPanel({ controller: panel, kind: 'task', onSaved })
      form.change(form.inputs()[0], '  普通标题  ')
      for (const [index, value] of [goal, specification, acceptance[0]!].entries()) form.change(form.textareas()[index], value)
      form.submit()
      await vi.waitFor(() => expect(saved).toBeDefined())
      expect(saved).toMatchObject({ title: '普通标题', goal, specification: { text: specification, acceptance } })
      const ref = { projectId: saved!.projectId, taskId: saved!.id }
      await panel.openTask(ref)
      const editor = await mountWorkPanel({ controller: panel, kind: 'spec', task: panel.getSnapshot().detail!.task, onSaved })
      saved = undefined
      editor.submit()
      await vi.waitFor(() => expect(saved).toBeDefined())
      const reloaded = await panel.client.query({ type: 'task.detail', ref })
      expect(reloaded.task).toMatchObject({ goal, specification: { text: specification, acceptance } })
    })
  })
})
