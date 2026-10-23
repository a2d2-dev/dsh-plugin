import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
      env: { ...process.env, ...(options.env ?? {}) },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
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

function exportedNodeEntrypoints(exportsMap) {
  return Object.entries(exportsMap)
    .filter(([specifier, target]) => {
      if (specifier === './package.json') return false
      if (specifier.includes('*')) return false
      const resolvedTarget = typeof target === 'string' ? target : target?.default
      return typeof resolvedTarget === 'string' && resolvedTarget.startsWith('./lib/') && !resolvedTarget.endsWith('/client.js')
    })
    .map(([specifier]) => (specifier === '.' ? pkg.name : `${pkg.name}/${specifier.slice(2)}`))
}

const packResult = await run('pnpm', ['pack', '--json'], { cwd: root })
const packed = JSON.parse(packResult.stdout)
const tarballFilename = Array.isArray(packed) ? packed[0]?.filename : packed.filename
if (typeof tarballFilename !== 'string') {
  throw new Error(`pnpm pack did not report a tarball filename: ${packResult.stdout}`)
}
const tarballPath = join(root, tarballFilename)
const installRoot = await mkdtemp(join(tmpdir(), 'a2d2-pack-exports-'))

try {
  await writeFile(join(installRoot, 'package.json'), JSON.stringify({ type: 'module' }, null, 2))
  const peerInstallSpecs = Object.entries(pkg.peerDependencies ?? {})
    .map(([name, range]) => `${name}@${pkg.devDependencies?.[name] ?? range}`)
  await run('pnpm', ['install', '--ignore-scripts', tarballPath, ...peerInstallSpecs], { cwd: installRoot })

  const installedRoot = join(installRoot, 'node_modules', pkg.name)
  const installed = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
  for (const [specifier, target] of Object.entries(installed.exports)) {
    if (specifier.includes('*')) throw new Error(`Unverified wildcard export: ${specifier}`)
    for (const path of typeof target === 'string' ? [target] : Object.values(target)) {
      if (typeof path !== 'string' || !path.startsWith('./')) throw new Error(`Invalid export target: ${specifier}`)
      await access(join(installedRoot, path))
    }
  }
  if (installed.license !== 'Apache-2.0') throw new Error('Package license must be Apache-2.0')
  const license = await readFile(join(installedRoot, 'LICENSE'), 'utf8')
  if (!license.includes('Apache License') || !license.includes('Version 2.0')) throw new Error('Missing Apache license text')

  // The client is a host-loader script, not a Node module. Check the shipped
  // wrapper registers the expected factory without executing browser UI code.
  let registered
  runInNewContext(await readFile(join(installedRoot, 'lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load: entry => { registered = entry } } },
  })
  if (registered?.id !== pkg.name || typeof registered.factory !== 'function') {
    throw new Error('Client bundle must register a factory under the package name')
  }

  const importLines = exportedNodeEntrypoints(pkg.exports)
    .map(specifier => `await import(${JSON.stringify(specifier)});`)
    .join('\n')

  await writeFile(join(installRoot, 'verify.mjs'), `${importLines}\n`)
  await run(process.execPath, ['verify.mjs'], { cwd: installRoot })
  console.log(`verified ${exportedNodeEntrypoints(pkg.exports).join(', ')}`)
}
finally {
  await rm(tarballPath, { force: true })
  await rm(installRoot, { recursive: true, force: true })
}
