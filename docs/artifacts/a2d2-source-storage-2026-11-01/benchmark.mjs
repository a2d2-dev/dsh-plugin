// Run from the repository root with node --experimental-transform-types. Uses real NVMe files, no filesystem mocks.
import { mkdtemp, writeFile, readdir, stat, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'
import { WorkDao } from '../../../src/work-store/dao.ts'
const repo = resolve('.'), baselineFile = join(repo, 'src/work-store', `.benchmark-${randomUUID()}.ts`)
const directory = await mkdtemp('/data/_ssd2t/a2d2-source-storage-benchmark-')
const baselineCommit = 'f39d93e45915a71b331c4a31b250dbd6372f3e7e'
const original = execFileSync('git', ['show', `${baselineCommit}:src/work-store/dao.ts`], { encoding: 'utf8' })
await writeFile(baselineFile, original)
try {
  const { WorkDao: OriginalDao } = await import(pathToFileURL(baselineFile).href)
  const sourceId = randomUUID(), projectId = randomUUID(), now = '2026-11-01T00:00:00Z'
  const observations = Array.from({ length: 1000 }, (_, index) => ({ sequence: 1, issue: { nodeId: `I_${index}`, number: index + 1, title: `Issue ${index}`, body: 'x'.repeat(20_000), repository: { owner: 'a2d2-dev', repository: 'dsh-plugin' }, url: `https://github.com/a2d2-dev/dsh-plugin/issues/${index + 1}`, state: 'open', labels: [], assignees: [], updatedAt: now, observedAt: now } }))
  const source = { id: sourceId, projectId, provider: 'github', githubProject: { owner: 'a2d2-dev', type: 'org', number: 1 }, enabled: true, version: 1, sequence: 1, requests: {}, observations, pages: [], discovery: { state: 'syncing', nextAttemptAt: now, failures: 0, checkpoint: { sourceVersion: 1, startedAt: now, pages: 0, items: [], issues: observations.slice(0, 850).map(value => value.issue) } } }
  const results = []
  for (const [label, Dao] of [['before', OriginalDao], ['after', WorkDao]]) {
    const root = join(directory, label), dao = Dao.forDirectory(root)
    await dao.transaction(async state => { state.sources.push(structuredClone(source)) })
    const archive = join(root, 'work-v3.archive'), existing = new Set(await readdir(archive))
    const start = performance.now()
    for (let page = 1; page <= 5; page++) await dao.transaction(async state => {
      // Same reservation access as discovery; cloning reads the body without changing it.
      structuredClone(state.sources[0])
      state.sources[0].discovery.checkpoint.pages = page
      state.sources[0].discovery.checkpoint.cursor = `page-${page}`
      state.sources[0].discovery.checkpoint.issues.push(structuredClone(observations[850 + page].issue))
    })
    const elapsedMs = performance.now() - start, files = (await readdir(archive)).filter(file => !existing.has(file))
    let archiveBytes = 0
    for (const file of files) archiveBytes += (await stat(join(archive, file))).size
    const controlBytes = (await stat(join(root, 'work-v3.json'))).size
    results.push({ label, pages: 5, sourceBytes: Buffer.byteLength(JSON.stringify(observations)), initialCheckpointBytes: Buffer.byteLength(JSON.stringify(source.discovery.checkpoint)), archiveFiles: files.length, archiveBytes, finalControlBytes: controlBytes, elapsedMs: Math.round(elapsedMs) })
    const exported = await dao.exportSnapshot()
    if (exported.sources[0].observations.length !== 1000 || exported.sources[0].discovery.checkpoint.pages !== 5) throw Error('Benchmark semantic verification failed')
  }
  const report = { baselineCommit, workload: '1000 observations with 20KB issue bodies, 850 accumulated checkpoint issues (~17MB); five pages adding one issue each with source reservation clone', filesystem: execFileSync('stat', ['-f', '-c', '%T', directory], { encoding: 'utf8' }).trim(), results }
  const output = join(repo, 'docs/artifacts/a2d2-source-storage-2026-11-01/benchmark.json')
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  await rm(baselineFile, { force: true })
  await rm(directory, { recursive: true, force: true })
}
