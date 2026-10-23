/**
 * Release check for the packed tarball (issue #194).
 *
 * A checkout only has git-tracked files, and `lib/` is git-ignored, so the old
 * check that ran `pnpm build` in the worktree first could never see the empty
 * shell this package used to ship. This script therefore exports HEAD with
 * `git archive` into a temporary tree (asserting `lib/` is absent), lets
 * `pnpm pack` build it through `prepack`, asserts every explicit export target
 * plus the bundle sidecars are inside the tarball, and only then installs that
 * tarball into an empty project and imports every Node entrypoint.
 *
 * Because the archive step verifies the committed `HEAD`, a dirty working tree
 * is rejected: an uncommitted manifest or build-script edit must never pass a
 * release gate and then be packed or published as-is.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKAGE_SIDECARS, explicitExportTargets, exportedNodeEntrypoints, readPackageManifest } from './pack-manifest.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = execFile(command, args, {
      cwd: options.cwd ?? root,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...(options.env ?? {}) },
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += chunk })
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolveRun({ stdout, stderr })
        return
      }
      const details = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}${details ? `\n${details}` : ''}`))
    })
  })
}

async function assertMissing(path, message) {
  if (existsSync(path)) throw new Error(message)
}

async function verifyCheckout(shipped) {
  const checkout = join(shipped, 'checkout')
  const archive = join(shipped, 'HEAD.tar')
  const packDestination = join(shipped, 'packed')

  const dirty = (await run('git', ['status', '--porcelain'])).stdout.trim()
  if (dirty.length > 0) {
    throw new Error(
      'working tree has uncommitted changes; commit or stash them first — '
      + `this check verifies the committed HEAD that would be packed:\n${dirty}`,
    )
  }
  const head = (await run('git', ['rev-parse', '--short', 'HEAD'])).stdout.trim()

  await mkdir(checkout, { recursive: true })
  await mkdir(packDestination, { recursive: true })

  await run('git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD'])
  await run('tar', ['-xf', archive, '-C', checkout])
  await assertMissing(
    join(checkout, 'lib'),
    'clean checkout unexpectedly contains lib/: `git archive HEAD` must only export tracked files',
  )

  const pkg = readPackageManifest(checkout)
  if (typeof pkg.scripts?.prepack !== 'string' || pkg.scripts.prepack.length === 0) {
    throw new Error(
      'clean checkout has no `prepack` script: `pnpm pack` would ship an empty shell — '
      + 'the eight mount rows in cordis.patch.yml would fail with ERR_MODULE_NOT_FOUND',
    )
  }

  // The build needs devDependencies; link this checkout's installed tree instead
  // of reinstalling. The clean tree stays free of build output until prepack runs.
  await symlink(join(root, 'node_modules'), join(checkout, 'node_modules'), 'dir')
  console.log(`clean tree: exported HEAD ${head} (no lib/), node_modules linked for the build`)

  await run('pnpm', ['pack', '--pack-destination', packDestination], { cwd: checkout })
  const tarballs = (await readdir(packDestination)).filter(file => file.endsWith('.tgz'))
  if (tarballs.length !== 1) {
    throw new Error(`pnpm pack produced ${tarballs.length} tarballs in ${packDestination}: ${tarballs.join(', ')}`)
  }
  const tarballPath = join(packDestination, tarballs[0])

  if (!existsSync(join(checkout, 'lib/index.js'))) {
    throw new Error('prepack ran but lib/index.js is still missing: the pack hook did not build the package')
  }

  const listing = (await run('tar', ['tzf', tarballPath])).stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const packed = new Set(listing)
  const required = [
    ...explicitExportTargets(pkg.exports).map(({ specifier, target }) => ({
      label: `${specifier} -> ${target}`,
      entry: `package/${target.replace(/^\.\//u, '')}`,
    })),
    ...PACKAGE_SIDECARS.map(file => ({ label: file, entry: `package/${file}` })),
  ]
  const missing = required.filter(({ entry }) => !packed.has(entry))
  if (missing.length > 0) {
    throw new Error(
      `tarball ${tarballs[0]} is missing required files:\n${missing.map(({ label, entry }) => `  ${label} (${entry})`).join('\n')}`,
    )
  }
  console.log(
    `tarball: ${tarballs[0]} carries all ${explicitExportTargets(pkg.exports).length} export targets `
    + `and ${PACKAGE_SIDECARS.join(' + ')} (${listing.length} entries)`,
  )

  const installRoot = join(shipped, 'install-project')
  await mkdir(installRoot)
  await writeFile(
    join(installRoot, 'package.json'),
    JSON.stringify({ name: 'pack-exports-check', private: true, type: 'module' }, null, 2),
  )
  const peerSpecs = Object.entries(pkg.peerDependencies ?? {})
    .map(([name, range]) => `${name}@${pkg.devDependencies?.[name] ?? range}`)
  await run('pnpm', ['install', '--ignore-scripts', tarballPath, ...peerSpecs], { cwd: installRoot })

  const entrypoints = exportedNodeEntrypoints(pkg.exports, pkg.name)
  await writeFile(join(installRoot, 'verify.mjs'), `${entrypoints.map(specifier => `await import(${JSON.stringify(specifier)});`).join('\n')}\n`)
  await run(process.execPath, ['verify.mjs'], {
    cwd: installRoot,
    env: {
      NODE_PATH: [join(installRoot, 'node_modules'), join(root, 'node_modules')].join(delimiter),
    },
  })
  console.log(`installed tarball imports ${entrypoints.length} Node entrypoints: ${entrypoints.join(', ')}`)
}

const shipped = await mkdtemp(join(tmpdir(), 'a2d2-pack-exports-'))
try {
  await verifyCheckout(shipped)
}
catch (error) {
  console.error(`verify-pack-exports: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
finally {
  await rm(shipped, { recursive: true, force: true })
}
