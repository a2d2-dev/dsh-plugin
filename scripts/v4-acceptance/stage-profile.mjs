import { readFile, writeFile, mkdir, readdir, cp, realpath, lstat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { targets, fingerprintTree } from './profile-actions.mjs'
import { importProfile } from './profile-imports.mjs'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
export async function stageProfile({sourceProfile,root,hostRoot,pluginTgz,overlays=[]}){
  if(!Object.values(targets).some(target=>target.profile===sourceProfile))throw Error('only existing specified profiles may be snapshotted')
  if(!root.startsWith('/data/_dsh-builds/v4-141-')&&!root.startsWith('/tmp/a2d2-v4-'))throw Error('private artifact root required')
  if(resolve(root)!==root)throw Error('canonical artifact path required')
  await mkdir(root,{mode:0o700})
  if(await realpath(root)!==root)throw Error('artifact parent has symlink')
  const sourceSha256=await fingerprintTree(sourceProfile)
  const installed=join(sourceProfile,'node_modules/dsh-a2d2')
  if(!pluginTgz){
    pluginTgz=join(root,'frozen-installed-plugin.tgz')
    const entries=[]
    for(const name of ['package.json','lib','cordis.patch.yml','dsh.plugin.json','ceo','README.md','README.zh.md']){
      try{await lstat(join(installed,name));entries.push(name)}catch(error){if(error.code!=='ENOENT')throw error}
    }
    if(!entries.includes('package.json')||!entries.includes('lib'))throw Error('installed old plugin lacks executable artifacts')
    const result=spawnSync('tar',['--dereference','--transform=s,^,package/,','-czf',pluginTgz,'-C',installed,...entries],{encoding:'utf8'})
    if(result.status!==0)throw Error('frozen installed-plugin archive failed')
  }
  pluginTgz=await realpath(pluginTgz)
  const profile=join(root,'profile')
  await mkdir(profile,{mode:0o700})
  for(const entry of await readdir(sourceProfile,{withFileTypes:true})){
    if(entry.name==='node_modules'||entry.name==='.v4-141-current-run.json')continue
    await cp(join(sourceProfile,entry.name),join(profile,entry.name),{recursive:true,dereference:false,preserveTimestamps:true,errorOnExist:true,force:false})
  }
  const manifest=JSON.parse(await readFile(join(profile,'package.json')))
  manifest.dependencies={...manifest.dependencies,'dsh-a2d2':`file:${pluginTgz}`}
  manifest.packageManager='pnpm@11.7.0'
  await writeFile(join(profile,'package.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600})
  const installation=spawnSync('pnpm',['install','--ignore-scripts','--no-frozen-lockfile','--config.auto-install-peers=false'],{cwd:profile,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024})
  await writeFile(join(root,'install.private.log'),JSON.stringify({status:installation.status,stdout:installation.stdout,stderr:installation.stderr}),{flag:'wx',mode:0o600})
  if(installation.status!==0)throw Error('offline profile staging install failed; inspect private log')
  const frozenOverlays=[]
  for(const [index,path]of overlays.entries()){
    const target=join(root,`overlay-${index}.private.yml`)
    await writeFile(target,await readFile(path),{flag:'wx',mode:0o600});frozenOverlays.push(target)
  }
  const imports=await importProfile(hostRoot,profile,frozenOverlays)
  await writeFile(join(root,'imports.private.json'),JSON.stringify(imports,null,2)+'\n',{flag:'wx',mode:0o600})
  if(await fingerprintTree(sourceProfile)!==sourceSha256)throw Error('source profile changed during staging; staged result needs review')
  const result={sourceProfile,sourceSha256,path:profile,hostRoot,pluginTgz,tgzSha256:hash(await readFile(pluginTgz)),clientSha256:hash(await readFile(join(profile,'node_modules/dsh-a2d2/lib/client.js'))),sha256:await fingerprintTree(profile),overlays:frozenOverlays,importsReceipt:{path:join(root,'imports.private.json'),sha256:hash(await readFile(join(root,'imports.private.json')))},preparedAt:new Date().toISOString()}
  await writeFile(join(root,'profile-proof.private.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600})
  return result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const[sourceProfile,root,hostRoot,plugin,...overlays]=process.argv.slice(2)
  stageProfile({sourceProfile,root,hostRoot,pluginTgz:plugin==='snapshot-installed'?undefined:plugin,overlays}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1})
}
