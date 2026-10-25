import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { WorkPanelController, SourceTab } from './work-panel-controller.ts'
import type { WorkSource } from '../work-sources/types.ts'
import { filterProjectItems } from '../work-sources/views.ts'
import { projectFieldCell, projectFieldValues, UNKNOWN_FIELD_VALUE } from './project-fields.ts'
import { SESSION_SLOT, fieldOption, orderProjectRows, projectColumnSlots, projectColumns } from './project-rows.ts'
import { InteractiveTable } from './interactive-table.tsx'
import type { TableColumn } from './interactive-table.tsx'
import { SessionCell, sessionOf } from './session-cell.tsx'
import type { ProjectRow } from './project-rows.ts'
import type { SourceScanProgress } from '../work-types.ts'
import { applySlice, sliceAggregate, sliceCandidates } from './project-slice.ts'
import styles from './work-panel.module.css'

const sourceName = (source: WorkSource) => source.title ?? source.projectSnapshot?.project.title ?? (source.repository ? `${source.repository.owner}/${source.repository.repository}` : `${source.githubProject?.owner} / Project #${source.githubProject?.number}`)
/** One line of scan progress: fetched/total items and the page being read, with a bar when the total is known. */
export function ScanProgressLine({scan}:{scan:SourceScanProgress|null}) {
  if(!scan||(!scan.pages&&!scan.fetched))return <p role="status">正在读取来源目录…</p>
  const total=scan.total, fetched=scan.fetched
  return <div role="status" className={styles.scanProgress}>
    <p>正在读取来源目录… 已取 {fetched}{total===undefined?'':`/${total}`} 项 · 第 {Math.max(1,scan.pages)} 页</p>
    {total!==undefined&&total>0?<progress value={Math.min(fetched,total)} max={total} aria-label="来源扫描进度"/>:<progress aria-label="来源扫描进度"/>}
  </div>
}
export function SourceTabs({controller,onAdd}:{controller:WorkPanelController;onAdd:()=>void}) {
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot)
  return <nav className={styles.tabs} aria-label="来源标签"><strong>A²D² 控制面板</strong>{Object.entries(state.projectSources).flatMap(([projectId,sources])=>sources.map(source=><button key={source.id} aria-pressed={state.projectId===projectId&&state.source.sourceId===source.id} onClick={()=>void controller.selectConnectedSource(projectId,source.id)}>{sourceName(source)} <small>{source.repository?'仓库':'Project'}</small></button>))}<button aria-label="添加来源" onClick={onAdd}>＋</button></nav>
}
export function SourceDirectory({controller,issues,panelContent,panel,onPanel}:{controller:WorkPanelController;issues:ReactNode;panelContent?:ReactNode;panel:'none'|'delegation'|'continuation';onPanel:(panel:'none'|'delegation'|'continuation')=>void}) {
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot), sourceState=state.source
  const [menu,setMenu]=useState(false)
  useEffect(()=>{ if(!menu)return; const close=()=>setMenu(false); document.addEventListener('click',close); return ()=>document.removeEventListener('click',close) },[menu])
  const source=sourceState.sources.find(source=>source.id===sourceState.sourceId)
  if(!source)return null
  const tabs:[SourceTab,string][]=[['overview','概览'],...(source.githubProject?[['project','项目'] as [SourceTab,string]]:[]),['issues','Issue'],['prs','PR']]
  const cache=sourceState.cached?'缓存 / 最后已知观察':'本次读取'
  return <>
    <div className={styles.sourceHeader}>
      <div className={styles.sourceIdentity}>
        <span className={styles.sourceIcon} aria-hidden="true">{source.repository?<RepoIcon/>:<ProjectIcon/>}</span>
        <div className={styles.sourceTitles}>
          <strong>{sourceName(source)}</strong>
          <span className={styles.sourceMeta}>{source.repository?`仓库 · ${source.repository.owner}/${source.repository.repository}`:`Project · ${source.githubProject?.owner} / #${source.githubProject?.number} · ${source.githubProject?.type==='org'?'组织':'个人'}`}<span className={styles.metaDot}>·</span>读取账号：{source.identity?.login??'尚未确认'}</span>
        </div>
      </div>
      <nav className={styles.tabs} aria-label="来源目录">{tabs.map(([tab,label])=><button key={tab} aria-pressed={sourceState.tab===tab} onClick={()=>void controller.selectSourceTab(tab)}>{label}</button>)}</nav>
      <div className={styles.sourceActions}>
        <div className={styles.menuWrap}>
          <button className={styles.iconButton} aria-label="来源操作" aria-expanded={menu} title="来源操作：刷新来源 / 读取目录缓存 / 持续委托 / 新执行默认自动接续" onClick={event=>{event.stopPropagation();setMenu(open=>!open)}}><MoreIcon/></button>
          {menu&&<div className={styles.menu} role="menu">
            <button role="menuitem" disabled={sourceState.loading||!source.enabled} onClick={event=>{event.stopPropagation();setMenu(false);void controller.browseDirectory(true)}}>刷新来源</button>
            <button role="menuitem" disabled={sourceState.loading} onClick={event=>{event.stopPropagation();setMenu(false);void controller.browseDirectory(false)}}>读取目录缓存</button>
            <button role="menuitem" aria-pressed={panel==='delegation'} onClick={event=>{event.stopPropagation();setMenu(false);onPanel(panel==='delegation'?'none':'delegation')}}>持续委托</button>
            <button role="menuitem" aria-pressed={panel==='continuation'} onClick={event=>{event.stopPropagation();setMenu(false);onPanel(panel==='continuation'?'none':'continuation')}}>新执行默认自动接续</button>
          </div>}
        </div>
      </div>
    </div>
    {panelContent}
    {sourceState.tab==='issues'?issues:<>
      {sourceState.loading&&<ScanProgressLine scan={sourceState.scan}/>}{!sourceState.loading&&sourceState.scan&&sourceState.scan.total!==undefined&&sourceState.scan.fetched<sourceState.scan.total&&<p role="status">Project 扫描未完成：已取 {sourceState.scan.fetched}/{sourceState.scan.total} 项，刷新来源可继续。</p>}{sourceState.error&&<p role="alert" className={styles.failure}>{sourceState.error}</p>}{!source.enabled&&<p role="status">来源已停用，保留已保存内容。</p>}
      {!sourceState.loading&&sourceState.catalog&&<p role="status">{cache} · 目录观察时间：{sourceState.catalog.observedAt}</p>}
      {sourceState.catalog?.limitations.map(reason=><p role="status" key={reason}>{reason}</p>)}
      {sourceState.tab==='overview'&&<SourceOverview controller={controller} source={source}/>}
      {sourceState.tab==='project'&&<ProjectViews key={`${source.projectId}/${source.id}/${sourceState.viewNumber??'entry'}`} controller={controller} source={source}/>}
      {sourceState.tab==='prs'&&<PullRequests key={source.id} controller={controller}/>}
    </>}
  </>
}
function RepoIcon(){return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z"/></svg>}
function ProjectIcon(){return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25H5.5v-13Zm5.25 0v13h7.25a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25Z"/></svg>}
function MoreIcon(){return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM1.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm13 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>}
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
  const state=controller.getSnapshot().source,snapshot=source.projectSnapshot
  const catalog=state.catalog??{observedAt:'',pullRequests:[],pullRequestsComplete:false,views:[],fields:[],viewsComplete:false,limitations:[]}
  const [collapsed,setCollapsed]=useState<ReadonlySet<string>>(()=>new Set())
  const [extraColumns,setExtraColumns]=useState(false)
  const [includeClosed,setIncludeClosed]=useState(false)
  const [sliceFieldId,setSliceFieldId]=useState<string|null>(null)
  // GitHub keeps the selected slice value in the entry URL, not in the view.
  const [sliceSelected,setSliceSelected]=useState<ReadonlySet<string>>(()=>{
    const entry=source.entryUrls?.at(-1)
    if(!entry||controller.getSnapshot().source.viewNumber!==null)return new Set<string>()
    return new Set(new URL(entry).searchParams.getAll('sliceBy[value]'))
  })
  const [showEmpty,setShowEmpty]=useState(false)
  const entry=source.entryUrls?.at(-1),url=entry?new URL(entry):undefined
  const entryView=Number(/\/views\/(\d+)/.exec(url?.pathname??'')?.[1])||null
  const viewNumber=state.viewNumber??entryView??catalog.views[0]?.number??null
  const view=catalog.views.find(view=>view.number===viewNumber)
  // A slice is a view UI state (sliceBy[value]); the view record does not name
  // its field, so the field is resolved from the value against the held items.
  const entryFilter=url?.searchParams.get('filterQuery')??''
  const expression=state.viewNumber===null
    ? entryFilter||view?.filter||''
    : viewNumber===entryView&&entryFilter ? entryFilter : view?.filter??''
  const filtered=snapshot?filterProjectItems(expression,snapshot.items,source.observations.map(item=>item.issue),snapshot.identity.login,catalog.fields.filter(field=>['SINGLE_SELECT','ITERATION','TEXT','NUMBER','DATE','MILESTONE'].includes(field.dataType)).map(field=>field.name)):null
  const issues=source.observations.map(item=>item.issue)
  const matched=state.catalog&&view&&filtered?.supported?filtered.items:[]
  const issuesByNode=new Map(issues.map(issue=>[issue.nodeId,issue]))
  // The Project view's own filter is upstream truth; this local switch only
  // hides items the view would otherwise include because GitHub shows closed
  // issues when its filter is empty. A view that explicitly asks for closed
  // items keeps them even with the switch off. Slice counts follow the same
  // upstream filter, so a closed row is not counted in GitHub's slice totals.
  const closedRequested=/(^|\s)is:closed(\s|$)/i.test(expression)
  const base=includeClosed||closedRequested?matched:matched.filter(item=>issuesByNode.get(item.issueNodeId??'')?.state!=='closed')
  const hiddenClosed=matched.length-base.length
  // The slice belongs to the entry view; it stays available whenever that view
  // is selected, including after switching away and back.
  const sliceValues=entryView!==null&&viewNumber===entryView&&url?url.searchParams.getAll('sliceBy[value]'):[]
  const sliceFieldOptions=sliceCandidates(catalog.fields,base,sliceValues)
  const sliceField=sliceFieldOptions.find(field=>field.id===sliceFieldId)??sliceFieldOptions[0]
  const sliceAgg=sliceField?sliceAggregate(sliceField.id,base):null
  const visible=sliceField?applySlice(base,sliceField.id,sliceSelected,showEmpty):base
  const columns=projectColumns(catalog.fields,orderProjectRows(base,issues,new Set()),extraColumns),slots=projectColumnSlots(columns)
  const progressByNode=new Map(controller.getSnapshot().progressItems.flatMap(item=>item.source?.nodeId?[[item.source.nodeId,item] as const]:[]))
  const toggle=(nodeId:string)=>setCollapsed(current=>{const next=new Set(current);if(next.has(nodeId))next.delete(nodeId);else next.add(nodeId);return next})
  const tableColumns:TableColumn<ProjectRow>[]=[{
    id:'title',label:'条目',protected:true,width:3,values:row=>[row.issue?.title??row.item.title??row.item.kind],
    qualifiers:[{id:'kind',label:'条目类型',values:row=>[row.item.kind]},{id:'state',label:'GitHub 状态',values:row=>[row.issue?.state??row.item.facts?.state??'未观察到状态']}],
    render:row=><div className={styles.hierarchy} style={{paddingLeft:row.depth*22}}>
      {row.item.issueNodeId&&row.hasChildren?<button className={styles.chevron} aria-label={collapsed.has(row.item.issueNodeId)?'展开子项':'收起子项'} aria-expanded={!collapsed.has(row.item.issueNodeId)} onClick={()=>toggle(row.item.issueNodeId!)}>{collapsed.has(row.item.issueNodeId)?'▸':'▾'}</button>:null}
      <span className={styles.rowState} data-closed={row.issue?.state==='closed'?'true':undefined} title={row.issue?.state??row.item.facts?.state??'未观察到状态'}/>
      {row.issue?<button className={styles.rowTitle} title={`#${row.issue.number} ${row.issue.title} · ${row.issue.repository.owner}/${row.issue.repository.repository}`} onClick={()=>void controller.openIssue(row.issue!.number,source.enabled,row.issue!.nodeId)}>#{row.issue.number} {row.issue.title}</button>:row.item.url?<TrustedLink url={row.item.url}>{row.item.title??row.item.kind}</TrustedLink>:row.item.title??row.item.kind}{row.item.archived&&<span> · 已归档</span>}
    </div>,
  },...slots.map((slot):TableColumn<ProjectRow>=>slot===SESSION_SLOT?{
    id:SESSION_SLOT,label:'会话',width:1.5,values:row=>{const progress=row.issue?.nodeId?progressByNode.get(row.issue.nodeId):undefined;return progress?.execution?[progress.execution.session.sessionId]:[]},
    render:row=><SessionCell entry={sessionOf(row.issue?.nodeId?progressByNode.get(row.issue.nodeId):undefined)} onOpen={session=>controller.openSession(session)}/>,
  }:{id:slot.id,label:slot.name,width:columnWeight(slot.dataType)/10,values:row=>projectValues(slot,row),
    sortValue:row=>projectSortValue(slot,row),groupable:['ASSIGNEES','LABELS','SINGLE_SELECT','STATUS','ITERATION','REPOSITORY','MILESTONE','REVIEWERS','PARENT_ISSUE'].includes(slot.dataType),
    ...(!supportedFieldTypes.has(slot.dataType)?{unsupported:`尚未读取 ${slot.dataType} 字段值，不能排序、过滤或分组`}:{}),
    render:row=><ProjectCell field={slot} row={row} fields={catalog.fields}/>,
  })]
  return <section>
    <div className={styles.projectToolbar}>
      <label>视图<select aria-label="Project 视图" value={viewNumber??''} onChange={event=>controller.setProjectView(Number(event.target.value))}>{catalog.views.map(view=><option key={view.id} value={view.number}>{view.name}</option>)}</select></label>
      {sliceField&&sliceAgg&&<label>切片{sliceFieldOptions.length>1&&<select aria-label="切片字段" value={sliceField.id} onChange={event=>{setSliceFieldId(event.target.value);setSliceSelected(new Set())}}>{sliceFieldOptions.map(field=><option key={field.id} value={field.id}>{field.name}</option>)}</select>}<select aria-label="切片值" value={[...sliceSelected][0]??''} onChange={event=>setSliceSelected(event.target.value?new Set([event.target.value]):new Set())}><option value="">全部</option>{sliceAgg.values.map(option=><option key={option.value} value={option.value}>{option.value}（{option.count}）</option>)}</select></label>}
      {sliceField&&sliceAgg&&<label className={styles.projectToggle}><input type="checkbox" checked={showEmpty} onChange={event=>setShowEmpty(event.target.checked)}/> 显示空值{sliceAgg.emptyCount?` ${sliceAgg.emptyCount}`:''}</label>}
      <span className={styles.projectCount}>{filtered?.supported?visible.length:0} 项{hiddenClosed?` · 已隐藏 ${hiddenClosed} 个已关闭`:''}{snapshot&&snapshot.items.some(item=>item.kind==='restricted')?` · ${snapshot.items.filter(item=>item.kind==='restricted').length} 项权限受限`:''}</span>
      <label className={styles.projectToggle}><input type="checkbox" checked={includeClosed} onChange={event=>setIncludeClosed(event.target.checked)}/> 含已关闭</label>
      <label className={styles.projectToggle}><input type="checkbox" checked={extraColumns} onChange={event=>setExtraColumns(event.target.checked)}/> 时间与仓库列</label>
      {entry&&<span className={styles.projectLink}><TrustedLink url={entry}>原始视图</TrustedLink></span>}
    </div>
      <InteractiveTable key={`${source.projectId}/${source.id}/${viewNumber}/${expression}`} label="真实 Project 条目" resetKey={JSON.stringify([snapshot?.observedAt,includeClosed,sliceField?.id,[...sliceSelected],showEmpty])} rows={orderProjectRows(visible,issues,new Set())} arrangeRows={matching=>orderProjectRows(matching.map(row=>row.item),issues,collapsed)} columns={tableColumns} rowKey={row=>row.item.id} searchText={row=>`${row.issue?.number??''} #${row.issue?.number??''} ${row.issue?.title??row.item.title??''} ${row.issue?.repository.owner??row.item.facts?.repository.owner??''}/${row.issue?.repository.repository??row.item.facts?.repository.repository??''}`} searchLabel="搜索 Project 条目" scope={`当前 Project：${sourceName(source)} · 视图：${view?.name??'未选择'} · 完整扫描快照 ${snapshot?.observedAt??'尚无'}；仅当前视图、含关闭设置和入口切片范围`} unavailable={!state.catalog?'尚无可读缓存：尚无真实 Project 视图缓存，请刷新来源。':!view?'保存的 view 不在当前可读取目录中，请选择真实视图。':!snapshot?'完整 Project 成员扫描尚未完成，请刷新继续；没有用全列表冒充视图。':filtered&&!filtered.supported?filtered.reason:undefined}/>
    <details><summary>字段定义</summary><ul>{catalog.fields.map(field=><li key={field.id}>{field.name} · {field.dataType}{field.options?.length?` · ${field.options.map(option=>`${option.name}(${option.color})`).join(' / ')}`:''}</li>)}</ul></details>
  </section>
}
type ProjectFieldDefinition = { id: string; name: string; dataType: string; options?: { id: string; name: string; color: string }[] }
const columnWeights: Record<string, number> = { ASSIGNEES: 16, STATUS: 8, LABELS: 11, LINKED_PULL_REQUESTS: 8, PARENT_ISSUE: 11, SUB_ISSUES_PROGRESS: 15, REPOSITORY: 11, MILESTONE: 13, REVIEWERS: 9, CREATED: 7, UPDATED: 7, CLOSED: 7 }
const columnWeight = (dataType: string) => columnWeights[dataType] ?? 10
const chipClasses: Record<string,string> = { GRAY: styles.chipGray, BLUE: styles.chipBlue, GREEN: styles.chipGreen, YELLOW: styles.chipYellow, ORANGE: styles.chipOrange, RED: styles.chipRed, PINK: styles.chipPink, PURPLE: styles.chipPurple }
const avatarPalette = ['#1f6feb','#8250df','#1a7f37','#bc4c00','#cf222e','#0969da','#bf3989','#57606a']
function avatarColor(login: string) { let hash = 0; for (const character of login) hash = (hash * 31 + character.charCodeAt(0)) >>> 0; return avatarPalette[hash % avatarPalette.length]! }
/** One Project cell rendered like the GitHub board: chips, avatars, label pills and a progress bar. */
const supportedFieldTypes=new Set(['TITLE','ASSIGNEES','LABELS','REPOSITORY','PARENT_ISSUE','SUB_ISSUES_PROGRESS','LINKED_PULL_REQUESTS','REVIEWERS','CREATED','UPDATED','CLOSED','MILESTONE','SINGLE_SELECT','STATUS','ITERATION','TEXT','NUMBER','DATE'])
function projectValues(field:ProjectFieldDefinition,row:ProjectRow):string[] {
  return projectFieldValues(field,row.issue,row.item)
}
function projectSortValue(field:ProjectFieldDefinition,row:ProjectRow):string|number {
  const facts=row.item.facts,issue=row.issue,value=row.item.fields.find(entry=>entry.id===field.id)?.value
  if(field.dataType==='NUMBER'&&value!==undefined&&Number.isFinite(Number(value)))return Number(value)
  if(field.dataType==='CREATED')return issue?.createdAt??facts?.createdAt??''
  if(field.dataType==='UPDATED')return issue?.updatedAt??facts?.updatedAt??''
  if(field.dataType==='CLOSED')return issue?.closedAt??facts?.closedAt??''
  return projectValues(field,row).join(', ')
}
function ProjectCell({field,row,fields}:{field:ProjectFieldDefinition;row:ProjectRow;fields:ProjectFieldDefinition[]}) {
  const {item,issue}=row, cell=projectFieldCell(field,issue,item), partial=item.fieldsPartial?' · 字段部分观察':''
  if(projectValues(field,row).includes(UNKNOWN_FIELD_VALUE))return <>{UNKNOWN_FIELD_VALUE}{partial}</>
  if(field.dataType==='ASSIGNEES'){const logins=issue?.assignees??item.facts?.assignees??[];return <>{logins.length?logins.map(login=><span key={login} style={{whiteSpace:'nowrap',marginRight:8}}><span className={styles.avatar} style={{background:avatarColor(login)}}>{login.slice(0,1)}</span>{login}</span>):'—'}{partial}</>}
  if(field.dataType==='LABELS'){const labels=issue?.labels??item.facts?.labels??[];return <>{labels.length?labels.map(label=><span key={label} className={styles.labelPill}>{label}</span>):'—'}{partial}</>}
  if(field.dataType==='SUB_ISSUES_PROGRESS'){const summary=issue?.subIssuesSummary,children=issue?.subIssues,total=summary?.total??children?.totalCount;if(!total)return <>—{partial}</>;const completed=summary?.completed??children?.items.filter(child=>child.state==='closed').length??0,pct=Math.floor(completed/total*100)
    const segments=Math.min(total,10),filled=Math.round((completed/total)*segments)
    return <div className={styles.progress}><div className={styles.progressSegments}>{Array.from({length:segments},(_,index)=><span key={index} className={index<filled?styles.segmentOn:styles.segmentOff}/>)}</div><span className={styles.progressText}>{completed}/{total} · {pct}%{summary===undefined&&children?.hasNextPage?' · 部分观察':''}</span></div>}
  const option=fieldOption(fields,field.id,cell.text)
  return <>{option?<span className={`${styles.chip} ${chipClasses[option.color.toUpperCase()]??styles.chipGray}`}>{cell.text}</span>:cell.parts?cell.parts.map((part,index)=>part.url?<TrustedLink key={index} url={part.url}>{part.label}</TrustedLink>:<span key={index}>{part.label}</span>):cell.text}{partial}</>
}
function PullRequests({controller}:{controller:WorkPanelController}) {
  const state=controller.getSnapshot(),catalog=state.source.catalog,source=state.source.sources.find(item=>item.id===state.source.sourceId)
  const progress=(pr:import('../work-sources/types.ts').GitHubPullRequest)=>pr.issues.map(issue=>controller.progressForIssue(issue)).find(item=>item!==undefined)
  const columns:TableColumn<import('../work-sources/types.ts').GitHubPullRequest>[]=[
    {id:'title',label:'PR',protected:true,width:3,values:pr=>[pr.title],qualifiers:[{id:'state',label:'PR 状态',values:pr=>[pr.state]},{id:'type',label:'PR 类型',values:pr=>[pr.draft?'草稿':'就绪']}],render:pr=><TrustedLink url={pr.url}>{pr.repository.owner}/{pr.repository.repository} #{pr.number} {pr.title}</TrustedLink>},
    {id:'status',label:'状态',groupable:true,values:pr=>[pr.state],render:pr=><>{({open:'开放',closed:'已关闭',merged:'已合并'})[pr.state]}{pr.draft?' · 草稿':''}</>},
    {id:'session',label:'会话',width:1.5,values:pr=>{const entry=sessionOf(progress(pr));return entry?[entry.session.sessionId]:[]},render:pr=><SessionCell entry={sessionOf(progress(pr))} onOpen={session=>controller.openSession(session)}/>},
    {id:'issues',label:'相关 Issue',values:pr=>pr.issues.map(issue=>`${issue.url} #${issue.number}`),render:pr=><>{pr.issues.length?pr.issues.map(issue=><span key={issue.url} style={{marginRight:8}}><TrustedLink url={issue.url}>#{issue.number}</TrustedLink></span>):'未观察到关联'}{!pr.issuesComplete?' · 部分':''}</>},
    {id:'checks',label:'检查 / 评审',groupable:true,values:pr=>[`${pr.checks??'未提供'} / ${pr.review??'未提供'}`],render:pr=><span title={`${pr.checks??'未提供'} / ${pr.review??'未提供'}`}>{pr.checks??'—'} · {pr.review??'—'}</span>},
  ]
  return <section><h2>PR 只读目录</h2><InteractiveTable label="PR 目录" resetKey={catalog?.observedAt} complete={catalog?.pullRequestsComplete??false} columns={columns} rows={catalog?.pullRequests??[]} rowKey={pr=>pr.nodeId} searchText={pr=>`${pr.repository.owner}/${pr.repository.repository} #${pr.number} ${pr.title}`} searchLabel="搜索 PR" scope={`当前来源：${source?sourceName(source):'未选择'} · ${catalog?.pullRequestsComplete?'当前范围完整观察':'部分目录，不能视为全量'} · 引用不等于验收`} unavailable={!catalog?'PR 目录尚无可读缓存，请刷新来源；读取失败不表示空目录。':undefined}/></section>
}
function TrustedLink({url,children}:{url:string;children:ReactNode}) {
  let safe=false
  try{const value=new URL(url);safe=value.protocol==='https:'&&value.hostname==='github.com'&&!value.port&&!value.username&&!value.password}catch{}
  return safe?<a href={url} target="_blank" rel="noreferrer">{children}</a>:<span>{children}（链接不可用）</span>
}
