let cached, pending, retryAt=0;
export function easternStart(now=Date.now()) {
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 let midnight=Date.parse(`${date}T00:00:00Z`);
 for(let i=0;i<3;i++){
  const offset=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'longOffset'}).formatToParts(new Date(midnight)).find(p=>p.type==='timeZoneName').value.replace('GMT','')||'+00:00';
  midnight=Date.parse(`${date}T00:00:00${offset}`);
 }
 return midnight;
}
export function summarize(tasks, now, start) {
 const voice=tasks.filter(t=>Number.isFinite(t.createdTime)&&t.createdTime>=start&&t.createdTime<=now&&String(t.channelType).toLowerCase()==='telephony'&&String(t.direction).toLowerCase()==='inbound');
 const groups=new Map();
 function metrics(rows){const completed=rows.filter(t=>t.isActive===false),handled=completed.filter(t=>t.isContactHandled===true),abandoned=completed.filter(t=>String(t.contactHandleType).toLowerCase()==='abandoned');
 const average=field=>handled.length&&handled.every(t=>Number.isFinite(t[field]))?handled.reduce((s,t)=>s+t[field],0)/handled.length:null;
 const talk=average('connectedDuration'),hold=average('holdDuration'),wrap=average('wrapupDuration');
 return {offered:rows.length,handled:handled.length,abandoned:abandoned.length,abandonRate:completed.length?100*abandoned.length/completed.length:null,queueTime:average('queueDuration'),talk,hold,wrap,handleTime:talk!==null&&wrap!==null?talk+wrap:null};}
 for(const t of voice){const id=t.lastQueue?.id||'unassigned';if(!groups.has(id))groups.set(id,{id,name:t.lastQueue?.name||'No reported queue',tasks:[]});groups.get(id).tasks.push(t)}
 const hourly=Array.from({length:24},(_,hour)=>({hour,offered:0,handled:0,abandoned:0}));
 for(const t of voice){const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(new Date(t.createdTime)));if(!hourly[hour])continue;hourly[hour].offered++;if(t.isActive===false&&t.isContactHandled===true)hourly[hour].handled++;if(t.isActive===false&&String(t.contactHandleType).toLowerCase()==='abandoned')hourly[hour].abandoned++;}
 return {updatedAt:new Date(now).toISOString(),from:new Date(start).toISOString(),mode:'reporting',...metrics(voice),queues:[...groups.values()].map(g=>({id:g.id,name:g.name,...metrics(g.tasks)})),hourly,recordCount:tasks.length};
}
export async function dashboardData(env,getToken){
 if(cached&&Date.now()-cached.time<60000)return cached.value;
 if(Date.now()<retryAt)throw new Error('Webex reporting is rate limited. Please retry shortly.');
 if(pending)return pending;
 pending=(async()=>{const token=await getToken();if(!token)throw new Error('An administrator must connect Webex reporting first.');const now=Date.now(),start=easternStart(now),tasks=new Map(),seen=new Set();let cursor='NA';
 for(let page=0;page<1000;page++){
 const query='query($from: Long!, $to: Long!) { taskDetails(from: $from, to: $to, pagination: {cursor: '+JSON.stringify(cursor)+'}) { tasks { id channelType direction createdTime isActive isContactHandled contactHandleType connectedDuration holdDuration wrapupDuration queueDuration lastQueue { id name } } pageInfo { hasNextPage endCursor } } }';
 const r=await fetch(`${env.WEBEX_API_BASE}/search?orgId=${encodeURIComponent(env.WEBEX_ORG_ID)}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{from:start,to:now}}),signal:AbortSignal.timeout(20000)});
 if(r.status===429){const wait=Number(r.headers.get('Retry-After'));retryAt=Date.now()+Math.max(60,Number.isFinite(wait)?wait:60)*1000;throw new Error('Webex reporting is rate limited. Please retry shortly.');}
 if(!r.ok)throw new Error(`Webex reporting returned HTTP ${r.status}. An administrator can check the connection.`);
 const v=await r.json();if(v.errors?.length)throw new Error('Webex rejected the reporting fields. An administrator needs to review the reporting schema.');const result=v.data?.taskDetails;if(!result||!Array.isArray(result.tasks)||typeof result.pageInfo?.hasNextPage!=='boolean')throw new Error('Webex returned an incomplete reporting response.');
 for(const t of result.tasks){if(!t.id)throw new Error('Webex returned a record without an ID.');tasks.set(t.id,t)}
 if(!result.pageInfo.hasNextPage){const value=summarize([...tasks.values()],now,start);cached={time:Date.now(),value};return value;}
 const next=result.pageInfo.endCursor;if(!next||seen.has(next))throw new Error('Webex pagination did not complete. Totals are unavailable.');seen.add(next);cursor=next;
 }
 throw new Error('Webex reporting exceeded the pagination limit. Totals are unavailable.');
 })();try{return await pending}finally{pending=null}
}
