#!/usr/bin/env node
/** Offline gates only: never launch a Web/SDK Host or operate on a live profile. */
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const phases = ['session', 'jobs', 'unit', 'host', 'node', 'typecheck', 'build', 'repository']
const usage = `用法：node scripts/verify-dsh-upgrade.mjs
  --host-root /ABS/BUILT_OFFICIAL_ROOT --expected-commit FULL_SHA
  --expected-version VERSION --report-dir /ABS/private/new-run
  [--full | --phase session,jobs,...] [--unit-tmp-dir /ABS/no-git-ancestor]
默认 quick：session,jobs。--full：${phases.join(',')}。
--phase 可重复；每次仍执行候选冻结与结束复核。report-dir 必须不存在。
只执行离线测试；PASS 不代表 profile、数据迁移或原 GUI 验收通过。`
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const within = (parent, child) => child === parent || child.startsWith(parent + sep)
function git(root, args) {
  return execFileSync('git', ['--no-optional-locks', '-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  }).trim()
}
function options(args) {
  const result = { selected: [] }
  const values = new Map([
    ['--host-root', 'hostRoot'], ['--expected-commit', 'commit'],
    ['--expected-version', 'version'], ['--report-dir', 'reportDir'], ['--unit-tmp-dir', 'unitTmpDir'],
  ])
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (key === '--help' || key === '-h') { console.log(usage); return }
    if (key === '--full') { assert(!result.full, '重复 --full'); result.full = true; continue }
    assert(values.has(key) || key === '--phase', `未知参数 ${key}`)
    const value = args[++i]
    assert(value && !value.startsWith('--'), `${key} 缺少值`)
    if (key === '--phase') result.selected.push(...value.split(','))
    else {
      const field = values.get(key)
      assert(result[field] === undefined, `重复 ${key}`)
      result[field] = value
    }
  }
  for (const field of ['hostRoot', 'commit', 'version', 'reportDir']) assert(result[field], `缺少 ${field}\n${usage}`)
  for (const field of ['hostRoot', 'reportDir', 'unitTmpDir']) if (result[field]) assert(isAbsolute(result[field]), `${field} 必须为绝对路径`)
  assert(/^[0-9a-f]{40}$/.test(result.commit), 'expected-commit 必须为完整40位小写 SHA，不能使用 branch/tag/短 SHA')
  assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(result.version), 'expected-version 必须为精确版本')
  assert(!(result.full && result.selected.length), '--full 与 --phase 不能同时使用')
  result.selected = [...new Set(result.full ? phases : result.selected.length ? result.selected : ['session', 'jobs'])]
  for (const phase of result.selected) assert(phases.includes(phase), `未知阶段 ${phase}；允许 ${phases.join(',')}`)
  result.hostRoot = realpathSync(result.hostRoot)
  return result
}
// Fail closed on unsupported grammar. Current official root/CLI use >=24.9.0.
function checkEngine(range, label) {
  assert(typeof range === 'string' && range.trim(), `${label} 缺少 engines.node`)
  const version = process.versions.node.split('.').map(Number)
  const compare = target => {
    for (let i = 0; i < 3; i++) if (version[i] !== target[i]) return Math.sign(version[i] - target[i])
    return 0
  }
  const groups = range.split('||').map(group => group.trim().split(/\s+/).map(token => {
    const match = /^(>=|<=|>|<|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(token)
    assert(match, `${label} engines.node=${range} 使用未支持的语法；请先更新 runner，不能跳过 Node 校验`)
    const cmp = compare([Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)])
    const partialUpper = [Number(match[2]) + (match[3] === undefined ? 1 : 0), match[3] === undefined ? 0 : Number(match[3]) + 1, 0]
    switch (match[1] ?? '=') {
      case '>=': return cmp >= 0
      case '<=': return match[4] === undefined ? compare(partialUpper) < 0 : cmp <= 0
      case '>': return match[4] === undefined ? compare(partialUpper) >= 0 : cmp > 0
      case '<': return cmp < 0
      default: return version[0] === Number(match[2]) && (match[3] === undefined || version[1] === Number(match[3])) && (match[4] === undefined || version[2] === Number(match[4]))
    }
  }).every(Boolean))
  assert(groups.some(Boolean), `当前 Node ${process.version} 不满足 ${label} engines.node=${range}；请显式用合适的 Node 重新执行`)
}
const requiredPackages = [
  'dsh-agent', 'dsh-agent-loop', 'dsh-agent-default-model', 'dsh-agent-preset-registry',
  'dsh-api-session-controller', 'dsh-app-boot', 'dsh-session', 'dsh-session-projection',
  'dsh-session-query', 'dsh-session-persistence-jsonl', 'dsh-session-format-catalog',
  'dsh-system-prompt', 'dsh-tools', 'dsh-tool-executor-native', 'dsh-llm', 'dsh-jobs-local', 'dsh-tool-jobs',
].map(name => `@deepseek-ai/${name}`)
function freezeCandidate(opt) {
  const root = opt.hostRoot
  assert(realpathSync(git(root, ['rev-parse', '--show-toplevel'])) === root, 'host-root 必须是候选 Git 根目录')
  const head = git(root, ['rev-parse', 'HEAD'])
  assert(head === opt.commit, `候选 SHA 不符：实际 ${head}，期望 ${opt.commit}`)
  assert(git(root, ['status', '--porcelain=v1', '--untracked-files=all']) === '', '候选 Git 不干净（含未跟踪源码）；拒绝运行')
  const rootPkg = json(join(root, 'package.json'))
  const cliPkg = json(join(root, 'apps/cli/package.json'))
  assert(rootPkg.version === opt.version && cliPkg.version === opt.version, `候选 root/CLI 版本不符：${rootPkg.version}/${cliPkg.version}`)
  checkEngine(rootPkg.engines?.node, '候选 root')
  checkEngine(cliPkg.engines?.node, '候选 CLI')
  const records = []
  function file(path, required = false) {
    assert(within(root, realpathSync(path)), `构建文件越出候选：${relative(root, path)}`)
    assert(statSync(path).isFile() && (!required || statSync(path).size > 0), `构建文件缺失或为空：${relative(root, path)}`)
    records.push({ path: relative(root, path), sha256: sha(readFileSync(path)) })
  }
  function tree(directory) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      assert(!lstatSync(path).isSymbolicLink(), `构建目录含 symlink，需显式审计：${relative(root, path)}`)
      if (statSync(path).isDirectory()) tree(path)
      else file(path)
    }
  }
  const directories = [join(root, 'apps/cli')]
  for (const group of readdirSync(join(root, 'packages'), { withFileTypes: true }).filter(item => item.isDirectory())) {
    for (const entry of readdirSync(join(root, 'packages', group.name), { withFileTypes: true }).filter(item => item.isDirectory())) directories.push(join(root, 'packages', group.name, entry.name))
  }
  for (const entry of readdirSync(join(root, 'vendor'), { withFileTypes: true }).filter(item => item.isDirectory())) directories.push(join(root, 'vendor', entry.name))
  const nativePackages = join(root, 'native/system/packages')
  if (existsSync(nativePackages)) {
    for (const entry of readdirSync(nativePackages, { withFileTypes: true }).filter(item => item.isDirectory())) directories.push(join(nativePackages, entry.name))
  }
  const packages = new Map()
  for (const directory of directories.sort()) {
    const manifest = join(directory, 'package.json')
    if (!existsSync(manifest)) continue
    const pkg = json(manifest)
    packages.set(pkg.name, { directory, pkg })
    file(manifest)
    if (existsSync(join(directory, 'lib'))) tree(join(directory, 'lib'))
    if (within(nativePackages, directory) && existsSync(join(directory, 'bin'))) tree(join(directory, 'bin'))
  }
  for (const name of requiredPackages) {
    const entry = packages.get(name)
    assert(entry, `缺少官方包 ${name}`)
    assert(entry.pkg.version === opt.version, `官方包 ${name} 版本不符：${entry.pkg.version}`)
    file(join(entry.directory, 'lib/index.js'), true)
  }
  file(join(root, 'native/system/packages/entry/lib/flock.js'), true)
  file(join(root, 'package.json'))
  file(join(root, 'pnpm-lock.yaml'))
  file(join(root, 'apps/cli/lib/bin.js'), true)
  const buildRecordPath = join(root, '.dsh-build/client-build-environment.json')
  const buildRecord = json(buildRecordPath)
  assert(buildRecord.formatVersion === 1
    && buildRecord.environment?.DSH_CLIENT_BUILD_PROFILE === 'official'
    && buildRecord.environment?.DSH_CLIENT_COMMIT_HASH === head.slice(0, 7)
    && buildRecord.environment?.DSH_CLIENT_VERSION === opt.version, '官方构建记录的 profile/SHA/version 不符；不能把旧构建冒充候选')
  tree(join(root, 'apps/web/dist'))
  const clientPaths = [...new Set(records.map(record => record.path))].filter(path =>
    path.startsWith('apps/web/dist/') || (/^packages\/[^/]+\/[^/]+\/lib\/(?:client(?:\..+)?\.js(?:\.map)?|assets\/.+)$/.test(path) && !path.includes('/lib/client.node')),
  ).sort()
  const clientHash = createHash('sha256')
  for (const path of clientPaths) {
    const bytes = readFileSync(join(root, path))
    clientHash.update(`${Buffer.byteLength(path)}:`).update(path).update(`${bytes.length}:`).update(bytes)
  }
  assert(clientPaths.length > 0 && buildRecord.artifacts?.fileCount === clientPaths.length
    && buildRecord.artifacts?.sha256 === clientHash.digest('hex'), '官方构建记录与实际客户端产物不符')
  file(buildRecordPath, true)
  records.sort((a, b) => a.path.localeCompare(b.path))
  return { root, head, clean: true, version: opt.version, engines: { root: rootPkg.engines.node, cli: cliPkg.engines.node }, clientBuild: buildRecord, buildSha256: sha(JSON.stringify(records)), files: records }
}
function noGitAncestor(directory) {
  for (let current = directory; ; current = dirname(current)) {
    assert(!existsSync(join(current, '.git')), `unit/host TMPDIR 有 .git 祖先：${current}；使用 --unit-tmp-dir 指向无项目标记目录`)
    if (dirname(current) === current) break
  }
}
function privateReport(opt) {
  const parent = realpathSync(dirname(opt.reportDir))
  const target = join(parent, relative(dirname(opt.reportDir), opt.reportDir))
  assert(!existsSync(target), 'report-dir 已存在；请使用新的运行目录，保留旧证据')
  assert(!within(opt.hostRoot, target), 'report-dir 不得写入官方候选')
  for (const home of [process.env.DSH_HOME, join(process.env.HOME || '', '.dsh')].filter(Boolean)) {
    const liveHome = resolve(home)
    assert(!within(liveHome, target) && !(existsSync(liveHome) && within(realpathSync(liveHome), target)), 'report-dir 不得位于 live DSH_HOME')
  }
  if (within(pluginRoot, target)) {
    assert(git(pluginRoot, ['check-ignore', '--', target]), '插件树内 report-dir 必须位于 Git 忽略的私有目录')
  } else {
    let ancestor = parent
    while (!existsSync(join(ancestor, '.git')) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor)
    if (existsSync(join(ancestor, '.git'))) assert(git(ancestor, ['check-ignore', '--', target]), 'report-dir 必须为 Git 忽略路径')
  }
  mkdirSync(target, { mode: 0o700 })
  return target
}
function sourceSnapshot() {
  const files = [...new Set(git(pluginRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort()
  const entries = files.filter(path => !path.startsWith('node_modules/')).map(path => {
    const absolute = join(pluginRoot, path)
    return { path, sha256: existsSync(absolute) && statSync(absolute).isFile() ? sha(readFileSync(absolute)) : null }
  })
  return { head: git(pluginRoot, ['rev-parse', 'HEAD']), status: git(pluginRoot, ['status', '--porcelain=v1']), sourceSha256: sha(JSON.stringify(entries)) }
}
function commandFor(phase) {
  const vitest = ['node_modules/vitest/vitest.mjs', 'run', '--configLoader', 'runner', '--no-cache']
  if (phase === 'session' || phase === 'jobs') return [...vitest, '--config', `tests/official-${phase}.config.ts`]
  if (phase === 'unit' || phase === 'host') return [...vitest, '--project', phase]
  if (phase === 'node') return ['--test', 'tests/a2d2-v3-121-acceptance.test.mjs', 'tests/a2d2-v3-121-run.test.mjs']
  return ['--run', phase === 'repository' ? 'verify:repository' : phase]
}
async function runStage(phase, opt, report, environment) {
  const args = commandFor(phase)
  const log = join(opt.reportDir, `${phase}.log`)
  const fd = openSync(log, 'wx', 0o600)
  const stage = { id: phase, command: [process.execPath, ...args], cwd: pluginRoot, log, startedAt: new Date().toISOString(), provenance: report.provenanceId }
  const start = performance.now()
  console.log(`RUN ${phase}`)
  try {
    const outcome = await new Promise(resolveResult => {
      const child = spawn(process.execPath, args, { cwd: pluginRoot, env: environment, stdio: ['ignore', fd, fd] })
      child.once('error', error => resolveResult({ exit: null, signal: null, error: error.message }))
      child.once('exit', (exit, signal) => resolveResult({ exit, signal }))
    })
    Object.assign(stage, outcome, { status: outcome.exit === 0 ? 'passed' : 'failed' })
  } finally {
    closeSync(fd)
    stage.durationMs = Math.round(performance.now() - start)
    stage.finishedAt = new Date().toISOString()
  }
  console.log(`${stage.status === 'passed' ? 'PASS' : 'FAIL'} ${phase} exit=${stage.exit} ${stage.durationMs}ms`)
  return stage
}
async function main() {
  const opt = options(process.argv.slice(2))
  if (!opt) return
  if (opt.selected.includes('build') && existsSync(join(pluginRoot, 'lib'))) {
    assert(realpathSync(join(pluginRoot, 'lib')) === join(pluginRoot, 'lib'), 'build 清理目标 lib 不得为 symlink 或越出插件树')
  }
  const candidate = freezeCandidate(opt)
  for (const path of ['node_modules/vitest/vitest.mjs', 'tests/official-session.config.ts', 'tests/official-jobs.config.ts']) assert(existsSync(join(pluginRoot, path)), `缺少本地工具或 fixture：${path}；runner 不安装依赖`)
  const useUnitTmp = opt.selected.some(phase => phase === 'unit' || phase === 'host')
  const unitParent = useUnitTmp ? realpathSync(opt.unitTmpDir || tmpdir()) : null
  if (unitParent) noGitAncestor(unitParent)
  const fixtureTmp = join(pluginRoot, '.local/tmp')
  for (const path of [join(pluginRoot, '.local'), fixtureTmp]) {
    try { assert(lstatSync(path).isDirectory() && realpathSync(path) === path, '官方 fixture TMPDIR 及其 .local 父目录不得为 symlink') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const source = sourceSnapshot()
  opt.reportDir = privateReport(opt)
  mkdirSync(fixtureTmp, { recursive: true, mode: 0o700 })
  assert(realpathSync(fixtureTmp) === fixtureTmp, '官方 fixture TMPDIR 不得为 symlink')
  const unitTmp = unitParent ? mkdtempSync(join(unitParent, 'dsh-upgrade-unit-')) : null
  const environment = {
    ...process.env, PATH: `${dirname(process.execPath)}${sep === '/' ? ':' : ';'}${process.env.PATH || ''}`,
    TMPDIR: fixtureTmp, TMP: fixtureTmp, TEMP: fixtureTmp,
    DSH_OFFICIAL_HOST_ROOT: candidate.root, DSH_OFFICIAL_HOST_COMMIT: candidate.head, DSH_OFFICIAL_HOST_VERSION: candidate.version,
  }
  const isolatedHome = join(opt.reportDir, 'isolated-home')
  Object.assign(environment, {
    DSH_HOME: isolatedHome, HOME: isolatedHome, USERPROFILE: isolatedHome,
    XDG_CONFIG_HOME: join(isolatedHome, 'config'), XDG_STATE_HOME: join(isolatedHome, 'state'),
    XDG_CACHE_HOME: join(isolatedHome, 'cache'),
  })
  const report = {
    schemaVersion: 1, status: 'running', scope: 'offline-plugin-upgrade-tests', guiAcceptance: 'not-run', profileMigrationAcceptance: 'not-run',
    startedAt: new Date().toISOString(), selectedPhases: opt.selected,
    provenance: { candidate, plugin: source, node: { execPath: process.execPath, version: process.version }, fixtureTmp, unitTmp },
    provenanceId: sha(JSON.stringify({ candidate, source, node: process.execPath, version: process.version })), stages: [],
  }
  const save = () => writeFileSync(join(opt.reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  save()
  try {
    for (const phase of opt.selected) {
      const env = (phase === 'unit' || phase === 'host') ? { ...environment, TMPDIR: unitTmp, TMP: unitTmp, TEMP: unitTmp } : environment
      report.stages.push(await runStage(phase, opt, report, env))
      save()
      if (report.stages.at(-1).status === 'failed') break
    }
    const after = freezeCandidate(opt)
    assert(after.buildSha256 === candidate.buildSha256, '测试期间候选构建摘要改变，结果无效')
    assert(sourceSnapshot().sourceSha256 === source.sourceSha256, '测试期间插件源码改变，结果无效；冻结新源码后重跑所需阶段')
    report.freezeRechecked = true
    report.status = report.stages.length === opt.selected.length && report.stages.every(stage => stage.status === 'passed') ? 'passed' : 'failed'
  } catch (error) {
    report.status = 'failed'
    report.error = error.message
  } finally {
    report.finishedAt = new Date().toISOString()
    save()
  }
  console.log(`离线 ${report.status.toUpperCase()}；报告 ${join(opt.reportDir, 'report.json')}；GUI/profile 验收未运行`)
  if (report.status !== 'passed') process.exitCode = 1
}
main().catch(error => { console.error(`PRECHECK/runner FAIL: ${error.message}`); process.exitCode = 1 })
