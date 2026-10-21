// A v4 upgrade may create its first Work runtime in a phase1-only GUI.
// An existing identity is always immutable; only this explicit schema/path birth is allowed.
export function permitsSystemGenesis(path,previousExists,value,allowed=[]){
  if(path!=='/data/_dsh-dev/a2d2/work-v3/runtime-v1.json'||previousExists!==false||!allowed.some(item=>item.path===path&&item.kind==='work-runtime-v1'))return false
  return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='runtimeId,schemaVersion'&&value.schemaVersion===1&&typeof value.runtimeId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.runtimeId)
}
