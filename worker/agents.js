import { easternStart } from './reporting.js';
let cache,pending,retryAt=0;
const key=s=>String(s||'').toLowerCase().replace(/[^a-z]/g,'');
const callStates=new Set(['connected','hold','consulting','consult','conference','conferencing','outdialconnected','outdialhold','outdialconsulting','outdialconference']);
export function summarizeAgents(sessions,now){
 const latest=new Map();
 for(const s of sessions){if(!s.agentId)throw Error('Agent ID missing');const old=latest.get(s.agentId);if(!old||s.startTime>old.startTime)latest.set(s.agentId,s)}
 const agents=[],queues=new Map();
 for(const s of latest.values()){
  if(s.isActive!==true)continue;
  const activities=[];
  for(const c of s.channelInfo||[]){if(key(c.channelType)!=='telephony')continue;
   if(c.activities?.pageInfo?.hasNextPage!==false)throw Error('Current agent activities incomplete');
   activities.push(...(c.activities.nodes||[]).filter(a=>a.isCurrentActivity===true));
  }
  const calls=activities.filter(a=>callStates.has(key(a.state))),wrap=activities.some(a=>key(a.state).includes('wrapup'));
  const status=calls.length?'On call':wrap?'Wrap-up':key(s.state)==='available'?'Available':key(s.state)==='idle'?'Idle':String(s.state||'Unknown');
  const queueIds=[...new Set(calls.map(a=>a.queue?.id).filter(Boolean))];
  for(const id of queueIds){const a=calls.find(a=>a.queue?.id===id);if(!queues.has(id))queues.set(id,{id,name:a.queue.name||id,onCall:0});queues.get(id).onCall++}
  agents.push({id:s.agentId,name:s.agentName||'Agent',team:s.teamName||'',status,reportedState:s.state||'Unknown',queues:queueIds});
 }
 return {updatedAt:new Date(now).toISOString(),agents:agents.sort((a,b)=>a.name.localeCompare(b.name)),queues:[...queues.values()],onCall:agents.filter(a=>a.status==='On call').length};
}
export async function agentData(env,getToken){
 if(cache&&Date.now()-cache.time<60000)return cache.value;
 if(pending)return pending;
 if(Date.now()<retryAt)throw Error('Agent reporting rate limited');
 pending=(async()=>{
  const token=await getToken();if(!token)throw Error('Connect Webex reporting first');
  const now=Date.now(),sessions=new Map(),seen=new Set();let cursor='NA';
  for(let page=0;page<1000;page++){
   const query='query($from: Long!, $to: Long!) { agentSession(from:$from,to:$to,pagination:{cursor:'+JSON.stringify(cursor)+'},extFilter:{channelInfo:{activities:{nodes:{isCurrentActivity:{equals:true}}}}}) { agentSessions { agentId agentName agentSessionId startTime isActive state teamName channelInfo { channelType activities(first:100) { nodes { id state startTime isCurrentActivity taskId queue { id name } } pageInfo { hasNextPage endCursor } } } } pageInfo { hasNextPage endCursor } } }';
   const r=await fetch(env.WEBEX_API_BASE+'/search?orgId='+encodeURIComponent(env.WEBEX_ORG_ID),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{from:easternStart(now-7*86400000),to:now}}),signal:AbortSignal.timeout(20000)});
   if(r.status===429){retryAt=Date.now()+60000;throw Error('Agent reporting rate limited')}
   if(!r.ok)throw Error('Agent reporting HTTP '+r.status);
   const v=await r.json();if(v.errors?.length)throw Error('Webex rejected agent reporting fields');
   const d=v.data?.agentSession;if(!Array.isArray(d?.agentSessions)||typeof d.pageInfo?.hasNextPage!=='boolean')throw Error('Incomplete agent reporting');
   for(const s of d.agentSessions){if(!s.agentSessionId)throw Error('Agent session ID missing');sessions.set(s.agentSessionId,s)}
   if(!d.pageInfo.hasNextPage){const value=summarizeAgents([...sessions.values()],now);cache={time:Date.now(),value};return value}
   const next=d.pageInfo.endCursor;if(!next||seen.has(next))throw Error('Agent pagination incomplete');seen.add(next);cursor=next;
  }
  throw Error('Agent pagination limit exceeded');
 })();try{return await pending}finally{pending=null}
}
