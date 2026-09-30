import { easternStart } from './reporting.js';
let cache,pending;
async function query(env,token,from,to,cursor='NA',id=null,after=null){
 const activity='activities(first: 100'+(after?', after: '+JSON.stringify(after):'')+') { totalCount nodes { id activityName activityType eventName createdTime endedTime isActive } pageInfo { hasNextPage endCursor } }';
 const selection=id?'id '+activity:'id channelType direction createdTime endedTime origin destination isActive isContactHandled queueCount terminationType terminationReason ivrScriptName flowActivityName flowActivitySequence lastEntryPoint { id name } lastQueue { id name } '+activity;
 const q='query($from: Long!, $to: Long!) { taskDetails(from: $from, to: $to, '+(id?'filter: {id: {equals: '+JSON.stringify(id)+'}}, ':'')+'pagination: {cursor: '+JSON.stringify(cursor)+'}) { tasks { '+selection+' } pageInfo { hasNextPage endCursor } } }';
 const r=await fetch(env.WEBEX_API_BASE+'/search?orgId='+encodeURIComponent(env.WEBEX_ORG_ID),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:q,variables:{from,to}}),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Call metadata request returned HTTP '+r.status);
 const v=await r.json();if(v.errors?.length)throw Error('Webex rejected the call activity query. The dashboard metrics are unaffected.');
 if(!Array.isArray(v.data?.taskDetails?.tasks))throw Error('Call metadata response is incomplete.');
 return v.data.taskDetails;
}
export function describeCall(t){
 const nodes=[...new Map((t.activities?.nodes||[]).map(n=>[n.id,n])).values()].sort((a,b)=>(a.createdTime||0)-(b.createdTime||0));
 return {...t,activities:{...t.activities,nodes},latestReportedNode:nodes.at(-1)||null,activityHistoryComplete:t.activities?.pageInfo?.hasNextPage===false&&nodes.length===(t.activities?.totalCount??nodes.length)};
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
