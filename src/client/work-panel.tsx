import { useEffect, useState, useSyncExternalStore } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { DetailTab, LocalView, WorkPanelController } from './work-panel-controller.ts'
import type { AssociatedWork, BreakdownBlock, HostResource, SessionCandidate, WorkExecution, WorkTask } from '../work-types.ts'
import { browserUUID } from './browser-uuid.ts'
import { message } from './work-panel-controller.ts'
import styles from './work-panel.module.css'

type FormKind = 'project' | 'attach' | 'task' | 'child' | 'spec' | 'breakdown' | null
const detailTabs: [DetailTab,string][] = [['overview','概览'],['sessions','会话'],['related','相关工作'],['activity','活动']]
const views: [LocalView,string][] = [['all','全部本地工作'],['unassociated','尚未关联会话'],['associated','已关联会话']]

export function WorkPanel({ controller }: { controller: WorkPanelController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [form, setForm] = useState<FormKind>(null)
  const object = state.object
  const [notice,setNotice] = useState('')
  const [surface,setSurface] = useState<HTMLElement|null>(null)
  useEffect(() => { void controller.initialize(); return () => controller.leavePanel() }, [controller])
  useEffect(() => {
    if(form||!surface||typeof document==='undefined') return
    const allowed=()=>document.visibilityState==='visible'&&surface.isConnected
      && !surface.querySelector('details[open] form')
      && !(surface.contains(document.activeElement)&&document.activeElement?.closest('form'))
    const timer=setInterval(()=>{void controller.observeCurrent(allowed)},5000)
    return ()=>{clearInterval(timer);controller.stopObservation()}
  },[controller,form,surface])
  useEffect(() => { setForm(null); setNotice('') }, [state.projectId])
  const project = state.projects.find(project => project.id === state.projectId)
  const task = state.detail?.task
  const done = async (text: string) => { setForm(null); setNotice(text); if (task) await controller.refreshTask(); else if (state.projectId) await controller.selectProject(state.projectId) }
  return <main ref={setSurface} className={styles.panel} aria-label="A²D² 控制面板">
    <header className={styles.header}><div><h1>A²D² 控制面板</h1><p>项目、工作与关联会话</p></div><button onClick={() => controller.close()}>关闭面板</button></header>
    {state.error && <p className={styles.failure} role="alert">{state.error} <button onClick={() => void controller.load()}>重新读取</button></p>}
    {state.observationError && <p role="status">状态更新暂不可用，保留上次内容：{state.observationError}</p>}
    {state.startup.error && <ErrorText error={state.startup.error}/>}
    {state.startup.busy && <p role="status">正在准备执行，请稍候…</p>}
    {notice && <p role="status">{notice}</p>}
    <div className={styles.toolbar}>
      {state.projects.length > 0 && <label>当前项目 <select aria-label="当前项目" value={state.projectId ?? ''} onChange={event => { void controller.selectProject(event.target.value) }}>
        {state.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>}
      <button onClick={() => setForm('project')}>接入 / 创建项目</button>
      {project && <button onClick={() => setForm('attach')}>接入已有资源</button>}
    </div>
    {state.loading && <p role="status">正在读取工作…</p>}
    {state.projects.length === 0 && !state.loading && !state.error && <section><h2>建立第一个项目</h2><p>接入已有资源或创建本地项目，保存工作目标、规格和验收。无需 GitHub、仓库或在线会话。</p><button onClick={() => setForm('project')}>创建本地项目</button></section>}
    {task ? <>
      <header className={styles.header}><div><button onClick={() => {controller.back(); setForm(null)}}>← 返回项目内容</button><h1>{task.title}</h1><p>{project?.name} · 本地工作</p></div><div className={styles.toolbar}><button onClick={()=>void controller.refreshTask()}>刷新详情</button><button onClick={() => setForm('spec')}>更新规格</button></div></header>
      <nav className={styles.tabs} role="tablist" aria-label="工作详情标签">{detailTabs.map(([id,label]) => <button key={id} role="tab" aria-selected={state.detailTab===id} onClick={() => {controller.setDetailTab(id);setForm(null)}}>{label}</button>)}</nav>
      <div role="tabpanel" aria-label={detailTabs.find(([id])=>id===state.detailTab)?.[1]}>
        {state.detailTab==='overview' && <>
          <Section title="状态概览"><div className={styles.metrics}><span>本地工作已保存</span><span>{(()=>{const counts=controller.sessionCounts(task);return `${counts.total} 个会话 · 当前 ${counts.current} · 历史 ${counts.historical} · 其他关联 ${counts.associated}`})()}</span><span>规格第 {task.specification.version} 版</span></div></Section>
          <Section title="目标与规格"><h3>目标</h3><p>{task.goal}</p><h3>规格</h3><p>{task.specification.text}</p><h3>验收标准</h3>{task.specification.missing?.includes('acceptance')&&<p role="status">结构化验收标准尚待确认。原文可能包含验收段落，请明确确认；此提示不表示标准已满足。</p>}{task.specification.missing?.includes('body')&&<p role="status">已接受的来源正文为空，规格正文尚待补充。</p>}<ul>{task.specification.acceptance.map((criterion,index)=><li key={index}>{criterion}</li>)}</ul></Section>
          {state.detail?.bindings?.map(binding=><SourceBinding key={binding.nodeId} binding={binding}/>)}
          {state.detail?.progress && <Section title="工作进展"><p>{stageLabel(state.detail.progress.stage)} · {state.detail.progress.summary}</p><CriteriaCount criteria={state.detail.progress.criteria}/>{state.detail.progress.next&&<p>下一步：{state.detail.progress.next}</p>}{state.detail.progress.blockers.map((blocker,index)=><p key={index} className={styles.failure}>阻塞：{blocker}</p>)}</Section>}
          <CurrentExecution controller={controller}/>
        </>}
        {state.detailTab==='sessions' && <><CurrentExecution controller={controller}/><Sessions controller={controller} task={task} onSaved={()=>done('会话已关联')} /></>}
        {state.detailTab==='related' && <>
          {state.detail?.bindings?.map(binding=><NativeIssueRelations key={binding.nodeId} issue={binding.lastObserved}/>)}
          <Section title="工作拆解"><button onClick={()=>setForm('breakdown')}>更新拆解</button>{task.breakdown.length ? task.breakdown.map(block=><article key={block.id}><h3>{block.title} · {stageLabel(block.status??'planned')}</h3><p>{block.description}</p>{block.evidence?.map((evidence,index)=><p key={index}>证据：{evidence}</p>)}</article>) : <p>尚无工作拆解。</p>}</Section>
          <Section title="相关工作"><div className={styles.toolbar}><button onClick={()=>setForm('child')}>创建子工作</button></div>{state.detail?.parent && <p>父工作：<TaskLink controller={controller} task={state.detail.parent}/></p>}{state.detail?.children?.map(child=><p key={child.id}><TaskLink controller={controller} task={child}/></p>)}{!task.children.length && <p>尚无子工作。子工作可独立保存目标、规格和验收。</p>}</Section>
        </>}
        {state.detailTab==='activity' && <Section title="活动记录">{task.activity.length ? <div className={styles.tableScroll}><table><thead><tr><th>工作版本</th><th>操作</th></tr></thead><tbody>{[...task.activity].reverse().map(item=><tr key={item.commandId}><td>{item.version}</td><td>{activityLabel(item.type)}</td></tr>)}</tbody></table></div>:<p>尚无活动记录。</p>}</Section>}
      </div>
    </> : state.projectId && <>
      <nav className={styles.tabs} role="tablist" aria-label="工作对象">{([['issues','Issue'],['prs','PR'],['projects','项目']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={object===id} onClick={()=>{setForm(null);if(id==='issues') void controller.showSources();else controller.setObject(id)}}>{label}</button>)}</nav>
      {object==='issues' ? <IssueSourcePanel key={state.projectId} controller={controller}/> : object==='prs' ? <Section title="PR 来源"><p>PR 来源尚未接入。</p><button onClick={()=>controller.setObject('projects')}>查看项目内容</button></Section> : <Section title={`${project?.name ?? '项目'} · 本地工作`}>
        <nav className={styles.tabs} role="tablist" aria-label="本地项目视图">{views.map(([id,label])=><button key={id} role="tab" aria-selected={state.view===id} onClick={()=>controller.setView(id)}>{label}</button>)}</nav>
        <div className={styles.toolbar}><input aria-label="搜索项目内容" placeholder="搜索标题、目标或规格" value={state.search} onChange={event=>controller.setSearch(event.target.value)} /><button onClick={()=>setForm('task')}>添加工作</button><button onClick={()=>void controller.selectProject(state.projectId!)}>刷新</button></div>
        {project && <ContinuationSettings key={`project/${project.id}/${project.continuationPolicy?.version??0}`} controller={controller} policy={project.continuationPolicy}/>}
        <p>{controller.visibleTasks().length} 项工作 · 当前项目</p>
        <div className={styles.tableScroll}><table aria-label="当前项目内容"><thead><tr><th>工作</th><th>工作状态与进展</th><th>会话</th><th>验收</th><th>GitHub 来源</th></tr></thead><tbody>{controller.visibleTaskRows().map(({task:item,depth})=>{const progress=state.progressItems.find(value=>value.ref.projectId===item.projectId&&value.ref.taskId===item.id);return <tr key={item.id}><td style={{paddingInlineStart:12+depth*20}}>{depth>0&&<span aria-label="子工作">↳ </span>}<TaskLink controller={controller} task={item}/></td><td>{progress?<><strong>{stageLabel(progress.stage)}</strong><p>{progress.summary}</p>{progress.next&&<p>下一步：{progress.next}</p>}{progress.blockers.map((blocker,index)=><p key={index} className={styles.failure}>阻塞：{blocker}</p>)}</>:<p>{item.goal}</p>}</td><td>{progress?.execution?<><p>{executionLabel(progress.execution.state,progress)} · {({running:'正在运行',idle:'空闲',inactive:'未激活'})[progress.execution.runtime]}</p><button onClick={()=>void controller.openTask(progress.ref)}>查看当前执行</button></>:<span>{item.sessions.length} 个关联会话</span>}</td><td>{progress?<CriteriaCount criteria={progress.criteria}/>:<>规格第 {item.specification.version} 版 · 尚未报告验收</>}</td><td>{progress?.source?<><span>#{progress.source.number} · 远端 {progress.source.state}</span><GitHubLink url={progress.source.url}/></>:<span>本地工作</span>}</td></tr>})}</tbody></table></div>
        {!state.loading && !state.error && !controller.visibleTasks().length && <p>{state.tasks.length ? '没有匹配当前视图和搜索的工作。' : '尚无本地工作，点击“添加工作”保存目标、规格和验收。'}</p>}
      </Section>}
    </>}
    {form && <section className={styles.formSection} aria-label="工作编辑"><div className={styles.header}><h2>{({project:'接入 / 创建项目',attach:'接入已有资源',task:'添加本地工作',child:'创建子工作',spec:'更新规格',breakdown:'更新工作拆解'})[form]}</h2><button onClick={()=>setForm(null)}>取消编辑</button></div>
      {form==='project' || form==='attach' ? <ProjectForm key={`${form}/${state.projectId}`} controller={controller} attach={form==='attach'} onSaved={async projectId=>{setForm(null); await controller.load(); await controller.selectProject(projectId);setNotice('项目已保存')}}/> : form==='breakdown' && task ? <BreakdownForm key={task.version} controller={controller} task={task} onSaved={()=>done('拆解已保存')}/> : <TaskForm key={`${form}/${task?.id ?? ''}/${task?.version ?? ''}`} controller={controller} kind={form as 'task'|'child'|'spec'} task={task} onSaved={async saved=>{setForm(null);setNotice('工作已保存');await controller.openTask({projectId:saved.projectId,taskId:saved.id})}}/>}
    </section>}
  </main>
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
      <p>执行状态：{executionLabel(execution.state,progress,execution.control?.status)}{executionRuntime ? ` · 会话：${({running:'正在运行',idle:'空闲',inactive:'未激活'})[executionRuntime]}` : ''}</p>
      {execution.progress && <p>工作进展：{execution.progress}</p>}
      {execution.control && !completed && <p>{({wait:'等待',pause:'暂停',resume:'恢复'})[execution.control.action]}请求{execution.control.status==='accepted'?'已接受，等待生效':'已生效'}{execution.control.reason?`：${execution.control.reason}`:''}</p>}
      {execution.error && <ErrorText error={`${execution.error.code}: ${execution.error.message}`}/>}
      <div className={styles.toolbar}>
        {controller.currentSession() && <button disabled={busy} onClick={()=>controller.openCurrentSession()}>进入当前会话</button>}
        {!completed && ['ready','running'].includes(execution.state) && <button disabled={busy||execution.control?.status==='accepted'} onClick={()=>void controller.controlExecution('pause')}>暂停处理</button>}
        {!completed && ['waiting','paused'].includes(execution.state) && <button disabled={busy||execution.control?.status==='accepted'} onClick={()=>void controller.controlExecution('resume')}>恢复处理</button>}
        {execution.state==='failed' && <button disabled={busy} onClick={()=>void controller.controlExecution('reconcile')}>重试原执行</button>}
        <button disabled={busy} onClick={()=>void controller.refreshTask()}>刷新执行状态</button>
      </div>
      {!controller.currentSession() && <p>当前会话暂不可进入；刷新可查看创建或恢复结果。</p>}
      <ContinuationSettings key={`execution/${execution.id}/${execution.continuationPolicy?.version??0}`} controller={controller} policy={execution.continuationPolicy} forExecution/>
      {execution.continuationObservation && <p>上下文读数：{execution.continuationObservation.totalTokens.toLocaleString()} token · {({usage:'用量计量',estimated:'估算',none:'无基线'})[execution.continuationObservation.baseline]} · 模型窗口 {execution.continuationObservation.capacity.toLocaleString()} token · 观察时间 {execution.continuationObservation.observedAt}</p>}
      {execution.continuationBlocked && <ErrorText error={`接续等待：${execution.continuationBlocked.code} · ${execution.continuationBlocked.message}`}/>}
      {execution.continuation && <p>接续状态：{({reserved:'已预约', 'material-requested':'正在保存上下文', 'material-saved':'材料已保存', 'successor-created':'后继已创建', taken:'后继已接任', delivered:'接续内容已投递'})[execution.continuation.phase]}{execution.continuation.error?` · ${execution.continuation.error.message}`:''}</p>}
      {!completed && <button disabled={busy||['accepted','creating','failed'].includes(execution.state)||Boolean(execution.continuation&&execution.continuation.phase!=='delivered')} onClick={()=>void controller.controlExecution('continue')}>接续到新会话</button>}
      {Boolean(execution.retired?.length) && <details><summary>历史会话（{execution.retired!.length}）</summary>{execution.retired!.map(item=><p key={item.session.sessionId}>第 {item.epoch} 段 · {item.session.sessionId} · 已退出当前协调 <button onClick={()=>void controller.openHistory(item.session)}>查看记录</button></p>)}</details>}
      <HistoryTranscript controller={controller}/>
      {execution.actual && <details><summary>实际执行环境</summary><p>工作目录：{execution.actual.cwd}<br/>模型：{execution.actual.provider}/{execution.actual.model}<br/>Agent 预设：{execution.actual.agentPreset}<br/>权限：{execution.actual.permissionPreset} · 沙箱：{execution.actual.sandbox} · 审批：{execution.actual.approval}</p></details>}
      {execution.events.length>0 && <details><summary>输入与结果（{execution.events.length}）</summary>{execution.events.map(event=><p key={event.id}>{({accepted:'已接受',delivered:'已投递',consumed:'已消费'})[event.delivery]} · 尚未验收<br/>{event.text}</p>)}</details>}
    </> : <>
      <p>尚未开始处理。可先关联已有会话查看相关工作。</p>
      {options && selection ? <form className={styles.form} onSubmit={event=>{event.preventDefault();void controller.startPrepared()}}>
        <p>已选用宿主默认配置。请确认工作目录和模型后开始处理。</p>
        <label>工作目录{options.resources.length>1 ? <select disabled={busy} value={selection.resourceIndex} onChange={event=>controller.selectStart({resourceIndex:Number(event.target.value)})}>{options.resources.map((resource,index)=><option key={`${resource.ref.runtimeId}/${resource.ref.workspaceId}`} value={index}>{resource.title}</option>)}</select> : <span>{options.resources[0]?.title}</span>}</label>
        <label>模型{options.models.length>1 ? <select disabled={busy} value={selection.modelIndex} onChange={event=>controller.selectStart({modelIndex:Number(event.target.value)})}>{options.models.map((model,index)=><option key={`${model.provider}/${model.model}`} value={index}>{model.provider}/{model.model}</option>)}</select> : <span>{options.models[0]?.provider}/{options.models[0]?.model}</span>}</label>
        <label>Agent 预设{options.agentPresets.length>1 ? <select disabled={busy} value={selection.agentPreset} onChange={event=>controller.selectStart({agentPreset:event.target.value})}>{options.agentPresets.map(preset=><option key={preset}>{preset}</option>)}</select> : <span>{selection.agentPreset}</span>}</label>
        <label>权限{options.permissionPresets.length>1 ? <select disabled={busy} value={selection.permissionPreset} onChange={event=>controller.selectStart({permissionPreset:event.target.value})}>{options.permissionPresets.map(preset=><option key={preset}>{preset}</option>)}</select> : <span>{selection.permissionPreset}</span>}</label>
        <div className={styles.toolbar}><button type="submit" disabled={busy}>{busy?'正在启动…':'确认开始处理'}</button><button type="button" disabled={busy} onClick={()=>controller.cancelStart()}>取消</button></div>
      </form> : <button disabled={busy||state.loading} onClick={()=>void controller.prepareStart()}>开始处理</button>}
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
  return <details><summary>{forExecution?'当前执行的上下文接续':'项目默认上下文接续'} · {policy?.enabled?`${policy.targetTokens.toLocaleString()} token`:'自动接续未启用'}</summary>
    <form className={styles.form} onSubmit={event=>void save(event)}>
      <label>自动接续<select disabled={busy} value={enabled?'on':'off'} onChange={event=>setEnabled(event.target.value==='on')}><option value="off">关闭</option><option value="on">启用</option></select></label>
      <div className={styles.toolbar}><button type="button" disabled={busy} onClick={()=>setTarget('200000')}>200K</button><button type="button" disabled={busy} onClick={()=>setTarget('300000')}>300K</button></div>
      <label>提前接续目标（token）<input disabled={busy} type="number" min="1" step="1" required value={target} onChange={event=>setTarget(event.target.value)}/></label>
      <label>接续预留（token）<input disabled={busy} type="number" min="1024" step="1" required value={reserve} onChange={event=>setReserve(event.target.value)}/></label>
      <p>这是安全边界上的提前接续目标。宿主会按实际模型窗口和输出预留检查；长轮次可能超过目标。{forExecution?'保存后适用于当前执行。':'项目默认只用于新执行，当前执行可单独设置。'}</p>
      <ErrorText error={error}/>{saved&&<p role="status">接续策略已保存</p>}<button type="submit" disabled={busy}>{busy?'正在保存…':'保存接续策略'}</button>
    </form>
  </details>
}
function IssueSourcePanel({controller}:{controller:WorkPanelController}) {
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot)
  const sourceState=state.source
  const {listing,issue,loading,error,cached,canonical}=sourceState
  const source=sourceState.sources.find(item=>item.id===sourceState.sourceId)
  const identity=source?.identity ?? listing?.identity
  const [sourceKind,setSourceKind]=useState<'repository'|'project'>('repository'),[projectOwnerType,setProjectOwnerType]=useState<'org'|'user'>('org'),[projectNumber,setProjectNumber]=useState('')
  const [owner,setOwner]=useState(''),[repository,setRepository]=useState(''),[number,setNumber]=useState(''),[existing,setExisting]=useState(''),[formError,setFormError]=useState(''),[saving,setSaving]=useState(false)
  async function configure(event:FormEvent) {
    event.preventDefault();setSaving(true);setFormError('')
    try {if(sourceKind==='project') await controller.configureProjectSource(owner,projectOwnerType,Number(projectNumber));else await controller.configureSource(owner,repository)}catch(error){setFormError(message(error))}finally{setSaving(false)}
  }
  return <Section title="GitHub Issue 来源">
    <p>从 GitHub 仓库或 Project 读取 Issue，保存到当前本地项目。远端来源与本地执行状态分别显示。</p>
    <details open={!sourceState.sources.length}><summary>配置工作来源</summary><form className={styles.form} onSubmit={event=>void configure(event)}>
      <label>来源类型<select value={sourceKind} onChange={event=>setSourceKind(event.target.value as 'repository'|'project')}><option value="repository">GitHub 仓库</option><option value="project">GitHub Project</option></select></label>
      <label>GitHub owner<input required value={owner} onChange={event=>setOwner(event.target.value)} placeholder="组织或用户"/></label>
      {sourceKind==='repository'?<label>GitHub repository<input required value={repository} onChange={event=>setRepository(event.target.value)} placeholder="仓库名称"/></label>:<><label>所属账号类型<select value={projectOwnerType} onChange={event=>setProjectOwnerType(event.target.value as 'org'|'user')}><option value="org">组织</option><option value="user">个人</option></select></label><label>Project 编号<input type="number" min="1" step="1" required value={projectNumber} onChange={event=>setProjectNumber(event.target.value)}/></label></>}
      <p>使用此服务已连接的 GitHub 账号读取仓库。</p><ErrorText error={formError}/><button disabled={saving} type="submit">{saving?'正在配置…':'保存并读取来源'}</button>
    </form></details>
    {sourceState.sources.length>0 && <div className={styles.toolbar}><label>仓库来源 <select aria-label="仓库来源" value={sourceState.sourceId??''} onChange={event=>void controller.selectSource(event.target.value)}>{sourceState.sources.map(item=><option key={item.id} value={item.id}>{item.repository?`${item.repository.owner}/${item.repository.repository}`:item.githubProject?`${item.githubProject.owner} / Project #${item.githubProject.number}`:'GitHub 来源'}{item.enabled?'':' · 已停用'}</option>)}</select></label><button disabled={loading} onClick={()=>void controller.showSources()}>重新读取来源配置</button><button disabled={loading||!source} onClick={()=>void controller.setSourceEnabled(!source?.enabled)}>{source?.enabled?'停用来源':'启用来源'}</button></div>}
    {loading && <p role="status">正在读取来源…</p>}
    <ErrorText error={error??''}/>
    {source && <>
      <p>来源状态：{source.enabled?'已启用':'已停用（保留缓存与已接受本地工作）'} · 最近确认的凭据身份：{identity?`${identity.login}${identity.name?` / ${identity.name}`:''}`:'尚未取得；刷新后由实际凭据确认'}。我的 Issue 使用此身份。</p>
      {source.projectSnapshot && <details><summary>GitHub Project · {source.projectSnapshot.project.title}</summary><p>远端 Project {source.projectSnapshot.project.closed?'已关闭':'开放'} · 观察时间：{source.projectSnapshot.observedAt}</p>{source.discovery&&<p>来源同步：{({idle:'空闲',syncing:'同步中',error:'读取失败'})[source.discovery.state]}{source.discovery.lastSuccessAt?` · 最近成功：${source.discovery.lastSuccessAt}`:''}</p>}<div className={styles.tableScroll}><table aria-label="GitHub Project 条目"><thead><tr><th>条目</th><th>远端字段</th></tr></thead><tbody>{source.projectSnapshot.items.map(item=><tr key={item.id}><td>{item.title??({issue:'Issue','pull-request':'PR',draft:'草稿',restricted:'无权读取'})[item.kind]}{item.archived?' · 已归档':''}</td><td>{item.fields.map(field=><p key={field.id}>{field.name}：{field.value}</p>)}{item.fieldsPartial&&<p>字段尚未完整读取</p>}</td></tr>)}</tbody></table></div><p>远端字段只作来源观察；本地工作进展和验收另行记录。</p></details>}
      {source.lastError?.retryAt && <p>可重试时间：{source.lastError.retryAt}</p>}
      {canonical && <p>该 Issue 已有本地工作。<button onClick={()=>void controller.openTask(canonical)}>打开已关联工作</button></p>}
      {issue ? <>
        <div className={styles.toolbar}><button onClick={()=>controller.backToIssues()}>← 返回 Issue 列表</button><button disabled={loading||!source.enabled} onClick={()=>void controller.openIssue(issue.number,true,issue.nodeId)}>刷新 Issue 详情</button><button disabled={loading} onClick={()=>void controller.openIssue(issue.number,false,issue.nodeId)}>读取缓存详情</button></div>
        <h2>#{issue.number} {issue.title}</h2><GitHubLink url={issue.url}/>
        <button disabled={loading||state.startup.busy||(!source.enabled&&!sourceState.bindings.length&&!canonical)} onClick={()=>void controller.prepareStart(true)}>{state.startup.busy?'正在准备执行…':'开始处理'}</button>
        <p>开始处理会保存或复用这项工作，在所选目录创建真实会话；已有执行会回到当前处理会话。</p>
        <IssueFacts issue={issue}/><NativeIssueRelations issue={issue}/><p>{cached?'缓存 / 最后已知内容':'本次读取内容'} · 观察时间：{issue.observedAt}</p>
        <h3>完整原文</h3><p className={styles.sourceBody}>{issue.body || '（原文正文为空）'}</p>
        {sourceState.bindings.length>0 ? sourceState.bindings.map(binding=><p key={`${binding.ref.projectId}/${binding.ref.taskId}`}>已关联本地工作 <button onClick={()=>void controller.openTask(binding.ref)}>打开已关联工作</button></p>) : <>
          <button disabled={loading||!source.enabled} onClick={()=>void controller.acceptIssue()}>接入为本地工作</button>
          <form className={styles.toolbar} onSubmit={event=>{event.preventDefault();const task=state.tasks.find(item=>item.id===existing);if(task)void controller.acceptIssue(task)}}><label>关联已有本地工作 <select required value={existing} onChange={event=>setExisting(event.target.value)}><option value="">选择当前项目的工作</option>{state.tasks.map(task=><option key={task.id} value={task.id}>{task.title}</option>)}</select></label><button type="submit" disabled={loading||!source.enabled||!existing}>关联已有本地工作</button></form>
        </>}
      </> : <>
        <div className={styles.toolbar}>
          <label>负责人 <select aria-label="Issue 负责人" value={sourceState.assignee} onChange={event=>void controller.browseIssues({assignee:event.target.value as '@me'|'*',page:1},true)} disabled={loading||!source.enabled}><option value="@me">我的 Issue</option><option value="*">全部 Issue</option></select></label>
          <label>远端状态 <select aria-label="Issue 远端状态" value={sourceState.state} onChange={event=>void controller.browseIssues({state:event.target.value as 'open'|'closed'|'all',page:1},true)} disabled={loading||!source.enabled}><option value="open">Open</option><option value="closed">Closed</option><option value="all">全部状态</option></select></label>
          <button disabled={loading||!source.enabled} onClick={()=>void controller.browseIssues({},true)}>刷新 Issue 列表</button><button disabled={loading} onClick={()=>void controller.browseIssues({},false)}>读取缓存列表</button>
        </div>
        <form className={styles.toolbar} onSubmit={event=>{event.preventDefault();void controller.openIssue(Number(number),source.enabled)}}><label>按 Issue 编号打开完整详情 <input type="number" min="1" step="1" required value={number} onChange={event=>setNumber(event.target.value)}/></label><button type="submit" disabled={loading}>打开 Issue</button></form>
        {listing ? <>
          <p>{cached?'缓存 / 最后已知列表':'本次读取列表'} · 第 {sourceState.page} 页 · 观察时间：{listing.observedAt}</p>
          <div className={styles.tableScroll}><table aria-label="GitHub Issue 列表"><thead><tr><th>Issue</th><th>远端状态</th><th>工作进展</th><th>当前处理</th><th>负责人</th><th>标签</th></tr></thead><tbody>{listing.items.map(item=>{const progress=controller.progressForIssue(item);return <tr key={item.nodeId}><td><button className={styles.link} onClick={()=>void controller.openIssue(item.number,source.enabled,item.nodeId)}>{source.githubProject?`${item.repository.owner}/${item.repository.repository} `:''}#{item.number} {item.title}</button></td><td>{item.state}</td><td>{progress?<><strong>{stageLabel(progress.stage)}</strong><p>{progress.summary}</p>{progress.blockers[0]&&<p className={styles.failure}>阻塞：{progress.blockers[0]}</p>}</>:<span>未开始</span>}</td><td>{progress?<>{progress.execution&&<p>{executionLabel(progress.execution.state,progress)} · {({running:'正在运行',idle:'空闲',inactive:'未激活'})[progress.execution.runtime]}{progress.execution.reason?` · ${progress.execution.reason}`:''}</p>}<button onClick={()=>void controller.openTask(progress.ref)}>查看处理</button></>:<span>尚未接入本地工作</span>}</td><td>{item.assignees.join(', ')||'无'}</td><td>{item.labels.join(', ')||'无'}</td></tr>})}</tbody></table></div>
          {!listing.items.length&&!error&&<p>{listing.nextPage?'本页无 Issue；仍有下一页（GitHub 原始分页可能包含 PR）。':'当前页没有匹配的 Issue。'}</p>}
          <div className={styles.toolbar}><button disabled={loading||sourceState.page<=1} onClick={()=>void controller.browseIssues({page:sourceState.page-1},source.enabled)}>上一页</button><span>第 {sourceState.page} 页</span><button disabled={loading||!listing.nextPage} onClick={()=>void controller.browseIssues({page:listing.nextPage!},source.enabled)}>下一页</button></div>
        </> : !loading&&<p>当前筛选页尚无可读缓存。请显式刷新；权限失败或离线不会被视为空列表。</p>}
      </>}
    </>}
    {!source&&!loading&&!error&&<p>尚未配置仓库来源。已保存的本地工作仍可在项目标签查看。</p>}
  </Section>
}
function SourceBinding({binding}:{binding:import('../work-sources/types.ts').ExternalBinding}) {
  const accepted=binding.accepted,latest=binding.lastObserved
  const fields=[['title','标题'],['body','正文'],['assignees','负责人'],['labels','标签'],['state','远端状态']] as const
  const differences=fields.filter(([key])=>JSON.stringify(accepted[key])!==JSON.stringify(latest[key])).map(([,label])=>label)
  return <Section title={`GitHub 来源 · #${accepted.number}`}>
    <GitHubLink url={latest.url}/><p>来源观察不代表本地完成或协调权。已接受内容与本地规格保留，远端变更不会自动覆盖。</p>
    <p>{differences.length?`相对已接受来源发生变化：${differences.join('、')}`:'最新观察与已接受来源内容一致。'} · 最新观察时间：{latest.observedAt}</p>
    <details><summary>已接受来源</summary><h3>{accepted.title}</h3><IssueFacts issue={accepted}/><p className={styles.sourceBody}>{accepted.body||'（已接受正文为空）'}</p></details>
    <details><summary>最新观察</summary><h3>{latest.title}</h3><IssueFacts issue={latest}/><p className={styles.sourceBody}>{latest.body||'（观察正文为空）'}</p></details>
  </Section>
}
function GitHubLink({url}:{url:string}) {
  let safe=false
  try {const parsed=new URL(url);safe=parsed.protocol==='https:'&&parsed.hostname==='github.com'&&!parsed.username&&!parsed.password&&!parsed.port&&/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*\/?$/.test(parsed.pathname)&&!parsed.search&&!parsed.hash}catch{}
  return safe?<a href={url} target="_blank" rel="noopener noreferrer">在 GitHub 查看来源</a>:<span>来源 URL 无法安全打开</span>
}
function NativeIssueRelations({issue}:{issue:import('../work-sources/types.ts').GitHubIssue}) {
  const {parent,subIssues}=issue
  if(!parent&&!subIssues?.items.length&&!subIssues?.totalCount)return null
  const reference=(item:import('../work-sources/types.ts').GitHubIssueReference)=><><span>{item.repository.owner}/{item.repository.repository} #{item.number} · {item.title} · 远端 {item.state}</span> <GitHubLink url={item.url}/></>
  return <Section title="原生 Issue 父子关系">
    <p>以下是 GitHub 来源关系；本地任务与验收状态分别记录，查看链接不会自动接入工作。</p>
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

function ProjectForm({controller,attach,onSaved}:{controller:WorkPanelController;attach:boolean;onSaved:(projectId:string)=>Promise<void>}) {
  const [resources,setResources]=useState<HostResource[]>([]),[resource,setResource]=useState(''),[name,setName]=useState('')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true)
  useEffect(()=>{const abort=new AbortController();void controller.client.query({type:'resources.list'},abort.signal).then(result=>{setResources(result.resources??[]);setLoading(false)},error=>{if(!abort.signal.aborted){setError(message(error));setLoading(false)}});return()=>abort.abort()},[controller])
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('')
    try {
      const selected=resources.find((_,index)=>String(index)===resource)?.ref
      const state=controller.getSnapshot(),project=state.projects.find(item=>item.id===state.projectId)
      if(attach && (!selected || !project)) throw Error('请选择可访问的资源')
      const result=await controller.submit(attach ? {type:'project.attach-resource',projectId:project!.id,expectedVersion:project!.version,resource:selected!} : {type:'project.create',name:name.trim(),...(selected?{resource:selected}:{})})
      if(!result.project) throw Error('工作服务未返回保存的项目')
      await onSaved(result.project.id)
    } catch(error){setError(message(error))} finally{setBusy(false)}
  }
  return <form onSubmit={event=>void submit(event)} className={styles.form}>
    {!attach && <label>项目名称<input required value={name} onChange={event=>setName(event.target.value)}/></label>}
    <label>{attach?'已有宿主资源':'已有宿主资源（可选）'}<select required={attach} value={resource} onChange={event=>setResource(event.target.value)}><option value="">{loading?'正在读取资源…':attach?'选择资源':'独立本地项目'}</option>{resources.map((item,index)=><option key={`${item.ref.runtimeId}/${item.ref.workspaceId}`} value={index} disabled={Boolean(item.owner)}>{item.title}{item.owner ? ` · 已归属：${item.owner.projectName}（不可选）` : ''}</option>)}</select></label>
    <p>已归属项目的资源不可选。{attach ? '项目无需绑定目录，也可继续保存本地工作。' : '可选择“独立本地项目”，不绑定目录也能保存项目与工作。'}</p>
    <p>项目默认负责策略由后端建立。选择资源不会启动或重配会话。</p><ErrorText error={error}/><button disabled={busy || loading} type="submit">{busy?'正在保存…':'保存项目'}</button>
  </form>
}
function TaskForm({controller,kind,task,onSaved}:{controller:WorkPanelController;kind:'task'|'child'|'spec';task?:WorkTask;onSaved:(task:WorkTask)=>Promise<void>}) {
  const existing=kind==='spec'?task:undefined
  const [title,setTitle]=useState(''),[goal,setGoal]=useState(existing?.goal??''),[spec,setSpec]=useState(existing?.specification.text??''),[acceptance,setAcceptance]=useState<string[]>(existing?.specification.acceptance??[''])
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('')
    try {
      const content={goal,specification:spec,acceptance}
      const projectId=controller.getSnapshot().projectId
      if(!projectId) throw Error('请先选择项目')
      if(!content.goal.trim() || !content.specification.trim() || !content.acceptance.length || content.acceptance.some(text=>!text.trim())) throw Error('请填写目标、规格和至少一条验收标准')
      const change=task?{ref:{projectId:task.projectId,taskId:task.id},expectedVersion:task.version}:null
      const result=await controller.submit(kind==='spec' && change ? {type:'task.update-spec',...change,...content} : kind==='child' && change ? {type:'task.create-child',...change,...content,title:title.trim()} : {type:'task.create',projectId,...content,title:title.trim()})
      if(!result.task) throw Error('工作服务未返回保存的工作')
      if(controller.getSnapshot().projectId !== projectId) return
      await onSaved(result.task)
    }catch(error){setError(message(error))}finally{setBusy(false)}
  }
  return <form onSubmit={event=>void submit(event)} className={styles.form}>
    {kind!=='spec' && <label>工作标题<input required value={title} onChange={event=>setTitle(event.target.value)}/></label>}
    <label>目标<textarea required value={goal} onChange={event=>setGoal(event.target.value)}/></label>
    <label>规格<textarea required value={spec} onChange={event=>setSpec(event.target.value)}/></label>
    <fieldset><legend>验收标准</legend>{acceptance.map((text,index)=><div key={index}><label>验收标准 {index+1}<textarea required value={text} onChange={event=>setAcceptance(acceptance.map((item,itemIndex)=>itemIndex===index?event.target.value:item))}/></label><button type="button" onClick={()=>setAcceptance(acceptance.filter((_,itemIndex)=>itemIndex!==index))}>移除验收标准 {index+1}</button></div>)}<button type="button" onClick={()=>setAcceptance([...acceptance,''])}>添加验收标准</button></fieldset>
    <ErrorText error={error}/><button type="submit" disabled={busy}>{busy?'正在保存…':'保存工作'}</button>
  </form>
}
function BreakdownForm({controller,task,onSaved}:{controller:WorkPanelController;task:WorkTask;onSaved:()=>Promise<void>}) {
  const [blocks,setBlocks]=useState<BreakdownBlock[]>(task.breakdown),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('')
    try {await controller.submit({type:'task.replace-breakdown',ref:{projectId:task.projectId,taskId:task.id},expectedVersion:task.version,blocks});await onSaved()}catch(error){setError(message(error))}finally{setBusy(false)}
  }
  return <form onSubmit={event=>void submit(event)} className={styles.form}>{blocks.map((block,index)=><fieldset key={block.id}><legend>工作块 {index+1}</legend><label>标题<input required value={block.title} onChange={event=>setBlocks(blocks.map(item=>item.id===block.id?{...item,title:event.target.value}:item))}/></label><label>说明<textarea required value={block.description} onChange={event=>setBlocks(blocks.map(item=>item.id===block.id?{...item,description:event.target.value}:item))}/></label><button type="button" onClick={()=>setBlocks(blocks.filter(item=>item.id!==block.id))}>移除工作块 {index+1}</button></fieldset>)}<div className={styles.toolbar}><button type="button" onClick={()=>setBlocks([...blocks,{id:browserUUID(),title:'',description:''}])}>添加工作块</button><button type="submit" disabled={busy}>{busy?'正在保存…':'保存拆解'}</button></div><ErrorText error={error}/></form>
}
function Sessions({controller,task,onSaved}:{controller:WorkPanelController;task:WorkTask;onSaved:()=>Promise<void>}) {
  const [candidates,setCandidates]=useState<SessionCandidate[]>([]),[selected,setSelected]=useState(''),[purpose,setPurpose]=useState<'related'|'review'>('related'),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
  useEffect(()=>{const abort=new AbortController();void controller.client.query({type:'session.candidates',projectId:task.projectId},abort.signal).then(result=>{setCandidates(result.candidates??[]);setLoading(false)},error=>{if(!abort.signal.aborted){setError(message(error));setLoading(false)}});return()=>abort.abort()},[controller,task.projectId,task.version])
  async function associate(event:FormEvent) {
    event.preventDefault();const candidate=candidates.find((_,index)=>String(index)===selected);if(!candidate)return
    setBusy(true);setError('')
    try{await controller.submit({type:'task.associate-session',ref:{projectId:task.projectId,taskId:task.id},expectedVersion:task.version,session:candidate.ref,purpose});await onSaved()}catch(error){setError(message(error))}finally{setBusy(false)}
  }
  return <><Section title="关联会话"><p>这些关联用于观察工作；未授予当前协调权。</p>{task.sessions.length ? <div className={styles.tableScroll}><table><thead><tr><th>会话</th><th>用途</th><th>导航</th></tr></thead><tbody>{task.sessions.map(association=>{const candidate=candidates.find(item=>item.ref.runtimeId===association.session.runtimeId&&item.ref.sessionId===association.session.sessionId);return <tr key={`${association.session.runtimeId}/${association.session.sessionId}`}><td>{candidate?.title || '已关联的原生会话'}</td><td>{association.purpose==='review'?'评审':'关联工作'}</td><td><button onClick={()=>controller.openSession(association.session)}>打开会话</button></td></tr>})}</tbody></table></div>:<p>尚无关联会话。</p>}</Section>
    <Section title="关联已有会话"><form onSubmit={event=>void associate(event)} className={styles.form}><label>兼容的已有会话<select required value={selected} onChange={event=>setSelected(event.target.value)}><option value="">{loading?'正在读取…':'选择已有会话'}</option>{candidates.map((candidate,index)=><option key={`${candidate.ref.runtimeId}/${candidate.ref.sessionId}`} value={index}>{candidate.title || '未命名会话'}</option>)}</select></label><label>关联用途<select value={purpose} onChange={event=>setPurpose(event.target.value as 'related'|'review')}><option value="related">关联工作</option><option value="review">评审</option></select></label><p>由后端校验项目资源权限。关联不改变目录、模型或权限，不启动会话。</p><ErrorText error={error}/><button type="submit" disabled={busy || loading || !candidates.length}>{busy?'正在关联…':'关联会话'}</button>{!loading&&!candidates.length&&!error&&<p>没有可关联的兼容会话。可先为项目接入已有资源。</p>}</form></Section></>
}

/** Query uses host-authorized runtime references; an unassociated session renders nothing. */
export function SessionWorkEntry({controller, sessionId}: {controller: WorkPanelController; sessionId: string}) {
  const [work, setWork] = useState<AssociatedWork[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    setWork([])
    setError(null)
    async function load() {
      try {
        const resources = await controller.client.query({type:'resources.list'}, abort.signal)
        const runtimes = [...new Set(resources.resources?.map(resource => resource.ref.runtimeId) ?? [])]
        const results = await Promise.all(runtimes.map(runtimeId => controller.client.query({type:'session.work',session:{runtimeId,sessionId}}, abort.signal)))
        if (!abort.signal.aborted) setWork(results.flatMap(result => result.work ?? []))
      } catch (error) { if (!abort.signal.aborted) setError(message(error)) }
    }
    void load()
    return () => abort.abort()
  },[controller,sessionId])
  if (error) return <span title={error}>工作关联读取失败</span>
  if (!work.length) return null
  return <div className={styles.sessionEntry}>{work.map(item => <button key={`${item.ref.projectId}/${item.ref.taskId}`} onClick={() => void controller.revealTask(item.ref)} title="查看工作与进展">{item.projectName} / {item.title} · 工作与进展</button>)}</div>
}
