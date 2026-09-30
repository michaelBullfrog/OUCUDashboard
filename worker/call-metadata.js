import { easternStart } from './reporting.js';
let cache,pending;
async function query(env,token,from,to,cursor='NA',id=null,after=null){
 const activity='activities(first: 100'+(after?', after: '+JSON.stringify(after):'')+') { totalCount nodes { id activityName activityType eventName createdTime endedTime isActive } pageInfo { hasNextPage endCursor } }';
 const selection=id?'id '+activity:'id channelType direction createdTime endedTime origin destination isActive status isContactHandled contactHandleType queueCount terminationType terminationReason lastWrapUpCodeId connectedDuration holdDuration wrapupDuration queueDuration ivrScriptName flowActivityName flowActivitySequence lastEntryPoint { id name } lastQueue { id name } '+activity;
 const q='query($from: Long!, $to: Long!) { taskDetails(from: $from, to: $to, '+(id?'filter: {id: {equals: '+JSON.stringify(id)+'}}, ':'')+'pagination: {cursor: '+JSON.stringify(cursor)+'}) { tasks { '+selection+' } pageInfo { hasNextPage endCursor } } }';
 const r=await fetch(env.WEBEX_API_BASE+'/search?orgId='+encodeURIComponent(env.WEBEX_ORG_ID),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:q,variables:{from,to}}),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Call metadata request returned HTTP '+r.status);
 const v=await r.json();if(v.errors?.length)throw Error('Webex rejected the call activity query. The dashboard metrics are unaffected.');
 if(!Array.isArray(v.data?.taskDetails?.tasks))throw Error('Call metadata response is incomplete.');
 return v.data.taskDetails;
}
export function describeCall(t){
 const nodes=[...new Map((t.activities?.nodes||[]).map(n=>[n.id,n])).values()].sort((a,b)=>(a.createdTime||0)-(b.createdTime||0));
 return {...t,activities:{...t.activities,nodes},latestReportedEvent:nodes.at(-1)||null,latestReportedNode:nodes.filter(n=>n.activityName&&String(n.activityName).trim()).at(-1)||null,activityHistoryComplete:t.activities?.pageInfo?.hasNextPage===false&&nodes.length===(t.activities?.totalCount??nodes.length)};
}
export async function unqueuedCalls(env,getToken){
 if(cache&&Date.now()-cache.time<60000)return cache.value;
 if(pending)return pending;
 pending=(async()=>{const token=await getToken();if(!token)throw Error('Connect Webex first.');const to=Date.now(),from=easternStart(to),calls=new Map(),seen=new Set();let cursor='NA',finished=false;
 for(let page=0;page<1000;page++){const r=await query(env,token,from,to,cursor);for(const t of r.tasks){if(t.createdTime>=from&&String(t.channelType).toLowerCase()==='telephony'&&String(t.direction).toLowerCase()==='inbound'&&!t.lastQueue?.id)calls.set(t.id,t)}if(r.pageInfo?.hasNextPage===false){finished=true;break}const next=r.pageInfo?.endCursor;if(!next||seen.has(next))throw Error('Call pagination is incomplete.');seen.add(next);cursor=next}
 if(!finished)throw Error('Call pagination limit exceeded.');
 for(const t of calls.values()){const seenActivities=new Set();for(let p=0;t.activities?.pageInfo?.hasNextPage&&p<100;p++){const next=t.activities.pageInfo.endCursor;if(!next||seenActivities.has(next))break;seenActivities.add(next);const r=await query(env,token,from,to,'NA',t.id,next),more=r.tasks.find(x=>x.id===t.id)?.activities;if(!more)break;t.activities={...more,nodes:[...t.activities.nodes,...more.nodes]}}}
 const value={from:new Date(from).toISOString(),updatedAt:new Date(to).toISOString(),calls:[...calls.values()].map(describeCall).sort((a,b)=>b.createdTime-a.createdTime)};cache={time:Date.now(),value};return value;
 })();try{return await pending}finally{pending=null}
}

export function transferNodeCounts(data){
 const counts=new Map();let total=0,unidentified=0;
 for(const t of data.calls){
  if(String(t.terminationType).toLowerCase()!=='transfertodn')continue;
  total++;
  const transfers=(t.activities?.nodes||[]).filter(n=>String(n.activityType||'').toLowerCase().replace(/[^a-z]/g,'')==='blindtransfer').sort((a,b)=>(a.createdTime||0)-(b.createdTime||0));
  const name=t.activityHistoryComplete?(transfers.at(-1)?.activityName||t.flowActivityName):null;
  if(!name||!String(name).trim()){unidentified++;continue}
  const node=String(name).trim();counts.set(node,(counts.get(node)||0)+1);
 }
 return {updatedAt:data.updatedAt,total,unidentified,leftBeforeQueue:nodeOutcomeCounts(data).totals.leftBeforeQueue,nodes:[...counts].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name))};
}

export function nodeOutcomeCounts(data){
 const groups=new Map();
 for(const t of data.calls){
  const type=String(t.terminationType||'').toLowerCase();
  const transfers=(t.activities?.nodes||[]).filter(n=>String(n.activityType||'').toLowerCase().replace(/[^a-z]/g,'')==='blindtransfer').sort((a,b)=>(a.createdTime||0)-(b.createdTime||0));
  const reported=t.activityHistoryComplete?(type==='transfertodn'?transfers.at(-1)?.activityName||t.flowActivityName:t.latestReportedNode?.activityName||t.flowActivityName):null;
  const name=String(reported||'Node unavailable').trim()||'Node unavailable';
  if(!groups.has(name))groups.set(name,{name,contacts:0,handled:0,transferred:0,leftBeforeQueue:0,inIvr:0,other:0});
  const g=groups.get(name);g.contacts++;
  if(t.isActive===true){if(t.queueCount===0)g.inIvr++;else g.other++;continue}
  if(t.isContactHandled===true)g.handled++;
  if(type==='transfertodn')g.transferred++;
  else if(t.isActive===false&&t.queueCount===0&&String(t.terminationReason||'').trim().toLowerCase()==='customer left')g.leftBeforeQueue++;
  else g.other++;
 }
 const totals={transferred:0,leftBeforeQueue:0,inIvr:0,other:0};for(const g of groups.values())for(const k of Object.keys(totals))totals[k]+=g[k];
 return {updatedAt:data.updatedAt,total:data.calls.length,totals,rows:[...groups.values()].sort((a,b)=>b.contacts-a.contacts||a.name.localeCompare(b.name))};
}

let remainderCache,remainderPending;
export async function queueRemainderCalls(env,getToken){
 if(remainderCache&&Date.now()-remainderCache.time<60000)return remainderCache.value;
 if(remainderPending)return remainderPending;
 remainderPending=(async()=>{const token=await getToken();if(!token)throw Error('Connect Webex first.');const to=Date.now(),from=easternStart(to),calls=new Map(),seen=new Set();let cursor='NA',finished=false;
 for(let page=0;page<1000;page++){const r=await query(env,token,from,to,cursor);for(const t of r.tasks){if(t.createdTime>=from&&String(t.channelType).toLowerCase()==='telephony'&&String(t.direction).toLowerCase()==='inbound'&&t.lastQueue?.id&&!((t.isActive===false&&t.isContactHandled===true)||(t.isActive===false&&String(t.contactHandleType).toLowerCase()==='abandoned')))calls.set(t.id,t)}if(r.pageInfo?.hasNextPage===false){finished=true;break}const next=r.pageInfo?.endCursor;if(!next||seen.has(next))throw Error('Call pagination is incomplete.');seen.add(next);cursor=next}
 if(!finished)throw Error('Call pagination limit exceeded.');
 for(const t of calls.values()){const seenActivities=new Set();for(let p=0;t.activities?.pageInfo?.hasNextPage&&p<100;p++){const next=t.activities.pageInfo.endCursor;if(!next||seenActivities.has(next))break;seenActivities.add(next);const r=await query(env,token,from,to,'NA',t.id,next),more=r.tasks.find(x=>x.id===t.id)?.activities;if(!more)break;t.activities={...more,nodes:[...t.activities.nodes,...more.nodes]}}}
 const value={from:new Date(from).toISOString(),updatedAt:new Date(to).toISOString(),calls:[...calls.values()].map(describeCall).sort((a,b)=>b.createdTime-a.createdTime)};remainderCache={time:Date.now(),value};return value;
 })();try{return await remainderPending}finally{remainderPending=null}
}

const allCache=new Map(),allPending=new Map();
export function searchCalls(calls,term){
 const q=String(term||'').trim().toLowerCase(),digits=q.replace(/\D/g,'');
 if(!q)return calls;
 return calls.filter(t=>{
  const fields=[t.id,t.origin,t.destination,t.status,t.terminationType,t.terminationReason,t.lastQueue?.name,t.lastEntryPoint?.name,t.ivrScriptName,t.flowActivityName,...(t.activities?.nodes||[]).flatMap(n=>[n.activityName,n.activityType,n.eventName])];
  return fields.some(v=>String(v||'').toLowerCase().includes(q))||(digits.length>=4&&/^[+\d\s().-]+$/.test(q)&&[t.origin,t.destination].some(v=>String(v||'').replace(/\D/g,'').includes(digits)));
 });
}
export async function allCalls(env,getToken,date=null){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date());
 date=date||today;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||date>today)throw Error('Choose a valid date no later than today.');
 if(allCache.has(date)&&Date.now()-allCache.get(date).time<60000)return allCache.get(date).value;
 if(allPending.has(date))return allPending.get(date);
 const work=(async()=>{
  const token=await getToken();if(!token)throw Error('Connect Webex first.');
  const from=easternStart(Date.parse(date+'T12:00:00Z')),to=Math.min(Date.now(),easternStart(from+36*3600000)-1),calls=new Map(),seen=new Set();let cursor='NA',finished=false;
  for(let p=0;p<1000;p++){
   const r=await query(env,token,from,to,cursor);
   for(const t of r.tasks)if(t.createdTime>=from&&t.createdTime<=to&&String(t.channelType).toLowerCase()==='telephony')calls.set(t.id,t);
   if(r.pageInfo?.hasNextPage===false){finished=true;break}
   const next=r.pageInfo?.endCursor;if(!next||seen.has(next))throw Error('Call pagination is incomplete.');seen.add(next);cursor=next;
  }
  if(!finished)throw Error('Call pagination limit exceeded.');
  for(const t of calls.values()){const seenActivities=new Set();for(let p=0;t.activities?.pageInfo?.hasNextPage&&p<100;p++){const next=t.activities.pageInfo.endCursor;if(!next||seenActivities.has(next))break;seenActivities.add(next);const r=await query(env,token,from,to,'NA',t.id,next),more=r.tasks.find(x=>x.id===t.id)?.activities;if(!more)break;t.activities={...more,nodes:[...t.activities.nodes,...more.nodes]}}}
  const value={date,from:new Date(from).toISOString(),updatedAt:new Date().toISOString(),calls:[...calls.values()].map(describeCall).sort((a,b)=>b.createdTime-a.createdTime)};
  if(allCache.size>=3)allCache.delete(allCache.keys().next().value);allCache.set(date,{time:Date.now(),value});return value;
 })();allPending.set(date,work);try{return await work}finally{allPending.delete(date)}
}

let waitingCache,waitingPending;
export function waitingContacts(tasks,now){
 const calls=tasks.filter(t=>t.isActive===true&&t.lastQueue?.id&&['queued','parked'].includes(String(t.status||'').toLowerCase())&&String(t.channelType).toLowerCase()==='telephony')
 .map(t=>({id:t.id,number:t.origin||null,cnam:null,queueId:t.lastQueue.id,queue:t.lastQueue.name||'Queue',status:t.status,arrivedAt:Number.isFinite(t.createdTime)?new Date(t.createdTime).toISOString():null})).sort((a,b)=>String(a.arrivedAt).localeCompare(String(b.arrivedAt)));
 return {updatedAt:new Date(now).toISOString(),count:calls.length,calls};
}
export async function waitingData(env,getToken){
 if(waitingCache&&Date.now()-waitingCache.time<60000)return waitingCache.value;
 if(waitingPending)return waitingPending;
 waitingPending=(async()=>{
  const token=await getToken();if(!token)throw Error('Connect Webex first');
  const now=Date.now(),tasks=new Map(),seen=new Set();let cursor='NA';
  for(let p=0;p<1000;p++){
   const query='query($from: Long!, $to: Long!) { taskDetails(from:$from,to:$to,filter:{isActive:{equals:true}},pagination:{cursor:'+JSON.stringify(cursor)+'}) { tasks { id channelType createdTime origin isActive status lastQueue { id name } } pageInfo { hasNextPage endCursor } } }';
   const r=await fetch(env.WEBEX_API_BASE+'/search?orgId='+encodeURIComponent(env.WEBEX_ORG_ID),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{from:easternStart(now-7*86400000),to:now}}),signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('Queue reporting HTTP '+r.status);
   const v=await r.json(),d=v.data?.taskDetails;if(v.errors?.length||!Array.isArray(d?.tasks)||typeof d.pageInfo?.hasNextPage!=='boolean')throw Error('Queue reporting response unavailable');
   for(const t of d.tasks)tasks.set(t.id,t);
   if(!d.pageInfo.hasNextPage){const value=waitingContacts([...tasks.values()],now);waitingCache={time:Date.now(),value};return value}
   const next=d.pageInfo.endCursor;if(!next||seen.has(next))throw Error('Queue pagination incomplete');seen.add(next);cursor=next;
  }
  throw Error('Queue pagination limit exceeded');
 })();try{return await waitingPending}finally{waitingPending=null}
}
