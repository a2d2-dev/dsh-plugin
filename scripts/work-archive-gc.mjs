#!/usr/bin/env node
// Requires a built checkout/package. Stop all readers and writers before invoking.
import { WorkDao } from '../lib/work.js'
const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('Usage: node scripts/work-archive-gc.mjs --offline WORK_DIRECTORY [--apply]\nStop all readers and writers first. Default is dry run; writes a manifest before any deletion.')
} else {
  const positionals = args.filter(value => !value.startsWith('--'))
  if (!args.includes('--offline') || positionals.length !== 1 || args.some(value => value.startsWith('--') && !['--offline', '--apply'].includes(value))) {
    throw Error('Usage: node scripts/work-archive-gc.mjs --offline WORK_DIRECTORY [--apply]')
  }
  const report = await WorkDao.forDirectory(positionals[0]).collectArchives({ offline: true, dryRun: !args.includes('--apply') })
  console.log(JSON.stringify({ dryRun: report.dryRun, reachable: report.reachable.length, reachableBytes: report.reachableBytes, candidates: report.candidates.length, candidateBytes: report.candidateBytes, manifest: report.manifest }))
}
