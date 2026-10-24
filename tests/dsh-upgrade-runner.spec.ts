import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts/verify-dsh-upgrade.mjs')
const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) {
    // Only delete the exact mkdtemp directory created by this test.
    if (realpathSync(path) !== path || !path.startsWith(resolve(tmpdir()) + '/upgrade-runner-')) throw Error('Unexpected cleanup path')
    rmSync(path, { recursive: true, force: true })
  }
})
function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function fixture(engine = '>=22') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'upgrade-runner-')))
  temporary.push(directory)
  const host = join(directory, 'candidate')
  mkdirSync(join(host, 'apps/cli'), { recursive: true })
  mkdirSync(join(host, 'packages'))
  mkdirSync(join(host, 'vendor'))
  const manifest = JSON.stringify({ name: 'test-only-unbuilt-candidate', version: '0.2.1-rc.3', engines: { node: engine } })
  writeFileSync(join(host, 'package.json'), manifest)
  writeFileSync(join(host, 'apps/cli/package.json'), manifest)
  git(host, 'init', '--quiet')
  git(host, 'add', '.')
  git(host, '-c', 'user.name=Upgrade Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'test candidate')
  const liveHome = join(directory, 'live-home')
  mkdirSync(liveHome)
  writeFileSync(join(liveHome, 'signed-cookie'), 'test sentinel; never modify')
  writeFileSync(join(liveHome, 'session.jsonl'), 'test sentinel; never restore or migrate')
  const bin = join(directory, 'trap-bin')
  mkdirSync(bin)
  const serviceMarker = join(directory, 'forbidden-command')
  // Public contract: even when PATH offers service/install commands, preflight
  // rejection must not invoke any of them or execute a candidate CLI.
  for (const name of ['dsh', 'npm', 'pnpm', 'supervisorctl']) {
    writeFileSync(join(bin, name), '#!/bin/sh\nprintf forbidden > "$UPGRADE_TEST_MARKER"\nexit 91\n', { mode: 0o700 })
  }
  return { directory, host, liveHome, bin, serviceMarker, head: git(host, 'rev-parse', 'HEAD'), report: join(directory, 'report') }
}
function digest(directory: string): string {
  const hash = createHash('sha256')
  const visit = (path: string) => {
    for (const name of readdirSync(path).sort()) {
      if (name === '.git') continue
      const file = join(path, name)
      hash.update(file)
      if (statSync(file).isDirectory()) visit(file)
      else hash.update(readFileSync(file))
    }
  }
  visit(directory)
  return hash.digest('hex')
}
function rejected(f: ReturnType<typeof fixture>, overrides: string[], reason: RegExp) {
  const before = { host: digest(f.host), live: digest(f.liveHome), status: git(f.host, 'status', '--porcelain=v1', '--untracked-files=all') }
  const result = spawnSync(process.execPath, [script,
    '--host-root', f.host, '--expected-commit', f.head,
    '--expected-version', '0.2.1-rc.3', '--report-dir', f.report, ...overrides,
  ], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, DSH_HOME: f.liveHome, PATH: `${f.bin}:${process.env.PATH}`, UPGRADE_TEST_MARKER: f.serviceMarker },
  })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stderr).toMatch(reason)
  expect(existsSync(f.report)).toBe(false)
  expect(existsSync(f.serviceMarker)).toBe(false)
  expect(digest(f.host)).toBe(before.host)
  expect(digest(f.liveHome)).toBe(before.live)
  expect(git(f.host, 'status', '--porcelain=v1', '--untracked-files=all')).toBe(before.status)
}

it('rejects a different commit despite the same manifest version, without touching candidate/live data or starting services', () => {
  const f = fixture()
  const head = f.head === '0'.repeat(40) ? '1'.repeat(40) : '0'.repeat(40)
  // Change the expected SHA rather than add a duplicate CLI option.
  f.head = head
  rejected(f, [], /候选 SHA 不符/)
})
it('rejects untracked candidate changes before tests or output writes', () => {
  const f = fixture()
  writeFileSync(join(f.host, 'untracked-source.txt'), 'dirty candidate')
  rejected(f, [], /候选 Git 不干净/)
})
it('rejects the current Node when the candidate requires a newer engine instead of switching executables', () => {
  rejected(fixture('>=999.0.0'), [], /当前 Node .*不满足/)
})
it('rejects a clean versioned but unbuilt checkout without launching a candidate CLI', () => {
  rejected(fixture(), [], /缺少官方包|ENOENT/)
})
it('rejects unknown phases without executing install, switch or restore operations', () => {
  rejected(fixture(), ['--phase', 'install'], /未知阶段 install/)
})
