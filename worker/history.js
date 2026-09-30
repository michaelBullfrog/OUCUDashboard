import { easternStart, summarize, estimateFcr } from './reporting.js';
import { allCalls } from './call-metadata.js';
export async function historicalReport(env,getToken,date){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date());
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||date>today)throw Error('Choose a valid date no later than today.');
 const start=easternStart(Date.parse(date+'T12:00:00Z')),end=easternStart(start+36*3600000)-1;
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
 const calls=await readDay(date),report=summarize(calls,end,start,start);
 report.date=date;report.historical=true;report.archivedOnly=archivedOnly;report.updatedAt=new Date().toISOString();
 report.fcr=null;for(const q of report.queues)q.fcr=null;
 if(!archivedOnly){
  try{
   const nextDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(end+1));
   const next=await readDay(nextDate);
   if(!archivedOnly){const tasks=[...calls,...next];report.fcr=estimateFcr(tasks,Date.now(),start,null,end);for(const q of report.queues)q.fcr=estimateFcr(tasks,Date.now(),start,q.id,end);}
  }catch{}
 }
 // Historical records describe outcomes, not a current queue or agent snapshot.
 report.queuedContacts=null;for(const q of report.queues)q.queuedContacts=null;
 return {report,unqueued:{updatedAt:report.updatedAt,calls:calls.filter(t=>String(t.direction).toLowerCase()==='inbound'&&!t.lastQueue?.id)}};
}
