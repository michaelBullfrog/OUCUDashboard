import { easternStart } from './reporting.js';

const fields=['availableDuration','connectedDuration','wrapupDuration','outdialConnectedDuration','outdialWrapupDuration'];
export function occupancyRows(sessions,from,to){
 const agents=new Map(),seen=new Set();
 for(const s of sessions){
  if(!s.agentSessionId||seen.has(s.agentSessionId))continue;seen.add(s.agentSessionId);
  if(Number.isFinite(s.endTime)&&s.endTime>0&&s.endTime<=from||Number.isFinite(s.startTime)&&s.startTime>to)continue;
  const channels=(s.channelInfo||[]).filter(c=>String(c.channelType).toLowerCase()==='telephony');if(!channels.length)continue;
  if(!agents.has(s.agentId))agents.set(s.agentId,{id:s.agentId,name:s.agentName||'Agent',team:s.teamName||'',sessions:0,firstLogin:null,lastLogout:null,...Object.fromEntries(fields.map(f=>[f,0])),reasons:new Set()});
  const a=agents.get(s.agentId);a.sessions++;
  if(Number.isFinite(s.startTime))a.firstLogin=a.firstLogin===null?s.startTime:Math.min(a.firstLogin,s.startTime);else a.reasons.add('Login timestamp missing');
  if(Number.isFinite(s.endTime)&&s.endTime>0)a.lastLogout=a.lastLogout===null?s.endTime:Math.max(a.lastLogout,s.endTime);
  if(s.isActive===true||!Number.isFinite(s.endTime)||s.endTime<=0)a.reasons.add('Awaiting reported logout');
  if(Number.isFinite(s.startTime)&&s.startTime<from||Number.isFinite(s.endTime)&&s.endTime>to)a.reasons.add('Session crosses selected date range');
  if(Number.isFinite(s.startTime)&&Number.isFinite(s.endTime)&&s.endTime>0&&s.endTime<=s.startTime)a.reasons.add('Invalid session timestamps');
  for(const c of channels)for(const f of fields){if(!Number.isFinite(c[f])||c[f]<0){a[f]=null;a.reasons.add('Duration fields incomplete')}else if(a[f]!==null)a[f]+=c[f]}
 }
 return [...agents.values()].map(a=>{
  const span=a.firstLogin!==null&&a.lastLogout!==null?a.lastLogout-a.firstLogin:null;
  const numerator=fields.every(f=>a[f]!==null)?fields.reduce((v,f)=>v+a[f],0):null;
  if(span!==null&&span<=0)a.reasons.add('Invalid login-to-logout span');
  return {...a,reasons:[...a.reasons],signedInSpan:span>0?span:null,numerator,occupancy:a.reasons.size===0&&span>0&&numerator!==null?100*numerator/span:null};
 }).sort((a,b)=>a.name.localeCompare(b.name));
}

export function occupancyRange(date,toDate,now=Date.now()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(now));date=date||today;toDate=toDate||date;
 for(const day of [date,toDate])if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T12:00:00Z'))||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day||day>today)throw Error('Choose a valid date no later than today.');
 const days=(Date.parse(toDate+'T12:00:00Z')-Date.parse(date+'T12:00:00Z'))/86400000+1;
 if(days<1||days>31)throw Error('Choose an ordered range of up to 31 days.');
 const from=easternStart(Date.parse(date+'T12:00:00Z')),last=easternStart(Date.parse(toDate+'T12:00:00Z'));
 return {date,toDate,from,to:Math.min(now,easternStart(last+36*3600000)-1)};
}
const cache=new Map(),pending=new Map();let retryAt=0;
export async function occupancyData(env,getToken,date,toDate){
 const range=occupancyRange(date,toDate),key=range.date+':'+range.toDate,cached=cache.get(key);
 if(cached&&Date.now()-cached.time<60000)return cached.value;
 if(pending.has(key))return pending.get(key);
 if(Date.now()<retryAt)throw Error('Agent occupancy reporting is rate limited');
 const work=(async()=>{
  const token=await getToken();if(!token)throw Error('Connect Webex first');
  const sessions=new Map(),seen=new Set();let cursor='NA',finished=false;
  for(let p=0;p<1000;p++){
   const query='query($from:Long!,$to:Long!) { agentSession(from:$from,to:$to,pagination:{cursor:'+JSON.stringify(cursor)+'}) { agentSessions { agentId agentName agentSessionId startTime endTime isActive teamName channelInfo { channelType '+fields.join(' ')+' } } pageInfo { hasNextPage endCursor } } }';
   const r=await fetch(env.WEBEX_API_BASE+'/search?orgId='+encodeURIComponent(env.WEBEX_ORG_ID),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{from:range.from,to:range.to}}),signal:AbortSignal.timeout(20000)});
   if(r.status===429){retryAt=Date.now()+Math.max(60000,Number(r.headers.get('Retry-After')||0)*1000);throw Error('Agent occupancy reporting is rate limited')}
   if(!r.ok)throw Error('Agent occupancy HTTP '+r.status);
   const v=await r.json(),d=v.data?.agentSession;
   if(v.errors?.length||!Array.isArray(d?.agentSessions)||typeof d.pageInfo?.hasNextPage!=='boolean')throw Error('Complete occupancy fields are unavailable from Webex');
   for(const s of d.agentSessions){if(!s.agentSessionId||!s.agentId)throw Error('Agent session identifiers are incomplete');sessions.set(s.agentSessionId,s)}
   if(!d.pageInfo.hasNextPage){finished=true;break}
   const next=d.pageInfo.endCursor;if(!next||seen.has(next))throw Error('Agent occupancy pagination is incomplete');seen.add(next);cursor=next;
  }
  if(!finished)throw Error('Agent occupancy pagination limit exceeded');
  const value={updatedAt:new Date().toISOString(),fromDate:range.date,toDate:range.toDate,agents:occupancyRows([...sessions.values()],range.from,range.to)};
  cache.set(key,{time:Date.now(),value});if(cache.size>8)cache.delete(cache.keys().next().value);return value;
 })();pending.set(key,work);try{return await work}finally{pending.delete(key)}
}
