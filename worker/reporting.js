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

const DAY=86400000;
function callerKey(value){const raw=String(value||'').trim();if(!/^[+\d\s().-]+$/.test(raw))return null;let digits=raw.replace(/\D/g,'');if(digits.length===10)digits='1'+digits;return digits.length>=7&&digits.length<=15?digits:null}
export function estimateFcr(tasks, now, from, queueId=null){
 const inbound=tasks.filter(t=>String(t.channelType).toLowerCase()==='telephony'&&String(t.direction).toLowerCase()==='inbound');
 const byCaller=new Map();
 for(const t of inbound){const key=callerKey(t.origin);if(key){if(!byCaller.has(key))byCaller.set(key,[]);byCaller.get(key).push(t)}}
 const totals={rate:null,evaluated:0,noRepeat:0,repeated:0,pending:0,unmeasurable:0,windowHours:24,from:new Date(from).toISOString()};
 for(const t of inbound){
  if(t.createdTime<from||t.createdTime>now||t.isActive!==false||t.isContactHandled!==true||(queueId!==null&&(t.lastQueue?.id||'unassigned')!==queueId))continue;
  const key=callerKey(t.origin),wrap=String(t.lastWrapUpCodeId||'').trim();
  if(!key||!wrap||!Number.isFinite(t.endedTime)||t.endedTime<t.createdTime){totals.unmeasurable++;continue}
  if(t.endedTime+DAY>now){totals.pending++;continue}
  const callbacks=(byCaller.get(key)||[]).filter(r=>r.id!==t.id&&r.createdTime>t.endedTime&&r.createdTime<=t.endedTime+DAY);
  if(callbacks.some(r=>String(r.lastWrapUpCodeId||'').trim()===wrap)){totals.repeated++;totals.evaluated++;continue}
  if(callbacks.some(r=>r.isContactHandled===true&&!String(r.lastWrapUpCodeId||'').trim()||r.isActive!==false)){totals.unmeasurable++;continue}
  totals.noRepeat++;totals.evaluated++;
 }
 totals.rate=totals.evaluated?totals.noRepeat/totals.evaluated*100:null;
 return totals;
}

export function summarize(tasks, now, start, fcrFrom=easternStart(start-1)) {
 const voice=tasks.filter(t=>Number.isFinite(t.createdTime)&&t.createdTime>=start&&t.createdTime<=now&&String(t.channelType).toLowerCase()==='telephony'&&String(t.direction).toLowerCase()==='inbound');
 const groups=new Map();
 const unassigned=voice.filter(t=>!t.lastQueue?.id),terminationCounts={};
 for(const t of unassigned){const reason=String(t.terminationType||'Not reported');terminationCounts[reason]=(terminationCounts[reason]||0)+1}
 const queueDiagnostics={total:unassigned.length,neverQueued:unassigned.filter(t=>t.queueCount===0).length,missingQueueMetadata:unassigned.filter(t=>Number.isFinite(t.queueCount)&&t.queueCount>0).length,unknownQueueCount:unassigned.filter(t=>!Number.isFinite(t.queueCount)).length,active:unassigned.filter(t=>t.isActive===true).length,handled:unassigned.filter(t=>t.isContactHandled===true).length,terminationCounts};
 function metrics(rows){const completed=rows.filter(t=>t.isActive===false),handled=completed.filter(t=>t.isContactHandled===true),abandoned=completed.filter(t=>t.isContactHandled!==true&&String(t.contactHandleType).toLowerCase()==='abandoned');
 const queued=completed.filter(t=>t.lastQueue?.id),answeredQueued=queued.filter(t=>t.isContactHandled===true);
 const within15=answeredQueued.filter(t=>Number.isFinite(t.queueDuration)&&t.queueDuration<=15000&&t.queueDuration>=0).length;
 const serviceLevel=queued.length&&answeredQueued.every(t=>Number.isFinite(t.queueDuration)&&t.queueDuration>=0)?100*within15/queued.length:null;
 const average=field=>handled.length&&handled.every(t=>Number.isFinite(t[field]))?handled.reduce((s,t)=>s+t[field],0)/handled.length:null;
 const talk=average('connectedDuration'),hold=average('holdDuration'),wrap=average('wrapupDuration');
 return {serviceLevel,serviceLevelThresholdSeconds:15,serviceLevelEligible:queued.length,serviceLevelWithinThreshold:within15,offered:rows.length,handled:handled.length,abandoned:abandoned.length,reportedActive:rows.filter(t=>t.isActive===true).length,other:rows.length-handled.length-abandoned.length-rows.filter(t=>t.isActive===true).length,abandonRate:completed.length?100*abandoned.length/completed.length:null,queueTime:average('queueDuration'),talk,hold,wrap,handleTime:talk!==null&&wrap!==null?talk+wrap:null};}
 for(const t of tasks.filter(t=>voice.includes(t)||(t.createdTime>=fcrFrom&&t.createdTime<start&&t.isContactHandled===true&&String(t.channelType).toLowerCase()==='telephony'&&String(t.direction).toLowerCase()==='inbound'))){const id=t.lastQueue?.id||'unassigned';if(!groups.has(id))groups.set(id,{id,name:t.lastQueue?.name||'Transfers out / Not queued',tasks:[]});if(voice.includes(t))groups.get(id).tasks.push(t)}
 const hourly=Array.from({length:24},(_,hour)=>({hour,offered:0,handled:0,abandoned:0}));
 for(const t of voice){const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(new Date(t.createdTime)));if(!hourly[hour])continue;hourly[hour].offered++;if(t.isActive===false&&t.isContactHandled===true)hourly[hour].handled++;if(t.isActive===false&&String(t.contactHandleType).toLowerCase()==='abandoned')hourly[hour].abandoned++;}
 return {updatedAt:new Date(now).toISOString(),from:new Date(start).toISOString(),mode:'reporting',queueDiagnostics,...metrics(voice),fcr:estimateFcr(tasks,now,fcrFrom),queues:[...groups.values()].map(g=>({id:g.id,name:g.name,...metrics(g.tasks),fcr:estimateFcr(tasks,now,fcrFrom,g.id)})),hourly,recordCount:tasks.length};
}
export async function dashboardData(env,getToken){
 if(cached&&Date.now()-cached.time<60000)return cached.value;
 if(Date.now()<retryAt)throw new Error('Webex reporting is rate limited. Please retry shortly.');
 if(pending)return pending;
 pending=(async()=>{const token=await getToken();if(!token)throw new Error('An administrator must connect Webex reporting first.');const now=Date.now(),start=easternStart(now),fcrFrom=easternStart(start-1),tasks=new Map(),seen=new Set();let cursor='NA';
 for(let page=0;page<1000;page++){
 const query='query($from: Long!, $to: Long!) { taskDetails(from: $from, to: $to, pagination: {cursor: '+JSON.stringify(cursor)+'}) { tasks { id channelType direction createdTime endedTime origin lastWrapUpCodeId isActive isContactHandled contactHandleType queueCount terminationType connectedDuration holdDuration wrapupDuration queueDuration lastQueue { id name } } pageInfo { hasNextPage endCursor } } }';
 const r=await fetch(`${env.WEBEX_API_BASE}/search?orgId=${encodeURIComponent(env.WEBEX_ORG_ID)}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{from:fcrFrom,to:now}}),signal:AbortSignal.timeout(20000)});
 if(r.status===429){const wait=Number(r.headers.get('Retry-After'));retryAt=Date.now()+Math.max(60,Number.isFinite(wait)?wait:60)*1000;throw new Error('Webex reporting is rate limited. Please retry shortly.');}
 if(!r.ok)throw new Error(`Webex reporting returned HTTP ${r.status}. An administrator can check the connection.`);
 const v=await r.json();if(v.errors?.length)throw new Error('Webex rejected the reporting fields. An administrator needs to review the reporting schema.');const result=v.data?.taskDetails;if(!result||!Array.isArray(result.tasks)||typeof result.pageInfo?.hasNextPage!=='boolean')throw new Error('Webex returned an incomplete reporting response.');
 for(const t of result.tasks){if(!t.id)throw new Error('Webex returned a record without an ID.');tasks.set(t.id,t)}
 if(!result.pageInfo.hasNextPage){const value=summarize([...tasks.values()],now,start,fcrFrom);cached={time:Date.now(),value};return value;}
 const next=result.pageInfo.endCursor;if(!next||seen.has(next))throw new Error('Webex pagination did not complete. Totals are unavailable.');seen.add(next);cursor=next;
 }
 throw new Error('Webex reporting exceeded the pagination limit. Totals are unavailable.');
 })();try{return await pending}finally{pending=null}
}
