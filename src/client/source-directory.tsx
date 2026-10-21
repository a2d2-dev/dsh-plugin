import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { WorkPanelController, SourceTab } from './work-panel-controller.ts'
import type { WorkSource } from '../work-sources/types.ts'
import { filterProjectItems } from '../work-sources/views.ts'
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
  return <>
    <div className={styles.sourceToolbar}><div className={styles.sourceSummary}><strong>{sourceName(source)}</strong><span>{source.repository?`仓库 · ${source.repository.owner}/${source.repository.repository}`:`Project · ${source.githubProject?.owner} / #${source.githubProject?.number} · ${source.githubProject?.type==='org'?'组织':'个人'}`}</span><span>读取账号：{source.identity?.login??'尚未确认'}</span></div>{delegation}</div>
    <nav className={styles.tabs} aria-label="来源目录">{tabs.map(([tab,label])=><button key={tab} aria-pressed={sourceState.tab===tab} onClick={()=>void controller.selectSourceTab(tab)}>{label}</button>)}</nav>
    {sourceState.tab==='issues'?issues:<>
      <div className={styles.toolbar}><button disabled={sourceState.loading||!source.enabled} onClick={()=>void controller.browseDirectory(true)}>刷新来源</button><button disabled={sourceState.loading} onClick={()=>void controller.browseDirectory(false)}>读取目录缓存</button><span>{sourceState.cached?'缓存 / 最后已知观察':'本次读取'}{sourceState.catalog?` · ${sourceState.catalog.observedAt}`:' · 尚无目录缓存'}</span></div>
      {sourceState.loading&&<p role="status">正在读取来源目录…</p>}{sourceState.error&&<p role="alert" className={styles.failure}>{sourceState.error}</p>}{!source.enabled&&<p role="status">来源已停用，保留已保存内容。</p>}
      {sourceState.catalog?.limitations.map(reason=><p role="status" key={reason}>{reason}</p>)}
      {sourceState.tab==='overview'&&<SourceOverview controller={controller} source={source}/>}
      {sourceState.tab==='project'&&<ProjectViews controller={controller} source={source}/>}
      {sourceState.tab==='prs'&&<PullRequests key={source.id} controller={controller}/>}
    </>}
  </>
}
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
  if(!catalog)return <p>尚无真实 Project 视图缓存，请刷新来源。</p>
  const entry=source.entryUrls?.at(-1),url=entry?new URL(entry):undefined
  const entryView=Number(/\/views\/(\d+)/.exec(url?.pathname??'')?.[1])||null
  const viewNumber=state.viewNumber??entryView??catalog.views[0]?.number??null
  const view=catalog.views.find(view=>view.number===viewNumber)
  const slice=state.viewNumber===null&&!!url&&[...url.searchParams.keys()].some(key=>/slice/i.test(key))
  const expression=(state.viewNumber===null?url?.searchParams.get('filterQuery'):undefined)??view?.filter??''
  const filtered=snapshot?filterProjectItems(expression,snapshot.items,source.observations.map(item=>item.issue),snapshot.identity.login,catalog.fields.filter(field=>['SINGLE_SELECT','ITERATION','TEXT','NUMBER','DATE','MILESTONE'].includes(field.dataType)).map(field=>field.name)):null
  const page=state.viewPage,perPage=25,items=filtered?.supported?filtered.items.slice((page-1)*perPage,page*perPage):[]
  return <section><h2>真实 Project 视图与字段</h2><label>视图<select aria-label="Project 视图" value={viewNumber??''} onChange={event=>controller.setProjectView(Number(event.target.value))}>{catalog.views.map(view=><option key={view.id} value={view.number}>{view.name}</option>)}</select></label>
    <p>{catalog.viewsComplete?'视图与字段目录读取完整':'视图或字段目录为部分观察'} · {view?.layout}</p><p>筛选：<code>{expression||'（无筛选）'}</code></p>
    {entry&&<p>保存入口：<TrustedLink url={entry}>打开原始 view / 切片</TrustedLink></p>}
    {slice?<p role="alert">已保留原始切片入口；当前未支持此 slice 参数，无法准确呈现该切片，请在 GitHub 查看。</p>:!view?<p role="alert">保存的 view 不在当前可读取目录中，请选择真实视图。</p>:!snapshot?<p role="status">完整 Project 成员扫描尚未完成，请刷新继续；没有用全列表冒充视图。</p>:filtered&&!filtered.supported?<p role="alert">{filtered.reason}</p>:<>
      <p>可见匹配 {filtered?.supported?filtered.items.length:0} 项 · {snapshot?.observedAt} · {snapshot?.items.filter(item=>item.kind==='restricted').length??0} 项权限受限，无法参与精确筛选。</p>
      <div className={styles.tableScroll}><table aria-label="真实 Project 条目"><thead><tr><th>条目</th>{catalog.fields.filter(field=>field.dataType!=='TITLE').map(field=><th key={field.id}>{field.name}</th>)}</tr></thead><tbody>{items.map(item=>{const issue=source.observations.find(value=>value.issue.nodeId===item.issueNodeId)?.issue;return <tr key={item.id}><td>{issue?<button className={styles.issueLink} onClick={()=>void controller.openIssue(issue.number,source.enabled,issue.nodeId)}>{issue.repository.owner}/{issue.repository.repository} #{issue.number} {issue.title}</button>:item.url?<TrustedLink url={item.url}>{item.title??item.kind}</TrustedLink>:item.title??({draft:'草稿',restricted:'权限受限',issue:'Issue','pull-request':'PR'})[item.kind]}{item.archived&&<span> · 已归档</span>}</td>{catalog.fields.filter(field=>field.dataType!=='TITLE').map(field=><td key={field.id}>{field.dataType==='ASSIGNEES'?(issue?.assignees??item.facts?.assignees)?.join(', ')||'—':field.dataType==='LABELS'?(issue?.labels??item.facts?.labels)?.join(', ')||'—':field.dataType==='REPOSITORY'?(issue?`${issue.repository.owner}/${issue.repository.repository}`:item.facts?`${item.facts.repository.owner}/${item.facts.repository.repository}`:'—'):item.fields.find(value=>value.id===field.id)?.value??(['SINGLE_SELECT','ITERATION','TEXT','NUMBER','DATE','MILESTONE'].includes(field.dataType)?'—':'未读取此类字段值')}{item.fieldsPartial?' · 字段部分观察':''}</td>)}</tr>})}</tbody></table></div>{!items.length&&<p>此视图没有可见匹配条目。</p>}<div className={styles.toolbar}><button disabled={page<=1} onClick={()=>controller.setProjectView(viewNumber,page-1)}>上一页</button><span>第 {page} 页</span><button disabled={!filtered?.supported||page*perPage>=filtered.items.length} onClick={()=>controller.setProjectView(viewNumber,page+1)}>下一页</button></div>
    </>}
    <details><summary>真实字段定义</summary><ul>{catalog.fields.map(field=><li key={field.id}>{field.name} · {field.dataType}</li>)}</ul></details>
  </section>
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
