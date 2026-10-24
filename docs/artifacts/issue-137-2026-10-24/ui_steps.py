import subprocess,json,pathlib,time
ROOT=pathlib.Path(__file__).parent

def cli(*args):
 if args[:4]==('find','role','button','click') and '--name' in args:
  name=args[args.index('--name')+1]
  expression='[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")==='+json.dumps(name)+'||e.textContent.trim()==='+json.dumps(name)+')?.scrollIntoView({block:"center"})'
  subprocess.run(['agent-browser','--auto-connect','eval',expression],text=True,capture_output=True,check=True,timeout=40)
 elif args[:2]==('find','text') and args[3]=='click':
  expression='[...document.querySelectorAll("summary")].find(e=>e.textContent.trim()==='+json.dumps(args[2])+')?.scrollIntoView({block:"center"})'
  subprocess.run(['agent-browser','--auto-connect','eval',expression],text=True,capture_output=True,check=True,timeout=40)
 elif args[0] in ('click','select','fill'):
  subprocess.run(['agent-browser','--auto-connect','scrollintoview',args[1]],text=True,capture_output=True,check=True,timeout=40)
 r=subprocess.run(['agent-browser','--auto-connect',*args],text=True,capture_output=True,timeout=40)
 if r.returncode: raise RuntimeError(str(args)+'\n'+r.stdout+r.stderr)
 return r.stdout

def wait_issues():
 return cli('wait','--fn','document.querySelector("select[aria-label=\\"Issue 负责人\\"]") && !document.querySelector("select[aria-label=\\"Issue 负责人\\"]").disabled')

def save(name):
 text=cli('eval','document.querySelector("main").innerText')
 (ROOT/(name+'.txt')).write_text(text)
 cli('screenshot',str(ROOT/(name+'.png')))
 state=cli('eval','JSON.stringify({url:location.href,inputs:[...document.querySelectorAll("main input,main select")].map(e=>({label:e.getAttribute("aria-label")||e.closest("label")?.innerText,value:e.value,disabled:e.disabled})),tables:[...document.querySelectorAll("main table")].map(t=>({label:t.getAttribute("aria-label"),rows:[...t.querySelectorAll("tbody tr")].map(r=>r.innerText)})),sourceTabs:[...document.querySelectorAll("nav[aria-label=\\"来源标签\\"] button")].map(e=>({text:e.innerText,selected:e.getAttribute("aria-pressed")}))})')
 (ROOT/(name+'.json')).write_text(state)
 print(name,text[:180],flush=True)

if __name__=='__main__':
 import sys
 mode=sys.argv[1]
 if mode=='repo-filters':
  cli('select','select[aria-label="Issue 负责人"]','*');wait_issues();save('04-repo-open-all')
  cli('select','select[aria-label="Issue 远端状态"]','closed');wait_issues();save('05-repo-closed')
  cli('select','select[aria-label="Issue 远端状态"]','all');wait_issues();save('06-repo-all-page1')
  cli('find','role','button','click','--name','下一页','--exact');wait_issues();save('07-repo-all-page2')
  cli('find','role','button','click','--name','上一页','--exact');wait_issues()
  cli('fill','input[aria-label="搜索来源 Issues"]','v4')
  cli('fill','input[aria-label="Issue 标签"]','ready-for-agent')
  cli('find','role','button','click','--name','应用搜索与标签','--exact');wait_issues();save('08-repo-search-label')
  cli('fill','input[aria-label="搜索来源 Issues"]','issue137acceptanceempty9f73')
  cli('find','role','button','click','--name','应用搜索与标签','--exact');wait_issues();save('09-repo-valid-empty')
  cli('fill','input[aria-label="搜索来源 Issues"]',' ')
  cli('fill','input[aria-label="Issue 标签"]',' ')
  cli('find','role','button','click','--name','应用搜索与标签','--exact');wait_issues();save('10-repo-restored')
 elif mode=='project-pr':
  save('12-project-view-open')
  cli('select','select[aria-label="Project 视图"]','2')
  cli('find','label','含已关闭','check');save('13-project-view-all')
  cli('find','role','button','click','--name','下一页','--exact');save('14-project-view-page2')
  cli('select','select[aria-label="Project 视图"]','1');save('15-project-filter-open')
  cli('find','role','button','click','--name','#137 [v4/01] Project／仓库链接接入、真实视图与 PR 目录','--exact')
  cli('wait','--text','当前 1 · 历史 1');save('16-project-canonical')
  cli('find','role','button','click','--name','DSH A²D² Project','--exact')
  cli('wait','--text','来源概览')
  cli('find','role','button','click','--name','PR','--exact')
  cli('wait','--text','PR 只读目录');save('17-project-pr')
  cli('find','role','button','click','--name','下一页','--exact');save('18-project-pr-page2')
 if mode in ('project-pr','pr-rest'):
  cli('select','main select','merged');save('19-project-pr-merged')
  cli('find','label','搜索 PR','fill','acceptanceempty9f73');save('20-pr-valid-empty')
  cli('find','role','button','click','--name','a2d2-dev/dsh-plugin 仓库','--exact')
  cli('wait','--text','来源概览')
  cli('find','role','button','click','--name','PR','--exact');cli('wait','--text','PR 只读目录');save('21-repo-pr')
  cli('find','label','搜索 PR','fill','212');save('22-repo-pr-212')
 if mode=='states':
  cli('find','role','button','click','--name','Issue','--exact');wait_issues()
  cli('fill','input[aria-label="搜索来源 Issues"]',' ')
  cli('fill','input[aria-label="Issue 标签"]',' ')
  cli('find','role','button','click','--name','应用搜索与标签','--exact');save('24-reading-issues');wait_issues();save('25-narrow-issues')
  cli('find','text','来源状态与缓存','click','--exact')
  cli('find','role','button','click','--name','读取缓存列表','--exact');wait_issues();save('26-cached-issues')
  try:
   cli('set','offline','on')
   cli('find','role','button','click','--name','刷新 Issues','--exact');wait_issues();save('27-unavailable-cache-retained')
  finally: cli('set','offline','off')
  cli('find','role','button','click','--name','刷新 Issues','--exact');wait_issues();save('28-recovered-issues')
  cli('set','viewport','1920','1080')
  cli('eval','performance.mark("issue137-race-start")')
  cli('find','role','button','click','--name','刷新 Issues','--exact')
  cli('find','role','button','click','--name','DSH A²D² Project','--exact')
  cli('wait','--text','来源概览');cli('wait','--load','networkidle');save('29-source-race-final-project')
  selected=json.loads(json.loads(cli('eval','JSON.stringify([...document.querySelectorAll("nav[aria-label=\\"来源标签\\"] button[aria-pressed=\\"true\\"]")].map(e=>e.innerText))')))
  assert selected==['DSH A²D² Project'],selected
 if mode=='project-issues-no-cache':
  cli('find','role','button','click','--name','Issue','--exact');wait_issues();save('35-project-issues-me')
  cli('select','select[aria-label="Issue 负责人"]','*');wait_issues();save('36-project-issues-open')
  cli('select','select[aria-label="Issue 远端状态"]','closed');wait_issues();save('37-project-issues-closed')
  cli('select','select[aria-label="Issue 远端状态"]','all');wait_issues();save('38-project-issues-all')
  cli('find','role','button','click','--name','下一页','--exact');wait_issues();save('39-project-issues-page2')
  cli('find','role','button','click','--name','a2d2-dev/dsh-plugin 仓库','--exact');cli('wait','--text','来源概览')
  cli('find','role','button','click','--name','Issue','--exact');wait_issues()
  cli('fill','input[aria-label="搜索来源 Issues"]',' ');cli('fill','input[aria-label="Issue 标签"]',' ')
  cli('select','select[aria-label="Issue 远端状态"]','all');wait_issues()
  cli('find','role','button','click','--name','应用搜索与标签','--exact');wait_issues()
  cli('find','text','来源状态与缓存','click','--exact')
  cli('find','role','button','click','--name','停用来源','--exact')
  try:
   cli('wait','--fn','[...document.querySelectorAll("button")].some(e=>e.innerText==="启用来源"&&!e.disabled)')
   for _ in range(3):
    cli('find','role','button','click','--name','下一页','--exact')
    cli('wait','--fn','[...document.querySelectorAll("button")].some(e=>e.innerText==="启用来源"&&!e.disabled)')
    if '此筛选页尚无可读缓存' in cli('eval','document.querySelector("main").innerText'): break
   else: raise AssertionError('Expected an unobserved cache page')
   save('40-real-no-cache-page')
  finally:
   cli('find','role','button','click','--name','启用来源','--exact')
  wait_issues()
  cli('find','role','button','click','--name','刷新 Issues','--exact');wait_issues();save('41-source-reenabled')
