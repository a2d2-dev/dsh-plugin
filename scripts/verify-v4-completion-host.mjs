import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

// This is a private test environment, never a runtime/profile installation.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = await realpath(process.env.A2D2_MATCHED_HOST_DIR ?? (() => { throw Error('Set A2D2_MATCHED_HOST_DIR to the approved Host artifact directory') })())
const fixture = join(root, '.local', 'matched-host-8282-env')
const revision = '8282d61299a04f60555f9ce473af174bbe161b02'
const expected = {
  '@deepseek-ai/dsh-session': '759374686dfb533afdbd448312fdc747a572188702e76639dd4e2d44a2b6c5a4',
  '@deepseek-ai/dsh-jobs': 'c2aef429bd5430aa724df0034c986be77487ea5c4744079543b8a162c305a04d',
  '@deepseek-ai/dsh-jobs-local': 'ff6f2310f9e0a845d39a77086cb12177fa3cb9112b898d0cc2b866e2a6954f9b',
  '@deepseek-ai/dsh-tool-jobs': '41674d1aa74334012b0c81715bbec5d1f8a7bc0d11c6f33b02041cfe678d8c47',
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function writeChanged(path, bytes) {
  const previous = await readFile(path).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (previous?.equals(Buffer.from(bytes))) return
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}
const manifestBytes = await readFile(join(artifacts, 'manifest.json'))
const manifest = JSON.parse(manifestBytes)
if (manifest.sourceCommit !== revision || manifest.packages.length !== 4) throw Error('Unexpected matched Host manifest')
const overrides = {}, hashes = {}
for (const [name, sha256] of Object.entries(expected)) {
  const entry = manifest.packages.find(item => item.name === name)
  if (!entry || entry.sourceCommit !== revision || entry.sha256 !== sha256) throw Error(`Unapproved Host artifact: ${name}`)
  const archive = await realpath(join(artifacts, basename(entry.tarball)))
  if (dirname(archive) !== artifacts) throw Error('Artifact escaped its approved directory')
  const bytes = await readFile(archive)
  if (digest(bytes) !== sha256) throw Error(`Host archive hash mismatch: ${name}`)
  await writeChanged(join(fixture, 'packages', basename(archive)), bytes)
  overrides[name] = `file:./packages/${basename(archive)}`
  hashes[name] = sha256
}
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
pkg.name = 'v4-pf-141-matched-host-fixture'
pkg.private = true
pkg.pnpm = { ...pkg.pnpm, overrides: { ...pkg.pnpm?.overrides, ...overrides } }
await writeChanged(join(fixture, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
await writeChanged(join(fixture, 'pnpm-lock.yaml'), await readFile(join(root, 'pnpm-lock.yaml')))
const sourceHashes = {}
async function snapshot(relative) {
  const source = join(root, relative)
  for (const item of await readdir(source, { withFileTypes: true })) {
    const path = join(relative, item.name)
    if (item.isDirectory()) await snapshot(path)
    else if (item.isFile()) {
      const bytes = await readFile(join(root, path))
      sourceHashes[path] = digest(bytes)
      await writeChanged(join(fixture, path), bytes)
    }
  }
}
await snapshot('src')
await snapshot('tests')
for (const path of ['vitest.matched-host.config.ts', 'tsconfig.json']) await writeChanged(join(fixture, path), await readFile(join(root, path)))
await writeChanged(join(fixture, 'host-manifest.json'), manifestBytes)
await writeChanged(join(fixture, 'fixture-provenance.json'), `${JSON.stringify({ host: revision, packages: hashes, sourceHashes }, null, 2)}\n`)
const env = { ...process.env }
function run(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('corepack', ['pnpm@10.26.2', ...args], { cwd: fixture, stdio: 'inherit', env })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolveRun() : reject(Error(`pnpm ${args.join(' ')} [exit code: ${code}]`)))
  })
}
console.log(`Matched Host ${revision}; fixture ${fixture}; ${Object.keys(sourceHashes).length} exact source/test snapshots`)
await run(['install', '--ignore-scripts'])
await run(['exec', 'vitest', 'run', '--config', 'vitest.matched-host.config.ts', '--maxWorkers=1'])
console.log(`Verified matched native/job completion lane. Provenance: ${join(fixture, 'fixture-provenance.json')}`)
