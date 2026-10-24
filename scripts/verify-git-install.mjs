/**
 * Opt-in Git install smoke test for #205. Uses real pnpm, an isolated project and
 * a fresh store so a previously prepared Git package cannot hide missing approval.
 * Run with Desktop 0.2.1-rc.2's pnpm on PATH:
 * npm exec --yes --package=pnpm@11.28.5 -- node scripts/verify-git-install.mjs <commit>
 * Requires network access, Git and Node >=22; never touches a DSH profile.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { PACKAGE_SIDECARS, explicitExportTargets, exportedNodeEntrypoints } from './pack-manifest.mjs'

const commit = process.argv[2]
const packageName = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name
assert.match(commit ?? '', /^[a-f0-9]{40}$/, 'pass the full Git commit to verify')
const dependency = `git+https://github.com/a2d2-dev/dsh-plugin.git#${commit}`
const root = realpathSync(mkdtempSync(join(tmpdir(), 'a2d2-git-install-')))
const profile = join(root, 'profile')
mkdirSync(profile)
const manifestPath = join(profile, 'package.json')
const policyPath = join(profile, 'pnpm-workspace.yaml')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const baselinePolicy = 'packages:\n  - .\n'

function install(label) {
  const result = spawnSync(pnpm, ['add', dependency, '--store-dir', join(root, 'store'), '--reporter=append-only'], {
    cwd: profile, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  writeFileSync(join(root, `${label}.log`), output)
  return { status: result.status, output }
}

let passed = false
try {
  writeFileSync(manifestPath, JSON.stringify({ name: 'a2d2-git-install-check', private: true, type: 'module' }))
  writeFileSync(policyPath, baselinePolicy)
  const version = execFileSync(pnpm, ['--version'], { cwd: profile, encoding: 'utf8', shell: process.platform === 'win32' }).trim()
  assert.equal(version, '11.28.5', 'run with the pnpm version shipped by Desktop 0.2.1-rc.2')
  console.log(`pnpm ${version}; Node ${process.version}; ${dependency}`)

  const denied = install('denied')
  assert.notEqual(denied.status, 0, 'Git source requiring prepack must not install without approval')
  assert.match(denied.output, /ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED/)
  assert.ok(denied.output.includes(`${packageName}@${dependency}`), 'error must identify the exact approval key')
  console.log('PASS: missing authorization reproduces ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')

  writeFileSync(policyPath, `${baselinePolicy}allowBuilds:\n  ${JSON.stringify(`${packageName}@${dependency}`)}: true\n`)
  const allowed = install('allowed')
  assert.equal(allowed.status, 0, allowed.output)
  const installedRoot = join(profile, 'node_modules', ...packageName.split('/'))
  const pkg = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
  for (const file of [...explicitExportTargets(pkg.exports).map(({ target }) => target), ...PACKAGE_SIDECARS]) {
    assert.ok(existsSync(join(installedRoot, file)), `missing installed file: ${file}`)
  }
  const entries = exportedNodeEntrypoints(pkg.exports, pkg.name)
  writeFileSync(join(profile, 'verify.mjs'), entries.map(specifier => `await import(${JSON.stringify(specifier)});`).join('\n'))
  execFileSync(process.execPath, ['verify.mjs'], { cwd: profile, stdio: 'pipe' })
  console.log(`PASS: exact approval installs all export targets and sidecars; ${entries.length} Node entrypoints import`)
  passed = true
} finally {
  if (passed) {
    // Delete only the unique temporary project created above, never caller input.
    assert.equal(realpathSync(root), root)
    assert.equal(dirname(root), realpathSync(tmpdir()))
    assert.ok(basename(root).startsWith('a2d2-git-install-'))
    rmSync(root, { recursive: true, force: true })
  } else {
    console.error(`Git install check failed; isolated project and logs retained at ${root}`)
  }
}
