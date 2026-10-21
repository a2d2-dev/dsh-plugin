/** Public server-only source boundary. Credential resolution stays inside the adapter. */
export { GitHubSource, SourceError } from './work-sources/github.ts'
export type * from './work-sources/types.ts'
export { reconcileProjectSources, startProjectDiscovery } from './work-sources/discovery.ts'
export type { DiscoveryOptions } from './work-sources/discovery.ts'
export type { SourceTransaction } from './work-sources/application.ts'
