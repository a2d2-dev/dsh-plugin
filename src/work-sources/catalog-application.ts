import type { WorkResult } from '../work-types.ts'
import type { SourceTransaction } from './application.ts'
import type { GitHubSourcePort } from './types.ts'
import { SourceError } from './errors.ts'
import { catalogSchema } from './catalog-schema.ts'

export async function refreshCatalog(transaction: SourceTransaction, query: { projectId: string; sourceId: string }, port?: GitHubSourcePort): Promise<WorkResult> {
  const reservation = await transaction(async state => {
    const source = state.sources.find(item => item.projectId === query.projectId && item.id === query.sourceId)
    if (!source) return { error: { status: 'failed' as const, error: { code: 'unknown-source', message: 'Source does not belong to this project' } } }
    if (!source.enabled || !port?.catalog) return { error: { status: 'failed' as const, source, ...(source.catalog ? { catalog: source.catalog } : {}), error: { code: !source.enabled ? 'source-disabled' : 'github-capability-unavailable', message: !source.enabled ? '来源已停用' : '宿主未提供真实目录读取能力' } } }
    source.sequence++; source.requests.catalog = source.sequence
    return { source: structuredClone(source), sequence: source.sequence }
  })
  if ('error' in reservation) return reservation.error!
  const { source: reserved, sequence } = reservation
  let catalog: ReturnType<typeof catalogSchema.parse> | undefined, failure: { code: string; message: string } | undefined
  try { catalog = catalogSchema.parse(await port!.catalog!(reserved)) }
  catch (error) { failure = error instanceof SourceError ? { code: error.code, message: error.message } : { code: 'github-invalid-response', message: 'GitHub 未返回可用目录' } }
  return transaction(async state => {
    const source = state.sources.find(item => item.id === reserved.id && item.projectId === reserved.projectId)!
    const previous = source.catalog ? { catalog: source.catalog } : {}
    if (!source.enabled || source.version !== reserved.version || source.requests.catalog !== sequence) return { status: 'conflict', source, ...previous, error: { code: 'source-observation-superseded', message: '旧来源目录响应已丢弃' } }
    if (failure) { source.catalogError = failure; return { status: 'failed', source, ...previous, error: failure } }
    source.catalog = catalog!; if(catalog!.identity)source.identity=catalog!.identity; delete source.catalogError
    return { status: 'completed', source, catalog: source.catalog }
  })
}
