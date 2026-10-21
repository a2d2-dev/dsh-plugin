import { readFile, writeFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { canonical } from './retention.mjs'

// Explicit allowlist projection; never serialize raw headers, events, instructions or cookies.
try {
  const [privateRoot, output] = process.argv.slice(2)
  if (!privateRoot?.startsWith('/tmp/a2d2-v4-') || await realpath(privateRoot) !== privateRoot) throw Error('canonical private capture root required')
  const target = resolve(output)
  const artifacts = resolve('docs/artifacts/task-interaction-v4-2026-10-21')
  if (!target.startsWith(artifacts + '/') || await realpath(artifacts) !== artifacts) throw Error('output must stay in this worktree artifact directory')
  const baseline = JSON.parse(await readFile(join(privateRoot, 'baseline.json')))
  const listed = JSON.parse(await readFile(join(privateRoot, 'session-list.private.json')))
  const publicValue = Object.fromEntries(['schemaVersion', 'capturedAt', 'origin', 'program', 'service', 'hostCommit', 'pluginRoot', 'fingerprints', 'warnings', 'coverage'].map(key => [key, baseline[key]]))
  publicValue.records = baseline.records.map(({ kind, id, identity, history }) => ({ kind, id, identity, historyCount: history.length, historySha256: createHash('sha256').update(canonical(history)).digest('hex') }))
  publicValue.observations = listed.map(row => {
    const value = Object.fromEntries(['sessionId', 'cwd', 'parentSessionId', 'origin', 'running', 'agentAvailable'].filter(key => key in row).map(key => [key, row[key]]))
    value.children = (row.projections?.values?.subagentCatalog ?? []).map(child => ({ id: child.id, mode: child.mode }))
    return value
  })
  publicValue.jobs = '未验证；没有调用消费接口或清理当前jobs'
  await writeFile(target, JSON.stringify(publicValue, null, 2)+'\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ published: target, origin: baseline.origin, recordCount: baseline.records.length }))
} catch (error) { console.error(error.message); process.exitCode = 1 }
