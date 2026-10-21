import { expect, it, vi } from 'vitest'
import { ContinuousDelegationController } from '../src/client/continuous-controller.ts'
import type { WorkClient } from '../src/client/work-api.ts'
import type { ContinuousWorkRule, WorkCommand } from '../src/work-types.ts'

const rule = { id: 'rule', projectId: 'project', sourceId: 'source', version: 1, enabled: false, items: [] } as unknown as ContinuousWorkRule
it('saves delegation on HTTP when Web Crypto has getRandomValues but no randomUUID', async () => {
  const original = globalThis.crypto
  vi.stubGlobal('crypto', { getRandomValues: original.getRandomValues.bind(original) })
  try {
    const client = { command: vi.fn(async () => ({ status: 'completed', continuousRule: rule })) } as unknown as WorkClient
    const controller = new ContinuousDelegationController(client, { projectId: 'project', sourceId: 'source' }, rule)
    controller.setDraft('HTTP 委托')
    await controller.save()
    expect(client.command).toHaveBeenCalledWith(expect.objectContaining({ commandId: expect.stringMatching(/^continuous-ui:[0-9a-f-]{36}$/), text: 'HTTP 委托' }))
  } finally { vi.unstubAllGlobals() }
})

it('keeps edited delegation drafts across background refresh and slow save responses', async () => {
  let release!: (value: unknown) => void
  const client = { command: vi.fn(() => new Promise(resolve => { release = resolve })), query: vi.fn() } as unknown as WorkClient
  const controller = new ContinuousDelegationController(client, { projectId: 'project', sourceId: 'source' }, rule)
  controller.setDraft('原始委托')
  controller.updateRule({ ...rule, version: 2 })
  expect(controller.getSnapshot().draft).toBe('原始委托')
  const saving = controller.save()
  controller.setDraft('保存期间继续输入')
  release({ status: 'completed', continuousRule: { ...rule, version: 3 } })
  await saving
  expect(controller.getSnapshot().draft).toBe('保存期间继续输入')
  expect(client.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'continuous.instruct', expectedVersion: 2, text: '原始委托' }))
})

it('retries an unknown command receipt using the same command identity', async () => {
  const commands: WorkCommand[] = []
  const client = { command: vi.fn(async command => { commands.push(command); if (commands.length === 1) throw new TypeError('Network disconnected'); return { status: 'completed', continuousRule: rule } }), query: vi.fn() } as WorkClient
  const controller = new ContinuousDelegationController(client, { projectId: 'project', sourceId: 'source' }, rule)
  await controller.preview()
  expect(controller.getSnapshot().pending).toBeDefined()
  await controller.retry()
  expect(commands).toHaveLength(2)
  expect(commands[1]).toEqual(commands[0])
  expect(controller.getSnapshot().pending).toBeUndefined()
})
