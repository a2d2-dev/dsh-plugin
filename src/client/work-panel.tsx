import { useEffect, useState, useSyncExternalStore } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { DetailTab, WorkPanelController } from './work-panel-controller.ts'
import type { AssociatedWork, HostResource, WorkExecution, WorkTask, WorkExecutionOptions, ContinuousWorkRule } from '../work-types.ts'
import type { GitHubIssue } from '../work-sources/types.ts'
import { message } from './work-panel-controller.ts'
import styles from './work-panel.module.css'

const detailTabs: [DetailTab,string][] = [['overview','概览'],['related','需求与子 Issue'],['sessions','会话与历史'],['activity','活动']]
const issueFilters = [['all','全部'],['not-started','未开始'],['processing','处理中'],['waiting','等待'],['blocked','阻塞'],['completed','已完成']] as const

export function WorkPanel({ controller }: { controller: WorkPanelController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [connecting,setConnecting]=useState(false),[surface,setSurface]=useState<HTMLElement|null>(null)
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
  const binding=detail?.bindings?.[0]
  const issue=task ? (binding?.lastObserved ?? (state.source.bindings.some(item=>item.ref.taskId===task.id&&item.ref.projectId===task.projectId)?state.source.issue:null)) : state.source.issue
  const hasDetail=Boolean(task||issue)
  const sourceTitle=source?.projectSnapshot?.project.title??project?.name
  return <main ref={setSurface} className={styles.panel} aria-label="A²D² 控制面板">
    <header className={styles.header}><div><p className={styles.eyebrow}>A²D² · GitHub</p><h1>{hasDetail?'Issue 工作台':sourceTitle??'连接 GitHub Project'}</h1></div><button onClick={()=>controller.close()}>关闭面板</button></header>
    {state.error&&<p className={styles.failure} role="alert">{state.error} <button onClick={()=>void (task?controller.refreshTask():controller.load())}>重新读取</button></p>}
    {state.observationError&&<p role="status">状态更新暂不可用，保留上次内容：{state.observationError}</p>}
    {state.startup.error&&<ErrorText error={state.startup.error}/>}
    {state.startup.busy&&<p role="status">正在准备执行，请稍候…</p>}
    <div className={styles.toolbar}>
      {projects.length>0&&<label>GitHub Project <select aria-label="GitHub Project" value={state.projectId??''} onChange={event=>{setConnecting(false);void controller.selectProject(event.target.value)}}>{!projects.some(item=>item.id===state.projectId)&&<option value="">选择 Project</option>}{projects.map(item=><option key={item.id} value={item.id}>{state.projectSources[item.id]?.find(source=>source.githubProject)?.projectSnapshot?.project.title??item.name}</option>)}</select></label>}
      {projects.length>0&&<button onClick={()=>setConnecting(!connecting)}>{connecting?'取消连接':'连接 GitHub Project'}</button>}
    </div>
    {(connecting||(!projects.length&&!hasDetail&&!state.loading))&&<Section title="选择 GitHub Project"><p>连接你的 Project，浏览分配给你的 Issues，并在需要时开启持续处理。</p><GitHubProjectForm controller={controller} onSaved={()=>setConnecting(false)}/></Section>}
    {state.loading&&<p role="status">正在读取 Issue 与进展…</p>}
    {hasDetail?<>
      <header className={styles.issueHeader}><button className={styles.link} onClick={()=>controller.back()}>← {controller.canReturnToRequirement()?'返回上级要求':'返回 Issue 列表'}</button><p className={styles.eyebrow}>{issue?`${issue.repository.owner}/${issue.repository.repository} · #${issue.number}`:sourceTitle}</p><h1>{issue?`#${issue.number} ${issue.title}`:task?.title}</h1><div className={styles.toolbar}>{issue&&<GitHubLink url={issue.url}/>}<span className={styles.badge}>{processingLabel(detail?.progress)}</span><button disabled={state.loading||state.source.loading} onClick={()=>void (task?controller.refreshTask():issue&&controller.openIssue(issue.number,Boolean(source?.enabled),issue.nodeId))}>刷新详情</button></div></header>
      <nav className={styles.tabs} role="tablist" aria-label="Issue 详情标签">{detailTabs.map(([id,label])=><button key={id} role="tab" aria-selected={state.detailTab===id} onClick={()=>controller.setDetailTab(id)}>{label}</button>)}</nav>
      <div role="tabpanel" aria-label={detailTabs.find(([id])=>id===state.detailTab)?.[1]}>
        {state.detailTab==='overview'&&<>
          <div className={styles.detailGrid}><div><Section title="当前进展"><p>{detail?.progress?.summary??'尚未开始处理'}</p>{detail?.progress&&<CriteriaCount criteria={detail.progress.criteria}/>}<p>下一步：{detail?.progress?.next||(!detail?.execution?'确认要求后开始处理':'等待当前会话报告下一步')}</p>{detail?.progress?.blockers.map((blocker,index)=><p className={styles.failure} key={index}>阻塞：{blocker}</p>)}</Section><Requirements controller={controller}/></div><CurrentExecution controller={controller}/></div>
          {issue&&<Section title="Issue 原始要求"><IssueFacts issue={issue}/><p>{state.source.cached?'缓存 / 最后已知内容':'本次读取内容'}</p><p className={styles.sourceBody}>{issue.body||'（原文正文为空）'}</p><NativeIssueRelations issue={issue} controller={controller}/></Section>}
          {task&&<Section title="已接受要求与验收"><p>{task.goal}</p>{task.specification.text!==issue?.body&&<details><summary>已接受规格 · 第 {task.specification.version} 版</summary><p className={styles.sourceBody}>{task.specification.text}</p></details>}{task.specification.missing?.includes('acceptance')&&<p role="status">结构化验收标准尚待确认。原始要求中的验收段落需由处理会话确认。</p>}{task.specification.missing?.includes('body')&&<p role="status">规格正文尚待补充；已观察的 Issue 正文为空。</p>}<ul>{task.specification.acceptance.map((criterion,index)=>{const result=task.progress?.specificationVersion===task.specification.version?task.progress.criteria.find(item=>item.index===index):undefined;return <li key={index}>{criterion} · {result?result.passed?'已通过':'未通过':'待核验'}{result?.evidence.map((evidence,index)=><p key={index}>证据：{evidence}</p>)}</li>})}</ul></Section>}
          {binding&&<SourceBinding binding={binding}/>}
        </>}
        {state.detailTab==='related'&&<><Requirements controller={controller}/>{issue&&<NativeIssueRelations issue={issue} controller={controller}/>}</>}
        {state.detailTab==='sessions'&&<><CurrentExecution controller={controller}/>{task&&<Sessions controller={controller} task={task}/>}</>}
        {state.detailTab==='activity'&&<Section title="活动记录">{task?.activity.length?<ol>{[...task.activity].reverse().map(item=><li key={item.commandId}>版本 {item.version} · {activityLabel(item.type)}</li>)}</ol>:<p>尚无处理活动。</p>}</Section>}
      </div>
      <ErrorText error={state.source.error??''}/>
    </>:state.projectId&&<>
      {source?.githubProject&&<div className={styles.sourceSummary}><strong>{sourceTitle}</strong><span>{source.githubProject.owner} / Project #{source.githubProject.number} · {source.githubProject.type==='org'?'组织':'个人'}</span><span>最近确认账号：{source.identity?.login??'尚未确认'}{source.identity?.name?` / ${source.identity.name}`:''}</span></div>}
      {source&&<ContinuousProcessing key={`${state.projectId}/${source.id}`} controller={controller}/>}
      <IssueSourcePanel controller={controller}/>
      {project&&<Section title="自动接续"><ContinuationSettings key={`${project.id}/${project.continuationPolicy?.version??0}`} controller={controller} policy={project.continuationPolicy}/></Section>}
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
function GitHubProjectForm({controller,onSaved}:{controller:WorkPanelController;onSaved:()=>void}) {
  const [owner,setOwner]=useState(''),[type,setType]=useState<'org'|'user'>('org'),[number,setNumber]=useState(''),[resources,setResources]=useState<HostResource[]>([]),[resource,setResource]=useState('')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{const abort=new AbortController();void controller.client.query({type:'resources.list'},abort.signal).then(result=>{if(!abort.signal.aborted)setResources(result.resources??[])},error=>{if(!abort.signal.aborted)setError(message(error))});return()=>abort.abort()},[controller])
  async function connect(event:FormEvent) {
    event.preventDefault();if(busy)return
    setBusy(true);setError('')
    try{await controller.connectProject({owner,type,number:Number(number)},resources.find((_,index)=>String(index)===resource)?.ref);onSaved()}catch(error){setError(message(error))}finally{setBusy(false)}
  }
  return <form className={styles.form} onSubmit={event=>void connect(event)}>
    <div className={styles.formRow}><label>GitHub owner<input required disabled={busy} value={owner} onChange={event=>setOwner(event.target.value)} placeholder="组织或用户名"/></label><label>账号类型<select disabled={busy} value={type} onChange={event=>setType(event.target.value as 'org'|'user')}><option value="org">组织</option><option value="user">个人</option></select></label><label>Project 编号<input required disabled={busy} type="number" min="1" step="1" value={number} onChange={event=>setNumber(event.target.value)}/></label></div>
    <label>执行目录（可选）<select disabled={busy} value={resource} onChange={event=>setResource(event.target.value)}><option value="">开始处理时选择</option>{resources.map((item,index)=><option key={`${item.ref.runtimeId}/${item.ref.workspaceId}`} value={index} disabled={Boolean(item.owner&&!controller.getSnapshot().projectSources[item.owner.projectId]?.some(source=>source.githubProject?.owner.toLowerCase()===owner.trim().toLowerCase()&&source.githubProject?.type===type&&source.githubProject?.number===Number(number)))}>{item.title}{item.owner?` · ${item.owner.projectName}`:''}</option>)}</select></label>
    <p>使用此 DSH 服务已连接的 GitHub 账号。连接后可先浏览 Issues。</p><ErrorText error={error}/><button className={styles.primary} disabled={busy} type="submit">{busy?'正在连接…':'连接并查看 Issues'}</button>
  </form>
}
function IssueSourcePanel({controller}:{controller:WorkPanelController}) {
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot), sourceState=state.source
  const {listing,loading,error,cached}=sourceState, source=sourceState.sources.find(item=>item.id===sourceState.sourceId)
  const rows=controller.visibleIssues(),sources=sourceState.sources.filter(item=>item.githubProject)
  return <Section title="Issues">
    {sources.length>1&&<label>Project 来源<select value={sourceState.sourceId??''} onChange={event=>void controller.selectSource(event.target.value)}>{sources.map(item=><option key={item.id} value={item.id}>{item.projectSnapshot?.project.title??`${item.githubProject?.owner} / Project #${item.githubProject?.number}`}</option>)}</select></label>}
    {source&&<>
      <div className={styles.toolbar}><label>负责人 <select aria-label="Issue 负责人" value={sourceState.assignee} onChange={event=>void controller.browseIssues({assignee:event.target.value as '@me'|'*',page:1},true)} disabled={loading||!source.enabled}><option value="@me">分配给我</option><option value="*">全部负责人</option></select></label><label>GitHub 状态 <select aria-label="Issue 远端状态" value={sourceState.state} onChange={event=>void controller.browseIssues({state:event.target.value as 'open'|'closed'|'all',page:1},true)} disabled={loading||!source.enabled}><option value="open">Open</option><option value="closed">Closed</option><option value="all">全部</option></select></label><input aria-label="搜索当前页 Issues" placeholder="搜索当前页标题、编号、要求或标签" value={state.search} onChange={event=>controller.setSearch(event.target.value)}/><button disabled={loading||!source.enabled} onClick={()=>void controller.browseIssues({},true)}>刷新 Issues</button></div>
      <nav className={styles.tabs} aria-label="Issue 处理状态">{issueFilters.map(([id,label])=><button key={id} aria-pressed={state.issueFilter===id} onClick={()=>controller.setIssueFilter(id)}>{label}</button>)}</nav>
      <p>{cached?'缓存 / 最后已知列表':'本次读取列表'} · 第 {sourceState.page} 页 · 搜索与处理状态筛选仅作用于当前已载入页{listing?`（${rows.length} / ${listing.items.length} 项） · 观察时间：${listing.observedAt}`:''}</p>
      {!source.enabled&&<p role="status">来源已停用，显示已保存的内容。</p>}
      {listing&&<><div className={styles.tableScroll}><table aria-label="GitHub Issue 列表"><thead><tr><th>Issue / 原始要求</th><th>进展与下一步</th><th>负责人 / 标签</th></tr></thead><tbody>{rows.map(issue=>{const progress=controller.progressForIssue(issue);return <tr key={issue.nodeId}><td><button className={styles.issueLink} onClick={()=>void controller.openIssue(issue.number,source.enabled,issue.nodeId)}>#{issue.number} {issue.title}</button><p>{issue.repository.owner}/{issue.repository.repository} · GitHub {issue.state}</p></td><td><span className={styles.badge}>{processingLabel(progress)}</span>{progress&&<>{progress.execution&&<p>{executionLabel(progress.execution.state,progress)}</p>}<p>{progress.summary}</p>{progress.next&&<p>下一步：{progress.next}</p>}{progress.processingReason&&<p>{progress.processingReason}</p>}{progress.blockers.map((blocker,index)=><p className={styles.failure} key={index}>阻塞：{blocker}</p>)}</>}</td><td>{issue.assignees.join(', ')||'未指派'}<p>{issue.labels.join(' · ')}</p></td></tr>})}</tbody></table></div>{!rows.length&&<p>{listing.items.length?'当前页没有匹配筛选的 Issue。':listing.nextPage?'本页没有 Issue，仍可读取下一页。':'当前页没有匹配的 Issue。'}</p>}<div className={styles.toolbar}><button disabled={loading||sourceState.page<=1} onClick={()=>void controller.browseIssues({page:sourceState.page-1},source.enabled)}>上一页</button><span>第 {sourceState.page} 页</span><button disabled={loading||!listing.nextPage} onClick={()=>void controller.browseIssues({page:listing.nextPage!},source.enabled)}>下一页</button></div></>}
      {!listing&&!loading&&<p>此筛选页尚无可读缓存，请刷新 Issues。读取失败不表示列表为空。</p>}
      <details><summary>来源状态与缓存</summary><p>最近确认账号：{source.identity?.login??'尚未确认'} · {source.discovery?.lastSuccessAt?`最近同步：${source.discovery.lastSuccessAt}`:'尚无同步时间'}</p>{source.lastError?.retryAt&&<p>可重试时间：{source.lastError.retryAt}</p>}<div className={styles.toolbar}><button disabled={loading} onClick={()=>void controller.browseIssues({},false)}>读取缓存列表</button><button disabled={loading} onClick={()=>void controller.setSourceEnabled(!source.enabled)}>{source.enabled?'停用来源':'启用来源'}</button></div></details>
    </>}
    {loading&&<p role="status">正在读取 Issues…</p>}<ErrorText error={error??''}/>{!source&&!loading&&!error&&<p>选择 GitHub Project 以读取 Issues。</p>}
  </Section>
}
function ContinuousProcessing({controller}:{controller:WorkPanelController}) {
  const snapshot=controller.getSnapshot(),projectId=snapshot.projectId!,sourceId=snapshot.source.sourceId!
  const [rule,setRule]=useState<ContinuousWorkRule|undefined>(undefined),[loaded,setLoaded]=useState(false),[editing,setEditing]=useState(false)
  const [options,setOptions]=useState<WorkExecutionOptions|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[statusError,setStatusError]=useState('')
  const [assignee,setAssignee]=useState<'@me'|'*'>('@me'),[labels,setLabels]=useState(''),[resource,setResource]=useState(0),[model,setModel]=useState(0),[agentPreset,setAgentPreset]=useState(''),[permissionPreset,setPermissionPreset]=useState('')
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
      setOptions(choices);setAssignee(rule?.scope.assignee??'@me');setLabels(rule?.scope.labels.join(', ')??'')
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
      const result=await controller.submit({type:'continuous.configure',projectId,sourceId,expectedVersion:rule?.version??0,assignee,labels:[...new Set(labels.split(',').map(label=>label.trim()).filter(Boolean))],resource:selectedResource,model:configuredModel,agentPreset,permissionPreset,enabled:true})
      if(!scope.signal.aborted){setRule(result.continuousRule);setEditing(false)}
    }catch(error){if(!scope.signal.aborted)setError(message(error))}finally{if(!scope.signal.aborted)setBusy(false)}
  }
  async function toggle() {
    if(!rule||busy)return;setBusy(true);setError('')
    try{const result=await controller.submit({type:'continuous.set-enabled',projectId,sourceId,expectedVersion:rule.version,enabled:!rule.enabled});if(!scope.signal.aborted)setRule(result.continuousRule)}catch(error){if(!scope.signal.aborted)setError(message(error))}finally{if(!scope.signal.aborted)setBusy(false)}
  }
  const queueLabels={queued:'排队',active:'处理中',waiting:'等待',paused:'已暂停',blocked:'阻塞',completed:'已完成',skipped:'已跳过'}
  return <section className={styles.continuous} aria-label="持续处理"><div className={styles.header}><div><h2>持续处理</h2><p>{rule?.enabled?'正在接收新 Issue':rule?'已暂停接新工作':'按规则自动接收并处理 Issues'} · 同时处理 1 项；等待时可处理下一项</p></div><div className={styles.toolbar}>{rule&&<button disabled={busy} onClick={()=>void toggle()}>{rule.enabled?'暂停接新工作':'恢复接新工作'}</button>}<button className={!rule?styles.primary:undefined} disabled={busy||!loaded} onClick={()=>void configure()}>{rule?'配置范围与执行':'开启持续处理'}</button></div></div>
    <p>范围：当前 GitHub Project · {rule?(rule.scope.assignee==='@me'?`分配给我${rule.scope.identity?`（${rule.scope.identity.login}）`:''}`:'全部负责人'):'待配置'}{rule?` · ${rule.scope.labels.length?`标签：${rule.scope.labels.join('、')}（全部匹配）`:'不限标签'}`:''}</p>
    <p>暂停接新工作后，当前执行继续处理。暂停当前执行请进入对应 Issue，使用“暂停处理”。</p>
    {rule?.active&&<button onClick={()=>void controller.openTask(rule.active!)}>查看当前执行 / 暂停处理</button>}
    {rule?.error&&<ErrorText error={`${rule.error.code}: ${rule.error.message}`}/>}<ErrorText error={error}/><ErrorText error={statusError}/>
    {editing&&options&&<form className={styles.form} onSubmit={event=>void save(event)}>
      <div className={styles.formRow}><label>持续处理负责人<select disabled={busy} value={assignee} onChange={event=>setAssignee(event.target.value as '@me'|'*')}><option value="@me">分配给我</option><option value="*">全部负责人</option></select></label><label>必须包含的标签（逗号分隔）<input disabled={busy} value={labels} onChange={event=>setLabels(event.target.value)} placeholder="ready-for-agent"/></label></div>
      <p>将持续读取当前 Project 的开放 Issues，按上述负责人和全部标签匹配。最多一项自动推进；浏览列表的筛选不会改变此范围。</p>
      <div className={styles.formRow}><label>持续处理执行目录<select disabled={busy} value={resource} onChange={event=>setResource(Number(event.target.value))}>{options.resources.map((item,index)=><option key={index} value={index}>{item.title}</option>)}</select></label><label>持续处理模型<select disabled={busy} value={model} onChange={event=>setModel(Number(event.target.value))}>{options.models.map((item,index)=><option key={index} value={index}>{item.provider}/{item.model}</option>)}</select></label></div>
      <details><summary>执行预设</summary><div className={styles.formRow}><label>Agent 预设<select disabled={busy} value={agentPreset} onChange={event=>setAgentPreset(event.target.value)}>{options.agentPresets.map(item=><option key={item}>{item}</option>)}</select></label><label>权限预设<select disabled={busy} value={permissionPreset} onChange={event=>setPermissionPreset(event.target.value)}>{options.permissionPresets.map(item=><option key={item}>{item}</option>)}</select></label></div></details>
      <div className={styles.toolbar}><button className={styles.primary} type="submit" disabled={busy}>{busy?'正在保存…':'确认范围并启用'}</button><button type="button" disabled={busy} onClick={()=>setEditing(false)}>取消配置</button></div>
    </form>}
    {Boolean(rule?.items.length)&&<details open><summary>处理队列 · {rule!.items.length} 项</summary><ul className={styles.queue}>{rule!.items.map(item=><li key={item.nodeId}><span className={styles.badge}>{queueLabels[item.state]}</span><span>{item.ref?<button className={styles.link} onClick={()=>void controller.openTask(item.ref!)}>#{item.number} {item.title}</button>:<button className={styles.link} onClick={()=>void controller.openIssue(item.number,false,item.nodeId)}>#{item.number} {item.title}</button>}{item.reason&&<p>{item.reason}</p>}</span></li>)}</ul></details>}
  </section>
}
function Sessions({controller,task}:{controller:WorkPanelController;task:WorkTask}) {
  return <Section title="相关会话"><p>关联记录仅用于查看；当前处理会话与接续历史分别列出。</p>{task.sessions.length?<ul>{task.sessions.map(item=><li key={`${item.session.runtimeId}/${item.session.sessionId}`}>{item.purpose==='review'?'评审':'相关'} · {item.session.sessionId} <button onClick={()=>controller.openSession(item.session)}>打开会话</button></li>)}</ul>:<p>尚无其他关联会话。</p>}</Section>
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
  const completed = completedProgress(progress)
  return <Section title="处理会话">
    {execution ? <>
      <p>{(()=>{const task=state.detail?.task;if(!task)return null;const counts=controller.sessionCounts(task);return `${counts.total} 个会话 · 当前 ${counts.current} · 历史 ${counts.historical} · 其他关联 ${counts.associated}`})()}</p><p>执行状态：{executionLabel(execution.state,progress,execution.control?.status)}{executionRuntime ? ` · 会话：${({running:'正在运行',idle:'空闲',inactive:'未激活'})[executionRuntime]}` : ''}</p>
      {execution.progress && <p>工作进展：{execution.progress}</p>}
      {execution.control && !completed && <p>{({wait:'等待',pause:'暂停',resume:'恢复'})[execution.control.action]}请求{execution.control.status==='accepted'?'已接受，等待生效':'已生效'}{execution.control.reason?`：${execution.control.reason}`:''}</p>}
      {execution.error && <ErrorText error={`${execution.error.code}: ${execution.error.message}`}/>}
      <div className={styles.toolbar}>
        {controller.currentSession() && <button disabled={busy} onClick={()=>controller.openCurrentSession()}>进入当前会话</button>}
        {!completed && ['ready','running'].includes(execution.state) && <button disabled={busy||execution.control?.status==='accepted'} onClick={()=>void controller.controlExecution('pause')}>暂停处理</button>}
        {!completed && progress?.processingState==='blocked' && ['ready','running'].includes(execution.state) && <button disabled={busy||execution.control?.status==='accepted'} onClick={()=>void controller.controlExecution('resume')}>继续处理</button>}
        {!completed && ['waiting','paused'].includes(execution.state) && <button disabled={busy||execution.control?.status==='accepted'} onClick={()=>void controller.controlExecution('resume')}>恢复处理</button>}
        {execution.state==='failed' && <button disabled={busy} onClick={()=>void controller.controlExecution('reconcile')}>重试原执行</button>}
        <button disabled={busy} onClick={()=>void controller.refreshTask()}>刷新执行状态</button>
      </div>
      {!controller.currentSession() && <p>当前会话暂不可进入；刷新可查看创建或恢复结果。</p>}
      <details><summary>自动接续 · {execution.continuationPolicy?.enabled?`${Math.round(execution.continuationPolicy.targetTokens/1000)}K`:'未启用'} · 200K / 300K / 自定义</summary><ContinuationSettings key={`execution/${execution.id}/${execution.continuationPolicy?.version??0}`} controller={controller} policy={execution.continuationPolicy} forExecution/></details>
      {execution.continuationObservation && <p>上下文读数：{execution.continuationObservation.totalTokens.toLocaleString()} token · {({usage:'用量计量',estimated:'估算',none:'无基线'})[execution.continuationObservation.baseline]} · 模型窗口 {execution.continuationObservation.capacity.toLocaleString()} token · 观察时间 {execution.continuationObservation.observedAt}</p>}
      {execution.continuationBlocked && <ErrorText error={`接续等待：${execution.continuationBlocked.code} · ${execution.continuationBlocked.message}`}/>}
      {execution.continuation && <p>接续状态：{({reserved:'已预约', 'material-requested':'正在保存上下文', 'material-saved':'材料已保存', 'successor-created':'后继已创建', taken:'后继已接任', delivered:'接续内容已投递'})[execution.continuation.phase]}{execution.continuation.error?` · ${execution.continuation.error.message}`:''}</p>}
      {!completed && <button disabled={busy||['accepted','creating','failed'].includes(execution.state)||Boolean(execution.continuation&&execution.continuation.phase!=='delivered')} onClick={()=>void controller.controlExecution('continue')}>接续到新会话</button>}
      {Boolean(execution.retired?.length) && <details><summary>历史会话（{execution.retired!.length}）</summary>{execution.retired!.map(item=><p key={item.session.sessionId}>第 {item.epoch} 段 · {item.session.sessionId} · 已退出当前协调 <button onClick={()=>void controller.openHistory(item.session)}>查看记录</button></p>)}</details>}
      <HistoryTranscript controller={controller}/>
      {execution.actual && <details><summary>实际执行环境</summary><p>工作目录：{execution.actual.cwd}<br/>模型：{execution.actual.provider}/{execution.actual.model}<br/>Agent 预设：{execution.actual.agentPreset}<br/>权限：{execution.actual.permissionPreset} · 沙箱：{execution.actual.sandbox} · 审批：{execution.actual.approval}</p></details>}
      {execution.events.length>0 && <details><summary>输入与结果（{execution.events.length}）</summary>{execution.events.map(event=><p key={event.id}>{({accepted:'已接受',delivered:'已投递',consumed:'已消费'})[event.delivery]} · 尚未验收<br/>{event.text}</p>)}</details>}
    </> : <>
      <p>尚未开始处理。开始后会在所选执行目录创建会话。</p>
      {options && selection ? <form className={styles.form} onSubmit={event=>{event.preventDefault();void controller.startPrepared()}}>
        <p>请确认执行目录和模型；优先使用项目与规则默认配置。</p>
        <label>工作目录{options.resources.length>1 ? <select disabled={busy} value={selection.resourceIndex} onChange={event=>controller.selectStart({resourceIndex:Number(event.target.value)})}>{options.resources.map((resource,index)=><option key={`${resource.ref.runtimeId}/${resource.ref.workspaceId}`} value={index}>{resource.title}</option>)}</select> : <span>{options.resources[0]?.title}</span>}</label>
        <label>模型{options.models.length>1 ? <select disabled={busy} value={selection.modelIndex} onChange={event=>controller.selectStart({modelIndex:Number(event.target.value)})}>{options.models.map((model,index)=><option key={`${model.provider}/${model.model}`} value={index}>{model.provider}/{model.model}</option>)}</select> : <span>{options.models[0]?.provider}/{options.models[0]?.model}</span>}</label>
        <label>Agent 预设{options.agentPresets.length>1 ? <select disabled={busy} value={selection.agentPreset} onChange={event=>controller.selectStart({agentPreset:event.target.value})}>{options.agentPresets.map(preset=><option key={preset}>{preset}</option>)}</select> : <span>{selection.agentPreset}</span>}</label>
        <label>权限{options.permissionPresets.length>1 ? <select disabled={busy} value={selection.permissionPreset} onChange={event=>controller.selectStart({permissionPreset:event.target.value})}>{options.permissionPresets.map(preset=><option key={preset}>{preset}</option>)}</select> : <span>{selection.permissionPreset}</span>}</label>
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
  if(!parent&&!subIssues?.items.length&&!subIssues?.totalCount)return null
  const reference=(item:import('../work-sources/types.ts').GitHubIssueReference)=>{const progress=controller.progressForIssue(item);return <><span>{item.repository.owner}/{item.repository.repository} #{item.number} · {item.title} · 远端 {item.state}</span> <GitHubLink url={item.url}/>{progress&&<p>{processingLabel(progress)} · {progress.summary} <button onClick={()=>void controller.openTask(progress.ref)}>查看进展</button></p>}</>}
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
  return <>{work.map(item=><span key={`${item.ref.projectId}/${item.ref.taskId}`}><button onClick={()=>onReveal(item.ref)} title="查看工作与进展">{item.projectName} / {item.title} · 工作与进展</button>{item.purpose==='history'&&<><span> 已接续到新会话 · </span><button disabled={opening} onClick={()=>onEnter(item.ref)}>{opening?'正在核对当前会话…':'进入当前处理会话'}</button></>}</span>)}</>
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
