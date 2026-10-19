import { useEffect, useState, useSyncExternalStore } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { DetailTab, LocalView, WorkPanelController } from './work-panel-controller.ts'
import type { AssociatedWork, BreakdownBlock, HostResource, SessionCandidate, WorkTask } from '../work-types.ts'
import { message } from './work-panel-controller.ts'
import styles from './work-panel.module.css'

type FormKind = 'project' | 'attach' | 'task' | 'child' | 'spec' | 'breakdown' | null
const detailTabs: [DetailTab,string][] = [['overview','概览'],['sessions','会话'],['related','相关工作'],['activity','活动']]
const views: [LocalView,string][] = [['all','全部本地工作'],['unassociated','尚未关联会话'],['associated','已关联会话']]

export function WorkPanel({ controller }: { controller: WorkPanelController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [form, setForm] = useState<FormKind>(null)
  const [object, setObject] = useState<'projects'|'issues'|'prs'>('projects')
  const [notice,setNotice] = useState('')
  useEffect(() => { void controller.load() }, [controller])
  useEffect(() => { setForm(null); setNotice('') }, [state.projectId])
  const project = state.projects.find(project => project.id === state.projectId)
  const task = state.detail?.task
  const done = async (text: string) => { setForm(null); setNotice(text); if (task) await controller.refreshTask(); else if (state.projectId) await controller.selectProject(state.projectId) }
  return <main className={styles.panel} aria-label="A²D² 控制面板">
    <header className={styles.header}><div><h1>A²D² 控制面板</h1><p>项目、工作与关联会话</p></div><button onClick={() => controller.close()}>关闭面板</button></header>
    {state.error && <p className={styles.failure} role="alert">{state.error} <button onClick={() => void controller.load()}>重新读取</button></p>}
    {notice && <p role="status">{notice}</p>}
    <div className={styles.toolbar}>
      {state.projects.length > 0 && <label>当前项目 <select aria-label="当前项目" value={state.projectId ?? ''} onChange={event => { setObject('projects'); void controller.selectProject(event.target.value) }}>
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
          <Section title="状态概览"><div className={styles.metrics}><span>本地工作已保存</span><span>{task.sessions.length} 个关联会话</span><span>规格第 {task.specification.version} 版</span></div></Section>
          <Section title="目标与规格"><h3>目标</h3><p>{task.goal}</p><h3>规格</h3><p>{task.specification.text}</p><h3>验收标准</h3><ul>{task.specification.acceptance.map((criterion,index)=><li key={index}>{criterion}</li>)}</ul></Section>
          <Section title="处理会话"><p>尚无当前处理会话。关联会话用于观察工作，当前票不启动执行。</p><button onClick={()=>controller.setDetailTab('sessions')}>查看关联会话</button></Section>
        </>}
        {state.detailTab==='sessions' && <Sessions controller={controller} task={task} onSaved={()=>done('会话已关联')} />}
        {state.detailTab==='related' && <>
          <Section title="工作拆解"><button onClick={()=>setForm('breakdown')}>更新拆解</button>{task.breakdown.length ? task.breakdown.map(block=><article key={block.id}><h3>{block.title}</h3><p>{block.description}</p></article>) : <p>尚无工作拆解。</p>}</Section>
          <Section title="相关工作"><div className={styles.toolbar}><button onClick={()=>setForm('child')}>创建子工作</button></div>{state.detail?.parent && <p>父工作：<TaskLink controller={controller} task={state.detail.parent}/></p>}{state.detail?.children?.map(child=><p key={child.id}><TaskLink controller={controller} task={child}/></p>)}{!task.children.length && <p>尚无子工作。子工作可独立保存目标、规格和验收。</p>}</Section>
        </>}
        {state.detailTab==='activity' && <Section title="活动记录">{task.activity.length ? <div className={styles.tableScroll}><table><thead><tr><th>工作版本</th><th>操作</th></tr></thead><tbody>{[...task.activity].reverse().map(item=><tr key={item.commandId}><td>{item.version}</td><td>{activityLabel(item.type)}</td></tr>)}</tbody></table></div>:<p>尚无活动记录。</p>}</Section>}
      </div>
    </> : state.projectId && <>
      <nav className={styles.tabs} role="tablist" aria-label="工作对象">{([['issues','Issue'],['prs','PR'],['projects','项目']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={object===id} onClick={()=>setObject(id)}>{label}</button>)}</nav>
      {object!=='projects' ? <Section title={object==='issues'?'Issue 来源':'PR 来源'}><p>GitHub 来源尚未接入。可以在项目中创建和浏览本地工作。</p><button onClick={()=>setObject('projects')}>查看项目内容</button></Section> : <Section title={`${project?.name ?? '项目'} · 本地工作`}>
        <nav className={styles.tabs} role="tablist" aria-label="本地项目视图">{views.map(([id,label])=><button key={id} role="tab" aria-selected={state.view===id} onClick={()=>controller.setView(id)}>{label}</button>)}</nav>
        <div className={styles.toolbar}><input aria-label="搜索项目内容" placeholder="搜索标题、目标或规格" value={state.search} onChange={event=>controller.setSearch(event.target.value)} /><button onClick={()=>setForm('task')}>添加工作</button><button onClick={()=>void controller.selectProject(state.projectId!)}>刷新</button></div>
        <p>{controller.visibleTasks().length} 项工作 · 当前项目</p>
        <div className={styles.tableScroll}><table aria-label="当前项目内容"><thead><tr><th>工作</th><th>目标</th><th>关联会话</th><th>规格</th></tr></thead><tbody>{controller.visibleTasks().map(item=><tr key={item.id}><td><TaskLink controller={controller} task={item}/></td><td>{item.goal}</td><td>{item.sessions.length}</td><td>第 {item.specification.version} 版</td></tr>)}</tbody></table></div>
        {!state.loading && !state.error && !controller.visibleTasks().length && <p>{state.tasks.length ? '没有匹配当前视图和搜索的工作。' : '尚无本地工作，点击“添加工作”保存目标、规格和验收。'}</p>}
      </Section>}
    </>}
    {form && <section className={styles.formSection} aria-label="工作编辑"><div className={styles.header}><h2>{({project:'接入 / 创建项目',attach:'接入已有资源',task:'添加本地工作',child:'创建子工作',spec:'更新规格',breakdown:'更新工作拆解'})[form]}</h2><button onClick={()=>setForm(null)}>取消编辑</button></div>
      {form==='project' || form==='attach' ? <ProjectForm key={`${form}/${state.projectId}`} controller={controller} attach={form==='attach'} onSaved={async projectId=>{setForm(null); await controller.load(); await controller.selectProject(projectId);setNotice('项目已保存')}}/> : form==='breakdown' && task ? <BreakdownForm key={task.version} controller={controller} task={task} onSaved={()=>done('拆解已保存')}/> : <TaskForm key={`${form}/${task?.id ?? ''}/${task?.version ?? ''}`} controller={controller} kind={form as 'task'|'child'|'spec'} task={task} onSaved={async saved=>{setForm(null);setNotice('工作已保存');await controller.openTask({projectId:saved.projectId,taskId:saved.id})}}/>}
    </section>}
  </main>
}
function Section({title,children}:{title:string;children:ReactNode}) {return <section><h2>{title}</h2>{children}</section>}
function TaskLink({controller,task}:{controller:WorkPanelController;task:WorkTask}) {return <button className={styles.link} onClick={()=>void controller.openTask({projectId:task.projectId,taskId:task.id})}>{task.title}</button>}
function activityLabel(type:string):string {return ({'task.create':'创建工作','task.create-child':'创建子工作','task.update-spec':'更新目标、规格与验收','task.replace-breakdown':'更新工作拆解','task.associate-session':'关联会话','task.link-child':'关联子工作'})[type] ?? type}
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
    <label>{attach?'已有宿主资源':'已有宿主资源（可选）'}<select required={attach} value={resource} onChange={event=>setResource(event.target.value)}><option value="">{loading?'正在读取资源…':attach?'选择资源':'独立本地项目'}</option>{resources.map((item,index)=><option key={`${item.ref.runtimeId}/${item.ref.workspaceId}`} value={index}>{item.title}</option>)}</select></label>
    <p>项目默认负责策略由后端建立。选择资源不会启动或重配会话。</p><ErrorText error={error}/><button disabled={busy || loading} type="submit">{busy?'正在保存…':'保存项目'}</button>
  </form>
}
function TaskForm({controller,kind,task,onSaved}:{controller:WorkPanelController;kind:'task'|'child'|'spec';task?:WorkTask;onSaved:(task:WorkTask)=>Promise<void>}) {
  const existing=kind==='spec'?task:undefined
  const [title,setTitle]=useState(''),[goal,setGoal]=useState(existing?.goal??''),[spec,setSpec]=useState(existing?.specification.text??''),[acceptance,setAcceptance]=useState(existing?.specification.acceptance.join('\n')??'')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('')
    try {
      const content={goal:goal.trim(),specification:spec.trim(),acceptance:acceptance.split('\n').map(text=>text.trim()).filter(Boolean)}
      const projectId=controller.getSnapshot().projectId
      if(!projectId) throw Error('请先选择项目')
      if(!content.goal || !content.specification || !content.acceptance.length) throw Error('请填写目标、规格和至少一条验收标准')
      const change=task?{ref:{projectId:task.projectId,taskId:task.id},expectedVersion:task.version}:null
      const result=await controller.submit(kind==='spec' && change ? {type:'task.update-spec',...change,...content} : kind==='child' && change ? {type:'task.create-child',...change,...content,title:title.trim()} : {type:'task.create',projectId,...content,title:title.trim()})
      if(!result.task) throw Error('工作服务未返回保存的工作')
      await onSaved(result.task)
    }catch(error){setError(message(error))}finally{setBusy(false)}
  }
  return <form onSubmit={event=>void submit(event)} className={styles.form}>
    {kind!=='spec' && <label>工作标题<input required value={title} onChange={event=>setTitle(event.target.value)}/></label>}
    <label>目标<textarea required value={goal} onChange={event=>setGoal(event.target.value)}/></label>
    <label>规格<textarea required value={spec} onChange={event=>setSpec(event.target.value)}/></label>
    <label>验收标准（每行一条）<textarea required value={acceptance} onChange={event=>setAcceptance(event.target.value)}/></label>
    <ErrorText error={error}/><button type="submit" disabled={busy}>{busy?'正在保存…':'保存工作'}</button>
  </form>
}
function BreakdownForm({controller,task,onSaved}:{controller:WorkPanelController;task:WorkTask;onSaved:()=>Promise<void>}) {
  const [blocks,setBlocks]=useState<BreakdownBlock[]>(task.breakdown),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('')
    try {await controller.submit({type:'task.replace-breakdown',ref:{projectId:task.projectId,taskId:task.id},expectedVersion:task.version,blocks});await onSaved()}catch(error){setError(message(error))}finally{setBusy(false)}
  }
  return <form onSubmit={event=>void submit(event)} className={styles.form}>{blocks.map((block,index)=><fieldset key={block.id}><legend>工作块 {index+1}</legend><label>标题<input required value={block.title} onChange={event=>setBlocks(blocks.map(item=>item.id===block.id?{...item,title:event.target.value}:item))}/></label><label>说明<textarea required value={block.description} onChange={event=>setBlocks(blocks.map(item=>item.id===block.id?{...item,description:event.target.value}:item))}/></label><button type="button" onClick={()=>setBlocks(blocks.filter(item=>item.id!==block.id))}>移除工作块 {index+1}</button></fieldset>)}<div className={styles.toolbar}><button type="button" onClick={()=>setBlocks([...blocks,{id:crypto.randomUUID(),title:'',description:''}])}>添加工作块</button><button type="submit" disabled={busy}>{busy?'正在保存…':'保存拆解'}</button></div><ErrorText error={error}/></form>
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
