import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { WorkPanelController, SourceTab } from './work-panel-controller.ts'
import type { WorkSource } from '../work-sources/types.ts'
import { filterProjectItems } from '../work-sources/views.ts'
import { projectFieldCell } from './project-fields.ts'
import { fieldOption, orderProjectRows, projectColumns } from './project-rows.ts'
import type { ProjectRow } from './project-rows.ts'
import styles from './work-panel.module.css'

const sourceName = (source: WorkSource) => source.title ?? source.projectSnapshot?.project.title ?? (source.repository ? `${source.repository.owner}/${source.repository.repository}` : `${source.githubProject?.owner} / Project #${source.githubProject?.number}`)
export function SourceTabs({controller,onAdd}:{controller:WorkPanelController;onAdd:()=>void}) {
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot)
  return <nav className={styles.tabs} aria-label="来源标签"><strong>A²D² 控制面板</strong>{Object.entries(state.projectSources).flatMap(([projectId,sources])=>sources.map(source=><button key={source.id} aria-pressed={state.projectId===projectId&&state.source.sourceId===source.id} onClick={()=>void controller.selectConnectedSource(projectId,source.id)}>{sourceName(source)} <small>{source.repository?'仓库':'Project'}</small></button>))}<button aria-label="添加来源" onClick={onAdd}>＋</button></nav>
}
export function SourceDirectory({controller,issues,delegation}:{controller:WorkPanelController;issues:ReactNode;delegation?:ReactNode}) {
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot), sourceState=state.source
  const source=sourceState.sources.find(source=>source.id===sourceState.sourceId)
  if(!source)return null
  const tabs:[SourceTab,string][]=[['overview','概览'],...(source.githubProject?[['project','项目'] as [SourceTab,string]]:[]),['issues','Issue'],['prs','PR']]
  const cache=sourceState.cached?'缓存 / 最后已知观察':'本次读取'
  return <>
    <div className={styles.sourceHeader}>
      <div className={styles.sourceIdentity}><strong>{sourceName(source)}</strong><span>{source.repository?`仓库 · ${source.repository.owner}/${source.repository.repository}`:`Project · ${source.githubProject?.owner} / #${source.githubProject?.number} · ${source.githubProject?.type==='org'?'组织':'个人'}`}</span><span>读取账号：{source.identity?.login??'尚未确认'}</span></div>
      <nav className={styles.tabs} aria-label="来源目录">{tabs.map(([tab,label])=><button key={tab} aria-pressed={sourceState.tab===tab} onClick={()=>void controller.selectSourceTab(tab)}>{label}</button>)}</nav>
      <div className={styles.sourceActions}>
        <button className={styles.iconButton} aria-label="刷新来源" title={`刷新来源（${cache}${sourceState.catalog?` · ${sourceState.catalog.observedAt}`:''}）`} disabled={sourceState.loading||!source.enabled} onClick={()=>void controller.browseDirectory(true)}><RefreshIcon/></button>
        <button className={styles.iconButton} aria-label="读取目录缓存" title={`读取目录缓存（${cache}${sourceState.catalog?` · ${sourceState.catalog.observedAt}`:''}）`} disabled={sourceState.loading} onClick={()=>void controller.browseDirectory(false)}><ClockIcon/></button>
        {delegation}
      </div>
    </div>
    {sourceState.tab==='issues'?issues:<>
      {sourceState.loading&&<p role="status">正在读取来源目录…</p>}{sourceState.error&&<p role="alert" className={styles.failure}>{sourceState.error}</p>}{!source.enabled&&<p role="status">来源已停用，保留已保存内容。</p>}
      {sourceState.catalog?.limitations.map(reason=><p role="status" key={reason}>{reason}</p>)}
      {sourceState.tab==='overview'&&<SourceOverview controller={controller} source={source}/>}
      {sourceState.tab==='project'&&<ProjectViews controller={controller} source={source}/>}
      {sourceState.tab==='prs'&&<PullRequests key={source.id} controller={controller}/>}
    </>}
  </>
}
function RefreshIcon(){return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .655-.835ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"/></svg>}
function ClockIcon(){return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm6.25-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 1 1 1.5 0Z"/></svg>}
function SourceOverview({controller,source}:{controller:WorkPanelController;source:WorkSource}) {
  const state=controller.getSnapshot(),catalog=state.source.catalog,snapshot=source.projectSnapshot
  const members=new Set(snapshot?.items.filter(item=>item.kind==='issue'&&!item.archived).map(item=>item.issueNodeId)??[])
  const issues=source.observations.map(item=>item.issue).filter(issue=>members.has(issue.nodeId))
  const relevant=state.progressItems.filter(item=>item.source&&(source.repository?item.source.url.toLowerCase().startsWith(`https://github.com/${source.repository.owner}/${source.repository.repository}/issues/`.toLowerCase()):members.has(item.source.nodeId??'')))
  const open=source.repository?catalog?.openIssueCount:snapshot?issues.filter(issue=>issue.state==='open').length:undefined
  const incomplete=!!snapshot?.items.some(item=>item.kind==='restricted')
  const processing=relevant.filter(item=>item.processingState==='processing'),attention=relevant.filter(item=>['waiting','paused','blocked'].includes(item.processingState??'not-started'))
  const workKnown=!!catalog&&!!(source.repository||snapshot)
  return <section aria-label="来源概览"><h2>来源概览</h2><div className={styles.metrics}>
    <article><span>开放 Issue</span><strong>{open??'—'}{incomplete&&open!==undefined?' + 未可见项':''}</strong><p>{open===undefined?'尚未完整观察':source.repository?'GitHub 全仓库计数':`完整扫描的可见收录 · ${snapshot?.observedAt}`}</p></article>
    <article><span>PR</span><strong>{catalog?catalog.pullRequests.length:'—'}</strong><p>{catalog?catalog.pullRequestsComplete?'当前范围完整观察':'部分观察，非全量':'尚未完整观察'}</p></article>
    <article><span>处理中</span><strong>{workKnown?processing.length:'—'}</strong><p>{workKnown?'当前来源已关联的本地工作':'本地工作聚合尚未读取'}</p></article><article><span>需要关注</span><strong>{workKnown?attention.length:'—'}</strong><p>{workKnown?'等待、暂停或阻塞':'本地工作聚合尚未读取'}</p></article>
  </div>{source.discovery?.checkpoint&&<p role="status">Project 扫描进行中，已读取 {source.discovery.checkpoint.pages} 页；概览保留上次完整扫描。可刷新继续读取。</p>}
    <div className={styles.detailGrid}>{[{title:'需要关注',items:attention},{title:'正在处理',items:processing}].map(({title,items}) => <details key={title}><summary>{title} · {workKnown?items.length:'—'}</summary>{items.length ? <ul className={styles.queue}>{items.map(item => <li key={`${item.ref.projectId}/${item.ref.taskId}`}><div><button className={styles.link} onClick={() => void controller.openTask(item.ref)}>#{item.source?.number} {item.title}</button><p>{item.processingReason ?? item.summary}{item.next ? ` · 下一步：${item.next}` : ''}</p></div></li>)}</ul> : <p>{workKnown ? '当前没有已关联的匹配工作。' : '本地工作聚合尚未读取。'}</p>}</details>)}</div>
    <h3>最近进展</h3>{relevant.length?<ul>{[...relevant].sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??'')).slice(0,8).map(item=><li key={`${item.ref.projectId}/${item.ref.taskId}`}><button className={styles.link} onClick={()=>void controller.openTask(item.ref)}>#{item.source?.number} {item.title}</button><p>{item.summary||'尚无工作报告'}{item.next?` · 下一步：${item.next}`:''}</p></li>)}</ul>:<p>当前来源尚无已关联的工作进展。</p>}
    {catalog&&<><h3>最近外部更新</h3><ul>{catalog.pullRequests.slice(0,5).map(pr=><li key={pr.nodeId}><TrustedLink url={pr.url}>{pr.repository.owner}/{pr.repository.repository}#{pr.number} {pr.title}</TrustedLink> · {pr.updatedAt}</li>)}</ul></>}
    <p>PR 引用、检查或合并是外部观察，不能替代任务验收。分页 Issue 列表不作为全量统计。</p>
  </section>
}
function ProjectViews({controller,source}:{controller:WorkPanelController;source:WorkSource}) {
  const state=controller.getSnapshot().source,catalog=state.catalog,snapshot=source.projectSnapshot
  const [collapsed,setCollapsed]=useState<ReadonlySet<string>>(()=>new Set())
  if(!catalog)return <p>尚无真实 Project 视图缓存，请刷新来源。</p>
  const entry=source.entryUrls?.at(-1),url=entry?new URL(entry):undefined
  const entryView=Number(/\/views\/(\d+)/.exec(url?.pathname??'')?.[1])||null
  const viewNumber=state.viewNumber??entryView??catalog.views[0]?.number??null
  const view=catalog.views.find(view=>view.number===viewNumber)
  const slice=state.viewNumber===null&&!!url&&[...url.searchParams.keys()].some(key=>/slice/i.test(key))
  const expression=(state.viewNumber===null?url?.searchParams.get('filterQuery'):undefined)??view?.filter??''
  const filtered=snapshot?filterProjectItems(expression,snapshot.items,source.observations.map(item=>item.issue),snapshot.identity.login,catalog.fields.filter(field=>['SINGLE_SELECT','ITERATION','TEXT','NUMBER','DATE','MILESTONE'].includes(field.dataType)).map(field=>field.name)):null
  const page=state.viewPage,perPage=25,issues=source.observations.map(item=>item.issue)
  const visible=filtered?.supported?filtered.items:[]
  const rows=orderProjectRows(visible.slice((page-1)*perPage,page*perPage),issues,collapsed)
  const columns=projectColumns(catalog.fields,orderProjectRows(visible,issues,new Set()))
  const parents=new Set(visible.flatMap(item=>{const parent=issues.find(issue=>issue.nodeId===item.issueNodeId)?.parent?.nodeId;return parent?[parent]:[]}))
  const toggle=(nodeId:string)=>setCollapsed(current=>{const next=new Set(current);if(next.has(nodeId))next.delete(nodeId);else next.add(nodeId);return next})
  return <section><h2>真实 Project 视图与字段</h2><label>视图<select aria-label="Project 视图" value={viewNumber??''} onChange={event=>controller.setProjectView(Number(event.target.value))}>{catalog.views.map(view=><option key={view.id} value={view.number}>{view.name}</option>)}</select></label>
    <p>{catalog.viewsComplete?'视图与字段目录读取完整':'视图或字段目录为部分观察'} · {view?.layout}</p><p>筛选：<code>{expression||'（无筛选）'}</code></p>
    {entry&&<p>保存入口：<TrustedLink url={entry}>打开原始 view / 切片</TrustedLink></p>}
    {slice?<p role="alert">已保留原始切片入口；当前未支持此 slice 参数，无法准确呈现该切片，请在 GitHub 查看。</p>:!view?<p role="alert">保存的 view 不在当前可读取目录中，请选择真实视图。</p>:!snapshot?<p role="status">完整 Project 成员扫描尚未完成，请刷新继续；没有用全列表冒充视图。</p>:filtered&&!filtered.supported?<p role="alert">{filtered.reason}</p>:<>
      <p>可见匹配 {filtered?.supported?filtered.items.length:0} 项 · {snapshot?.observedAt} · {snapshot?.items.filter(item=>item.kind==='restricted').length??0} 项权限受限，无法参与精确筛选。</p>
      {rows.length?<div className={styles.tableScroll}><table className={styles.projectTable} aria-label="真实 Project 条目"><thead><tr><th>条目</th>{columns.map(field=><th key={field.id}>{field.name}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.item.id}>
        <td className={styles.titleCell}><div className={styles.hierarchy} style={{paddingLeft:row.depth*22}}>
          {row.item.issueNodeId&&parents.has(row.item.issueNodeId)?<button className={styles.chevron} aria-label={collapsed.has(row.item.issueNodeId!)?'展开子项':'收起子项'} aria-expanded={!collapsed.has(row.item.issueNodeId!)} onClick={()=>toggle(row.item.issueNodeId!)}>{collapsed.has(row.item.issueNodeId!)?'▸':'▾'}</button>:<span className={styles.chevronSpacer}/>}
          <span className={styles.rowState} data-closed={row.issue?.state==='closed'?'true':undefined} title={row.issue?.state==='closed'?'已关闭':'打开'}/>
          {row.issue?<button className={styles.rowTitle} title={`${row.issue.repository.owner}/${row.issue.repository.repository} #${row.issue.number}`} onClick={()=>void controller.openIssue(row.issue!.number,source.enabled,row.issue!.nodeId)}>#{row.issue.number} {row.issue.title}</button>:row.item.url?<TrustedLink url={row.item.url}>{row.item.title??row.item.kind}</TrustedLink>:row.item.title??({draft:'草稿',restricted:'权限受限',issue:'Issue','pull-request':'PR'} as Record<string,string>)[row.item.kind]}
          {row.item.archived&&<span> · 已归档</span>}
        </div></td>
        {columns.map(field=><ProjectCell key={field.id} field={field} row={row} fields={catalog.fields}/>)}
      </tr>)}</tbody></table></div>:<p>此视图没有可见匹配条目。</p>}
      <div className={styles.toolbar}><button disabled={page<=1} onClick={()=>controller.setProjectView(viewNumber,page-1)}>上一页</button><span>第 {page} 页</span><button disabled={!filtered?.supported||page*perPage>=filtered.items.length} onClick={()=>controller.setProjectView(viewNumber,page+1)}>下一页</button></div>
    </>}
    <details><summary>真实字段定义</summary><ul>{catalog.fields.map(field=><li key={field.id}>{field.name} · {field.dataType}{field.options?.length?` · ${field.options.map(option=>`${option.name}(${option.color})`).join(' / ')}`:''}</li>)}</ul></details>
  </section>
}
type ProjectFieldDefinition = { id: string; name: string; dataType: string; options?: { id: string; name: string; color: string }[] }
const chipClasses: Record<string,string> = { GRAY: styles.chipGray, BLUE: styles.chipBlue, GREEN: styles.chipGreen, YELLOW: styles.chipYellow, ORANGE: styles.chipOrange, RED: styles.chipRed, PINK: styles.chipPink, PURPLE: styles.chipPurple }
const avatarPalette = ['#1f6feb','#8250df','#1a7f37','#bc4c00','#cf222e','#0969da','#bf3989','#57606a']
function avatarColor(login: string) { let hash = 0; for (const character of login) hash = (hash * 31 + character.charCodeAt(0)) >>> 0; return avatarPalette[hash % avatarPalette.length]! }
/** One Project cell rendered like the GitHub board: chips, avatars, label pills and a progress bar. */
function ProjectCell({field,row,fields}:{field:ProjectFieldDefinition;row:ProjectRow;fields:ProjectFieldDefinition[]}) {
  const {item,issue}=row, cell=projectFieldCell(field,issue,item), partial=item.fieldsPartial?' · 字段部分观察':''
  if(field.dataType==='ASSIGNEES'){const logins=issue?.assignees??item.facts?.assignees??[];return <td><div className={styles.cellClip}>{logins.length?logins.map(login=><span key={login} style={{whiteSpace:'nowrap',marginRight:8}}><span className={styles.avatar} style={{background:avatarColor(login)}}>{login.slice(0,1)}</span>{login}</span>):'—'}{partial}</div></td>}
  if(field.dataType==='LABELS'){const labels=issue?.labels??item.facts?.labels??[];return <td><div className={styles.cellClip}>{labels.length?labels.map(label=><span key={label} className={styles.labelPill}>{label}</span>):'—'}{partial}</div></td>}
  if(field.dataType==='SUB_ISSUES_PROGRESS'){const summary=issue?.subIssuesSummary,children=issue?.subIssues,total=summary?.total??children?.totalCount;if(!total)return <td><div className={styles.cellClip}>—{partial}</div></td>;const completed=summary?.completed??children?.items.filter(child=>child.state==='closed').length??0,pct=Math.floor(completed/total*100)
    const segments=Math.min(total,20),filled=Math.round((completed/total)*segments)
    return <td><div className={styles.progress}><div className={styles.progressSegments}>{Array.from({length:segments},(_,index)=><span key={index} className={index<filled?styles.segmentOn:styles.segmentOff}/>)}</div><span className={styles.progressText}>{completed}/{total} · {pct}%{summary===undefined&&children?.hasNextPage?' · 部分观察':''}</span></div></td>}
  const option=fieldOption(fields,field.id,cell.text)
  return <td><div className={styles.cellClip}>{option?<span className={`${styles.chip} ${chipClasses[option.color.toUpperCase()]??styles.chipGray}`}>{cell.text}</span>:cell.parts?cell.parts.map((part,index)=>part.url?<TrustedLink key={index} url={part.url}>{part.label}</TrustedLink>:<span key={index}>{part.label}</span>):cell.text}{partial}</div></td>
}
function PullRequests({controller}:{controller:WorkPanelController}) {
  const catalog=controller.getSnapshot().source.catalog
  const [state,setState]=useState('all'),[search,setSearch]=useState(''),[page,setPage]=useState(1)
  if(!catalog)return <p>PR 目录尚无可读缓存，请刷新来源；读取失败不表示空目录。</p>
  const filtered=catalog.pullRequests.filter(pr=>(state==='all'||pr.state===state)&&(search.trim()===''||`${pr.repository.owner}/${pr.repository.repository} #${pr.number} ${pr.title}`.toLowerCase().includes(search.trim().toLowerCase())))
  const items=filtered.slice((page-1)*25,page*25)
  return <section><h2>PR 只读目录</h2><div className={styles.toolbar}><label>PR 状态<select value={state} onChange={event=>{setState(event.target.value);setPage(1)}}><option value="all">全部</option><option value="open">开放</option><option value="closed">已关闭</option><option value="merged">已合并</option></select></label><label>搜索 PR<input value={search} onChange={event=>{setSearch(event.target.value);setPage(1)}}/></label></div><p>{catalog.pullRequestsComplete?'当前范围完整观察':'部分目录，不能视为全量'} · {filtered.length} 项匹配 · 引用不等于验收。</p>
    <div className={styles.tableScroll}><table aria-label="PR 目录"><thead><tr><th>仓库 / PR</th><th>状态</th><th>相关 Issue</th><th>检查 / 评审</th></tr></thead><tbody>{items.map(pr=><tr key={pr.nodeId}><td><TrustedLink url={pr.url}>{pr.repository.owner}/{pr.repository.repository} #{pr.number} {pr.title}</TrustedLink><p>{({repository:'仓库范围',project:'Project 收录','issue-reference':'Issue 交叉引用'})[pr.membership]}</p></td><td>{({open:'开放',closed:'已关闭',merged:'已合并'})[pr.state]}{pr.draft?' · 草稿':''}</td><td>{pr.issues.length?<ul>{pr.issues.map(issue=><li key={issue.url}><TrustedLink url={issue.url}>#{issue.number} {issue.title}</TrustedLink></li>)}</ul>:'未观察到关联'}{!pr.issuesComplete&&<p>关联为部分观察</p>}</td><td>检查：{pr.checks??'未提供'}<p>评审：{pr.review??'未提供'}</p></td></tr>)}</tbody></table></div>{!items.length&&<p>当前筛选下没有 PR；这是已成功读取目录的有效空结果。</p>}<div className={styles.toolbar}><button disabled={page<=1} onClick={()=>setPage(page-1)}>上一页</button><span>第 {page} 页</span><button disabled={page*25>=filtered.length} onClick={()=>setPage(page+1)}>下一页</button></div>
  </section>
}
function TrustedLink({url,children}:{url:string;children:ReactNode}) {
  let safe=false
  try{const value=new URL(url);safe=value.protocol==='https:'&&value.hostname==='github.com'&&!value.port&&!value.username&&!value.password}catch{}
  return safe?<a href={url} target="_blank" rel="noreferrer">{children}</a>:<span>{children}（链接不可用）</span>
}
