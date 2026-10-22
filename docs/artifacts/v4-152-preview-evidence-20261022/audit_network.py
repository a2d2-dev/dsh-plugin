#!/usr/bin/env python3
"""记录 qa152 独立浏览窗口真实网络；剔除所有 HTTP headers。"""
import subprocess,json,collections,hashlib
from datetime import datetime,timezone
from capture import ROOT,run
AB=['agent-browser','--session','qa152']
p=subprocess.run(AB+['network','requests','--json'],capture_output=True,text=True)
assert p.returncode==0,p.stderr
requests=json.loads(p.stdout)['data']['requests']
requests=[{k:v for k,v in r.items() if 'header' not in k.lower()} for r in requests]
assert all('token=' not in r['url'] for r in requests),'Never persist login URLs'
(ROOT/'raw'/'side-effect-network-window.json').write_text(json.dumps({'command':'agent-browser --session qa152 network requests --json','exit':p.returncode,'requests':requests},ensure_ascii=False,indent=2)+'\n')
summary={'capturedAt':datetime.now(timezone.utc).isoformat(),'requests':len(requests),'workKinds':dict(collections.Counter()),'workTypes':{},'commands':[],'failedRequests':[],'nonWorkRequests':[]}
kinds=collections.Counter();types=collections.Counter()
for r in requests:
 if r['url'].endswith('/a2d2/api/work'):
  body=json.loads(r.get('postData','{}'));kinds[body.get('kind')]+=1;types[body.get('value',{}).get('type')]+=1
  if body.get('kind')=='command':summary['commands'].append(body)
 else:summary['nonWorkRequests'].append({'url':r['url'],'method':r['method'],'requestId':r['requestId']})
 if r.get('status',0)>=400:
  detail=subprocess.run(AB+['network','request',r['requestId'],'--json'],capture_output=True,text=True)
  assert detail.returncode==0,detail.stderr
  data=json.loads(detail.stdout)['data'];data={k:v for k,v in data.items() if 'header' not in k.lower()}
  (ROOT/'raw'/('window-error-'+r['requestId']+'.json')).write_text(json.dumps({'exit':detail.returncode,'data':data},ensure_ascii=False,indent=2)+'\n')
  response=json.loads(data.get('responseBody','{}'))
  summary['failedRequests'].append({'requestId':r['requestId'],'status':r['status'],'postData':r.get('postData'),'error':response.get('error')})
summary['workKinds']=dict(kinds);summary['workTypes']=dict(types)
(ROOT/'raw'/'side-effect-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
run('close-panel-stop-polling',AB+['find','role','button','click','--name','关闭面板','--exact'])
run('final-sidebar',AB+['snapshot'])
