import { easternStart } from './reporting.js';
const norm=v=>String(v||'').toLowerCase().replace(/[^a-z]/g,'');
const active=new Set(['connected','hold','onhold','consult','consulting','conference','conferencing','outdialconnected','outdialhold','outdialconsult','outdialconsulting','outdialconference','outdialconferencing']);
export function merged(intervals){const sorted=intervals.filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]),out=[];for(const [a,b] of sorted){const last=out.at(-1);if(last&&a<=last[1])last[1]=Math.max(b,last[1]);else out.push([a,b])}return out}
const total=x=>merged(x).reduce((s,[a,b])=>s+b-a,0);
function subtract(intervals,exclude){let result=merged(intervals);for(const [a,b] of merged(exclude))result=result.flatMap(([x,y])=>b<=x||a>=y?[[x,y]]:[[x,Math.min(a,y)],[Math.max(b,x),y]].filter(([u,v])=>v>u));return result}
export function dailyAgents(sessions,now){
 const from=easternStart(now),agents=new Map();
 for(const s of sessions){
  if(!agents.has(s.agentId))agents.set(s.agentId,{id:s.agentId,name:s.agentName||'Agent',team:s.teamName||'',calls:[],idle:new Map(),complete:true,seenToday:false,sessionStart:-Infinity});
  const a=agents.get(s.agentId);if(s.startTime>a.sessionStart){a.name=s.agentName||a.name;a.team=s.teamName||a.team;a.sessionStart=s.startTime}
  for(const c of s.channelInfo||[]){if(norm(c.channelType)!=='telephony')continue;
   if(c.activities?.pageInfo?.hasNextPage!==false)a.complete=false;
   for(const n of c.activities?.nodes||[]){
    if(n.isCurrentActivity===true||n.startTime>=from||n.endTime>from)a.seenToday=true;
    const state=norm(n.state);if(state!=='idle'&&!active.has(state))continue;
    if(!Number.isFinite(n.startTime)){a.complete=false;continue}
    const end=n.isCurrentActivity===true?now:n.endTime;
    if(!Number.isFinite(end)||end<n.startTime){a.complete=false;continue}
    const interval=[Math.max(from,n.startTime),Math.min(now,end)];if(interval[1]<=interval[0])continue;
    if(active.has(state))a.calls.push(interval);
    else {const code=n.idleCode?.name||'Code not reported';if(!a.idle.has(code))a.idle.set(code,[]);a.idle.get(code).push(interval)}
   }
  }
 }
 return {updatedAt:new Date(now).toISOString(),from:new Date(from).toISOString(),agents:[...agents.values()].filter(a=>a.seenToday||!a.complete).map(a=>({id:a.id,name:a.name,team:a.team,complete:a.complete,callTime:a.complete?total(a.calls):null,idleTime:a.complete?total([...a.idle.values()].flatMap(x=>subtract(x,a.calls))):null,idleCodes:a.complete?[...a.idle].map(([code,r])=>({code,duration:total(subtract(r,a.calls))})):[]})).sort((a,b)=>a.name.localeCompare(b.name))};
}
let cache,pending,retryAt=0;
export async function dailyAgentData(env,getToken){
 if(cache&&cache.value.from===new Date(easternStart()).toISOString()&&Date.now()-cache.time<60000)return cache.value;
 if(pending)return pending;if(Date.now()<retryAt)throw Error('Agent history is rate limited');
 pending=(async()=>{
 const token=await getToken();if(!token)throw Error('Connect Webex first');const now=Date.now(),from=easternStart(now-7*86400000);
 async function query(cursor,session=null,after=null){
  const fields='agentId agentName agentSessionId startTime isActive teamName channelInfo { channelId channelType activities(first:100'+(after?',after:'+JSON.stringify(after):'')+') { nodes { id state startTime endTime isCurrentActivity idleCode { id name } } pageInfo { hasNextPage endCursor } } }';
  const q='query($from:Long!,$to:Long!) { agentSession(from:$from,to:$to,'+(session?'filter:{agentSessionId:{equals:'+JSON.stringify(session)+'}},':'')+'pagination:{cursor:'+JSON.stringify(cursor)+'}) { agentSessions { '+fields+' } pageInfo { hasNextPage endCursor } } }';
  const r=await fetch(env.WEBEX_API_BASE+'/search?orgId='+encodeURIComponent(env.WEBEX_ORG_ID),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:q,variables:{from,to:now}}),signal:AbortSignal.timeout(20000)});
  if(r.status===429){retryAt=Date.now()+60000;throw Error('Agent history is rate limited')}
  if(!r.ok)throw Error('Agent history HTTP '+r.status);
  const v=await r.json(),d=v.data?.agentSession;if(v.errors?.length||!Array.isArray(d?.agentSessions)||typeof d.pageInfo?.hasNextPage!=='boolean')throw Error('Complete agent history is unavailable from Webex');
  return d;
 }
 const sessions=new Map(),seen=new Set();let cursor='NA',finished=false;
 for(let p=0;p<1000;p++){const d=await query(cursor);for(const s of d.agentSessions)sessions.set(s.agentSessionId,s);if(!d.pageInfo.hasNextPage){finished=true;break}const next=d.pageInfo.endCursor;if(!next||seen.has(next))throw Error('Agent session history is incomplete');seen.add(next);cursor=next}
 if(!finished)throw Error('Agent history pagination limit exceeded');
 for(const s of sessions.values())for(const c of s.channelInfo||[]){
  if(norm(c.channelType)!=='telephony')continue;const seen=new Set();
  for(let p=0;c.activities?.pageInfo?.hasNextPage&&p<1000;p++){
   const next=c.activities.pageInfo.endCursor;if(!next||seen.has(next))throw Error('Agent activity history is incomplete');seen.add(next);
   const d=await query('NA',s.agentSessionId,next),more=d.agentSessions.find(x=>x.agentSessionId===s.agentSessionId)?.channelInfo?.find(x=>x.channelId===c.channelId)?.activities;
   if(!more)throw Error('Agent activity history is incomplete');
   c.activities={...more,nodes:[...new Map([...c.activities.nodes,...more.nodes].map(n=>[n.id,n])).values()]};
  }
 }
 const value=dailyAgents([...sessions.values()],now);cache={time:Date.now(),value};return value;
 })();try{return await pending}finally{pending=null}
}
