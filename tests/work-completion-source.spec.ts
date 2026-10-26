import { expect, it } from 'vitest'
import { GitHubSource } from '../src/work-sources/github.ts'
const target={nodeId:'I_contract',repository:{owner:'example',repository:'repo'},number:139,expectedUpdatedAt:'2026-10-21T00:00:00Z',expectedAssignees:['developer']}
const raw={node_id:'I_contract',number:139,title:'contract',body:'verify',html_url:'https://github.com/example/repo/issues/139',state:'open',milestone:null,updated_at:target.expectedUpdatedAt,assignees:[{login:'developer'}],labels:[]}
it('uses host credentials and a fixed canonical node mutation and classifies a lost mutation receipt as unknown',async()=>{
 const requests:{url:string;init?:RequestInit}[]=[]
 const source=new GitHubSource({credential:async()=> 'host-only-token',fetch:async(input,init)=>{
  const url=String(input);requests.push({url,init})
  if(url.endsWith('/user'))return new Response(JSON.stringify({login:'developer',node_id:'U_developer',name:null}))
  if(url.endsWith('/issues/139'))return new Response(JSON.stringify(raw))
  throw Error('mutation receipt lost')
 }})
 expect(await source.close(target,'operation-139')).toMatchObject({status:'unknown'})
 expect(requests.at(-1)).toMatchObject({url:'https://api.github.com/graphql',init:{method:'POST',redirect:'manual'}})
 expect(JSON.parse(String(requests.at(-1)!.init!.body))).toMatchObject({variables:{input:{issueId:'I_contract',clientMutationId:'operation-139'}}})
})
it('refuses a changed remote assignee before any GitHub mutation',async()=>{
 const requests:string[]=[]
 const source=new GitHubSource({credential:async()=> 'host-only-token',fetch:async(input)=>{
  const url=String(input);requests.push(url)
  return new Response(JSON.stringify(url.endsWith('/user')?{login:'developer',node_id:'U_developer',name:null}:{...raw,assignees:[{login:'other'}]}))
 }})
 expect(await source.close(target,'operation-139')).toMatchObject({status:'conflict'})
 expect(requests.some(url=>url.endsWith('/graphql'))).toBe(false)
})
