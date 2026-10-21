import type { GitHubIssue, GitHubProjectItem } from './types.ts'

type FilterResult = { supported: true; items: GitHubProjectItem[] } | { supported: false; reason: string }
/** GitHub's common conjunctive filter subset. Unsupported grammar is never interpreted as an empty/all view. */
export function filterProjectItems(expression: string, items: GitHubProjectItem[], issues: GitHubIssue[], viewer: string, fieldNames: string[] = []): FilterResult {
  const tokens = expression.match(/(?:[^\s"]|"[^"]*")+/g) ?? []
  if (tokens.some(token=>/^or$/i.test(token))) {
    const groups:string[]=['']
    for(const token of tokens){if(/^or$/i.test(token))groups.push('');else groups[groups.length-1]+=`${token} `}
    if(groups.some(group=>!group.trim()))return {supported:false,reason:'OR 表达式缺少一侧条件'}
    const results=groups.map(group=>filterProjectItems(group,items,issues,viewer,fieldNames))
    for(const result of results)if(!result.supported)return result
    const ids=new Set(results.flatMap(result=>result.supported?result.items.map(item=>item.id):[]))
    return {supported:true,items:items.filter(item=>ids.has(item.id))}
  }
  if ((expression.match(/"/g)?.length ?? 0) % 2 || tokens.some(token => /^(OR|NOT)$/i.test(token) || /[()<>]/.test(token))) return { supported: false, reason: '暂不支持此视图的括号、比较或不完整引号表达式' }
  const byNode = new Map(issues.map(issue => [issue.nodeId, issue]))
  const fields = new Set([...fieldNames, ...items.flatMap(item => item.fields.map(field => field.name))].map(name => name.toLowerCase()))
  const predicates: ((item: GitHubProjectItem) => boolean)[] = []
  const unquote = (value: string) => value.replace(/^"|"$/g, '').toLowerCase()
  for (const original of tokens) {
    if (/^and$/i.test(original)) continue
    const negative = original.startsWith('-'), token = negative ? original.slice(1) : original
    const colon = token.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    const key = colon < 0 ? 'text' : unquote(token.slice(0, colon)), raw = colon < 0 ? token : token.slice(colon + 1)
    const values = (raw.match(/(?:[^,"]|"[^"]*")+/g) ?? []).map(unquote)
    if (!values.length) return { supported: false, reason: `视图筛选缺少值：${original}` }
    if (!['text','is','state','label','assignee','repo','no','has'].includes(key) && !fields.has(key)) return { supported: false, reason: `暂不支持或无法读取视图字段：${key}` }
    if ((key === 'is' && values.some(value => !['open','closed','issue','pr','draft','archived'].includes(value))) || ((key === 'no' || key === 'has') && values.some(value => !['assignee','label'].includes(value) && !fields.has(value)))) return { supported: false, reason: `暂不支持视图筛选：${original}` }
    if ((fields.has(key) || (key === 'no' || key === 'has') && values.some(value => fields.has(value))) && items.some(item => item.fieldsPartial)) return { supported: false, reason: `字段 ${key} 的观察不完整，无法准确应用此视图` }
    predicates.push(item => {
      const issue = byNode.get(item.issueNodeId ?? '') ?? item.facts
      const matches = values.some(value => {
        if (key === 'text') return `${item.title ?? ''} ${issue?.body ?? ''}`.toLowerCase().includes(value)
        if (key === 'label') return !!issue?.labels.some(label => label.toLowerCase() === value)
        if (key === 'assignee') return !!issue?.assignees.some(login => login.toLowerCase() === (value === '@me' ? viewer.toLowerCase() : value))
        if (key === 'repo') return !!issue && `${issue.repository.owner}/${issue.repository.repository}`.toLowerCase() === value
        if (key === 'state') return issue?.state === value
        if (key === 'is') return value === 'issue' ? item.kind === 'issue' : value === 'pr' ? item.kind === 'pull-request' : value === 'draft' ? item.kind === 'draft' || !!item.facts?.draft : value === 'archived' ? item.archived : issue?.state === value || value === 'closed' && issue?.state === 'merged'
        if (key === 'no' || key === 'has') {
          const present = value === 'assignee' ? !!issue?.assignees.length : value === 'label' ? !!issue?.labels.length : item.fields.some(field => field.name.toLowerCase() === value && field.value !== '')
          return key === 'has' ? present : !present
        }
        return item.fields.some(field => field.name.toLowerCase() === key && field.value.toLowerCase() === value)
      })
      return negative ? !matches : matches
    })
  }
  return { supported: true, items: items.filter(item => (!tokens.length || item.kind !== 'restricted') && (!item.archived || tokens.some(token=>/^is:archived$/i.test(token))) && predicates.every(predicate => predicate(item))) }
}
