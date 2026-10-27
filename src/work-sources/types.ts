/** Browser-safe observations; external text never grants host authority. */
export interface GitHubRepository { owner: string; repository: string }
export interface GitHubProjectRef { owner: string; type: 'org' | 'user'; number: number }
export interface GitHubIdentity { login: string; nodeId: string; name: string | null }
export interface GitHubIssueReference { nodeId: string; url: string; number: number; title: string; repository: GitHubRepository; state: 'open' | 'closed' }
export interface GitHubIssue {
  nodeId: string; url: string; number: number; title: string; body: string | null
  repository: GitHubRepository; assignees: string[]; labels: string[]; state: 'open' | 'closed'
  updatedAt: string; observedAt: string
  createdAt?: string; closedAt?: string | null
  /** Absent in legacy observations; null means GitHub confirmed no milestone. */
  milestone?: { number: number; title: string } | null
  parent?: GitHubIssueReference | null
  subIssues?: { items: GitHubIssueReference[]; totalCount: number; hasNextPage: boolean }
  /** Absent means unknown; only the native blocked-by API can establish availability. */
  dependencies?: { availability: 'available'; blockedBy: { items: GitHubIssueReference[]; totalCount: number; hasNextPage: boolean } }
    | { availability: 'unavailable'; code: string; message: string }
  subIssuesSummary?: { total: number; completed: number }
  linkedPullRequests?: GitHubLinkedPullRequest[]
}
export interface GitHubLinkedPullRequest { number: number; title: string; url: string; state: 'open' | 'closed' | 'merged'; draft: boolean }
export interface GitHubProjectField { id: string; name: string; type: 'single-select' | 'iteration' | 'text' | 'number' | 'date'; value: string }
export interface GitHubProjectItem {
  id: string; kind: 'issue' | 'pull-request' | 'draft' | 'restricted'; archived: boolean
  facts?: { draft?: boolean; assignees: string[]; labels: string[]; state: string; repository: GitHubRepository; body?: string | null
    reviewers?: string[]; createdAt?: string; updatedAt?: string; closedAt?: string | null }
  issueNodeId?: string; title?: string; url?: string
  fields: GitHubProjectField[]; fieldsPartial: boolean
}
export interface GitHubProjectMetadata { nodeId: string; title: string; url: string; closed: boolean }
export interface GitHubProjectPage {
  identity: GitHubIdentity; project: GitHubProjectMetadata; items: GitHubProjectItem[]; issues: GitHubIssue[]
  observedAt: string; nextCursor?: string
  /** GitHub's total item count for this Project, the denominator of a scan progress report. */
  total?: number
}
export interface ProjectPageRequest { cursor?: string; perPage: number }
export interface ProjectSnapshot { identity: GitHubIdentity; project: GitHubProjectMetadata; items: GitHubProjectItem[]; observedAt: string }
export interface ProjectCheckpoint {
  sourceVersion: number; startedAt: string; cursor?: string; pages: number
  /** GitHub's total item count for the Project being scanned, when the page reported it. */
  total?: number
  identity?: GitHubIdentity; project?: GitHubProjectMetadata; items: GitHubProjectItem[]; issues: GitHubIssue[]
}
export interface SourceDiscovery {
  state: 'idle' | 'syncing' | 'error'; nextAttemptAt: string; lastAttemptAt?: string; lastSuccessAt?: string
  failures: number; checkpoint?: ProjectCheckpoint
  /** Fences independent consumers and expires after a bounded adapter call window. */
  inFlight?: { id: string; expiresAt: string }
}
export interface IssuePageRequest { page: number; perPage: number; assignee: '@me' | '*'; state: 'open' | 'closed' | 'all'; labels?: string[]; search?: string }
export interface IssuePage { identity: GitHubIdentity; items: GitHubIssue[]; nextPage?: number; observedAt: string }
export interface IssueDetail { identity: GitHubIdentity; issue: GitHubIssue }
export interface GitHubPullRequest {
  nodeId: string; number: number; title: string; url: string; repository: GitHubRepository
  state: 'open' | 'closed' | 'merged'; draft: boolean; updatedAt: string
  issues: { number: number; url: string; title: string }[]; issuesComplete: boolean
  checks: string | null; review: string | null; membership: 'repository' | 'project' | 'issue-reference'
}
export interface SourceCatalog {
  identity?: GitHubIdentity
  observedAt: string; openIssueCount?: number; pullRequests: GitHubPullRequest[]; pullRequestsComplete: boolean
  views: { id: string; number: number; name: string; filter: string; layout: string }[]
  fields: { id: string; name: string; dataType: string; options?: { id: string; name: string; color: string }[] }[]; viewsComplete: boolean; limitations: string[]
}
export type SourceCandidate = { kind: 'project' | 'repository'; nodeId: string; title: string; url: string; entryUrl: string; identity: GitHubIdentity; repository?: GitHubRepository; githubProject?: GitHubProjectRef }
export interface GitHubSourcePort {
  account?(): Promise<GitHubAccount>
  repositories?(page: number): Promise<GitHubRepositoryPage>
  login?(action: 'start' | 'cancel'): GitHubLogin
  logout?(expected: { login: string; nodeId: string }): Promise<GitHubAccount>
  dispose?(): void
  catalog?(source: { repository?: GitHubRepository; githubProject?: GitHubProjectRef }): Promise<SourceCatalog>
  identify?(url: string): Promise<SourceCandidate>
  /** Host-only write capability. Targets come exclusively from accepted local bindings. */
  close?(target: import('../work-completion/index.ts').CloseTarget, operationId: string): Promise<import('../work-completion/index.ts').CloseReceipt>
  list(repository: GitHubRepository, request: IssuePageRequest): Promise<IssuePage>
  detail(repository: GitHubRepository, number: number, options?: { nativeChildren?: true; nativeRelationships?: true }): Promise<IssueDetail>
  project?(project: GitHubProjectRef, request: ProjectPageRequest): Promise<GitHubProjectPage>
}
export interface SourceFailure { code: string; message: string; retryAt?: string }
export interface SourceObservation { issue: GitHubIssue; sequence: number }
export interface SourcePage { key: string; nodeIds: string[]; nextPage?: number; identity: GitHubIdentity; observedAt: string }
export interface WorkSource {
  id: string; projectId: string; provider: 'github'; repository?: GitHubRepository; githubProject?: GitHubProjectRef; enabled: boolean; version: number
  sequence: number; requests: Record<string, number>; observations: SourceObservation[]; pages: SourcePage[]
  catalogError?: SourceFailure
  catalog?: SourceCatalog
  title?: string; nodeId?: string; entryUrls?: string[]
  repositorySnapshot?: { sourceVersion: number; identity: GitHubIdentity; nodeIds: string[]; observedAt: string }
  identity?: GitHubIdentity; lastError?: SourceFailure; projectSnapshot?: ProjectSnapshot; discovery?: SourceDiscovery
}
export interface ExternalBinding {
  provider: 'github'; nodeId: string; urls: string[]; ref: { projectId: string; taskId: string }
  sourceIds: string[]; accepted: GitHubIssue; lastObserved: GitHubIssue
  acceptedChildren?: NonNullable<GitHubIssue['subIssues']> & { observedAt: string }
  relatedObservations?: GitHubIssue[]
  hierarchyWarnings?: { code: 'source-hierarchy-frozen'; reason: string; parent: import('../work-types.ts').TaskRef; child: import('../work-types.ts').TaskRef; message: string }[]
}


export interface GitHubLogin { state: 'idle' | 'pending' | 'complete' | 'error'; code?: string; url?: string; message?: string }
export interface GitHubAccount { status: 'connected' | 'disconnected' | 'unavailable'; identity?: GitHubIdentity; message?: string; canLogout?: boolean; login: GitHubLogin }
export interface GitHubRepositoryOption { nodeId: string; owner: string; name: string; url: string; description: string | null; private: boolean; archived: boolean }
export interface GitHubRepositoryPage { identity: GitHubIdentity; items: GitHubRepositoryOption[]; nextPage?: number }
