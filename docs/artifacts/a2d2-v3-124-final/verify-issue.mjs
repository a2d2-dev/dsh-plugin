import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const out = new URL('./', import.meta.url)
const root = '/data/_dsh-dev/previews/a2d2-v3-121'
const env = { PATH: '/root/.nvm/versions/node/v22.23.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', DSH_HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_STATE_HOME: `${root}/state`, DSH_TELEMETRY_DISABLED: '1', DSH_WEB_PASSWORD_FILE: '/data/_dsh-dev/web-password', GH_CONFIG_DIR: '/root/.config/gh' }
if (process.env.HOME !== undefined) env.HOME = process.env.HOME
const gh = spawnSync('gh', ['api', '--method', 'GET', 'repos/a2d2-dev/dsh-plugin/issues/112', '--jq', '{number,nodeId:.node_id,url:.html_url,title,body,updatedAt:.updated_at,state,assignees:[.assignees[].login]}'], { env, encoding: 'utf8' })
assert.equal(gh.status, 0, 'Read-only GitHub issue request failed; raw error excluded')
const issue = JSON.parse(gh.stdout)
const browser = spawnSync('agent-browser', ['--session', 'a2d2-http132', 'eval', '--stdin'], { encoding: 'utf8', input: '({body:[...document.querySelectorAll("main h3")].find(e=>e.textContent==="完整原文")?.nextElementSibling?.textContent,url:document.querySelector("main a")?.href})' })
assert.equal(browser.status, 0)
const visible = JSON.parse(browser.stdout)
const hash = text => createHash('sha256').update(text).digest('hex')
const result = { observedAt: new Date().toISOString(), ghMethod: 'GET', ghExitCode: gh.status, issue, browser: { bodyBytes: Buffer.byteLength(visible.body ?? ''), bodySha256: hash(visible.body ?? ''), url: visible.url }, reference: { bodyBytes: Buffer.byteLength(issue.body), bodySha256: hash(issue.body) }, exactBodyEquality: visible.body === issue.body, exactCanonicalUrlEquality: visible.url === issue.url }
await writeFile(new URL('issue112-current-body-verification.json', out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
assert.equal(result.exactBodyEquality, true)
assert.equal(result.exactCanonicalUrlEquality, true)
console.log(JSON.stringify({ number: issue.number, nodeId: issue.nodeId, state: issue.state, reference: result.reference, exactBodyEquality: true, exactCanonicalUrlEquality: true }))
