import { SourceSwitcher } from './source-switcher.tsx'
import { ListQueryBar } from './list-query-bar.tsx'
import { PanelIcon } from './icons.tsx'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { WorkPanelController, SourceTab } from './work-panel-controller.ts'
import type { GitHubPullRequest, WorkSource } from '../work-sources/types.ts'
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
const pullRequestLabel = (pr: GitHubPullRequest, source?: WorkSource) => {
  const repository = `${pr.repository.owner}/${pr.repository.repository}`
  const current = source?.repository ? `${source.repository.owner}/${source.repository.repository}` : null
  return `${repository.toLowerCase() === current?.toLowerCase() ? '' : `${repository} `}#${pr.number} ${pr.title}`
}
const isUnobservedSource = (error: string | null | undefined) => Boolean(error && (error.startsWith('source-page-unobserved:') || error.startsWith('source-catalog-unobserved:') || error === '目录尚无可读缓存，请刷新来源'))
/** One line of scan progress: fetched/total items and the page being read, with a bar when the total is known. */
export function ScanProgressLine({scan}:{scan:SourceScanProgress|null}) {
  if(!scan||(!scan.pages&&!scan.fetched))return null
  const total=scan.total, fetched=scan.fetched
  return <div role="status" className={styles.scanProgress}>
    <p>正在读取来源目录… 已取 {fetched}{total===undefined?'':`/${total}`} 项 · 第 {Math.max(1,scan.pages)} 页</p>
    {total!==undefined&&total>0?<progress value={Math.min(fetched,total)} max={total} aria-label="来源扫描进度"/>:<progress aria-label="来源扫描进度"/>}
  </div>
}
export function SourceTabs({controller,onAdd}:{controller:WorkPanelController;onAdd:()=>void}) {
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot)
  const current=state.source, source=current.sources.find(item=>item.id===current.sourceId)
  const options=Object.entries(state.projectSources).flatMap(([projectId,sources])=>sources.map(item=>({projectId,source:item,value:`${projectId}/${item.id}`})))
  const selected=options.find(item=>item.projectId===state.projectId&&item.source.id===current.sourceId)
  const observed=current.tab==='issues'?current.listing?.observedAt:current.catalog?.observedAt
  const error=(isUnobservedSource(current.error)?null:current.error)??(isUnobservedSource(state.observationError)?null:state.observationError)
  const status=current.loading?'正在刷新':source?.enabled===false?'已停用':error?(observed?'更新失败 · 显示缓存':'更新失败'):!observed?'尚未刷新':current.cached?'显示缓存':'已更新'
  const reader=(current.tab==='issues'?current.listing?.identity.login:current.catalog?.identity?.login)??source?.identity?.login
  const activeLogin=state.github.account?.identity?.login
  return <div className={styles.sourceContext}>
    <nav className={styles.sourcePicker} aria-label="来源标签">
      <span className={styles.sourceKind} title={source?.repository?'GitHub 仓库':'GitHub Project'}><PanelIcon name={source?.repository?'repo':'project'}/></span>
      <SourceSwitcher options={options} value={selected?.value} onSelect={value=>{const option=options.find(item=>item.value===value);if(option)void controller.selectConnectedSource(option.projectId,option.source.id)}}/>
      <button className={styles.addSourceButton} aria-label="添加来源" title="添加来源" onClick={onAdd}><PanelIcon name="plus"/></button>
    </nav>
    {source&&<div className={styles.sourceSync}>
      <details className={styles.sourceSyncDetails} data-source-freshness={current.loading?'loading':!observed?'unknown':current.cached?'cached':'fresh'}>
        <summary aria-label={`来源同步状态：${status}`} title={status}><PanelIcon name={source.enabled===false?'pause':error?'alert':!observed||current.cached?'clock':'check'} className={error?styles.statusWarning:undefined}/>{current.loading&&<span className={styles.visuallyHidden}>正在刷新</span>}{observed&&<time dateTime={observed}>{new Date(observed).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time>}<PanelIcon name="chevron" size={12}/></summary>
        <div className={styles.sourceSyncPopover}>
          <strong>{status}</strong>
          {observed?<p><time dateTime={observed}>{new Date(observed).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></p>:<p>尚无缓存</p>}
          {reader&&reader!==activeLogin&&<p title="此数据读取时使用的账号">读取账号 @{reader}</p>}
          {error&&<p>{error}</p>}
          <button disabled={current.loading} onClick={()=>void (current.tab==='issues'?controller.browseIssues({},false):controller.browseDirectory(false))}>读取缓存</button>
        </div>
      </details>
      <button className={styles.sourceRefresh} aria-label="刷新来源" aria-busy={current.loading} title={current.loading?'正在刷新来源':'刷新来源'} disabled={current.loading||!source.enabled} onClick={()=>void (current.tab==='issues'?controller.browseIssues({},true):controller.browseDirectory(true))}><PanelIcon name="refresh" className={current.loading?styles.iconSpin:undefined}/></button>
    </div>}
  </div>
}
export function SourceDirectory({controller,issues,delegation,panelContent,panel,onPanel}:{controller:WorkPanelController;issues:ReactNode;delegation?:ReactNode;panelContent?:ReactNode;panel:'none'|'continuation';onPanel:(panel:'none'|'continuation')=>void}) {
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot), sourceState=state.source
  const [menu,setMenu]=useState(false)
  useEffect(()=>{ if(!menu)return; const close=()=>setMenu(false); document.addEventListener('click',close); return ()=>document.removeEventListener('click',close) },[menu])
  const source=sourceState.sources.find(source=>source.id===sourceState.sourceId)
  if(!source)return null
  const tabs:[SourceTab,string][]=[['overview','概览'],...(source.githubProject?[['project','项目'] as [SourceTab,string]]:[]),['issues','Issue'],['prs','PR'],['delegation','持续委托']]
  return <>
    <div className={styles.sourceHeader}>
      <nav className={styles.tabs} aria-label="来源目录">{tabs.map(([tab,label])=><button key={tab} aria-pressed={sourceState.tab===tab} onClick={()=>void controller.selectSourceTab(tab)}>{label}</button>)}</nav>
      <div className={styles.sourceActions}>
        <div className={styles.menuWrap}>
          <button className={styles.iconButton} aria-label="来源操作" aria-expanded={menu} title="来源设置：读取缓存 / 持续委托 / 自动接续" onClick={event=>{event.stopPropagation();setMenu(open=>!open)}}><MoreIcon/></button>
          {menu&&<div className={styles.menu} role="menu">
            <button role="menuitem" disabled={sourceState.loading} onClick={event=>{event.stopPropagation();setMenu(false);void controller.browseDirectory(false)}}>读取缓存</button>
            <button role="menuitem" aria-pressed={sourceState.tab==='delegation'} onClick={event=>{event.stopPropagation();setMenu(false);void controller.selectSourceTab('delegation')}}>持续委托</button>
            <button role="menuitem" aria-pressed={panel==='continuation'} onClick={event=>{event.stopPropagation();setMenu(false);onPanel(panel==='continuation'?'none':'continuation')}}>自动接续</button>
          </div>}
        </div>
      </div>
    </div>
    {sourceState.tab!=='delegation'&&panelContent}
    {sourceState.tab==='delegation'?delegation:sourceState.tab==='issues'?issues:<>
      {sourceState.loading&&<ScanProgressLine scan={sourceState.scan}/>}{!sourceState.loading&&sourceState.scan&&sourceState.scan.total!==undefined&&sourceState.scan.fetched<sourceState.scan.total&&<p role="status">Project 扫描未完成：已取 {sourceState.scan.fetched}/{sourceState.scan.total} 项，刷新来源可继续。</p>}{sourceState.error&&<p role="alert" className={styles.failure}>{sourceState.error}</p>}{!source.enabled&&<p role="status">来源已停用，保留已保存内容。</p>}

      {sourceState.catalog?.limitations.map(reason=><p role="status" key={reason}>{reason}</p>)}
      {sourceState.tab==='overview'&&<SourceOverview controller={controller} source={source}/>}
      {sourceState.tab==='project'&&<ProjectViews key={`${source.projectId}/${source.id}/${sourceState.viewNumber??'entry'}`} controller={controller} source={source}/>}
      {sourceState.tab==='prs'&&<PullRequests key={source.id} controller={controller}/>}
    </>}
  </>
}
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
  const [activityView,setActivityView]=useState<'attention'|'processing'|'recent'>(()=>attention.length?'attention':processing.length?'processing':'recent')
  const activityItems=activityView==='attention'?attention:activityView==='processing'?processing:[...relevant].sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??'')).slice(0,8)
  const activityKnown=workKnown||relevant.length>0
  const activityViews=[{id:'attention',label:'需要关注',count:attention.length},{id:'processing',label:'正在处理',count:processing.length},{id:'recent',label:'最近进展',count:relevant.length}] as const
  const activityEmptyTitle=!activityKnown?'工作进展尚未读取':!relevant.length?'还没有关联的工作':activityView==='attention'?'暂时没有需要关注的工作':'当前没有正在处理的工作'

  return <section className={styles.sourceOverview} aria-label="来源概览"><h2 className={styles.visuallyHidden}>来源概览</h2>
    <div className={styles.overviewSummary} role="group" aria-label="来源统计">
      <div title={open===undefined?'尚未完整观察':source.repository?'GitHub 全仓库计数':`完整扫描的可见收录 · ${snapshot?.observedAt}`}><span>开放 Issue</span><strong>{open??'—'}</strong>{incomplete&&<small>部分可见</small>}</div>
      <div title={catalog?catalog.pullRequestsComplete?'当前范围完整观察':'部分观察，非全量':'尚未完整观察'}><span>PR</span><strong>{catalog?catalog.pullRequests.length:'—'}</strong>{catalog&&!catalog.pullRequestsComplete&&<small>部分</small>}</div>
    </div>
    {source.discovery?.checkpoint&&<p className={styles.overviewFootnote} role="status">正在扫描来源，已读取 {source.discovery.checkpoint.pages} 页，当前保留上次完整结果。</p>}
    <div className={styles.overviewActivity}>
      <div className={styles.overviewSegments} role="group" aria-label="工作动态视图">{activityViews.map(view=><button key={view.id} type="button" data-work-view={view.id} aria-pressed={activityView===view.id} onClick={()=>setActivityView(view.id)}><PanelIcon name={view.id==='attention'?'alert':view.id==='processing'?'play':'clock'}/>{view.label}<span>{activityKnown?view.count:'—'}</span></button>)}</div>
      {activityItems.length?<ul className={styles.overviewActivityList}>{activityItems.map(item=><li key={`${item.ref.projectId}/${item.ref.taskId}`}>
        <span className={styles.overviewActivityIcon}><PanelIcon name={['waiting','paused','blocked'].includes(item.processingState??'')?'alert':item.processingState==='processing'?'play':'clock'}/></span>
        <div><button className={styles.link} onClick={()=>void controller.openTask(item.ref)}>#{item.source?.number} {item.title}</button><p>{item.processingReason||item.summary||'尚无工作报告'}</p>{item.next&&<p>下一步：{item.next}</p>}</div>
        <span className={styles.overviewActivityState}>{({processing:'处理中',waiting:'等待确认',paused:'已暂停',blocked:'受阻',completed:'已完成','not-started':'未开始'})[item.processingState??'not-started']}</span>
      </li>)}</ul>:<div className={styles.overviewActivityEmpty} role="status"><PanelIcon name={!activityKnown?'clock':!relevant.length?'repo':'check'} size={22}/><h3>{activityEmptyTitle}</h3><p>{!activityKnown?'刷新来源后查看已关联工作的进展。':!relevant.length?'从 Issue 中选择一项工作，开始后会在这里显示进展。':'可以切换到最近进展，查看其他工作的更新。'}</p>
        {!activityKnown?<button disabled={state.source.loading||!source.enabled} onClick={()=>void controller.browseDirectory(true)}>刷新来源</button>:!relevant.length?<button onClick={()=>void controller.selectSourceTab('issues')}>查看 Issue</button>:<button onClick={()=>setActivityView('recent')}>最近进展</button>}
      </div>}
    </div>
    {catalog&&catalog.pullRequests.length>0&&<div className={styles.overviewExternal}><h3>最近外部更新</h3><ul>{catalog.pullRequests.slice(0,5).map(pr=><li key={pr.nodeId}><TrustedLink url={pr.url}>{pullRequestLabel(pr,source)}</TrustedLink><span>{new Date(pr.updatedAt).toLocaleDateString('zh-CN')}</span></li>)}</ul></div>}
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
  const [search,setSearch]=useState('')
  const [filtersOpen,setFiltersOpen]=useState(false)
  const [prState,setPrState]=useState('all'),[prType,setPrType]=useState('all')
  const [stateDraft,setStateDraft]=useState('all'),[typeDraft,setTypeDraft]=useState('all')
  const rows=catalog?.pullRequests.filter(pr=>(prState==='all'||pr.state===prState)&&(prType==='all'||pr.draft===(prType==='draft')))??[]
  const matchedCount=rows.filter(pr=>`${pr.repository.owner}/${pr.repository.repository} #${pr.number} ${pr.title}`.toLowerCase().includes(search.toLowerCase())).length
  const filterCount=Number(prState!=='all')+Number(prType!=='all')
  const applyFilters=()=>{setPrState(stateDraft);setPrType(typeDraft);setFiltersOpen(false)}
  const resetFilters=()=>{setSearch('');setPrState('all');setPrType('all');setStateDraft('all');setTypeDraft('all');setFiltersOpen(false)}
  const {loading,error}=state.source
  const progress=(pr:import('../work-sources/types.ts').GitHubPullRequest)=>pr.issues.map(issue=>controller.progressForIssue(issue)).find(item=>item!==undefined)
  const columns:TableColumn<import('../work-sources/types.ts').GitHubPullRequest>[]=[
    {id:'title',label:'PR',protected:true,width:3,values:pr=>[pr.title],qualifiers:[{id:'state',label:'PR 状态',values:pr=>[pr.state]},{id:'type',label:'PR 类型',values:pr=>[pr.draft?'草稿':'就绪']}],render:pr=><TrustedLink url={pr.url}>{pullRequestLabel(pr,source)}</TrustedLink>},
    {id:'status',label:'状态',groupable:true,values:pr=>[pr.state],render:pr=><>{({open:'开放',closed:'已关闭',merged:'已合并'})[pr.state]}{pr.draft?' · 草稿':''}</>},
    {id:'session',label:'会话',width:1.5,values:pr=>{const entry=sessionOf(progress(pr));return entry?[entry.session.sessionId]:[]},render:pr=><SessionCell entry={sessionOf(progress(pr))} onOpen={session=>controller.openSession(session)}/>},
    {id:'issues',label:'相关 Issue',values:pr=>pr.issues.map(issue=>`${issue.url} #${issue.number}`),render:pr=><>{pr.issues.length?pr.issues.map(issue=><span key={issue.url} style={{marginRight:8}}><TrustedLink url={issue.url}>#{issue.number}</TrustedLink></span>):'未观察到关联'}{!pr.issuesComplete?' · 部分':''}</>},
    {id:'checks',label:'检查 / 评审',groupable:true,values:pr=>[`${pr.checks??'未提供'} / ${pr.review??'未提供'}`],render:pr=><span title={`${pr.checks??'未提供'} / ${pr.review??'未提供'}`}>{pr.checks??'—'} · {pr.review??'—'}</span>},
  ]
  const readError=Boolean(error&&!(!catalog&&isUnobservedSource(error)))
  const emptyTitle=readError?'暂时无法更新 PR':!catalog?'尚未读取 PR':catalog.pullRequestsComplete?'当前来源暂无 PR':'已读取范围暂无 PR'
  const emptyDescription=readError?'未能取得最新目录，可检查账号权限或网络后重试。':!catalog?'读取当前来源后查看 PR 与关联会话。':catalog.pullRequestsComplete?'后续发现的 PR 会出现在这里。':'当前目录仍为部分观察，不能据此判断来源没有 PR。'
  const appliedFilters=<div className={styles.issueApplied} aria-label="已应用的 PR 筛选">{prState!=='all'&&<button onClick={()=>{setPrState('all');setStateDraft('all')}}>{({open:'Open',closed:'Closed',merged:'Merged'})[prState as 'open'|'closed'|'merged']} <PanelIcon name="close" size={12}/></button>}{prType!=='all'&&<button onClick={()=>{setPrType('all');setTypeDraft('all')}}>{prType==='draft'?'草稿':'就绪'} <PanelIcon name="close" size={12}/></button>}</div>
  return <section className={styles.issueList} aria-label="PR 目录"><h2 className={styles.visuallyHidden}>PR 列表</h2>
    <ListQueryBar label="搜索 PR" placeholder="搜索 PR" searchTitle="搜索已读取的 PR" value={search} onChange={setSearch} onSubmit={applyFilters} count={loading?'读取中…':catalog?`${matchedCount} 项${catalog.pullRequestsComplete?'':' · 部分'}`:'尚未读取'} disabled={loading||!source?.enabled} filtersOpen={filtersOpen} filterCount={filterCount} filterId="a2d2-pr-filters" onToggleFilters={()=>setFiltersOpen(open=>!open)}>
      <label>GitHub 状态<select aria-label="PR 状态" value={stateDraft} onChange={event=>setStateDraft(event.target.value)}><option value="all">全部状态</option><option value="open">Open</option><option value="closed">Closed</option><option value="merged">Merged</option></select></label>
      <label>类型<select aria-label="PR 类型" value={typeDraft} onChange={event=>setTypeDraft(event.target.value)}><option value="all">全部类型</option><option value="draft">草稿</option><option value="ready">就绪</option></select></label>
      <div className={styles.issueFilterActions}><button type="button" onClick={resetFilters}>重置</button><button type="submit" disabled={loading||!source?.enabled}>应用</button></div>
    </ListQueryBar>
    {!(catalog&&catalog.pullRequests.length>0)&&appliedFilters}
    {catalog&&catalog.pullRequests.length>0&&<>

      {error&&<div className={styles.issueReadNotice} role="alert">更新未完成，保留上次目录。<button disabled={loading||!source?.enabled} onClick={()=>void controller.browseDirectory(true)}>重试</button></div>}
      <InteractiveTable compact toolbarContent={appliedFilters} emptyState={<div className={styles.issueEmpty} role="status"><h3>没有匹配的 PR</h3><button onClick={resetFilters}>清除筛选</button></div>} label="PR 目录" resetKey={catalog.observedAt} complete={catalog.pullRequestsComplete} columns={columns} rows={rows} rowKey={pr=>pr.nodeId} searchText={pr=>`${pr.repository.owner}/${pr.repository.repository} #${pr.number} ${pr.title}`} searchLabel="搜索 PR" searchControl={{value:search,onChange:setSearch}} scope="PR 列表仅用于浏览与关联，不代表任务验收"/>
    </>}
    {loading&&(!catalog||!catalog.pullRequests.length)?<div className={styles.issueSkeleton} role="status"><span className={styles.visuallyHidden}>正在读取 PR…</span>{[0,1,2].map(value=><div key={value}><span/><span/></div>)}</div>:!catalog||!catalog.pullRequests.length?<div className={styles.issueEmpty} role="status"><span className={styles.issueEmptyIcon}><PanelIcon name={readError?'alert':'repo'} size={22}/></span><h3>{emptyTitle}</h3><p>{emptyDescription}</p><button disabled={loading||!source?.enabled} onClick={()=>void controller.browseDirectory(true)}>{readError?'重试':!catalog?'读取 PR':'刷新'}</button></div>:null}
  </section>
}
function TrustedLink({url,children}:{url:string;children:ReactNode}) {
  let safe=false
  try{const value=new URL(url);safe=value.protocol==='https:'&&value.hostname==='github.com'&&!value.port&&!value.username&&!value.password}catch{}
  return safe?<a href={url} target="_blank" rel="noreferrer">{children}</a>:<span>{children}（链接不可用）</span>
}
