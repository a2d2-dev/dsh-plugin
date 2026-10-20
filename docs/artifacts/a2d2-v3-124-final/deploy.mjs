import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, copyFile, constants } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const root = '/data/_dsh-dev/previews/a2d2-v3-121'
const profile = `${root}/home/profiles/web`
const commit = '876758c8566e50c0db0df53e27ada46b8041c223'
const sourceTgz = `/data/src/github.com/a2d2-dev/dsh-plugin.worktrees/a2d2-v3-04-source-ui/.local/artifacts/${commit}/dsh-a2d2-0.0.1.tgz`
const target = `${root}/artifacts/source124-${commit}/dsh-a2d2-0.0.1.tgz`
const backup = `${root}/evidence/source124-${commit}/rollback`
const out = new URL('./', import.meta.url)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const expected = 'b7939639179faf84563a9d486ef768600e642e0722db22a1fb84fe9444c9bf5b'
const clientSha = '93baf01e6222cefc5710403f0c29e59ae9258d31fd3ca930b1c1e3a1a7476f61'
const oldSha = '3ba6225b0da7eb20f05724b4c686ba058d6f52d8e41bd98964ae566a10e22767'
const packageBytes = await readFile(sourceTgz)
assert.equal(sha(packageBytes), expected)
const packedClient = spawnSync('tar', ['-xOf', sourceTgz, 'package/lib/client.js'])
assert.equal(packedClient.status, 0)
assert.equal(sha(packedClient.stdout), clientSha)
const manifestPath = `${profile}/package.json`, launcherPath = `${root}/launch.mjs`
const manifestBytes = await readFile(manifestPath)
const manifest = JSON.parse(manifestBytes)
const launcher = await readFile(launcherPath, 'utf8')
assert.equal(sha(await readFile(manifest.dependencies['dsh-a2d2'].replace(/^file:/, ''))), oldSha)
assert.equal(launcher.split(oldSha).length, 2)
assert.ok(!launcher.includes('GH_CONFIG_DIR'))
if (process.argv[2] === 'prepare') {
  await mkdir(backup, { recursive: true, mode: 0o700 })
  await mkdir(new URL('.', `file://${target}`), { recursive: true, mode: 0o700 })
  const backups = []
  for (const [path, name] of [[manifestPath, 'package.json'], [`${profile}/pnpm-lock.yaml`, 'pnpm-lock.yaml'], [launcherPath, 'launch.mjs'], [`${root}/preview.patch.yml`, 'preview.patch.yml']]) {
    const bytes = await readFile(path)
    await writeFile(`${backup}/${name}`, bytes, { flag: 'wx', mode: 0o600 })
    backups.push({ path, backup: `${backup}/${name}`, bytes: bytes.length, sha256: sha(bytes) })
  }
  await copyFile(sourceTgz, target, constants.COPYFILE_EXCL)
  assert.equal(sha(await readFile(target)), expected)
  const prepared = { sourceCommit: commit, sourceTgz, versionedTgz: target, packageSha256: expected, clientSha256: clientSha, rollbackPackageSha256: oldSha, backups }
  await writeFile(new URL('deployment-prepared.json', out), JSON.stringify(prepared, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify(prepared))
} else if (process.argv[2] === 'install') {
  const prepared = JSON.parse(await readFile(new URL('deployment-prepared.json', out)))
  for (const row of prepared.backups) assert.equal(sha(await readFile(row.path)), row.sha256)
  assert.equal(sha(await readFile(target)), expected)
  manifest.dependencies['dsh-a2d2'] = `file:${target}`
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const install = spawnSync('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile', '--config.auto-install-peers=false'], { cwd: profile, encoding: 'utf8' })
  // Install output stays in preview private evidence; never capture host logs or credentials in Git.
  await writeFile(`${backup}/../install.private.log`, `${install.stdout ?? ''}${install.stderr ?? ''}`, { flag: 'wx', mode: 0o600 })
  assert.equal(install.status, 0, 'Install failed; inspect private install output before any restart')
  const nextLauncher = launcher.replace(oldSha, expected).replace("DSH_TELEMETRY_DISABLED:'1'", "GH_CONFIG_DIR:'/root/.config/gh',DSH_TELEMETRY_DISABLED:'1'")
  assert.ok(nextLauncher.includes("XDG_STATE_HOME:`${root}/state`"))
  await writeFile(launcherPath, nextLauncher)
  assert.equal(sha(await readFile(`${profile}/node_modules/dsh-a2d2/lib/client.js`)), clientSha)
  for (const path of [`${root}/preview.patch.yml`]) assert.equal(sha(await readFile(path)), prepared.backups.find(row => row.path === path).sha256)
  await writeFile(new URL('deployment-installed.json', out), JSON.stringify({ sourceCommit: commit, versionedTgz: target, packageSha256: expected, clientSha256: clientSha, installExitCode: install.status, launcherChange: 'package SHA and GH_CONFIG_DIR only', unchangedXdgStateHome: `${root}/state`, next: 'restart only dsh-a2d2-v3-preview' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ installed: true, packageSha256: expected, clientSha256: clientSha, installExitCode: install.status }))
} else throw Error('Use prepare or install')
