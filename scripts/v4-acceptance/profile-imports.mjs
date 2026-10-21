import { createRequire } from 'node:module'
import { readFile, writeFile, realpath } from 'node:fs/promises'
import { join, dirname, isAbsolute } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// Uses the production public Loader.import seam, never entry.apply()/boot().
// Native group/include and AgentPreset.Config.plugins are explicit carrier contracts.
export async function importProfile(hostRoot, profileDir, overlays = []) {
  for (const root of [hostRoot,profileDir]) if(!isAbsolute(root)||await realpath(root)!==root)throw Error('canonical isolated paths required')
  if(hostRoot==='/data/src/github.com/deepseek-ai/deepseek-harness-dev'||hostRoot.endsWith('/v4-job-observation')||hostRoot.includes('/v4-job-observation/'))throw Error('shared dev and implementer trees are not deployment artifacts')
  const anchor=join(hostRoot,'apps/cli/package.json'),req=createRequire(anchor)
  const appBoot=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-app-boot')).href)
  const {Context}=await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href)
  const {default:Loader,EntryGroup}=await import(pathToFileURL(req.resolve('@deepseek-ai/cordis-plugin-loader')).href)
  const profile=appBoot.loadProfileDirectory('v4-acceptance-imports',profileDir,anchor)
  if(profile.skippedBundles.length)throw Error('profile contains unresolved/incompatible bundle')
  const layers=[...profile.layers.map(layer=>layer.patches),profile.patches,...overlays.map(path=>appBoot.loadOverlayPatches('v4-acceptance-imports',path))]
  const entries=appBoot.composeEntries(layers)
  const resolution=await appBoot.createRuntimeResolution({installAnchor:anchor,profile})
  const ctx=new Context(),imports=[],includes=new Set()
  try{
    await ctx.plugin(appBoot.PluginPackages,{resolution})
    const loader=new Loader(ctx,{baseUrl:pathToFileURL(profileDir+'/').href})
    loader.builtins.group=loader.unwrapExports(await loader.import('@deepseek-ai/cordis-plugin-group'))
    loader.builtins.include=loader.unwrapExports(await loader.import('@deepseek-ai/cordis-plugin-include'))
    async function walk(rows,baseUrl){
      if(!Array.isArray(rows))throw Error('carrier child list must be literal; expressions are not evaluated')
      for(const entry of rows){
        if(entry.disabled===true)continue
        if(typeof entry.name!=='string')throw Error('literal plugin name required')
        loader.ctx.baseUrl=baseUrl
        const module=await loader.import(entry.name)
        const plugin=loader.unwrapExports(module)
        const pkg=ctx.pluginPackages.packageOf(entry.name,baseUrl)
        if(pkg){
          const dir=await realpath(pkg.dir)
          if(dir.startsWith('/data/src/github.com/deepseek-ai/deepseek-harness-dev/'))throw Error('entry resolves to shared dev')
        }
        imports.push({name:entry.name,baseUrl,packageDir:pkg?.dir??null,ok:true})
        if(!plugin?.[EntryGroup.key])continue
        if(entry.name==='@deepseek-ai/dsh-agent-preset'){
          // Public PresetDefinition/AgentPreset.Config owns this literal plugins list.
          await walk(entry.config?.plugins,baseUrl)
        }else if(plugin===loader.builtins.group||entry.name==='cordis:group'){
          await walk(entry.config,baseUrl)
        }else if(plugin===loader.builtins.include||entry.name==='cordis:include'){
          if(typeof entry.config?.path!=='string')throw Error('literal include path required')
          const path=await realpath(fileURLToPath(new URL(entry.config.path,baseUrl)))
          if(includes.has(path))throw Error('include cycle')
          includes.add(path)
          const patch=appBoot.loadOverlayPatches('v4-acceptance-imports',path)
          const children=appBoot.composeEntries([patch,entry.config.patches??[]])
          await walk(children,pathToFileURL(dirname(path)+'/').href)
          includes.delete(path)
        }else throw Error(`unsupported real Loader carrier: ${entry.name}`)
      }
    }
    await walk(entries,pathToFileURL(profileDir+'/').href)
    if(!imports.length)throw Error('empty profile proof')
    return {passed:true,hostRoot,profileDir,imports,overlays,capturedAt:new Date().toISOString(),method:'production public Loader.import, official profile composition/resolution, native group/include and public AgentPreset.plugins traversal; no activation'}
  }finally{await ctx.fiber.dispose()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const[host,profile,output,...overlays]=process.argv.slice(2);const value=await importProfile(host,profile,overlays);await writeFile(output,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:true,imports:value.imports.length,hostRoot:host,profileDir:profile,evidence:output}))}catch(error){console.error(error.message);process.exitCode=1}
}
