import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { GitHubSource } from '../lib/work-sources.js'
import { WorkApplication } from '../lib/work.js'
const exec = promisify(execFile)
const firstQuery = `query { viewer { login } organization(login:"a2d2-dev") { projectV2(number:1) { id title url public closed viewerCanUpdate items(first:1) { totalCount pageInfo { hasNextPage endCursor } nodes { id type content { __typename ... on Issue { id number title body state updatedAt url assignees(first:20) { nodes { login } } labels(first:20) { nodes { name } } repository { id nameWithOwner viewerPermission } } } } } views(first:20) { totalCount pageInfo { hasNextPage endCursor } nodes { id name layout filter } } fields(first:20) { totalCount pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2FieldCommon { id name dataType } } } } } }`
async function graphql(query, cursor) {
  const args = ['api', '--hostname', 'github.com', 'graphql', '-f', `query=${query}`]
  if (cursor) args.push('-f', `cursor=${cursor}`)
  const { stdout } = await exec('gh', args, { timeout: 20_000, maxBuffer: 2_000_000, env: process.env })
  const parsed = JSON.parse(stdout)
  assert.equal(parsed.errors, undefined, 'GitHub GraphQL returned errors')
  return parsed.data
}
function complete(result) { assert.equal(result.status, 'completed', JSON.stringify(result.error)); return result }
const initial = await graphql(firstQuery)
const project = initial.organization.projectV2
assert.equal(project.url, 'https://github.com/orgs/a2d2-dev/projects/1')
const cursor = project.items.pageInfo.endCursor
const after = await graphql('query($cursor:String!) { organization(login:"a2d2-dev") { projectV2(number:1) { items(first:1,after:$cursor) { totalCount pageInfo { hasNextPage endCursor } nodes { id type } } } } }', cursor)
const content = project.items.nodes.find(item => item.content?.__typename === 'Issue')?.content
assert.ok(content, 'Actual Project 1 must supply an Issue source for this smoke; no demo substitution')
const [owner, repository] = content.repository.nameWithOwner.split('/')
const sourcePort = new GitHubSource()
const first = await sourcePort.list({ owner, repository }, { page: 1, perPage: 1, assignee: '@me', state: 'all' })
const second = await sourcePort.list({ owner, repository }, { page: 2, perPage: 1, assignee: '@me', state: 'all' })
assert.equal(first.identity.login, initial.viewer.login)
assert.equal(second.identity.nodeId, first.identity.nodeId)
assert.equal(first.nextPage, 2, 'Real repository must demonstrate a second requestable page')
const detail = await sourcePort.detail({ owner, repository }, content.number)
assert.equal(detail.issue.nodeId, content.id)
assert.equal(detail.issue.body, content.body)
const directory = await mkdtemp(join(tmpdir(), 'a2d2-source-smoke-'))
let local
try {
  const app = new WorkApplication(directory, { resources: async () => [], sessions: async () => [] }, sourcePort)
  const actor = { operator: true }
  const domainProject = complete(await app.execute({ type: 'project.create', commandId: 'project', name: 'Isolated source smoke' }, actor)).project
  const source = complete(await app.execute({ type: 'source.configure', commandId: 'source', projectId: domainProject.id, repository: { owner, repository } }, actor)).source
  complete(await app.query({ type: 'source.issue', projectId: domainProject.id, sourceId: source.id, number: content.number, refresh: true }, actor))
  const imported = complete(await app.execute({ type: 'source.import', commandId: 'import', projectId: domainProject.id, sourceId: source.id, nodeId: content.id }, actor))
  const offline = new WorkApplication(directory, { resources: async () => [], sessions: async () => [] })
  const reread = complete(await offline.query({ type: 'task.detail', ref: imported.ref }, actor))
  assert.equal(reread.task.specification.text, content.body)
  assert.equal(reread.task.id, imported.task.id)
  local = { import: 'passed', offlineReread: 'passed', acceptedBodyBytes: Buffer.byteLength(reread.task.specification.text), structuredAcceptance: 'pending-review', noExecution: true }
} finally {
  assert.ok(resolve(directory).startsWith(join(tmpdir(), 'a2d2-source-smoke-')), 'Refuse unexpected cleanup path')
  await rm(directory, { recursive: true, force: true })
}
const { items, ...metadata } = project
console.log(JSON.stringify({ observedAt: new Date().toISOString(), mode: 'read-only remote; isolated temporary local records', identity: first.identity,
  target: metadata, projectPagination: [{ request: { first: 1 }, totalCount: items.totalCount, pageInfo: items.pageInfo, nodes: items.nodes.map(item => ({ id: item.id, type: item.type, content: item.content && { nodeId: item.content.id, number: item.content.number, repository: item.content.repository } })) }, { request: { first: 1, after: cursor }, ...after.organization.projectV2.items }],
  repositoryPages: [first, second].map((page, index) => ({ page: index + 1, perPage: 1, assignee: '@me', identity: page.identity, nextPage: page.nextPage, issues: page.items.map(issue => ({ nodeId: issue.nodeId, number: issue.number, url: issue.url })) })),
  detail: { nodeId: detail.issue.nodeId, number: detail.issue.number, title: detail.issue.title, state: detail.issue.state, assignees: detail.issue.assignees, labels: detail.issue.labels, updatedAt: detail.issue.updatedAt, bodyBytes: Buffer.byteLength(detail.issue.body ?? ''), bodySha256: createHash('sha256').update(detail.issue.body ?? '').digest('hex'), matchedProjectContent: true }, local,
  limits: ['Project view metadata was probed through gh GraphQL; Project view application/UI is not implemented', 'No remote writes, task execution, deployment, browser or 18782 acceptance'] }, null, 2))
