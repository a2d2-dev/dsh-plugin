import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

// Offline validation only: never starts a model, Task, job or browser.
try {
  const evidence = JSON.parse(await readFile(process.argv[2]))
  const violations = []
  const check = (condition, message) => { if (!condition) violations.push(message) }
  check(['readonly', 'real-model'].includes(evidence.lane), 'explicit lane required')
  check(Array.isArray(evidence.facts) && evidence.facts.length > 0, 'observed evidence facts required')
  for (const fact of evidence.facts ?? []) {
    check(fact.status === 'observed' && fact.path && /^[a-f0-9]{64}$/.test(fact.sha256 ?? ''), 'observed fact path and SHA required')
    if (fact.path && fact.sha256) check(createHash('sha256').update(await readFile(fact.path)).digest('hex') === fact.sha256, 'evidence content changed')
  }
  const before = evidence.counts?.before, after = evidence.counts?.after
  check(evidence.counts?.instrumented === true && before?.processId && before.processId === after?.processId, 'instrumented same-process counter snapshots required')
  for (const key of ['gateway', 'adapter']) check(Number.isSafeInteger(before?.[key]) && Number.isSafeInteger(after?.[key]) && after[key] >= before[key], `missing/nonmonotonic ${key} counter`)
  if (evidence.lane === 'readonly') check(before?.gateway === after?.gateway && before?.adapter === after?.adapter, 'readonly lane attempted inference')
  if (evidence.lane === 'real-model') {
    const auth = evidence.authorization, request = evidence.actualRequest
    check(auth?.source === 'direct-human-real-model-authorization' && auth.requestRef && auth.maxGateway > 0 && auth.maxAdapter > 0, 'separate bounded real-model authorization required')
    check(evidence.guardDisabledAdapter === false, 'disabled v3 adapter cannot prove real inference')
    check(after?.gateway > before?.gateway && after?.adapter > before?.adapter, 'real gateway and adapter calls required')
    check(after?.gateway-before?.gateway <= auth?.maxGateway && after?.adapter-before?.adapter <= auth?.maxAdapter, 'model-call authorization budget exceeded')
    check(request?.provider && request.provider !== 'acceptance-disabled' && request.model && request.sessionId && request.responseEvidence, 'actual request route and persisted response required')
    check(auth?.sessionIds?.includes(request?.sessionId), 'request owner outside authorized dedicated Sessions')
  }
  console.log(JSON.stringify({ ok: violations.length === 0, lane: evidence.lane, violations, ticketAcceptance: 'not implied by schema validation' }, null, 2))
  process.exitCode = violations.length ? 1 : 0
} catch (error) { console.error(error.message); process.exitCode = 1 }
