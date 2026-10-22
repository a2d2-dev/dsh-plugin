#!/usr/bin/env python3
"""只创建本 run 标签、六个专用 Issue、两条 sub-issue 及四个 Project items。"""
import json,os
from pathlib import Path
from capture import run,ROOT
os.environ['HOME']='/root'
repo='a2d2-dev/dsh-plugin'
fixtures=Path('docs/artifacts/v4-152-live-acceptance')
ledger=json.loads((fixtures/'ledger.template.json').read_text())
ledger['state']='preparation-objects-creating-no-executions'
ledger['resourceRef']={'runtimeId':'c01a3a7b-6deb-4820-9896-548d14220162','workspaceId':'b2c6edcf-bb21-4925-8ccd-6b0e503de5dc'}
ledger['reusedSourceProjectId']='ec480d94-c5e8-44a0-80a0-897945df1a67'
ledger['sourceIds']={'repo':'9cea4378-0219-4f99-a237-80f51bd36291','project':'c122502c-1632-4a96-acb5-8adbac61999d'}
def save(): (ROOT/'ledger.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
assert not (ROOT/'ledger.json').exists(),'Refuse duplicate fixture creation'
save()
for name,key in [('run','runLabel'),('serial','serialLabel'),('touch','touchLabel')]:
 run('github-label-'+name,['gh','label','create',ledger[key],'--repo',repo,'--color','BFDADC','--description','专用 v4 #152 验收 '+ledger['run']])
for code in ['P','C','E','A','B','X']:
 labels=[ledger['runLabel']]
 if code in 'ABX': labels.append(ledger['serialLabel'])
 if code=='A': labels.append(ledger['touchLabel'])
 args=['gh','issue','create','--repo',repo,'--title',f'[QA #152 v4 {ledger["run"]}] {code}','--body-file',str(fixtures/(code+'.body.md')),'--assignee','imneov']
 for label in labels: args+=['--label',label]
 url=run('github-create-'+code,args).strip()
 obj=json.loads(run('github-read-'+code,['gh','api','repos/'+repo+'/issues/'+url.rsplit('/',1)[1]]))
 assert obj['body']==(fixtures/(code+'.body.md')).read_text().strip() or obj['body']==(fixtures/(code+'.body.md')).read_text()
 ledger['actualFixtureIdentities'].append({'fixture':code,'number':obj['number'],'node_id':obj['node_id'],'database_id':obj['id'],'url':obj['html_url'],'updatedAt':obj['updated_at'],'state':obj['state'],'labels':[x['name'] for x in obj['labels']],'assignees':[x['login'] for x in obj['assignees']]})
 save()
by={x['fixture']:x for x in ledger['actualFixtureIdentities']}
for code in ['C','E']:
 run('github-subissue-'+code,['gh','api','--method','POST',f'repos/{repo}/issues/{by["P"]["number"]}/sub_issues','-F',f'sub_issue_id={by[code]["database_id"]}'])
children=json.loads(run('github-subissues-confirm',['gh','api',f'repos/{repo}/issues/{by["P"]["number"]}/sub_issues']))
assert {x['id'] for x in children}=={by[c]['database_id'] for c in ['C','E']}
ledger['nativeSubIssues']={'parent':by['P']['number'],'children':[x['number'] for x in children],'verified':True}
project=json.loads(run('github-project',['gh','project','view','1','--owner','a2d2-dev','--format','json']))
ledger['githubProjectId']=project['id']
for code in ['P','C','E','A']:
 item=json.loads(run('github-project-add-'+code,['gh','project','item-add','1','--owner','a2d2-dev','--url',by[code]['url'],'--format','json']))
 ledger['actualProjectItems'].append({'fixture':code,'issueNumber':by[code]['number'],'itemId':item['id']})
 save()
ledger['allowedPlanNodes']=[by[c]['node_id'] for c in ['A','B']]
ledger['state']='prepared-workspace-registered-six-issues-four-project-items-no-task-no-execution'
ledger['evidence']=['raw/workspace-resources.json','raw/github-subissues-confirm.json']
save()
