/** Repository and release invariants shared by local checks and CI. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const pkg = JSON.parse(read('package.json'))
const plugin = JSON.parse(read('dsh.plugin.json'))
assert.equal(pkg.name, '@a2d2/dsh-a2d2', 'package name must match the deployed scoped identity')
assert.equal(pkg.version, plugin.version, 'package and plugin versions must agree')
assert.equal(pkg.license, 'Apache-2.0')
assert.match(read('LICENSE'), /Apache License\s+Version 2\.0/)
assert.equal(pkg.repository.url, 'git+https://github.com/a2d2-dev/dsh-plugin.git')
assert.match(read('CHANGELOG.md'), /^## Unreleased/m)
assert.ok(pkg.scripts.prepack?.includes('assert-pack-entrypoints'), 'packing must build and verify entrypoints')

const rows = parse(read('cordis.patch.yml')).flatMap(patch => patch.insert ?? [])
assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'mount row IDs must be unique')
for (const row of rows) {
  assert.ok(row.name === pkg.name || row.name.startsWith(`${pkg.name}/`), `foreign mount: ${row.id}`)
  const suffix = row.name.slice(pkg.name.length)
  assert.ok(pkg.exports[suffix ? `.${suffix}` : '.'], `mount row lacks a public export: ${row.id}`)
}
for (const file of ['README.md', 'README.zh.md', 'CONTRIBUTING.md', 'SECURITY.md', 'SUPPORT.md', 'docs/releasing.md']) {
  assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `missing contributor document: ${file}`)
}
const tracked = git('ls-files', '-z').split('\0').filter(Boolean)
const privatePaths = tracked.filter(file => /^(?:docs\/artifacts\/|\.claude\/|\.dsh\/|\.local\/|\.scratch\/)/.test(file))
assert.deepEqual(privatePaths, [], 'local state and private acceptance captures belong in a2d2-dev/project')
assert.equal(tracked.some(file => /^docs\/architecture\/project14-/.test(file)), false, 'external personal issue inventories must not ship')

const args = process.argv.slice(2)
if (args.length > 0) {
  assert.equal(args.length, 2, 'usage: node scripts/verify-repository.mjs [--tag vX.Y.Z]')
  assert.equal(args[0], '--tag')
  const tag = args[1]
  assert.equal(tag, `v${pkg.version}`, 'release tag must exactly match package.json')
  assert.match(tag, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'invalid version tag')
  assert.doesNotMatch(pkg.version, /(?:^|[.-])dev(?:[.-]|$)/, 'development snapshots are not release candidates')
  assert.equal(git('rev-parse', `${tag}^{commit}`), git('rev-parse', 'HEAD'), 'checkout must equal the tagged source')
  git('merge-base', '--is-ancestor', 'HEAD', 'origin/main')
  console.log(`release source: ${tag} at ${git('rev-parse', 'HEAD')} is contained in origin/main`)
}
console.log(`repository: ${pkg.name}@${pkg.version}; ${rows.length} mount rows; metadata and source exclusions agree`)
