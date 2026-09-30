import { easternStart, summarize, estimateFcr } from './reporting.js';
import { allCalls } from './call-metadata.js';
export async function historicalReport(env,getToken,date,toDate=date){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date());
 for(const day of [date,toDate])if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T12:00:00Z'))||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day||day>today)throw Error('Choose a valid date no later than today.');
 if(date>toDate)throw Error('From date must be on or before To date.');
 const span=Math.round((Date.parse(toDate+'T12:00:00Z')-Date.parse(date+'T12:00:00Z'))/86400000)+1;
 if(span>31)throw Error('Choose a range of up to 31 days.');
 const start=easternStart(Date.parse(date+'T12:00:00Z')),lastStart=easternStart(Date.parse(toDate+'T12:00:00Z')),end=Math.min(Date.now(),easternStart(lastStart+36*3600000)-1);
 let archivedOnly=false;
 async function readDay(day){
  let live;
  try{live=await allCalls(env,getToken,day)}catch(e){
   if(!env.ARCHIVE)throw e;const calls=await env.ARCHIVE.readCalls(day);if(!calls.length)throw e;
   archivedOnly=true;return calls;
  }
  if(!env.ARCHIVE)return live.calls;
  await env.ARCHIVE.saveCalls(live);
  return [...new Map([...(await env.ARCHIVE.readCalls(day)),...live.calls].map(t=>[t.id,t])).values()];
 }
 const records=new Map();
 for(let i=0;i<span;i++){const day=new Date(Date.parse(date+'T12:00:00Z')+i*86400000).toISOString().slice(0,10);for(const t of await readDay(day))records.set(t.id,t)}
 const calls=[...records.values()],report=summarize(calls,end,start,start);
 report.date=date;report.fromDate=date;report.toDate=toDate;report.historical=true;report.archivedOnly=archivedOnly;report.updatedAt=new Date().toISOString();
 report.fcr=null;for(const q of report.queues)q.fcr=null;
 if(!archivedOnly){
  try{
   const nextDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(easternStart(lastStart+36*3600000)));
   const next=nextDate<=today?await readDay(nextDate):[];
   if(!archivedOnly){const tasks=[...calls,...next];report.fcr=estimateFcr(tasks,Date.now(),start,null,end);for(const q of report.queues)q.fcr=estimateFcr(tasks,Date.now(),start,q.id,end);}
  }catch{}
 }
 // Historical records describe outcomes, not a current queue or agent snapshot.
 report.queuedContacts=null;for(const q of report.queues)q.queuedContacts=null;
 return {report,unqueued:{updatedAt:report.updatedAt,calls:calls.filter(t=>String(t.direction).toLowerCase()==='inbound'&&!t.lastQueue?.id)}};
}
