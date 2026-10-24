import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const tool = fileURLToPath(new URL('../scripts/a2d2-v3-121/acceptance.mjs', import.meta.url))
const checkout = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const load = async path => JSON.parse(await readFile(path, 'utf8'))
const save = (path, value) => writeFile(path, JSON.stringify(value), { mode: 0o600 })

// This is a real loopback HTTP CLI fixture, not a DSH product acceptance server.
// All subprocesses, directories and listeners belong exclusively to this test.
async function fixture(t) {
  const handles = []
  let root
  let exact
  t.after(async () => {
    for (const handle of handles.reverse()) await handle.stop()
    if (root) {
      assert.equal(root, exact)
      assert.equal(dirname(root), '/tmp/a2d2-v3-121')
      assert.ok(basename(root).startsWith('run-regression-'))
      assert.equal(await realpath(root), exact, 'refuse cleanup of a replaced fixture')
      await rm(exact, { recursive: true, force: true })
    }
  })
  assert.equal(await realpath('/tmp'), '/tmp')
  const namespace = '/tmp/a2d2-v3-121'
  try { assert.equal(await realpath(namespace), namespace) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(namespace, { mode: 0o700 })
  }
  assert.equal(await realpath(namespace), namespace)
  root = await mkdtemp(join(namespace, 'run-regression-'))
  exact = resolve(root)
  for (const name of ['logs', 'workspace', 'evidence', 'home', 'config', 'state', 'browser-profile']) await mkdir(join(root, name))
  const cli = join(root, 'fixture-cli.mjs')
  await writeFile(cli, `
    import { createServer } from 'node:http';
    import { appendFileSync, readFileSync, existsSync } from 'node:fs';
    import { join, dirname } from 'node:path';
    import { fileURLToPath } from 'node:url';
    const root = dirname(fileURLToPath(import.meta.url));
    const requestedPort = Number(process.argv[process.argv.indexOf('--port') + 1]);
    const mode = existsSync(join(root, 'fixture-mode')) ? readFileSync(join(root, 'fixture-mode'), 'utf8') : '';
    appendFileSync(join(root, 'evidence/spawns.jsonl'), JSON.stringify({pid: process.pid, root, requestedPort, cwd: process.cwd(), home: process.env.DSH_HOME}) + '\\n');
    const server = createServer((_request, response) => response.end('test-owned loopback fixture'));
    server.on('error', error => { console.error(error.code); process.exitCode = 1; });
    const reserved = mode === 'wrong-origin' ? createServer() : null;
    const listen = () => server.listen({ host: '127.0.0.1', port: reserved ? 0 : requestedPort, exclusive: true }, () => {
      const port = server.address().port;
      appendFileSync(join(root, 'evidence/metrics.jsonl'), JSON.stringify({pid: process.pid, kind: 'fixture-listening', port}) + '\\n');
      console.log('dsh web: http://127.0.0.1:' + port + '/?token=fixture-private-' + process.pid);
    });
    if (reserved) reserved.listen({ host: '127.0.0.1', port: requestedPort, exclusive: true }, listen);
    else listen();
    process.on('SIGTERM', () => { reserved?.close(); server.close(() => process.exit(0)); });
  `)
  const head = spawnSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  assert.equal(head.status, 0, head.stderr)
  await save(join(root, 'manifest.json'), { root, host: checkout, hostCommit: head.stdout.trim(), cli, cliVersion: 'loopback-fixture', plugin: null })
  await writeFile(join(root, 'home/preserved-marker'), 'preserve home')
  await writeFile(join(root, 'browser-profile/preserved-marker'), 'preserve browser profile')
  await writeFile(join(root, 'evidence/metrics.jsonl'), '{"kind":"fixture-original"}\n')
  const records = async () => (await readFile(join(root, 'evidence/spawns.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  function start() {
    const args = [tool, 'run', '--root', root]
    const child = spawn(process.execPath, args, { cwd: checkout, stdio: ['ignore', 'pipe', 'pipe'] })
    const ownedPid = child.pid
    let stdout = '', stderr = '', pending = '', readyValue
    let readyResolve
    const ready = new Promise(resolve => { readyResolve = resolve })
    child.stdout.on('data', data => {
      stdout += data
      pending += data
      let line
      while ((line = pending.indexOf('\n')) !== -1) {
        const text = pending.slice(0, line)
        pending = pending.slice(line + 1)
        const value = JSON.parse(text)
        if (value.ready) { readyValue = value; readyResolve(value) }
      }
    })
    child.stderr.on('data', data => { stderr += data })
    const exited = once(child, 'exit').then(([code, signal]) => ({ code, signal, stdout, stderr }))
    const handle = {
      exited,
      async ready() {
        let timeout
        try {
          const value = await Promise.race([
            ready,
            exited.then(result => { throw Error(`fixture supervisor exited before ready: ${result.code}; ${result.stderr}`) }),
            new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(Error('fixture readiness timed out')), 5000) }),
          ])
          assert.ok((await records()).some(row => row.pid === value.pid && row.root === exact))
          return value
        } finally { clearTimeout(timeout) }
      },
      async stop() {
        if (child.exitCode !== null || child.signalCode !== null) return exited
        // Signal only this exact supervisor spawned with this exact fixture root.
        assert.equal(child.pid, ownedPid)
        assert.ok(Number.isSafeInteger(ownedPid) && ownedPid > 0 && ownedPid !== process.pid)
        assert.deepEqual(child.spawnargs, [process.execPath, ...args])
        assert.equal(await realpath(root), exact)
        if (readyValue) assert.ok((await records()).some(row => row.pid === readyValue.pid && row.root === exact))
        child.kill('SIGTERM')
        return exited
      },
    }
    handles.push(handle)
    return handle
  }
  return { root, start, records }
}

async function failedStartup(handle) {
  const outcome = await Promise.race([
    handle.exited.then(exit => ({ exit })),
    handle.ready().then(ready => ({ ready }), () => handle.exited.then(exit => ({ exit }))),
  ])
  if (outcome.ready) {
    await handle.stop()
    assert.fail('startup unexpectedly reported ready instead of rejecting')
  }
  assert.equal(outcome.exit.code, 1)
  return outcome.exit
}

test('unsafe saved origins are rejected before any Web spawn or log creation', async t => {
  const cases = [
    ['protected 18780', 'http://127.0.0.1:18780'], ['protected 18781', 'http://127.0.0.1:18781'],
    ['non-loopback', 'http://192.0.2.1:43123'], ['different loopback name', 'http://localhost:43123'],
    ['HTTPS', 'https://127.0.0.1:43123'], ['other protocol', 'file:///tmp/fixture'],
    ['zero port', 'http://127.0.0.1:0'], ['out-of-range port', 'http://127.0.0.1:65536'],
    ['negative port', 'http://127.0.0.1:-1'], ['non-numeric port', 'http://127.0.0.1:invalid'],
    ['missing port', 'http://127.0.0.1'], ['path', 'http://127.0.0.1:43123/extra'],
    ['credentials', 'http://user:fixture-private-record@127.0.0.1:43123'],
    ['query', 'http://127.0.0.1:43123/?token=fixture-private-record'],
    ['missing identity', undefined], ['non-string identity', 43123],
  ]
  for (const [label, baseURL] of cases) await t.test(label, async t => {
    const f = await fixture(t)
    const path = join(f.root, 'current-run.json')
    await save(path, { baseURL, runId: 'preserved' })
    const before = await readFile(path, 'utf8')
    const exit = await failedStartup(f.start())
    assert.match(exit.stderr, /recorded Web origin|Recorded Web origin/)
    assert.ok(!exit.stderr.includes('fixture-private-record'))
    assert.equal(await readFile(path, 'utf8'), before)
    assert.deepEqual(await readdir(join(f.root, 'logs')), [])
    await assert.rejects(() => readFile(join(f.root, 'evidence/spawns.jsonl')), { code: 'ENOENT' })
  })
})

test('a malformed existing run record fails rather than starting a new site', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root, 'current-run.json'), '{"baseURL":"fixture-private-record"')
  const exit = await failedStartup(f.start())
  assert.match(exit.stderr, /Cannot read current-run/)
  assert.ok(!exit.stderr.includes('fixture-private-record'))
  assert.deepEqual(await readdir(join(f.root, 'logs')), [])
  await assert.rejects(() => readFile(join(f.root, 'evidence/spawns.jsonl')), { code: 'ENOENT' })
})

test('an occupied saved port fails explicitly without changing origin or stopping its owner', async t => {
  const f = await fixture(t)
  const owner = createServer((_request, response) => response.end('test-owned occupied port'))
  await new Promise((resolve, reject) => { owner.once('error', reject); owner.listen(0, '127.0.0.1', resolve) })
  const address = owner.address()
  const baseURL = `http://127.0.0.1:${address.port}`
  try {
    await save(join(f.root, 'current-run.json'), { baseURL, runId: 'preserved', managedJobId: 'fixture-job' })
    const before = await readFile(join(f.root, 'current-run.json'), 'utf8')
    const exit = await failedStartup(f.start())
    assert.equal(await (await fetch(baseURL)).text(), 'test-owned occupied port')
    assert.match(exit.stderr, /EADDRINUSE/)
    assert.equal(await readFile(join(f.root, 'current-run.json'), 'utf8'), before)
    assert.equal(await readFile(join(f.root, 'evidence/metrics.jsonl'), 'utf8'), '{"kind":"fixture-original"}\n')
    assert.deepEqual(await readdir(join(f.root, 'logs')), [])
    await assert.rejects(() => readFile(join(f.root, 'evidence/spawns.jsonl')), { code: 'ENOENT' })
  } finally {
    assert.deepEqual(owner.address(), address, 'close only this exact listener owned by the test')
    await new Promise((resolve, reject) => owner.close(error => error ? reject(error) : resolve()))
  }
})

test('a CLI announcing a different origin is stopped without replacing the saved site record', async t => {
  const f = await fixture(t)
  const first = f.start()
  const one = await first.ready()
  assert.equal((await first.stop()).code, 0)
  const before = await readFile(join(f.root, 'current-run.json'), 'utf8')
  const login = await readFile(join(f.root, 'login-url.private'), 'utf8')
  const metrics = await readFile(join(f.root, 'evidence/metrics.jsonl'), 'utf8')
  await writeFile(join(f.root, 'fixture-mode'), 'wrong-origin')
  const exit = await failedStartup(f.start())
  assert.match(exit.stderr, /changed the saved Web origin/)
  assert.equal(await readFile(join(f.root, 'current-run.json'), 'utf8'), before)
  assert.equal(await readFile(join(f.root, 'login-url.private'), 'utf8'), login)
  assert.ok((await readFile(join(f.root, 'evidence/metrics.jsonl'), 'utf8')).startsWith(metrics))
  assert.equal((await f.records())[1].requestedPort, Number(new URL(one.baseURL).port))
})

test('same root first run uses port zero and restart listens on the same actual origin', async t => {
  const f = await fixture(t)
  const first = f.start()
  const one = await first.ready()
  assert.equal((await f.records())[0].requestedPort, 0)
  assert.equal(await (await fetch(one.baseURL)).text(), 'test-owned loopback fixture')
  assert.equal((await first.stop()).code, 0)
  const original = await load(join(f.root, 'current-run.json'))
  const second = f.start()
  const two = await second.ready()
  const spawns = await f.records()
  assert.equal(spawns[1].requestedPort, Number(new URL(one.baseURL).port), 'restart must request the first actual port, not port zero')
  assert.equal(two.baseURL, one.baseURL)
  assert.equal(await (await fetch(two.baseURL)).text(), 'test-owned loopback fixture')
  assert.equal((await second.stop()).code, 0)
  const current = await load(join(f.root, 'current-run.json'))
  assert.notEqual(current.runId, original.runId)
  assert.equal(current.baseURL, original.baseURL)
  assert.ok((await readdir(join(f.root, 'evidence'))).includes(`${original.runId}-run.json`))
  assert.ok((await readdir(join(f.root, 'evidence'))).includes(`${current.runId}-exit.json`))
  assert.equal(await readFile(join(f.root, 'home/preserved-marker'), 'utf8'), 'preserve home')
  assert.equal(await readFile(join(f.root, 'browser-profile/preserved-marker'), 'utf8'), 'preserve browser profile')
  const metrics = (await readFile(join(f.root, 'evidence/metrics.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.deepEqual(metrics.map(row => row.kind), ['fixture-original', 'fixture-listening', 'fixture-listening'])
  for (const row of spawns) {
    assert.equal(row.cwd, join(f.root, 'workspace'))
    assert.equal(row.home, join(f.root, 'home'))
  }
  assert.equal((await stat(join(f.root, 'login-url.private'))).mode & 0o777, 0o600)
  assert.ok(!(await second.exited).stdout.includes('fixture-private-'), 'public output must not expose the private login URL')
})
