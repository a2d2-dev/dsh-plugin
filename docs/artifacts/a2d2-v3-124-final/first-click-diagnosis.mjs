import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const out = new URL('./', import.meta.url)
const actions = (await readFile(new URL('browser-actions.jsonl', out), 'utf8')).trim().split('\n').map(JSON.parse)
const firstClick = actions.find(row => row.args.join(' ') === 'click @e28')
const scroll = actions.find(row => row.args.join(' ') === 'scrollintoview button[type=submit]')
const retry = actions.find(row => row.args.join(' ') === 'find role button click --name 保存并读取来源')
const dom = JSON.parse(actions.find(row => row.args[0] === 'eval' && row.args[1].startsWith('({forms:')).output)
const probe = spawnSync('agent-browser', ['--session', 'a2d2-http132', 'eval', '--stdin'], { encoding: 'utf8', input: '({timeOrigin:performance.timeOrigin,viewport:{width:innerWidth,height:innerHeight},resourceEntries:performance.getEntriesByType("resource").length,workRequests:performance.getEntriesByType("resource").filter(e=>new URL(e.name).pathname==="/a2d2/api/work").map(e=>({startedAt:new Date(performance.timeOrigin+e.startTime).toISOString(),duration:e.duration,responseStatus:e.responseStatus}))})' })
assert.equal(probe.status, 0)
const timeline = JSON.parse(probe.stdout)
const inWindow = timeline.workRequests.filter(row => Date.parse(row.startedAt) >= Date.parse(firstClick.time) - 1000 && Date.parse(row.startedAt) < Date.parse(scroll.time))
const result = { observedAt: new Date().toISOString(), firstClick, scroll, retry, originalDom: dom, timeline, workRequestsBetweenFirstClickAndRetryScroll: inWindow, requestTraceSource: 'native Resource Timing; no fetch/XHR overrides, page has not reloaded', conclusion: 'First offscreen tool click did not trigger a work request; source.configure and source.issues only began at the scrolled retry. No evidence of successful configure followed by failed UI transition.', screenshot: '02a-configure-no-transition.png' }
assert.equal(inWindow.length, 0)
assert.ok(timeline.workRequests.some(row => Math.abs(Date.parse(row.startedAt) - Date.parse(retry.time)) < 100))
await writeFile(new URL('first-configure-click-diagnosis.json', out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ firstClick: firstClick.time, retry: retry.time, requestsBetween: inWindow.length, viewport: timeline.viewport, originalButtonRect: dom.forms[0].buttons[0].rect, conclusion: result.conclusion }))
