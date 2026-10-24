"""Issue #137: guarded client-only update; no host process/config/data changes."""
import hashlib,json,pathlib,shutil,sys,os
ROOT=pathlib.Path(__file__).resolve().parents[3]
INSTALLED=pathlib.Path('/root/.dsh/profiles/web/node_modules/@a2d2/dsh-a2d2/lib').resolve()
EXPECTED=pathlib.Path('/data/_ssd2t/dsh/home/profiles/web/node_modules/@a2d2/dsh-a2d2/lib')
BACKUP=pathlib.Path('/data/_dsh-builds/issue-137-client-20261024-cache-status')
EVIDENCE=pathlib.Path(__file__).resolve().parent/'client-deployment.json'
assert INSTALLED==EXPECTED,(INSTALLED,EXPECTED)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def sources(p):
 m=json.loads(p.read_text());return {n:c for n,c in zip(m['sources'],m['sourcesContent']) if n.startswith('../src/')}
def replace(target,data):
 assert target.resolve()==EXPECTED/target.name,target
 staging=target.with_name(target.name+'.issue137-staged')
 assert staging.resolve().parent==EXPECTED
 staging.write_bytes(data)
 os.replace(staging,target)
mode=sys.argv[1]
if mode=='apply':
 assert not BACKUP.exists(),'Backup already exists; do not overwrite another deployment'
 old=sources(INSTALLED/'client.js.map');new=sources(ROOT/'lib/client.js.map')
 changed=sorted(n for n in set(old)|set(new) if old.get(n)!=new.get(n))
 assert changed==['../src/client/source-directory.tsx'],changed
 BACKUP.mkdir(parents=True)
 hosts={p.name:sha(p) for p in INSTALLED.glob('*.js') if p.name!='client.js'}
 metadata={'base':'d975e9cc60c8c7acee6c91fc80d7d277691d9577','changedSources':changed,'preservedClientSources':len(new)-1,'backup':str(BACKUP),'installed':str(INSTALLED),'files':{},'hostAssets':hosts}
 for name in ['client.js','client.js.map']:
  target=INSTALLED/name;candidate=ROOT/'lib'/name
  shutil.copy2(target,BACKUP/name)
  metadata['files'][name]={'before':sha(target),'after':sha(candidate)}
 # Map first; script last. All destination paths are checked before replacement.
 for name in ['client.js.map','client.js']:
  replace(INSTALLED/name,(ROOT/'lib'/name).read_bytes())
 assert hosts=={p.name:sha(p) for p in INSTALLED.glob('*.js') if p.name!='client.js'}
 EVIDENCE.write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'status':'client-updated','changedSources':changed,'preservedClientSources':len(new)-1,'hostAssetsUnchanged':len(hosts),'sha256':sha(INSTALLED/'client.js')},ensure_ascii=False))
elif mode=='rollback':
 metadata=json.loads(EVIDENCE.read_text())
 for name,facts in metadata['files'].items():
  assert sha(INSTALLED/name)==facts['after'],'Installed asset changed since this deployment'
  assert sha(BACKUP/name)==facts['before'],'Backup hash mismatch'
 for name in ['client.js.map','client.js']:
  replace(INSTALLED/name,(BACKUP/name).read_bytes())
 print('client-rolled-back; refresh the existing GUI')
else: raise SystemExit('usage: client_update.py apply|rollback')
