import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
export function compareRetention(before, after, allowedAdditions = []) {
  const violations = []
  if (!before?.origin || before.origin !== after?.origin) violations.push('origin changed or missing')
  const index = snapshot => {
    if (!Array.isArray(snapshot?.records)) throw Error('records required')
    const map = new Map()
    for (const row of snapshot.records) {
      if (!row.kind || !row.id || !row.identity || !Array.isArray(row.history)) throw Error('invalid retention record')
      const key = `${row.kind}:${row.id}`
      if (map.has(key)) throw Error(`duplicate identity: ${key}`)
      map.set(key, row)
    }
    return map
  }
  const previous = index(before), current = index(after)
  for (const [key, row] of previous) {
    const next = current.get(key)
    if (!next) { violations.push(`missing: ${key}`); continue }
    if (canonical(row.identity) !== canonical(next.identity)) violations.push(`identity/config/material drift: ${key}`)
    if (canonical(row.history) !== canonical(next.history.slice(0, row.history.length))) violations.push(`history lost/rewritten: ${key}`)
  }
  for (const key of current.keys()) if (!previous.has(key) && !allowedAdditions.includes(key)) violations.push(`unapproved addition: ${key}`)
  return { ok: violations.length === 0, violations }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [before, after, allow] = process.argv.slice(2)
    const result = compareRetention(JSON.parse(await readFile(before)), JSON.parse(await readFile(after)), allow ? JSON.parse(await readFile(allow)) : [])
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
