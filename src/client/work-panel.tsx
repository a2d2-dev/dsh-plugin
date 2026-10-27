import { useScrollLoad } from './use-scroll-load.ts'
import { ListQueryBar } from './list-query-bar.tsx'
import { IssueMarkdown } from './issue-markdown.tsx'
import { PanelIcon } from './icons.tsx'
import { GitHubAccountControl } from './github-account.tsx'
import { ExecutionSessions, ExecutionContinuation } from './execution-components.tsx'
import { CompletionStatus } from './completion-status.tsx'
import { ContinuousDelegation } from './continuous-delegation.tsx'
import { SourceConnect } from './source-connect.tsx'
import { SourceDirectory, SourceTabs } from './source-directory.tsx'
import { InteractiveTable } from './interactive-table.tsx'
import type { TableColumn } from './interactive-table.tsx'
import { SessionCell, sessionOf } from './session-cell.tsx'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { DetailTab, WorkPanelController } from './work-panel-controller.ts'
import type { AssociatedWork, WorkExecution, WorkTask, WorkExecutionOptions, ContinuousWorkRule } from '../work-types.ts'
import type { GitHubIssue } from '../work-sources/types.ts'
import { message } from './work-panel-controller.ts'
import styles from './work-panel.module.css'

const detailTabs: [DetailTab,string][] = [['overview','概览'],['related','子项'],['sessions','会话'],['continuation','接续'],['activity','活动']]
const issueFilters = [['all','全部'],['not-started','未开始'],['processing','处理中'],['waiting','等待'],['blocked','阻塞'],['completed','已完成']] as const

export function WorkPanel({ controller }: { controller: WorkPanelController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const detailScroll=useRef<HTMLDivElement>(null)
  useEffect(()=>{if(detailScroll.current)detailScroll.current.scrollTop=0},[state.detailTab,state.source.issueTarget?.nodeId,state.detail?.task?.id])
  const [connecting,setConnecting]=useState(false),[surface,setSurface]=useState<HTMLElement|null>(null),[panel,setPanel]=useState<'none'|'continuation'>('none')
  useEffect(() => { void controller.initialize(); return () => controller.leavePanel() }, [controller])
  useEffect(() => {
    if(connecting||!surface||typeof document==='undefined') return
    const allowed=()=>document.visibilityState==='visible'&&surface.isConnected
      && !surface.querySelector('details[open] form')
      && !(surface.contains(document.activeElement)&&document.activeElement?.closest('form'))
    const timer=setInterval(()=>{void controller.observeCurrent(allowed)},5000)
    return ()=>{clearInterval(timer);controller.stopObservation()}
  },[controller,connecting,surface])
  const project=state.projects.find(item=>item.id===state.projectId)
  const projects=controller.connectedProjects()
  const source=state.source.sources.find(item=>item.id===state.source.sourceId)
  const detail=state.detail, task=detail?.task
  const continuationCompleted=Boolean(task?.completion||detail?.progress?.completion||detail?.progress?.processingState==='completed')
  const selectedNode=state.source.issueTarget?.nodeId
  const binding=detail?.bindings?.find(item=>item.nodeId===selectedNode)??detail?.bindings?.[0]
  const issue=task ? (binding?.lastObserved ?? (state.source.bindings.some(item=>item.ref.taskId===task.id&&item.ref.projectId===task.projectId)?state.source.issue:null)) : state.source.issue
  const target=task?null:state.source.issueTarget
  const detailPending=Boolean(target&&(state.source.loading||state.loading))
  const detailUnavailable=Boolean(target&&(state.source.error||state.error))
  const hasDetail=Boolean(task||issue||target)
  const retryIssue=()=>void controller.refreshDetail()
  const issueRepository=issue?`${issue.repository.owner}/${issue.repository.repository}`:null
  const sourceRepository=source?.repository?`${source.repository.owner}/${source.repository.repository}`:null
  return <main ref={setSurface} data-delegation={state.source.tab==='delegation'&&!hasDetail} className={`${styles.panel} ${hasDetail&&!connecting?styles.detailPanel:''}`} aria-label="A²D² 控制面板">
    <header className={styles.navigation}><div className={styles.panelContext}><SourceTabs controller={controller} onAdd={()=>setConnecting(!connecting)}/></div><div className={styles.panelUtilities}><GitHubAccountControl controller={controller} onManageSources={()=>setConnecting(true)}/><button className={styles.closePanel} aria-label="关闭面板" title="关闭面板" onClick={()=>controller.close()}><PanelIcon name="close" size={18}/></button></div></header>
    {state.error&&<p className={styles.failure} role="alert">{state.error} <button onClick={retryIssue}>重新读取</button></p>}

    {state.startup.error&&<ErrorText error={state.startup.error}/>}
    {state.startup.busy&&<p role="status">正在准备执行，请稍候…</p>}
    {(connecting||(!projects.length&&!hasDetail&&!state.loading))&&<SourceConnect controller={controller} onBack={connecting?()=>setConnecting(false):undefined} onSaved={()=>setConnecting(false)}/>}
    {state.loading&&<p role="status">正在读取 Issue 与进展…</p>}
    {!connecting&&hasDetail?<>
      <header className={styles.issueHeader}><div className={styles.detailActions}><button className={styles.sourceRefresh} aria-label="返回 Issue 列表" title={controller.canReturnToRequirement()?'返回上级':'返回列表'} onClick={()=>controller.back()}><PanelIcon name="back"/></button><span className={styles.badge}>{detailPending?'读取中…':task?.completion?'已完成':detailUnavailable?'读取失败':processingLabel(detail?.progress)}</span><div className={styles.panelUtilities}>{!detail?.execution&&!continuationCompleted&&!state.startup.options&&!detailPending&&!detailUnavailable&&<button className={styles.detailStart} disabled={state.startup.busy||state.loading||state.source.loading||detailPending||detailUnavailable||!issue&&!task} onClick={()=>void controller.prepareStart(!state.detail?.task)}><PanelIcon name="play"/>开始处理</button>}{issue&&<GitHubLink url={issue.url}/>}<button className={styles.sourceRefresh} aria-label="刷新详情" title="刷新" aria-busy={detailPending} disabled={state.loading||state.source.loading} onClick={retryIssue}><PanelIcon name="refresh" className={detailPending?styles.iconSpin:undefined}/></button></div></div>{issueRepository&&issueRepository!==sourceRepository&&<p className={styles.issueFacts}>{issueRepository} · #{issue?.number}</p>}<h1>{issue?`#${issue.number} ${issue.title}`:target?`#${target.number}`:task?.title}</h1></header>

      <nav className={`${styles.tabs} ${styles.detailTabs}`} role="tablist" aria-label="Issue 详情标签">{detailTabs.map(([id,label])=><button key={id} role="tab" aria-selected={state.detailTab===id} onClick={()=>controller.setDetailTab(id)}>{label}</button>)}</nav>
      <div ref={detailScroll} tabIndex={0} className={styles.detailContent} role="tabpanel" aria-label={detailTabs.find(([id])=>id===state.detailTab)?.[1]} aria-busy={detailPending}>
        {detailPending?<p role="status">正在加载 Issue 详情与进展…</p>:detailUnavailable?<><p role="status">详情读取失败，进展状态尚未确认，请重试加载详情。</p>{issue&&<Section title="正文"><IssueFacts issue={issue}/><p>最后已知内容</p><IssueMarkdown text={issue.body} sourceUrl={issue.url}/></Section>}</>:!issue&&!task?<p role="status">详情尚未读取，请重试加载详情。</p>:<>
        {state.detailTab==='overview'&&<>
          {task&&<CompletionStatus task={task} execution={detail?.execution} remoteState={binding?.lastObserved.state} busy={state.startup.busy} error={state.startup.error??undefined} onSync={command=>controller.syncCompletion(command)}/>}
          {(task||detail?.execution)?<div className={styles.detailGrid}><div><Section title="进展"><p>{detail?.progress?.summary??(task?.completion?'本地已验收，保留完成事实与收口状态。':'尚未开始处理')}</p>{detail?.progress&&<CriteriaCount criteria={detail.progress.criteria}/>}<p>下一步：{detail?.progress?.next||(task?.completion?(task.completion.closeout.status==='settled'?'已完成本地工作；外部同步独立观察':'等待执行安全收口'):!detail?.execution?'确认要求后开始处理':'等待当前会话报告下一步')}</p>{detail?.progress?.blockers.map((blocker,index)=><p className={styles.failure} key={index}>阻塞：{blocker}</p>)}</Section>{task&&(task.breakdown.length>0||task.children.length>0)&&<Requirements controller={controller}/>}</div><CurrentExecution controller={controller}/></div>:<CurrentExecution controller={controller}/>}
          {issue&&<Section title="正文"><IssueFacts issue={issue}/><IssueMarkdown text={issue.body} sourceUrl={issue.url}/><NativeIssueRelations issue={issue} controller={controller}/></Section>}
          {task&&<Section title="已接受要求与验收"><p>{task.goal}</p>{task.specification.text!==issue?.body&&<details><summary>已接受规格 · 第 {task.specification.version} 版</summary><IssueMarkdown text={task.specification.text}/></details>}{task.specification.missing?.includes('acceptance')&&<p role="status">结构化验收标准尚待确认。原始要求中的验收段落需由处理会话确认。</p>}{task.specification.missing?.includes('body')&&<p role="status">规格正文尚待补充；已观察的 Issue 正文为空。</p>}<ul>{task.specification.acceptance.map((criterion,index)=>{const result=task.progress?.specificationVersion===task.specification.version?task.progress.criteria.find(item=>item.index===index):undefined;return <li key={index}>{criterion} · {result?result.passed?'已通过':'未通过':'待核验'}{result?.evidence.map((evidence,index)=><p key={index}>证据：{evidence}</p>)}</li>})}</ul></Section>}
          {binding&&<SourceBinding binding={binding}/>}
        </>}
        {state.detailTab==='related'&&<><Requirements controller={controller}/>{issue&&<NativeIssueRelations issue={issue} controller={controller}/>}</>}
        {state.detailTab==='sessions'&&<>{detail?.executionGraph?<ExecutionSessions graph={detail.executionGraph} onReadIssue={issue=>void controller.openNativeIssue(issue)} onOpenTask={ref=>void controller.openTask(ref)} onEnterTask={ref=>void controller.enterTask(ref)} onOpenSession={session=>controller.openSession(session)} onReadHistory={session=>void controller.openHistory(session)}/>:<p role="status">执行图尚未读取，执行与结果状态未知。</p>}<HistoryTranscript controller={controller}/></>}
        {state.detailTab==='continuation'&&<><ExecutionContinuation graph={detail?.executionGraph} execution={detail?.execution} policy={detail?.execution?.continuationPolicy??project?.continuationPolicy} busy={state.startup.busy} completed={continuationCompleted} {...(!continuationCompleted?{onContinue:()=>void controller.controlExecution('continue'),onRecover:()=>void controller.controlExecution('reconcile'),onResume:()=>void controller.controlExecution('resume')}: {})}/>{detail?.execution&&!continuationCompleted&&<Section title="自动接续"><ContinuationSettings key={`execution/${detail.execution.id}/${detail.execution.continuationPolicy?.version??0}`} controller={controller} policy={detail.execution.continuationPolicy??project?.continuationPolicy} forExecution/></Section>}</>}
        {state.detailTab==='activity'&&<Section title="活动记录">{task?.activity.length?<ol>{[...task.activity].reverse().map(item=><li key={item.commandId}>版本 {item.version} · {activityLabel(item.type)}</li>)}</ol>:<p>尚无处理活动。</p>}</Section>}
        </>}
      </div>
      <ErrorText error={state.source.error??''}/>
    </>:!connecting&&state.projectId&&<>
      <SourceDirectory controller={controller} panel={panel} onPanel={setPanel} delegation={source?<ContinuousProcessing key={`${state.projectId}/${source.id}`} controller={controller}/>:null} panelContent={panel==='continuation'&&project?<section className={styles.settingsPanel} aria-label="新执行默认自动接续"><div className={styles.delegationHeader}><strong>新执行默认自动接续</strong><button onClick={()=>setPanel('none')}>收起</button></div><ContinuationSettings key={`${project.id}/${project.continuationPolicy?.version??0}`} controller={controller} policy={project.continuationPolicy}/></section>:null} issues={<IssueSourcePanel key={source?.id} controller={controller}/>}/>
    </>}
  </main>
}
function processingLabel(progress?:import('../work-progress.ts').TaskProgressView):string {
  const state=progress?.processingState??'not-started'
  return ({'not-started':'未开始',processing:'处理中',waiting:'等待',paused:'已暂停',blocked:'阻塞',completed:'已完成'})[state]
}
function RequirementBranch({controller,task,path=new Set<string>(),depth=0}:{controller:WorkPanelController;task:WorkTask;path?:Set<string>;depth?:number}) {
  const {tasks,detail,progressItems}=controller.getSnapshot(),key=`${task.projectId}/${task.id}`
  if(path.has(key))return <li>此需求已在上级显示。</li>
  const nextPath=new Set(path).add(key)
  const all=[...tasks,...(detail?.children??[]),...(detail?.task?[detail.task]:[])]
  const children=[...new Map(all.filter(item=>task.children.some(ref=>ref.projectId===item.projectId&&ref.taskId===item.id)||(item.parent?.projectId===task.projectId&&item.parent.taskId===task.id)).map(item=>[`${item.projectId}/${item.id}`,item])).values()]
  const progress=progressItems.find(item=>item.ref.projectId===task.projectId&&item.ref.taskId===task.id)
  const current=task.progress?.specificationVersion===task.specification.version?task.progress:undefined
  return <li className={styles.requirementBranch}><div className={styles.toolbar}><span>{progress?.source?`子 Issue #${progress.source.number}`:'子需求'}</span><TaskLink controller={controller} task={task}/><span className={styles.badge}>{progress?processingLabel(progress):current?stageLabel(current.stage):'尚无处理状态'}</span></div>
    {(progress?.summary??current?.summary)&&<p>{progress?.summary??current?.summary}</p>}
    {(progress?.next??current?.next)&&<p>下一步：{progress?.next??current?.next}</p>}
    {(progress?.blockers??current?.blockers)?.map((blocker,index)=><p className={styles.failure} key={index}>阻塞：{blocker}</p>)}
    {current?.criteria.flatMap(item=>item.evidence).map((evidence,index)=><p key={index}>证据：{evidence}</p>)}
    {children.length>0&&<details open={depth===0}><summary>下级需求 · {children.length} 项</summary><ul>{children.map(child=><RequirementBranch key={`${child.projectId}/${child.id}`} controller={controller} task={child} path={nextPath} depth={depth+1}/>)}</ul></details>}
  </li>
}
function Requirements({controller}:{controller:WorkPanelController}) {
  const {detail,tasks}=controller.getSnapshot(),task=detail?.task
  const all=[...(detail?.children??[]),...tasks]
  const resolve=(ref:import('../work-types.ts').TaskRef)=>all.find(item=>item.id===ref.taskId&&item.projectId===ref.projectId)
  return <Section title="子项">
    {detail?.parent&&<p>上级要求：<TaskLink controller={controller} task={detail.parent}/></p>}
    {task?.breakdown.length?task.breakdown.map(block=>{const child=block.child?resolve(block.child):undefined;return <article className={styles.requirement} key={block.id}><div className={styles.header}><h3>{block.title}</h3><span className={styles.badge}>{stageLabel(block.status??'planned')}</span></div><p>{block.description}</p>{block.evidence?.map((evidence,index)=><p key={index}>证据：{evidence}</p>)}{child&&<ul><RequirementBranch controller={controller} task={child}/></ul>}{block.child&&!child&&<button className={styles.link} onClick={()=>void controller.openTask(block.child!)}>关联需求</button>}</article>}):<p>暂无子项</p>}
    <ul>{task?.children.filter(ref=>!task.breakdown.some(block=>block.child?.taskId===ref.taskId&&block.child.projectId===ref.projectId)).map(ref=>{const child=resolve(ref);return child?<RequirementBranch key={`${ref.projectId}/${ref.taskId}`} controller={controller} task={child}/>:<li key={`${ref.projectId}/${ref.taskId}`}><button className={styles.link} onClick={()=>void controller.openTask(ref)}>子需求</button></li>})}</ul>
  </Section>
}
function IssueSourcePanel({controller}:{controller:WorkPanelController}) {
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot), sourceState=state.source
  const {listing,loading,error}=sourceState, source=sourceState.sources.find(item=>item.id===sourceState.sourceId)
  const {search:queryDraft,labels:labelDraft}=controller.issueQueryDraft()
  const rows=controller.visibleIssues()
  const [filtersOpen,setFiltersOpen]=useState(false)
  const [assigneeDraft,setAssigneeDraft]=useState(sourceState.assignee)
  const [stateDraft,setStateDraft]=useState(sourceState.state)
  const [processingDraft,setProcessingDraft]=useState(state.issueFilter)
  useEffect(()=>setProcessingDraft(state.issueFilter),[state.issueFilter])
  useEffect(()=>{setAssigneeDraft(sourceState.assignee);setStateDraft(sourceState.state)},[sourceState.assignee,sourceState.state])
  const applyQuery=()=>{setFiltersOpen(false);controller.setIssueFilter(processingDraft);void controller.browseIssues({search:queryDraft.trim(),labels:labelDraft.split(',').map(label=>label.trim()).filter(Boolean),assignee:assigneeDraft,state:stateDraft,page:1},true)}
  const clearQuery=()=>{setAssigneeDraft('*');setStateDraft('open');setProcessingDraft('all');controller.setIssueQueryDraft({search:'',labels:''});controller.setIssueFilter('all');void controller.browseIssues({search:'',labels:[],assignee:'*',state:'open',page:1},true)}
  const appliedCount=(sourceState.assignee==='@me'?1:0)+(sourceState.state!=='all'?1:0)+(sourceState.labels?.length??0)+(state.issueFilter!=='all'?1:0)
  const queryFiltered=Boolean(sourceState.search?.trim()||sourceState.labels?.length||sourceState.assignee==='@me'||sourceState.state==='closed')
  const columns:TableColumn<GitHubIssue>[]=[
    {id:'title',label:'Issue',protected:true,width:3,values:issue=>[issue.title],qualifiers:[{id:'github-state',label:'GitHub 状态',values:issue=>[issue.state]}],render:issue=><button className={styles.rowTitle} title={`#${issue.number} ${issue.title} · ${issue.repository.owner}/${issue.repository.repository}`} onClick={()=>void controller.openIssue(issue.number,Boolean(source?.enabled),issue.nodeId)}>#{issue.number} {issue.title}</button>},
    {id:'status',label:'状态',groupable:true,values:issue=>[processingLabel(controller.progressForIssue(issue))],render:issue=>{const progress=controller.progressForIssue(issue),detail=[progress?.summary,progress?.next?`下一步：${progress.next}`:'',...(progress?.blockers??[]).map(blocker=>`阻塞：${blocker}`)].filter(Boolean).join(' / ');return <span title={detail||undefined}><span className={styles.badge}>{processingLabel(progress)}</span>{progress?.blockers.length&&processingLabel(progress)!=='阻塞'?<span className={styles.failure}> · 阻塞</span>:null}</span>}},
    {id:'session',label:'会话',width:1.5,values:issue=>{const entry=sessionOf(controller.progressForIssue(issue));return entry?[entry.session.sessionId]:[]},render:issue=><SessionCell entry={sessionOf(controller.progressForIssue(issue))} onOpen={session=>controller.openSession(session)}/>},
    {id:'assignees',label:'负责人',groupable:true,values:issue=>issue.assignees,render:issue=>issue.assignees.join(', ')||'—'},
    {id:'labels',label:'标签',groupable:true,values:issue=>issue.labels,render:issue=>issue.labels.length?issue.labels.map(label=><span key={label} className={styles.labelPill}>{label}</span>):'—'},
  ]
  const failedRead=Boolean(error&&!error.startsWith('source-page-unobserved:'))
  const emptyPageEnd=useRef<HTMLDivElement>(null)
  useScrollLoad({target:emptyPageEnd,enabled:Boolean(source?.enabled&&listing?.nextPage&&!listing.items.length),busy:loading||sourceState.loadingMore,error:failedRead||sourceState.moreError,loadMore:()=>void controller.moreIssues()})
  if(!source)return null
  const emptyTitle=failedRead?listing?'上次结果为空，更新尚未完成':'暂时无法读取 Issue':!listing?'尚未读取 Issue':listing.items.length&&!rows.length?'当前处理状态下没有 Issue':listing.nextPage?'已加载范围暂无匹配项':queryFiltered?'没有符合当前条件的 Issue':sourceState.state==='open'?'此来源暂无开放 Issue':'此来源还没有 Issue'
  const emptyDescription=failedRead?'未能取得最新结果，可检查账号权限或网络后重试。':!listing?'读取此来源后，即可查看工作与关联会话。':listing.items.length&&!rows.length?'试试其他处理状态，或查看全部已加载工作。':listing.nextPage?'正在加载后续结果。':queryFiltered?'调整上方条件，或查看此来源的全部开放 Issue。':sourceState.state==='open'?'可切换到全部状态，查看已关闭的工作。':'后续发现的 Issue 会出现在这里。'
  const emptyState=<div className={styles.issueEmpty} role="status">
      <span className={styles.issueEmptyIcon}><PanelIcon name={failedRead&&!listing?'alert':queryFiltered||state.issueFilter!=='all'?'search':'repo'} size={24}/></span>
      <h3>{emptyTitle}</h3><p>{emptyDescription}</p>
      {failedRead||!listing?<button disabled={!source.enabled||loading} onClick={()=>void controller.browseIssues({},true)}>{failedRead?'重试':'读取 Issue'}</button>:listing.items.length&&!rows.length?<button onClick={()=>controller.setIssueFilter('all')}>全部进展</button>:listing.nextPage?null:queryFiltered?<button disabled={!source.enabled||loading} onClick={clearQuery}>开放 Issue</button>:sourceState.state==='open'?<button disabled={!source.enabled||loading} onClick={()=>void controller.browseIssues({state:'all',page:1},true)}>全部状态</button>:null}
    </div>
  const appliedFilters=<div className={styles.issueApplied} aria-label="已应用的 Issue 筛选">
      {sourceState.assignee==='@me'&&<button disabled={loading||!source.enabled} title="改为全部负责人" onClick={()=>void controller.browseIssues({assignee:'*',page:1},true)}>分配给我 <PanelIcon name="close" size={12}/></button>}
      {sourceState.state!=='all'&&<button disabled={loading||!source.enabled} title="查看全部 GitHub 状态" onClick={()=>void controller.browseIssues({state:'all',page:1},true)}>{sourceState.state==='open'?'Open':'Closed'} <PanelIcon name="close" size={12}/></button>}
      {sourceState.labels?.map(label=><button key={label} disabled={loading||!source.enabled} title={`移除标签筛选 ${label}`} onClick={()=>{const labels=sourceState.labels!.filter(value=>value!==label);controller.setIssueQueryDraft({labels:labels.join(',')});void controller.browseIssues({labels,page:1},true)}}>{label} <PanelIcon name="close" size={12}/></button>)}
      {sourceState.search&&<button disabled={loading||!source.enabled} title="清除来源搜索" onClick={()=>{controller.setIssueQueryDraft({search:''});void controller.browseIssues({search:'',page:1},true)}}>搜索：{sourceState.search} <PanelIcon name="close" size={12}/></button>}
      {state.issueFilter!=='all'&&<button onClick={()=>controller.setIssueFilter('all')}>{issueFilters.find(([id])=>id===state.issueFilter)?.[1]} <PanelIcon name="close" size={12}/></button>}
    </div>
  return <section className={styles.issueList} aria-label="Issues">
    <h2 className={styles.visuallyHidden}>Issues</h2>
    <ListQueryBar label="搜索来源 Issues" placeholder="搜索 Issue" searchTitle="搜索整个来源" value={queryDraft} onChange={value=>controller.setIssueQueryDraft({search:value})} onSubmit={applyQuery} count={loading?'读取中…':listing?`${rows.length} 项`:'尚未读取'} disabled={loading||!source.enabled} filtersOpen={filtersOpen} filterCount={appliedCount} filterId="a2d2-issue-filters" onToggleFilters={()=>setFiltersOpen(open=>!open)}>
        <label>负责人<select aria-label="Issue 负责人" value={assigneeDraft} onChange={event=>setAssigneeDraft(event.target.value as '@me'|'*')}><option value="@me">分配给我</option><option value="*">全部负责人</option></select></label>
        <label>GitHub 状态<select aria-label="Issue 远端状态" value={stateDraft} onChange={event=>setStateDraft(event.target.value as 'open'|'closed'|'all')}><option value="open">Open</option><option value="closed">Closed</option><option value="all">全部状态</option></select></label>
        <label>处理进展<select aria-label="Issue 处理状态" value={processingDraft} onChange={event=>setProcessingDraft(event.target.value as typeof state.issueFilter)}>{issueFilters.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>包含标签<input aria-label="Issue 标签" value={labelDraft} onChange={event=>controller.setIssueQueryDraft({labels:event.target.value})} placeholder="多个标签以逗号分隔"/></label>
        <div className={styles.issueFilterActions}><button type="button" title="清除搜索与筛选，显示全部开放 Issue" onClick={()=>{setFiltersOpen(false);clearQuery()}}>重置</button><button type="submit" disabled={loading||!source.enabled}>应用</button></div>
    </ListQueryBar>
    {!(listing&&listing.items.length>0)&&appliedFilters}
    {!source.enabled&&<p role="status">来源已停用，显示已保存的内容。</p>}
    {failedRead&&listing&&<div className={styles.issueReadNotice} role="alert">更新未完成，保留上次列表。<button disabled={loading||!source.enabled} onClick={()=>void controller.browseIssues({},true)}>重试</button></div>}
    {loading&&!listing?<div className={styles.issueSkeleton} role="status"><span className={styles.visuallyHidden}>正在读取 Issues…</span>{[0,1,2,3].map(value=><div key={value}><span/><span/></div>)}</div>:listing&&listing.items.length>0? <>
      <InteractiveTable compact toolbarContent={appliedFilters} emptyState={emptyState} key={`${state.projectId}/${source.id}/${sourceState.tab}/${sourceState.assignee}/${sourceState.state}/${sourceState.search??''}/${sourceState.labels?.join(',')??''}`} label="GitHub Issue 列表" columns={columns} rows={rows} resetKey={`${state.issueFilter}/${sourceState.listEpoch}`} rowKey={issue=>issue.nodeId} searchText={issue=>`${issue.repository.owner}/${issue.repository.repository} #${issue.number} ${issue.title}`} searchLabel="搜索已加载 Issues" scope={`当前来源：${source.title??source.projectSnapshot?.project.title??source.repository?.repository??source.id} · 列搜索、排序、分组、切片和过滤作用于已加载范围；主搜索查询整个来源；这里的条件仅作用于已加载范围${listing?.nextPage?' · 来源还有更多，当前结果并非完整来源':''}`} remote={{hasMore:Boolean(listing?.nextPage),loading:sourceState.loadingMore,error:sourceState.moreError,loadMore:()=>void controller.moreIssues(),retry:()=>void (listing?controller.moreIssues():controller.browseIssues({},true))}} unavailable={!listing?loading?'正在读取 Issues…':'此查询尚无可读缓存，请刷新 Issues。读取失败不表示列表为空。':undefined}/>
    </>:<>{emptyState}<div ref={emptyPageEnd} className={styles.loadSentinel} aria-label="Issue 加载状态"/>{sourceState.loadingMore&&<p role="status">正在加载…</p>}{sourceState.moreError&&<p role="alert">{sourceState.moreError} <button disabled={sourceState.loadingMore} onClick={()=>void controller.moreIssues()}>重试</button></p>}</>}

  </section>
}
function ContinuousProcessing({controller}:{controller:WorkPanelController}) {
  const snapshot=controller.getSnapshot(),projectId=snapshot.projectId!,browseSourceId=snapshot.source.sourceId!
  const [rule,setRule]=useState<ContinuousWorkRule|undefined>(undefined),[loaded,setLoaded]=useState(false),[editing,setEditing]=useState(false)
  const sourceId=rule?.sourceId??browseSourceId
  const [options,setOptions]=useState<WorkExecutionOptions|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[statusError,setStatusError]=useState('')
  const [assignee,setAssignee]=useState<'@me'|'*'>('*'),[labels,setLabels]=useState(''),[resource,setResource]=useState(0),[model,setModel]=useState(0),[agentPreset,setAgentPreset]=useState(''),[permissionPreset,setPermissionPreset]=useState('')
  const [filterPrompt,setFilterPrompt]=useState('')
  const [configSourceId,setConfigSourceId]=useState(sourceId)
  const [concurrency,setConcurrency]=useState(1),[refreshMinutes,setRefreshMinutes]=useState(30),[order,setOrder]=useState<'oldest'|'newest'>('oldest')
  const [scope]=useState(()=>new AbortController())
  useEffect(()=>()=>scope.abort(),[scope])
  useEffect(()=>{
    const abort=new AbortController();let reading=false
    const read=async()=>{if(reading||editing||busy||abort.signal.aborted)return;reading=true;try{const result=await controller.client.query({type:'continuous.status',projectId,sourceId:browseSourceId},abort.signal);if(!abort.signal.aborted){setRule(result.continuousRule);setLoaded(true);setStatusError('')}}catch(error){if(!abort.signal.aborted)setStatusError(message(error))}finally{reading=false}}
    void read();const timer=setInterval(()=>{if(typeof document==='undefined'||document.visibilityState==='visible')void read()},5000)
    return()=>{abort.abort();clearInterval(timer)}
  },[controller,projectId,browseSourceId,editing,busy])
  async function configure() {
    if(busy)return;setBusy(true);setError('')
    try {
      const result=await controller.client.query({type:'source.execution-options',projectId,sourceId},scope.signal)
      if(scope.signal.aborted)return
      const choices=result.executionOptions
      if(!choices||!choices.resources.length||!choices.models.length||!choices.agentPresets.length||!choices.permissionPresets.length)throw Error('宿主尚无完整的执行目录、模型或预设配置')
      setOptions(choices);setConfigSourceId(sourceId);setAssignee(rule?.scope.assignee??'*');setLabels(rule?.scope.labels.join(', ')??'')
      setConcurrency(rule?.queue?.concurrency??1);setRefreshMinutes(rule?.queue?.refreshMinutes??30);setOrder(rule?.queue?.order??'oldest');setFilterPrompt(rule?.queue?.filterPrompt??'')
      setResource(Math.max(0,choices.resources.findIndex(item=>item.ref.runtimeId===rule?.resource.runtimeId&&item.ref.workspaceId===rule.resource.workspaceId)))
      const preferred=rule?.model??choices.defaults.model
      setModel(Math.max(0,choices.models.findIndex(item=>item.provider===preferred.provider&&item.model===preferred.model)))
      setAgentPreset(choices.agentPresets.includes(rule?.agentPreset??choices.defaults.agentPreset)?rule?.agentPreset??choices.defaults.agentPreset:choices.agentPresets[0]!)
      setPermissionPreset(choices.permissionPresets.includes(rule?.permissionPreset??choices.defaults.permissionPreset)?rule?.permissionPreset??choices.defaults.permissionPreset:choices.permissionPresets[0]!)
      setEditing(true)
    }catch(error){if(!scope.signal.aborted)setError(message(error))}finally{if(!scope.signal.aborted)setBusy(false)}
  }
  async function save(event:FormEvent) {
    event.preventDefault();if(busy||!options)return;setBusy(true);setError('')
    try {
      const selectedResource=options.resources[resource]?.ref, selectedModel=options.models[model]
      if(!selectedResource||!selectedModel)throw Error('请选择可用执行配置')
      const configuredModel=rule?.model.provider===selectedModel.provider&&rule.model.model===selectedModel.model?rule.model:options.defaults.model.provider===selectedModel.provider&&options.defaults.model.model===selectedModel.model?options.defaults.model:selectedModel
      const result=await controller.submit({type:'continuous.configure',projectId,sourceId:configSourceId,expectedVersion:rule?.version??0,assignee,labels:[...new Set(labels.split(',').map(label=>label.trim()).filter(Boolean))],resource:selectedResource,model:configuredModel,agentPreset,permissionPreset,enabled:rule?.enabled??false,queue:{concurrency,refreshMinutes,order,filterPrompt}})
      if(!scope.signal.aborted){setRule(result.continuousRule);setEditing(false)}
    }catch(error){if(!scope.signal.aborted)setError(message(error))}finally{if(!scope.signal.aborted)setBusy(false)}
  }
  const source=snapshot.source.sources.find(item=>item.id===sourceId)
  const sourceTitle=source?.title??source?.projectSnapshot?.project.title??(source?.repository?`${source.repository.owner}/${source.repository.repository}`:'当前来源')
  return <>
    <ErrorText error={error}/><ErrorText error={statusError}/>
    {loaded?<ContinuousDelegation client={controller.client} projectId={projectId} sourceId={sourceId} projectTitle={snapshot.projects.find(item=>item.id===projectId)?.name??'当前 Project'} sourceTitle={sourceTitle} rule={rule} onRuleChanged={setRule} navigation={controller} onConfigure={()=>void configure()} configuring={busy||editing}>
      {rule?.migrationConflict&&<p role="alert">{rule.migrationConflict.message}</p>}
      {editing&&options&&<form className={styles.form} aria-label="队列设置" onSubmit={event=>void save(event)}>
        <label>队列来源<select disabled={busy} value={configSourceId} onChange={event=>setConfigSourceId(event.target.value)}>{snapshot.source.sources.map(item=><option key={item.id} value={item.id}>{item.title??item.projectSnapshot?.project.title??(item.repository?`${item.repository.owner}/${item.repository.repository}`:item.id)}</option>)}</select></label>
        <div className={styles.formRow}><label>负责人<select disabled={busy} value={assignee} onChange={event=>setAssignee(event.target.value as '@me'|'*')}><option value="*">所有负责人</option><option value="@me">分配给我</option></select></label><label>必须包含的标签<input disabled={busy} value={labels} onChange={event=>setLabels(event.target.value)} placeholder="逗号分隔；留空不限"/></label></div>
        <label>大模型筛选提示词<textarea disabled={busy} rows={4} maxLength={10000} value={filterPrompt} onChange={event=>setFilterPrompt(event.target.value)} placeholder="例如：只处理能独立完成的缺陷；排除纯文档、依赖未完成或需要产品决策的事项。"/></label>
        <p>每次定时更新先按上述条件取候选，再按提示词对整批候选筛选一次。留空则只使用上述条件。</p>
        <div className={styles.formRow}><label>更新周期（分钟）<input type="number" min={1} max={10080} required disabled={busy} value={refreshMinutes} onChange={event=>setRefreshMinutes(Number(event.target.value))}/></label><label>并发上限<input type="number" min={1} max={32} required disabled={busy} value={concurrency} onChange={event=>setConcurrency(Number(event.target.value))}/></label><label>等待顺序<select disabled={busy} value={order} onChange={event=>setOrder(event.target.value as 'oldest'|'newest')}><option value="oldest">较早创建优先</option><option value="newest">较新创建优先</option></select></label></div>
        <details><summary>执行目录、模型与权限</summary><div className={styles.formRow}><label>持续处理执行目录<select disabled={busy} value={resource} onChange={event=>setResource(Number(event.target.value))}>{options.resources.map((item,index)=><option key={index} value={index}>{item.title}</option>)}</select></label><label>持续处理模型<select disabled={busy} value={model} onChange={event=>setModel(Number(event.target.value))}>{options.models.map((item,index)=><option key={index} value={index}>{item.provider}/{item.model}</option>)}</select></label><label>Agent 预设<select disabled={busy} value={agentPreset} onChange={event=>setAgentPreset(event.target.value)}>{options.agentPresets.map(item=><option key={item}>{item}</option>)}</select></label><label>权限预设<select disabled={busy} value={permissionPreset} onChange={event=>setPermissionPreset(event.target.value)}>{options.permissionPresets.map(item=><option key={item}>{item}</option>)}</select></label></div></details>
        <p>筛选上述来源的开放 Issue；保存后更新等待部分，在途执行、问题与历史保留。{rule?.enabled?'队列已开启，空余位置按新设置推进。':'保存后仍暂停，点击“继续处理”才启动。'}</p>
        <div className={styles.toolbar}><button className={styles.primary} type="submit" disabled={busy}>{busy?'正在保存…':'保存并更新等待任务'}</button><button type="button" disabled={busy} onClick={()=>setEditing(false)}>取消</button></div>
      </form>}
    </ContinuousDelegation>:<p role="status">正在读取持续队列…</p>}
  </>
}
function stageLabel(stage: import('../work-progress.ts').WorkStage): string { return ({planned:'待处理','in-progress':'处理中',review:'待验收',blocked:'受阻',done:'已验收完成'})[stage] }
function CriteriaCount({criteria}:{criteria:import('../work-progress.ts').TaskProgressView['criteria']}) {
  return <p>验收通过 {criteria.passed} / {criteria.total} 项 · 已核验 {criteria.assessed} 项{!criteria.current?' · 尚无当前规格的有效验收结果':''}</p>
}
const executionLabels: Record<WorkExecution['state'], string> = { accepted: '已登记', creating: '正在创建会话', ready: '已就绪', running: '处理中', waiting: '等待回复', paused: '已暂停', failed: '执行失败' }
function completedProgress(progress?: import('../work-progress.ts').TaskProgressView): boolean { return progress?.stage === 'done' && progress.criteria.current }
function executionLabel(state: WorkExecution['state'], progress?: import('../work-progress.ts').TaskProgressView, controlStatus?: 'accepted'|'applied'): string {
  if (!completedProgress(progress)) return executionLabels[state]
  // List projections expose applied wait/pause through their persisted execution state.
  return controlStatus === 'applied' || (controlStatus === undefined && (state === 'waiting' || state === 'paused')) ? '已收口' : '正在收口'
}
function CurrentExecution({controller}:{controller:WorkPanelController}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const { execution, executionRuntime, progress } = state.detail ?? {}, { options, selection, busy } = state.startup
  const completed = Boolean(state.detail?.task?.completion)||completedProgress(progress)
  if(!execution&&!options&&!completed)return null
  return <Section title="会话" className={!execution&&!options?styles.idleExecution:undefined}>
    {execution ? <>
      <p>{(()=>{const task=state.detail?.task;if(!task)return null;const counts=controller.sessionCounts(task);return `${counts.total} 个会话 · 当前 ${counts.current} · 历史 ${counts.historical} · 其他关联 ${counts.associated}`})()}</p><p>执行状态：{state.detail?.task?.completion?({pending:'等待执行收口',settled:'执行已安全收口',error:'执行收口失败'})[state.detail.task.completion.closeout.status]:executionLabel(execution.state,progress,execution.control?.status)}{executionRuntime ? ` · 会话：${({running:'正在运行',idle:'空闲',inactive:'未激活'})[executionRuntime]}` : ''}</p>
      {execution.progress && <p>工作进展：{execution.progress}</p>}
      {execution.control && !completed && <p>{({wait:'等待',pause:'暂停',resume:'恢复'})[execution.control.action]}请求{execution.control.status==='accepted'?(execution.state==='failed'?'未生效，执行失败':'已接受，等待生效'):'已生效'}{execution.control.reason?`：${execution.control.reason}`:''}</p>}
      {execution.error && <ErrorText error={`${execution.error.code}: ${execution.error.message}`}/>}
      <div className={styles.toolbar}>
        {controller.currentSession() && <button disabled={busy} onClick={()=>controller.openCurrentSession()}>进入会话</button>}
        {!completed && ['ready','running'].includes(execution.state) && <button disabled={busy||execution.control?.status==='accepted'} onClick={()=>void controller.controlExecution('pause')}>暂停处理</button>}
        {!completed && progress?.processingState==='blocked' && ['ready','running'].includes(execution.state) && <button disabled={busy||execution.control?.status==='accepted'} onClick={()=>void controller.controlExecution('resume')}>继续处理</button>}
        {!completed && ['waiting','paused'].includes(execution.state) && <button disabled={busy||execution.control?.status==='accepted'} onClick={()=>void controller.controlExecution('resume')}>恢复处理</button>}
        {!completed && execution.state==='failed' && <button disabled={busy} onClick={()=>void controller.controlExecution('reconcile')}>重试原执行</button>}
        <button disabled={busy} onClick={()=>void controller.refreshTask()}>刷新</button>
      </div>
      {!controller.currentSession() && <p>当前会话暂不可进入；刷新可查看创建或恢复结果。</p>}
      {execution.actual && <details><summary>实际执行环境</summary><p>工作目录：{execution.actual.cwd}<br/>模型：{execution.actual.provider}/{execution.actual.model}<br/>Agent 预设：{execution.actual.agentPreset}<br/>权限：{execution.actual.permissionPreset} · 沙箱：{execution.actual.sandbox} · 审批：{execution.actual.approval}</p></details>}
      {execution.events.length>0 && <details><summary>输入与结果（{execution.events.length}）</summary>{execution.events.map(event=><p key={event.id}>{({accepted:'已接受',delivered:'已投递',consumed:'已消费',discarded:'已废弃'})[event.delivery]} · 尚未验收<br/>{event.text}</p>)}</details>}
    </> : completed ? <p>本地已验收；执行观察尚未取得，请刷新详情读取收口状态。</p> : <>

      {options && selection ? <form className={styles.form} onSubmit={event=>{event.preventDefault();void controller.startPrepared()}}>
        <p>请确认执行目录、模型、Agent 预设与权限；未修改时使用宿主与项目的默认配置。</p>
        <label>工作目录{options.resources.length>1 ? <select disabled={busy} value={selection.resourceIndex} onChange={event=>controller.selectStart({resourceIndex:Number(event.target.value)})}>{options.resources.map((resource,index)=><option key={`${resource.ref.runtimeId}/${resource.ref.workspaceId}`} value={index}>{resource.title}</option>)}</select> : <span title="宿主或项目规则只提供这一个执行目录">{options.resources[0]?.title}</span>}</label>
        <label>模型{options.models.length>1 ? <select disabled={busy} value={selection.modelIndex} onChange={event=>controller.selectStart({modelIndex:Number(event.target.value)})}>{options.models.map((model,index)=><option key={`${model.provider}/${model.model}`} value={index}>{model.provider}/{model.model}</option>)}</select> : <span title="宿主或项目 Agent 只允许这一个模型">{options.models[0]?.provider}/{options.models[0]?.model}</span>}</label>
        <label>Agent 预设{options.agentPresets.length>1 ? <select disabled={busy} value={selection.agentPreset} onChange={event=>controller.selectStart({agentPreset:event.target.value})}>{options.agentPresets.map(preset=><option key={preset}>{preset}</option>)}</select> : <span title="宿主只暴露默认 Agent 预设">{selection.agentPreset}</span>}</label>
        <label>权限{options.permissionPresets.length>1 ? <select disabled={busy} value={selection.permissionPreset} onChange={event=>controller.selectStart({permissionPreset:event.target.value})}>{options.permissionPresets.map(preset=><option key={preset}>{preset}</option>)}</select> : <span title="宿主只暴露默认权限预设">{selection.permissionPreset}</span>}</label>
        <div className={styles.toolbar}><button type="submit" disabled={busy}>{busy?'正在启动…':'开始处理'}</button><button type="button" disabled={busy} onClick={()=>controller.cancelStart()}>取消</button></div>
      </form> : <button className={styles.primary} disabled={busy||state.loading||state.source.loading} onClick={()=>void controller.prepareStart(!state.detail?.task)}>开始处理</button>}
    </>}
  </Section>
}
function HistoryTranscript({controller}:{controller:WorkPanelController}) {
  const {history}=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot)
  const historyEnd=useRef<HTMLDivElement>(null)
  useScrollLoad({target:historyEnd,enabled:Boolean(history.session&&history.nextCursor!==undefined),busy:history.loading,error:history.error,loadMore:()=>void controller.moreHistory()})
  if(!history.session&&!history.error)return null
  return <section aria-label="只读历史记录"><div className={styles.header}><h3>历史记录 · 只读</h3><button onClick={()=>controller.closeHistory()}>关闭</button></div>
    {history.session&&<p>会话：{history.session.sessionId} · 查看记录不会启动旧会话。</p>}
    {history.events.map((event,index)=><pre key={index}>{typeof event==='string'?event:JSON.stringify(event,null,2)??'空记录'}</pre>)}
    {history.loaded&&!history.events.length&&<p>此会话没有可显示的记录。</p>}
    {history.loading&&<p role="status">正在读取历史记录…</p>}
    {history.error&&<><ErrorText error={history.error}/>{history.session&&<button disabled={history.loading} onClick={()=>void controller.retryHistory()}>重试</button>}</>}
    <div ref={historyEnd} className={styles.loadSentinel} aria-label="历史记录加载状态"/>
    {history.loaded&&history.nextCursor===undefined&&!history.error&&<p>已读到记录末尾。</p>}
  </section>
}
function ContinuationSettings({controller,policy,forExecution=false}:{controller:WorkPanelController;policy?:import('../work-types.ts').ContinuationPolicy;forExecution?:boolean}) {
  const [enabled,setEnabled]=useState(policy?.enabled??false),[target,setTarget]=useState(String(policy?.targetTokens??200000)),[reserve,setReserve]=useState(String(policy?.reserveTokens??16000))
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false)
  async function save(event:FormEvent) {
    event.preventDefault();if(busy)return
    setBusy(true);setError('');setSaved(false)
    try {await controller.saveContinuation({version:(policy?.version??0)+1,enabled,targetTokens:Number(target),reserveTokens:Number(reserve)},forExecution);setSaved(true)}catch(error){setError(message(error))}finally{setBusy(false)}
  }
  return <div className={styles.continuation}><h3>{forExecution?'当前执行自动接续':'项目自动接续'}</h3><p>{policy?.enabled?`${policy.targetTokens.toLocaleString()} token 目标`:'自动接续未启用'}</p>
    <form className={styles.form} onSubmit={event=>void save(event)}>
      <label>自动接续<select disabled={busy} value={enabled?'on':'off'} onChange={event=>setEnabled(event.target.value==='on')}><option value="off">关闭</option><option value="on">启用</option></select></label>
      <div className={styles.toolbar}><button type="button" disabled={busy} onClick={()=>setTarget('200000')}>200K</button><button type="button" disabled={busy} onClick={()=>setTarget('300000')}>300K</button></div>
      <label>提前接续目标（token）<input disabled={busy} type="number" min="1" step="1" required value={target} onChange={event=>setTarget(event.target.value)}/></label>
      <details><summary>高级接续设置</summary><label>接续预留（token）<input disabled={busy} type="number" min="1024" step="1" required value={reserve} onChange={event=>setReserve(event.target.value)}/></label></details>
      <p>这是安全边界上的提前接续目标。宿主会按实际模型窗口和输出预留检查；长轮次可能超过目标。{forExecution?'保存后适用于当前执行。':'项目默认只用于新执行，当前执行可单独设置。'}</p>
      <ErrorText error={error}/>{saved&&<p role="status">接续策略已保存</p>}<button type="submit" disabled={busy}>{busy?'正在保存…':'保存'}</button>
    </form>
  </div>
}
function SourceBinding({binding}:{binding:import('../work-sources/types.ts').ExternalBinding}) {
  const accepted=binding.accepted,latest=binding.lastObserved
  const fields=[['title','标题'],['body','正文'],['assignees','负责人'],['labels','标签'],['state','远端状态']] as const
  const differences=fields.filter(([key])=>JSON.stringify(accepted[key])!==JSON.stringify(latest[key])).map(([,label])=>label)
  return <details><summary>来源更新 · #{accepted.number}</summary>
    <GitHubLink url={latest.url}/><p>远端状态与验收分别记录。已接受要求保留，远端变更不会自动覆盖。</p>
    <p>{differences.length?`相对已接受来源发生变化：${differences.join('、')}`:'最新观察与已接受来源内容一致。'} · 最新观察时间：{latest.observedAt}</p>
    <details><summary>已接受来源</summary><h3>{accepted.title}</h3><IssueFacts issue={accepted}/><IssueMarkdown text={accepted.body} sourceUrl={accepted.url}/></details>
    <details><summary>最新观察</summary><h3>{latest.title}</h3><IssueFacts issue={latest}/><IssueMarkdown text={latest.body} sourceUrl={latest.url}/></details>
  </details>
}
function GitHubLink({url}:{url:string}) {
  let safe=false
  try {const parsed=new URL(url);safe=parsed.protocol==='https:'&&parsed.hostname==='github.com'&&!parsed.username&&!parsed.password&&!parsed.port&&/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*\/?$/.test(parsed.pathname)&&!parsed.search&&!parsed.hash}catch{}
  return safe?<a href={url} target="_blank" rel="noopener noreferrer" className={styles.externalSource} aria-label="在 GitHub 打开" title="在 GitHub 打开"><PanelIcon name="external"/></a>:<span>来源 URL 无法安全打开</span>
}
function NativeIssueRelations({issue,controller}:{issue:import('../work-sources/types.ts').GitHubIssue;controller:WorkPanelController}) {
  const {parent,subIssues}=issue
  if(parent===undefined&&subIssues===undefined)return <p role="status">子项尚未读取</p>
  if(!parent&&!subIssues?.items.length&&!subIssues?.totalCount)return null
  const reference=(item:import('../work-sources/types.ts').GitHubIssueReference)=>{const progress=controller.progressForIssue(item);return <><span>{item.repository.owner}/{item.repository.repository} #{item.number} · {item.title} · 远端 {item.state}</span> <GitHubLink url={item.url}/>{progress?<p>{processingLabel(progress)} · {progress.summary} <button onClick={()=>void controller.openTask(progress.ref)}>查看进展</button></p>:<span> · 尚未读取完整要求 <button onClick={()=>void controller.openNativeIssue(item)}>读取要求</button></span>}</>}
  return <Section title="关联 Issue">
    {parent&&<p>父 Issue：{reference(parent)}</p>}
    {subIssues&&<><p>子 Issue：已显示 {subIssues.items.length} / {subIssues.totalCount} 项</p><ul>{subIssues.items.map(item=><li key={item.nodeId}>{reference(item)}</li>)}</ul>{subIssues.hasNextPage&&<p role="status">子 Issue 尚未完整读取，还有更多条目。</p>}</>}
  </Section>
}
function IssueFacts({issue}:{issue:import('../work-sources/types.ts').GitHubIssue}) {
  return <div className={styles.issueFacts}><span title="GitHub 状态">{issue.state==='closed'?'已关闭':'开放'}</span>{issue.assignees.length>0&&<span>{issue.assignees.map(login=>`@${login}`).join(', ')}</span>}{issue.labels.map(label=><span className={styles.labelPill} key={label}>{label}</span>)}<time dateTime={issue.updatedAt} title="GitHub 更新时间">{new Date(issue.updatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></div>
}
function Section({title,children,className}:{title:string;children:ReactNode;className?:string}) {return <section className={className}><h2>{title}</h2>{children}</section>}
function TaskLink({controller,task}:{controller:WorkPanelController;task:WorkTask}) {return <button className={styles.link} onClick={()=>void controller.openTask({projectId:task.projectId,taskId:task.id})}>{task.title}</button>}
function activityLabel(type:string):string {return ({'task.create':'创建工作','task.create-child':'创建子工作','task.update-spec':'更新目标、规格与验收','task.replace-breakdown':'更新工作拆解','task.associate-session':'关联会话','task.link-child':'关联子工作','source.import':'接入 GitHub 工作','source.link':'关联 GitHub 来源','source.link-hierarchy':'原生 Issue 父子关联'})[type] ?? type}
function ErrorText({error}:{error:string}) {return error ? <p role="alert" className={styles.failure}>{error}</p>:null}

/** Present native work links without owning navigation or execution side effects. */
export function SessionWorkLinks({work,onReveal,onEnter,opening=false}:{work:AssociatedWork[];onReveal:(ref:AssociatedWork['ref'])=>void;onEnter:(ref:AssociatedWork['ref'])=>void;opening?:boolean}) {
  return <>{work.map(item=><span key={`${item.ref.projectId}/${item.ref.taskId}`}><button onClick={()=>onReveal(item.ref)} title="查看工作与进展">{item.projectName} / {item.title} · 工作与进展</button>{item.purpose==='history'&&<><span> 处理会话已切换；内容投递状态见「A²D² 接续」 · </span><button disabled={opening} onClick={()=>onEnter(item.ref)}>{opening?'正在核对…':'进入会话'}</button></>}</span>)}</>
}
/** Mounted native entries observe role changes; polling never opens a Session or touches drafts. */
export function SessionWorkEntry({controller, sessionId}: {controller: WorkPanelController; sessionId: string}) {
  const [work, setWork] = useState<AssociatedWork[]>([])
  const [error, setError] = useState<string | null>(null)
  const [navigationError,setNavigationError]=useState<string|null>(null),[opening,setOpening]=useState(false)
  const [scope,setScope]=useState<AbortController|null>(null)
  useEffect(() => {
    const abort = new AbortController()
    setScope(abort);setWork([]);setError(null);setNavigationError(null);setOpening(false)
    const stop=controller.watchSessionWork(sessionId,setWork,setError)
    return () => {abort.abort();stop()}
  },[controller,sessionId])
  async function enter(ref:AssociatedWork['ref']) {
    if(!scope||scope.signal.aborted||opening)return
    setOpening(true);setNavigationError(null)
    try {await controller.openCurrentTask(ref,scope.signal)}catch(error){if(!scope.signal.aborted)setNavigationError(message(error))}
    finally {if(!scope.signal.aborted)setOpening(false)}
  }
  if (!work.length&&!error&&!navigationError) return null
  return <div className={styles.sessionEntry}>
    {error&&<span title={error}>工作关联读取失败</span>}
    {SessionWorkLinks({work,onReveal:ref=>void controller.revealTask(ref),onEnter:ref=>void enter(ref),opening})}
    {navigationError&&<span role="alert">{navigationError}</span>}
  </div>
}
