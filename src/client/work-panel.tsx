import { ExecutionSessions, ExecutionContinuation } from './execution-components.tsx'
import { CompletionStatus } from './completion-status.tsx'
import { ContinuousDelegation } from './continuous-delegation.tsx'
import { SourceConnect } from './source-connect.tsx'
import { SourceDirectory, SourceTabs } from './source-directory.tsx'
import { InteractiveTable } from './interactive-table.tsx'
import type { TableColumn } from './interactive-table.tsx'
import { SessionCell, sessionOf } from './session-cell.tsx'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { DetailTab, WorkPanelController } from './work-panel-controller.ts'
import type { AssociatedWork, WorkExecution, WorkTask, WorkExecutionOptions, ContinuousWorkRule } from '../work-types.ts'
import type { GitHubIssue } from '../work-sources/types.ts'
import { message } from './work-panel-controller.ts'
import styles from './work-panel.module.css'

const detailTabs: [DetailTab,string][] = [['overview','概览'],['related','需求与子 Issue'],['sessions','会话与执行'],['continuation','接续'],['activity','活动']]
const issueFilters = [['all','全部'],['not-started','未开始'],['processing','处理中'],['waiting','等待'],['blocked','阻塞'],['completed','已完成']] as const

export function WorkPanel({ controller }: { controller: WorkPanelController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [connecting,setConnecting]=useState(false),[surface,setSurface]=useState<HTMLElement|null>(null),[panel,setPanel]=useState<'none'|'delegation'|'continuation'>('none')
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
  const sourceTitle=source?.title??source?.projectSnapshot?.project.title??(source?.repository?`${source.repository.owner}/${source.repository.repository}`:project?.name)
  return <main ref={setSurface} className={styles.panel} aria-label="A²D² 控制面板">
    <div className={styles.navigation}><SourceTabs controller={controller} onAdd={()=>setConnecting(!connecting)}/><button onClick={()=>controller.close()}>关闭面板</button></div>
    {state.error&&<p className={styles.failure} role="alert">{state.error} <button onClick={retryIssue}>重新读取</button></p>}
    {state.observationError&&<p role="status">状态更新暂不可用，保留上次内容：{state.observationError}</p>}
    {state.startup.error&&<ErrorText error={state.startup.error}/>}
    {state.startup.busy&&<p role="status">正在准备执行，请稍候…</p>}
    {(connecting||(!projects.length&&!hasDetail&&!state.loading))&&<SourceConnect controller={controller} onSaved={()=>setConnecting(false)}/>}
    {state.loading&&<p role="status">正在读取 Issue 与进展…</p>}
    {hasDetail?<>
      <header className={styles.issueHeader}><button className={styles.link} onClick={()=>controller.back()}>← {controller.canReturnToRequirement()?'返回上级要求':'返回 Issue 列表'}</button><p className={styles.eyebrow}>{issue?`${issue.repository.owner}/${issue.repository.repository} · #${issue.number}`:target?`${sourceTitle??'Issue'} · #${target.number}`:sourceTitle}</p><h1>{issue?`#${issue.number} ${issue.title}`:target?`#${target.number} Issue 详情`:task?.title}</h1><div className={styles.toolbar}>{issue&&<GitHubLink url={issue.url}/>}<span className={styles.badge}>{detailPending?'正在加载…':task?.completion?'已完成':!task&&target&&(state.source.error||state.error)?'读取失败':processingLabel(detail?.progress)}</span><button disabled={state.loading||state.source.loading} onClick={retryIssue}>{state.source.error||state.error?'重试加载详情':'刷新详情'}</button></div></header>
      {detail?.execution&&!task?.completion&&<details className={styles.continuation}><summary>编辑自动接续设置</summary><ContinuationSettings key={`execution/${detail.execution.id}/${detail.execution.continuationPolicy?.version??0}`} controller={controller} policy={detail.execution.continuationPolicy??project?.continuationPolicy} forExecution/></details>}
      <nav className={styles.tabs} role="tablist" aria-label="Issue 详情标签">{detailTabs.map(([id,label])=><button key={id} role="tab" aria-selected={state.detailTab===id} onClick={()=>controller.setDetailTab(id)}>{label}</button>)}</nav>
      <div role="tabpanel" aria-label={detailTabs.find(([id])=>id===state.detailTab)?.[1]} aria-busy={detailPending}>
        {detailPending?<p role="status">正在加载 Issue 详情与进展…</p>:detailUnavailable?<><p role="status">详情读取失败，进展状态尚未确认，请重试加载详情。</p>{issue&&<Section title="Issue 原始要求"><IssueFacts issue={issue}/><p>最后已知内容</p><p className={styles.sourceBody}>{issue.body||'（原文正文为空）'}</p></Section>}</>:!issue&&!task?<p role="status">详情尚未读取，请重试加载详情。</p>:<>
        {state.detailTab==='overview'&&<>
          {task&&<CompletionStatus task={task} execution={detail?.execution} remoteState={binding?.lastObserved.state} busy={state.startup.busy} error={state.startup.error??undefined} onSync={command=>controller.syncCompletion(command)}/>}
          <div className={styles.detailGrid}><div><Section title="当前进展"><p>{detail?.progress?.summary??(task?.completion?'本地已验收，保留完成事实与收口状态。':'尚未开始处理')}</p>{detail?.progress&&<CriteriaCount criteria={detail.progress.criteria}/>}<p>下一步：{detail?.progress?.next||(task?.completion?(task.completion.closeout.status==='settled'?'已完成本地工作；外部同步独立观察':'等待执行安全收口'):!detail?.execution?'确认要求后开始处理':'等待当前会话报告下一步')}</p>{detail?.progress?.blockers.map((blocker,index)=><p className={styles.failure} key={index}>阻塞：{blocker}</p>)}</Section><Requirements controller={controller}/></div><CurrentExecution controller={controller}/></div>
          {issue&&<Section title="Issue 原始要求"><IssueFacts issue={issue}/><p>{state.source.cached?'缓存 / 最后已知内容':'本次读取内容'}</p><p className={styles.sourceBody}>{issue.body||'（原文正文为空）'}</p><NativeIssueRelations issue={issue} controller={controller}/></Section>}
          {task&&<Section title="已接受要求与验收"><p>{task.goal}</p>{task.specification.text!==issue?.body&&<details><summary>已接受规格 · 第 {task.specification.version} 版</summary><p className={styles.sourceBody}>{task.specification.text}</p></details>}{task.specification.missing?.includes('acceptance')&&<p role="status">结构化验收标准尚待确认。原始要求中的验收段落需由处理会话确认。</p>}{task.specification.missing?.includes('body')&&<p role="status">规格正文尚待补充；已观察的 Issue 正文为空。</p>}<ul>{task.specification.acceptance.map((criterion,index)=>{const result=task.progress?.specificationVersion===task.specification.version?task.progress.criteria.find(item=>item.index===index):undefined;return <li key={index}>{criterion} · {result?result.passed?'已通过':'未通过':'待核验'}{result?.evidence.map((evidence,index)=><p key={index}>证据：{evidence}</p>)}</li>})}</ul></Section>}
          {binding&&<SourceBinding binding={binding}/>}
        </>}
        {state.detailTab==='related'&&<><Requirements controller={controller}/>{issue&&<NativeIssueRelations issue={issue} controller={controller}/>}</>}
        {state.detailTab==='sessions'&&<>{detail?.executionGraph?<ExecutionSessions graph={detail.executionGraph} onReadIssue={issue=>void controller.openNativeIssue(issue)} onOpenTask={ref=>void controller.openTask(ref)} onEnterTask={ref=>void controller.enterTask(ref)} onOpenSession={session=>controller.openSession(session)} onReadHistory={session=>void controller.openHistory(session)}/>:<p role="status">执行图尚未读取，执行与结果状态未知。</p>}<HistoryTranscript controller={controller}/></>}
        {state.detailTab==='continuation'&&<ExecutionContinuation graph={detail?.executionGraph} execution={detail?.execution} policy={detail?.execution?.continuationPolicy??project?.continuationPolicy} busy={state.startup.busy} completed={continuationCompleted} {...(!continuationCompleted?{onContinue:()=>void controller.controlExecution('continue'),onRecover:()=>void controller.controlExecution('reconcile'),onResume:()=>void controller.controlExecution('resume')}: {})}/>}
        {state.detailTab==='activity'&&<Section title="活动记录">{task?.activity.length?<ol>{[...task.activity].reverse().map(item=><li key={item.commandId}>版本 {item.version} · {activityLabel(item.type)}</li>)}</ol>:<p>尚无处理活动。</p>}</Section>}
        </>}
      </div>
      <ErrorText error={state.source.error??''}/>
    </>:state.projectId&&<>
      <SourceDirectory controller={controller} panel={panel} onPanel={setPanel} panelContent={panel==='delegation'&&source?<ContinuousProcessing key={`${state.projectId}/${source.id}`} controller={controller} onClose={()=>setPanel('none')}/>:panel==='continuation'&&project?<section className={styles.settingsPanel} aria-label="新执行默认自动接续"><div className={styles.delegationHeader}><strong>新执行默认自动接续</strong><button onClick={()=>setPanel('none')}>收起</button></div><ContinuationSettings key={`${project.id}/${project.continuationPolicy?.version??0}`} controller={controller} policy={project.continuationPolicy}/></section>:null} issues={<IssueSourcePanel key={source?.id} controller={controller}/>}/>
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
  return <Section title="需求与子 Issue">
    {detail?.parent&&<p>上级要求：<TaskLink controller={controller} task={detail.parent}/></p>}
    {task?.breakdown.length?task.breakdown.map(block=>{const child=block.child?resolve(block.child):undefined;return <article className={styles.requirement} key={block.id}><div className={styles.header}><h3>{block.title}</h3><span className={styles.badge}>{stageLabel(block.status??'planned')}</span></div><p>{block.description}</p>{block.evidence?.map((evidence,index)=><p key={index}>证据：{evidence}</p>)}{child&&<ul><RequirementBranch controller={controller} task={child}/></ul>}{block.child&&!child&&<button className={styles.link} onClick={()=>void controller.openTask(block.child!)}>查看关联需求详情</button>}</article>}):<p>尚未报告需求拆解。处理会话将围绕原始要求记录进展与证据。</p>}
    <ul>{task?.children.filter(ref=>!task.breakdown.some(block=>block.child?.taskId===ref.taskId&&block.child.projectId===ref.projectId)).map(ref=>{const child=resolve(ref);return child?<RequirementBranch key={`${ref.projectId}/${ref.taskId}`} controller={controller} task={child}/>:<li key={`${ref.projectId}/${ref.taskId}`}><button className={styles.link} onClick={()=>void controller.openTask(ref)}>查看子需求详情</button></li>})}</ul>
  </Section>
}
function IssueSourcePanel({controller}:{controller:WorkPanelController}) {
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot), sourceState=state.source
  const {listing,loading,error,cached}=sourceState, source=sourceState.sources.find(item=>item.id===sourceState.sourceId)
  const {search:queryDraft,labels:labelDraft}=controller.issueQueryDraft()
  const rows=controller.visibleIssues(),sources=sourceState.sources
  const columns:TableColumn<GitHubIssue>[]=[
    {id:'title',label:'Issue',protected:true,width:3,values:issue=>[issue.title],qualifiers:[{id:'github-state',label:'GitHub 状态',values:issue=>[issue.state]}],render:issue=><button className={styles.rowTitle} title={`#${issue.number} ${issue.title} · ${issue.repository.owner}/${issue.repository.repository}`} onClick={()=>void controller.openIssue(issue.number,Boolean(source?.enabled),issue.nodeId)}>#{issue.number} {issue.title}</button>},
    {id:'status',label:'状态',groupable:true,values:issue=>[processingLabel(controller.progressForIssue(issue))],render:issue=>{const progress=controller.progressForIssue(issue),detail=[progress?.summary,progress?.next?`下一步：${progress.next}`:'',...(progress?.blockers??[]).map(blocker=>`阻塞：${blocker}`)].filter(Boolean).join(' / ');return <span title={detail||undefined}><span className={styles.badge}>{processingLabel(progress)}</span>{progress?.blockers.length&&processingLabel(progress)!=='阻塞'?<span className={styles.failure}> · 阻塞</span>:null}</span>}},
    {id:'session',label:'会话',width:1.5,values:issue=>{const entry=sessionOf(controller.progressForIssue(issue));return entry?[entry.session.sessionId]:[]},render:issue=><SessionCell entry={sessionOf(controller.progressForIssue(issue))} onOpen={session=>controller.openSession(session)}/>},
    {id:'assignees',label:'负责人',groupable:true,values:issue=>issue.assignees,render:issue=>issue.assignees.join(', ')||'—'},
    {id:'labels',label:'标签',groupable:true,values:issue=>issue.labels,render:issue=>issue.labels.length?issue.labels.map(label=><span key={label} className={styles.labelPill}>{label}</span>):'—'},
  ]
  return <Section title="Issues">
    {sources.length>1&&<label>来源<select value={sourceState.sourceId??''} onChange={event=>void controller.selectSource(event.target.value)}>{sources.map(item=><option key={item.id} value={item.id}>{item.title??item.projectSnapshot?.project.title??(item.repository?`${item.repository.owner}/${item.repository.repository}`:`${item.githubProject?.owner} / Project #${item.githubProject?.number}`)}</option>)}</select></label>}
    {source&&<>
      <form className={styles.toolbar} onSubmit={event=>{event.preventDefault();void controller.browseIssues({search:queryDraft,labels:labelDraft.split(',').map(label=>label.trim()).filter(Boolean),page:1},true)}}><label>搜索当前来源<input aria-label="搜索来源 Issues" value={queryDraft} onChange={event=>controller.setIssueQueryDraft({search:event.target.value})} placeholder="标题、正文或 #编号"/></label><label>必须包含的标签<input aria-label="Issue 标签" value={labelDraft} onChange={event=>controller.setIssueQueryDraft({labels:event.target.value})} placeholder="逗号分隔"/></label><button type="submit" disabled={loading||!source.enabled}>应用搜索与标签</button></form>
      <div className={styles.toolbar}><label>负责人 <select aria-label="Issue 负责人" value={sourceState.assignee} onChange={event=>void controller.browseIssues({assignee:event.target.value as '@me'|'*',page:1},true)} disabled={loading||!source.enabled}><option value="@me">分配给我</option><option value="*">全部负责人</option></select></label><label>GitHub 状态 <select aria-label="Issue 远端状态" value={sourceState.state} onChange={event=>void controller.browseIssues({state:event.target.value as 'open'|'closed'|'all',page:1},true)} disabled={loading||!source.enabled}><option value="open">Open</option><option value="closed">Closed</option><option value="all">全部</option></select></label><button disabled={loading||!source.enabled} onClick={()=>void controller.browseIssues({},true)}>刷新 Issues</button></div>
      <nav className={styles.tabs} aria-label="Issue 处理状态">{issueFilters.map(([id,label])=><button key={id} aria-pressed={state.issueFilter===id} onClick={()=>controller.setIssueFilter(id)}>{label}</button>)}</nav>
      <p>{cached?'缓存 / 最后已知列表':'本次读取列表'} · 已加载 {listing?.items.length??0} 项 · 列查询及处理状态筛选作用于已加载范围；上方搜索查询整个当前来源{listing?` · 观察时间：${listing.observedAt}`:''}</p>
      {!source.enabled&&<p role="status">来源已停用，显示已保存的内容。</p>}
      <InteractiveTable key={`${state.projectId}/${source.id}/${sourceState.tab}/${sourceState.assignee}/${sourceState.state}/${sourceState.search??''}/${sourceState.labels?.join(',')??''}`} label="GitHub Issue 列表" columns={columns} rows={rows} resetKey={`${state.issueFilter}/${sourceState.listEpoch}`} rowKey={issue=>issue.nodeId} searchText={issue=>`${issue.repository.owner}/${issue.repository.repository} #${issue.number} ${issue.title}`} searchLabel="搜索已加载 Issues" scope={`当前来源：${source.title??source.projectSnapshot?.project.title??source.repository?.repository??source.id} · 列搜索、排序、分组、切片和过滤作用于已加载范围；来源搜索请使用上方表单${listing?.nextPage?' · 来源还有更多，当前结果并非完整来源':''}`} remote={{hasMore:Boolean(listing?.nextPage),loading:sourceState.loadingMore,error:sourceState.moreError,loadMore:()=>void controller.moreIssues(),retry:()=>void (listing?controller.moreIssues():controller.browseIssues({},true))}} unavailable={!listing?loading?'正在读取 Issues…':'此查询尚无可读缓存，请刷新 Issues。读取失败不表示列表为空。':undefined}/>
      {!listing&&!loading&&<p>此筛选页尚无可读缓存，请刷新 Issues。读取失败不表示列表为空。</p>}
      <details><summary>来源状态与缓存</summary><p>最近确认账号：{source.identity?.login??'尚未确认'} · {source.discovery?.lastSuccessAt?`最近同步：${source.discovery.lastSuccessAt}`:'尚无同步时间'}</p>{source.lastError?.retryAt&&<p>可重试时间：{source.lastError.retryAt}</p>}<div className={styles.toolbar}><button disabled={loading} onClick={()=>void controller.browseIssues({},false)}>读取缓存列表</button><button disabled={loading} onClick={()=>void controller.setSourceEnabled(!source.enabled)}>{source.enabled?'停用来源':'启用来源'}</button></div></details>
    </>}
    {loading&&<p role="status">正在读取 Issues…</p>}<ErrorText error={error??''}/>{!source&&!loading&&!error&&<p>选择 Project 或仓库来源以读取 Issues。</p>}
  </Section>
}
function ContinuousProcessing({controller,onClose}:{controller:WorkPanelController;onClose:()=>void}) {
  const snapshot=controller.getSnapshot(),projectId=snapshot.projectId!,sourceId=snapshot.source.sourceId!
  const [rule,setRule]=useState<ContinuousWorkRule|undefined>(undefined),[loaded,setLoaded]=useState(false),[editing,setEditing]=useState(false)
  const [options,setOptions]=useState<WorkExecutionOptions|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[statusError,setStatusError]=useState('')
  const [assignee,setAssignee]=useState<'@me'|'*'>('*'),[labels,setLabels]=useState(''),[resource,setResource]=useState(0),[model,setModel]=useState(0),[agentPreset,setAgentPreset]=useState(''),[permissionPreset,setPermissionPreset]=useState('')
  const [scope]=useState(()=>new AbortController())
  useEffect(()=>()=>scope.abort(),[scope])
  useEffect(()=>{
    const abort=new AbortController();let reading=false
    const read=async()=>{if(reading||editing||busy||abort.signal.aborted)return;reading=true;try{const result=await controller.client.query({type:'continuous.status',projectId,sourceId},abort.signal);if(!abort.signal.aborted){setRule(result.continuousRule);setLoaded(true);setStatusError('')}}catch(error){if(!abort.signal.aborted)setStatusError(message(error))}finally{reading=false}}
    void read();const timer=setInterval(()=>{if(typeof document==='undefined'||document.visibilityState==='visible')void read()},5000)
    return()=>{abort.abort();clearInterval(timer)}
  },[controller,projectId,sourceId,editing,busy])
  async function configure() {
    if(busy)return;setBusy(true);setError('')
    try {
      const result=await controller.client.query({type:'source.execution-options',projectId,sourceId},scope.signal)
      if(scope.signal.aborted)return
      const choices=result.executionOptions
      if(!choices||!choices.resources.length||!choices.models.length||!choices.agentPresets.length||!choices.permissionPresets.length)throw Error('宿主尚无完整的执行目录、模型或预设配置')
      setOptions(choices);setAssignee(rule?.scope.assignee??'*');setLabels(rule?.scope.labels.join(', ')??'')
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
      const result=await controller.submit({type:'continuous.configure',projectId,sourceId,expectedVersion:rule?.version??0,assignee,labels:[...new Set(labels.split(',').map(label=>label.trim()).filter(Boolean))],resource:selectedResource,model:configuredModel,agentPreset,permissionPreset,enabled:false})
      if(!scope.signal.aborted){setRule(result.continuousRule);setEditing(false)}
    }catch(error){if(!scope.signal.aborted)setError(message(error))}finally{if(!scope.signal.aborted)setBusy(false)}
  }
  return <section className={styles.delegation} aria-label="持续委托">
    <div className={styles.delegationHeader}><strong>持续委托{rule?.enabled?' · 已启用':''}</strong><button onClick={onClose}>收起</button></div>
    <ContinuousDelegation client={controller.client} projectId={projectId} sourceId={sourceId} sourceTitle={snapshot.source.sources.find(item=>item.id===sourceId)?.title??snapshot.source.sources.find(item=>item.id===sourceId)?.projectSnapshot?.project.title??'当前来源'} rule={rule} onRuleChanged={setRule}/>
    <button disabled={busy||!loaded} onClick={()=>void configure()}>{rule?'执行目录与模型':'配置执行资源'}</button>
    {rule?.active&&<button onClick={()=>void controller.openTask(rule.active!)}>查看当前执行 / 暂停处理</button>}
    {rule?.error&&<ErrorText error={`${rule.error.code}: ${rule.error.message}`}/>}<ErrorText error={error}/><ErrorText error={statusError}/>
    {editing&&options&&<form className={styles.form} onSubmit={event=>void save(event)}>
      <p>授权整个当前来源的开放 Issue；浏览中的 Project view 与 Issue 筛选不改变委托范围。已有规则保留原负责人和标签约束。保存资源不会启用或启动工作。</p>
       <div className={styles.formRow}><label>持续处理执行目录<select disabled={busy} value={resource} onChange={event=>setResource(Number(event.target.value))}>{options.resources.map((item,index)=><option key={index} value={index}>{item.title}</option>)}</select></label><label>持续处理模型<select disabled={busy} value={model} onChange={event=>setModel(Number(event.target.value))}>{options.models.map((item,index)=><option key={index} value={index}>{item.provider}/{item.model}</option>)}</select></label></div>
      <details><summary>执行预设</summary><div className={styles.formRow}><label>Agent 预设<select disabled={busy} value={agentPreset} onChange={event=>setAgentPreset(event.target.value)}>{options.agentPresets.map(item=><option key={item}>{item}</option>)}</select></label><label>权限预设<select disabled={busy} value={permissionPreset} onChange={event=>setPermissionPreset(event.target.value)}>{options.permissionPresets.map(item=><option key={item}>{item}</option>)}</select></label></div></details>
      <div className={styles.toolbar}><button className={styles.primary} type="submit" disabled={busy}>{busy?'正在保存…':'保存执行资源'}</button><button type="button" disabled={busy} onClick={()=>setEditing(false)}>取消配置</button></div>
    </form>}
    </section>
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
  return <Section title="处理会话">
    {execution ? <>
      <p>{(()=>{const task=state.detail?.task;if(!task)return null;const counts=controller.sessionCounts(task);return `${counts.total} 个会话 · 当前 ${counts.current} · 历史 ${counts.historical} · 其他关联 ${counts.associated}`})()}</p><p>执行状态：{state.detail?.task?.completion?({pending:'等待执行收口',settled:'执行已安全收口',error:'执行收口失败'})[state.detail.task.completion.closeout.status]:executionLabel(execution.state,progress,execution.control?.status)}{executionRuntime ? ` · 会话：${({running:'正在运行',idle:'空闲',inactive:'未激活'})[executionRuntime]}` : ''}</p>
      {execution.progress && <p>工作进展：{execution.progress}</p>}
      {execution.control && !completed && <p>{({wait:'等待',pause:'暂停',resume:'恢复'})[execution.control.action]}请求{execution.control.status==='accepted'?(execution.state==='failed'?'未生效，执行失败':'已接受，等待生效'):'已生效'}{execution.control.reason?`：${execution.control.reason}`:''}</p>}
      {execution.error && <ErrorText error={`${execution.error.code}: ${execution.error.message}`}/>}
      <div className={styles.toolbar}>
        {controller.currentSession() && <button disabled={busy} onClick={()=>controller.openCurrentSession()}>进入当前会话</button>}
        {!completed && ['ready','running'].includes(execution.state) && <button disabled={busy||execution.control?.status==='accepted'} onClick={()=>void controller.controlExecution('pause')}>暂停处理</button>}
        {!completed && progress?.processingState==='blocked' && ['ready','running'].includes(execution.state) && <button disabled={busy||execution.control?.status==='accepted'} onClick={()=>void controller.controlExecution('resume')}>继续处理</button>}
        {!completed && ['waiting','paused'].includes(execution.state) && <button disabled={busy||execution.control?.status==='accepted'} onClick={()=>void controller.controlExecution('resume')}>恢复处理</button>}
        {!completed && execution.state==='failed' && <button disabled={busy} onClick={()=>void controller.controlExecution('reconcile')}>重试原执行</button>}
        <button disabled={busy} onClick={()=>void controller.refreshTask()}>刷新执行状态</button>
      </div>
      {!controller.currentSession() && <p>当前会话暂不可进入；刷新可查看创建或恢复结果。</p>}
      {execution.actual && <details><summary>实际执行环境</summary><p>工作目录：{execution.actual.cwd}<br/>模型：{execution.actual.provider}/{execution.actual.model}<br/>Agent 预设：{execution.actual.agentPreset}<br/>权限：{execution.actual.permissionPreset} · 沙箱：{execution.actual.sandbox} · 审批：{execution.actual.approval}</p></details>}
      {execution.events.length>0 && <details><summary>输入与结果（{execution.events.length}）</summary>{execution.events.map(event=><p key={event.id}>{({accepted:'已接受',delivered:'已投递',consumed:'已消费',discarded:'已废弃'})[event.delivery]} · 尚未验收<br/>{event.text}</p>)}</details>}
    </> : completed ? <p>本地已验收；执行观察尚未取得，请刷新详情读取收口状态。</p> : <>
      <p>尚未开始处理。开始后会在所选执行目录创建会话。</p>
      {options && selection ? <form className={styles.form} onSubmit={event=>{event.preventDefault();void controller.startPrepared()}}>
        <p>请确认执行目录、模型、Agent 预设与权限；未修改时使用宿主与项目的默认配置。</p>
        <label>工作目录{options.resources.length>1 ? <select disabled={busy} value={selection.resourceIndex} onChange={event=>controller.selectStart({resourceIndex:Number(event.target.value)})}>{options.resources.map((resource,index)=><option key={`${resource.ref.runtimeId}/${resource.ref.workspaceId}`} value={index}>{resource.title}</option>)}</select> : <span title="宿主或项目规则只提供这一个执行目录">{options.resources[0]?.title}</span>}</label>
        <label>模型{options.models.length>1 ? <select disabled={busy} value={selection.modelIndex} onChange={event=>controller.selectStart({modelIndex:Number(event.target.value)})}>{options.models.map((model,index)=><option key={`${model.provider}/${model.model}`} value={index}>{model.provider}/{model.model}</option>)}</select> : <span title="宿主或项目 Agent 只允许这一个模型">{options.models[0]?.provider}/{options.models[0]?.model}</span>}</label>
        <label>Agent 预设{options.agentPresets.length>1 ? <select disabled={busy} value={selection.agentPreset} onChange={event=>controller.selectStart({agentPreset:event.target.value})}>{options.agentPresets.map(preset=><option key={preset}>{preset}</option>)}</select> : <span title="宿主只暴露默认 Agent 预设">{selection.agentPreset}</span>}</label>
        <label>权限{options.permissionPresets.length>1 ? <select disabled={busy} value={selection.permissionPreset} onChange={event=>controller.selectStart({permissionPreset:event.target.value})}>{options.permissionPresets.map(preset=><option key={preset}>{preset}</option>)}</select> : <span title="宿主只暴露默认权限预设">{selection.permissionPreset}</span>}</label>
        <div className={styles.toolbar}><button type="submit" disabled={busy}>{busy?'正在启动…':'确认开始处理'}</button><button type="button" disabled={busy} onClick={()=>controller.cancelStart()}>取消</button></div>
      </form> : <button className={styles.primary} disabled={busy||state.loading||state.source.loading} onClick={()=>void controller.prepareStart(!state.detail?.task)}>开始处理</button>}
    </>}
  </Section>
}
function HistoryTranscript({controller}:{controller:WorkPanelController}) {
  const {history}=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot)
  if(!history.session&&!history.error)return null
  return <section aria-label="只读历史记录"><div className={styles.header}><h3>历史记录 · 只读</h3><button onClick={()=>controller.closeHistory()}>关闭记录</button></div>
    {history.session&&<p>会话：{history.session.sessionId} · 查看记录不会启动旧会话。</p>}
    {history.events.map((event,index)=><pre key={index}>{typeof event==='string'?event:JSON.stringify(event,null,2)??'空记录'}</pre>)}
    {history.loaded&&!history.events.length&&<p>此会话没有可显示的记录。</p>}
    {history.loading&&<p role="status">正在读取历史记录…</p>}
    {history.error&&<><ErrorText error={history.error}/>{history.session&&<button disabled={history.loading} onClick={()=>void controller.retryHistory()}>重试读取</button>}</>}
    {history.nextCursor!==undefined&&<button disabled={history.loading} onClick={()=>void controller.moreHistory()}>{history.loading?'正在读取…':'加载更多记录'}</button>}
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
      <ErrorText error={error}/>{saved&&<p role="status">接续策略已保存</p>}<button type="submit" disabled={busy}>{busy?'正在保存…':'保存接续策略'}</button>
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
    <details><summary>已接受来源</summary><h3>{accepted.title}</h3><IssueFacts issue={accepted}/><p className={styles.sourceBody}>{accepted.body||'（已接受正文为空）'}</p></details>
    <details><summary>最新观察</summary><h3>{latest.title}</h3><IssueFacts issue={latest}/><p className={styles.sourceBody}>{latest.body||'（观察正文为空）'}</p></details>
  </details>
}
function GitHubLink({url}:{url:string}) {
  let safe=false
  try {const parsed=new URL(url);safe=parsed.protocol==='https:'&&parsed.hostname==='github.com'&&!parsed.username&&!parsed.password&&!parsed.port&&/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*\/?$/.test(parsed.pathname)&&!parsed.search&&!parsed.hash}catch{}
  return safe?<a href={url} target="_blank" rel="noopener noreferrer">在 GitHub 查看来源</a>:<span>来源 URL 无法安全打开</span>
}
function NativeIssueRelations({issue,controller}:{issue:import('../work-sources/types.ts').GitHubIssue;controller:WorkPanelController}) {
  const {parent,subIssues}=issue
  if(parent===undefined&&subIssues===undefined)return <p role="status">原生父子关系尚未读取；不能据此断言没有子工作。</p>
  if(!parent&&!subIssues?.items.length&&!subIssues?.totalCount)return null
  const reference=(item:import('../work-sources/types.ts').GitHubIssueReference)=>{const progress=controller.progressForIssue(item);return <><span>{item.repository.owner}/{item.repository.repository} #{item.number} · {item.title} · 远端 {item.state}</span> <GitHubLink url={item.url}/>{progress?<p>{processingLabel(progress)} · {progress.summary} <button onClick={()=>void controller.openTask(progress.ref)}>查看进展</button></p>:<span> · 尚未读取完整要求 <button onClick={()=>void controller.openNativeIssue(item)}>读取独立工作要求</button></span>}</>}
  return <Section title="原生 Issue 父子关系">
    <p>GitHub 原始父子关系；打开来源链接仅查看原文。执行进展与验收在下方分别显示。</p>
    {parent&&<p>父 Issue：{reference(parent)}</p>}
    {subIssues&&<><p>子 Issue：已显示 {subIssues.items.length} / {subIssues.totalCount} 项</p><ul>{subIssues.items.map(item=><li key={item.nodeId}>{reference(item)}</li>)}</ul>{subIssues.hasNextPage&&<p role="status">子 Issue 尚未完整读取，还有更多条目。</p>}</>}
  </Section>
}
function IssueFacts({issue}:{issue:import('../work-sources/types.ts').GitHubIssue}) {
  return <p>远端状态：{issue.state} · 负责人：{issue.assignees.join(', ')||'无'} · 标签：{issue.labels.join(', ')||'无'}<br/>远端更新时间：{issue.updatedAt} · 观察时间：{issue.observedAt}</p>
}
function Section({title,children}:{title:string;children:ReactNode}) {return <section><h2>{title}</h2>{children}</section>}
function TaskLink({controller,task}:{controller:WorkPanelController;task:WorkTask}) {return <button className={styles.link} onClick={()=>void controller.openTask({projectId:task.projectId,taskId:task.id})}>{task.title}</button>}
function activityLabel(type:string):string {return ({'task.create':'创建工作','task.create-child':'创建子工作','task.update-spec':'更新目标、规格与验收','task.replace-breakdown':'更新工作拆解','task.associate-session':'关联会话','task.link-child':'关联子工作','source.import':'接入 GitHub 工作','source.link':'关联 GitHub 来源','source.link-hierarchy':'原生 Issue 父子关联'})[type] ?? type}
function ErrorText({error}:{error:string}) {return error ? <p role="alert" className={styles.failure}>{error}</p>:null}

/** Present native work links without owning navigation or execution side effects. */
export function SessionWorkLinks({work,onReveal,onEnter,opening=false}:{work:AssociatedWork[];onReveal:(ref:AssociatedWork['ref'])=>void;onEnter:(ref:AssociatedWork['ref'])=>void;opening?:boolean}) {
  return <>{work.map(item=><span key={`${item.ref.projectId}/${item.ref.taskId}`}><button onClick={()=>onReveal(item.ref)} title="查看工作与进展">{item.projectName} / {item.title} · 工作与进展</button>{item.purpose==='history'&&<><span> 处理会话已切换；内容投递状态见「A²D² 接续」 · </span><button disabled={opening} onClick={()=>onEnter(item.ref)}>{opening?'正在核对当前会话…':'进入当前处理会话'}</button></>}</span>)}</>
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
