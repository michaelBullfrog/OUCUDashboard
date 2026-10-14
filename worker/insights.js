const norm=v=>String(v||'').toLowerCase().replace(/[^a-z]/g,'');
const et=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(v));
export function queueEntry(t){
 const nodes=t.activities?.nodes||[];
 return nodes.some(n=>norm(n.activityType)==='queuecontact'||norm(n.eventName)==='queued')||!!t.lastQueue?.id||t.queueCount>0;
}
export function contactMetrics(rows){
 const queued=rows.filter(queueEntry);
 const left=rows.filter(t=>!queueEntry(t)&&t.isContactHandled!==true&&t.isActive===false&&String(t.terminationReason||'').trim().toLowerCase()==='customer left'&&norm(t.terminationType)!=='transfertodn');
 const abandoned=queued.filter(t=>t.isContactHandled!==true&&norm(t.terminationType)==='abandoned');
 const waits=queued.filter(t=>['connected','ended'].includes(norm(t.status)));
 const valid=waits.every(t=>Number.isFinite(t.queueDuration)&&t.queueDuration>=0);
 return {volume:rows.length,presented:queued.length,handled:rows.filter(t=>t.isContactHandled===true).length,leftBeforeQueue:left.length,leftBeforeQueueRate:rows.length?left.length/rows.length*100:null,abandoned:abandoned.length,abandonRate:queued.length?abandoned.length/queued.length*100:null,averageWait:waits.length&&valid?waits.reduce((s,t)=>s+t.queueDuration,0)/waits.length:null,waitSamples:waits.length,longestWait:queued.length&&queued.every(t=>Number.isFinite(t.queueDuration)&&t.queueDuration>=0)?Math.max(...queued.map(t=>t.queueDuration)):null};
}
export function insights(tasks,from,to){
 const rows=tasks.filter(t=>t.createdTime>=from&&t.createdTime<=to&&norm(t.channelType)==='telephony'&&norm(t.direction)==='inbound');
 const map=new Map(),heat=Array.from({length:7},()=>Array(24).fill(0));
 for(const t of rows){
  const date=et(t.createdTime);if(!map.has(date))map.set(date,[]);map.get(date).push(t);
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(new Date(t.createdTime));
  const weekday=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(parts.find(p=>p.type==='weekday').value),hour=Number(parts.find(p=>p.type==='hour').value);heat[weekday][hour]++;
 }
 const start=Date.parse(et(from)+'T12:00:00Z'),end=Date.parse(et(to)+'T12:00:00Z');
 for(let day=start;day<=end;day+=86400000){const key=new Date(day).toISOString().slice(0,10);if(!map.has(key))map.set(key,[])}
 const daily=[...map].sort(([a],[b])=>a.localeCompare(b)).map(([date,r])=>({date,...contactMetrics(r)}));
 const bucket=kind=>{const groups=new Map();for(const t of rows){const date=et(t.createdTime);let k=date.slice(0,7);if(kind==='week'){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);k=d.toISOString().slice(0,10)}if(!groups.has(k))groups.set(k,[]);groups.get(k).push(t)}return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([date,r])=>({date,...contactMetrics(r)}))};
 const queues=[...new Set(rows.map(t=>t.lastQueue?.id).filter(Boolean))].map(id=>({id,name:rows.find(t=>t.lastQueue?.id===id).lastQueue.name,...contactMetrics(rows.filter(t=>t.lastQueue?.id===id))}));
 return {...contactMetrics(rows),daily,weekly:bucket('week'),monthly:bucket('month'),heat,queues,from:et(from),to:et(to)};
}
