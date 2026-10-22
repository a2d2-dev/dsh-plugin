#!/usr/bin/env python3
"""本 run 命令证据；不记录登录请求、cookie 或口令。"""
import subprocess,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def run(name,args):
 p=subprocess.run(args,capture_output=True,text=True)
 (ROOT/'raw'/f'{name}.json').write_text(json.dumps({'argv':args,'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr},ensure_ascii=False,indent=2))
 print(name,'exit',p.returncode)
 if p.returncode: raise SystemExit(p.stderr)
 return p.stdout

def query(name,value):
 js='(async()=>{const r=await fetch("/a2d2/api/work",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify('+json.dumps({'kind':'query','value':value})+')});return {http:r.status,body:await r.json()}})()'
 out=run(name,['agent-browser','--session','qa152','eval',js])
 return json.loads(out)['body']

if __name__=='__main__':
 project=query('baseline-projects',{'type':'projects.list'})
 for p in project.get('projects',[]):
  pid=p['id']
  query('baseline-project-'+pid,{'type':'project.detail','projectId':pid})
  sources=query('baseline-sources-'+pid,{'type':'source.list','projectId':pid})
  for s in sources.get('sources',[]):
   query('baseline-continuous-'+s['id'],{'type':'continuous.status','projectId':pid,'sourceId':s['id']})
 run('baseline-sessions',['agent-browser','--session','qa152','eval','(async()=>{const r=await fetch("/api/session/list",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});return {http:r.status,body:await r.json()}})()'])
 run('baseline-page',['agent-browser','--session','qa152','snapshot'])
 run('viewport-desktop',['agent-browser','--session','qa152','set','viewport','1440','1000'])
 run('baseline-shot',['agent-browser','--session','qa152','screenshot',str(ROOT/'shots'/'01-baseline-rules-desktop.png')])
