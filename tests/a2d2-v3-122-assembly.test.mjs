import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { prepare, verify } from '../scripts/a2d2-v3-122/acceptance.mjs'

const host = process.env.A2D2_ACCEPTANCE_HOST ?? '/data/src/github.com/deepseek-ai/deepseek-harness-dev'
test('prepared assembly rejects a different wrapper before any host or IPC action', async () => {
  const root = `/tmp/a2d2-v3-121/122-integrity-${randomUUID()}`
  await prepare({ host, root, hostOnly: true })
  await verify(root)
  const path = `${root}/assembly.json`
  const assembly = JSON.parse(await readFile(path, 'utf8'))
  assembly.wrapperSHA = '0'.repeat(64)
  await writeFile(path, JSON.stringify(assembly, null, 2), { mode: 0o600 })
  await assert.rejects(verify(root), /Wrapper changed after preparation/)
  // Retain this exclusively owned fixture for diagnosis; no host was started.
})
