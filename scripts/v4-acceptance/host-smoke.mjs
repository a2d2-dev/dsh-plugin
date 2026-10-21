import { createRequire } from 'node:module'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

// Explicit preparation command only; imports and CLI --version never start Web/Agent/model.
const [root, output] = process.argv.slice(2)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
try {
  if (!isAbsolute(root ?? '') || await realpath(root) !== root || root === '/data/src/github.com/deepseek-ai/deepseek-harness-dev') throw Error('isolated canonical host required')
  if (!isAbsolute(output ?? '') || !output.startsWith('/tmp/a2d2-v4-')) throw Error('private output required')
  const command = (program, args) => {
    const result = spawnSync(program, args, { encoding: 'utf8', timeout: 30000 })
    if (result.status !== 0) throw Error('host smoke command failed; inspect privately')
    return result.stdout.trim()
  }
  const cli = join(root, 'apps/cli/lib/bin.js')
  const cliSha256 = sha(await readFile(cli))
  const hostCommit = command('git', ['-C', root, 'rev-parse', 'HEAD'])
  const cliVersion = command(process.execPath, [cli, '--version'])
  const imports = [], modules = {}
  const targets = [
    ['packages/bundle/base/package.json', '@deepseek-ai/dsh-session'],
    ['packages/bundle/base/package.json', '@deepseek-ai/dsh-jobs-local'],
    ['packages/bundle/base/package.json', '@deepseek-ai/dsh-subagent'],
    ['packages/bundle/base/package.json', '@deepseek-ai/dsh-llm'],
    ['packages/bundle/web-app/package.json', '@deepseek-ai/dsh-api-session-controller'],
    ['packages/bundle/web-app/package.json', '@deepseek-ai/dsh-api-job-controller'],
    ['packages/bundle/web-app/package.json', '@deepseek-ai/dsh-client-modules'],
  ]
  for (const [anchor, name] of targets) {
    const path = await realpath(createRequire(join(root, anchor)).resolve(name))
    if (!path.startsWith(root + '/')) throw Error(`dynamic import escapes isolated host: ${name}`)
    modules[name] = await import(pathToFileURL(path).href)
    imports.push({ name, path, sha256: sha(await readFile(path)), ok: true })
  }
  const jobsObserve = typeof modules['@deepseek-ai/dsh-jobs-local'].LocalJobRegistry?.prototype.observe === 'function'
  const appendIgnorable = typeof modules['@deepseek-ai/dsh-session'].Session?.prototype.appendIgnorable === 'function'
  const receipt = { passed: true, hostRoot: root, hostCommit, cliVersion, cliSha256, jobsObserve, appendIgnorable, imports, capturedAt: new Date().toISOString(), scope: 'all listed runtime seams import; full module dependency closure still requires complete build/export regressions' }
  await writeFile(output, JSON.stringify(receipt, null, 2)+'\n', { mode: 0o600, flag: 'wx' })
  console.log(JSON.stringify(receipt, null, 2))
} catch (error) { console.error(error.message); process.exitCode = 1 }
