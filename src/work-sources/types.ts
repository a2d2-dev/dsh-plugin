/** Browser-safe observations; external text never grants host authority. */
export interface GitHubRepository { owner: string; repository: string }
export interface GitHubIdentity { login: string; nodeId: string; name: string | null }
export interface GitHubIssue {
  nodeId: string; url: string; number: number; title: string; body: string | null
  repository: GitHubRepository; assignees: string[]; labels: string[]; state: 'open' | 'closed'
  updatedAt: string; observedAt: string
}
export interface IssuePageRequest { page: number; perPage: number; assignee: '@me' | '*'; state: 'open' | 'closed' | 'all' }
export interface IssuePage { identity: GitHubIdentity; items: GitHubIssue[]; nextPage?: number; observedAt: string }
export interface IssueDetail { identity: GitHubIdentity; issue: GitHubIssue }
export interface GitHubSourcePort {
  list(repository: GitHubRepository, request: IssuePageRequest): Promise<IssuePage>
  detail(repository: GitHubRepository, number: number): Promise<IssueDetail>
}
export interface SourceFailure { code: string; message: string; retryAt?: string }
export interface SourceObservation { issue: GitHubIssue; sequence: number }
export interface SourcePage { key: string; nodeIds: string[]; nextPage?: number; identity: GitHubIdentity; observedAt: string }
export interface WorkSource {
  id: string; projectId: string; provider: 'github'; repository: GitHubRepository; enabled: boolean; version: number
  sequence: number; requests: Record<string, number>; observations: SourceObservation[]; pages: SourcePage[]
  identity?: GitHubIdentity; lastError?: SourceFailure
}
export interface ExternalBinding {
  provider: 'github'; nodeId: string; urls: string[]; ref: { projectId: string; taskId: string }
  sourceIds: string[]; accepted: GitHubIssue; lastObserved: GitHubIssue
}
