import { registerHooks } from 'node:module'
import { appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
const evidence = join(dirname(process.env.DSH_HOME), 'evidence/check-probe.jsonl')
const record = value => appendFileSync(evidence, JSON.stringify(value)+'\n',{mode:0o600})
globalThis[Symbol.for('a2d2.admission.record')] = record
registerHooks({load(url, context, nextLoad) {
 const result = nextLoad(url, context)
 if (url.endsWith('/dsh-a2d2/lib/work-plugin.js')) {
  const original = String(result.source)
  const instrumentation = `\nconst __admissionRecord = globalThis[Symbol.for('a2d2.admission.record')];
const __admissionCheck = DshWorkExecutionHost.prototype.check;
DshWorkExecutionHost.prototype.check = async function(request) {
  try { const result = await __admissionCheck.call(this, request); __admissionRecord({kind:'check-returned', request}); return result; }
  catch(error) { __admissionRecord({kind:'check-threw', request, error:{name:error.name,message:error.message,stack:error.stack}}); throw error; }
};\n`
  record({kind:'public-check-instrumentation',url,originalSHA:createHash('sha256').update(original).digest('hex'),instrumentationSHA:createHash('sha256').update(instrumentation).digest('hex')})
  return {...result,source:original+instrumentation}
 }
 return result
}})
