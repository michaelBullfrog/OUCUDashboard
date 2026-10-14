export const REPORTS=['senior','manager','agent'];
const names={senior:'Senior Management',manager:'Manager',agent:'Call Center Agents'};
const keys={senior:'SENIOR_DASHBOARD_EMAILS',manager:'MANAGER_DASHBOARD_EMAILS',agent:'AGENT_DASHBOARD_EMAILS'};
export function reportAccess(session,env){
 const email=String(session.email||'').trim().toLowerCase();
 const admins=String(env.WEBEX_ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 const isAdmin=session.admin===true||admins.includes(email);
 const reports=REPORTS.filter(r=>isAdmin||String(env[keys[r]]||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(email));
 return {isAdmin,reports};
}
export function reportRoute(path){
 const m=path.match(/^\/reports\/(senior|manager|agent)\/?$/);if(m)return {report:m[1],page:true};
 const api=path.match(/^\/api\/reports\/(senior|manager|agent)\/(dashboard|insights|transfer-nodes|agents|waiting|agent-history)$/);
 if(api)return {report:api[1],endpoint:api[2]};
 return null;
}
export function endpointAllowed(report,endpoint){
 return ({senior:['dashboard','insights'],manager:['dashboard','insights','transfer-nodes'],agent:['dashboard','insights','transfer-nodes','agents','waiting','agent-history']})[report]?.includes(endpoint)===true;
}
export function sanitizeReport(report,endpoint,data){
 if(report==='senior'&&endpoint==='dashboard'){
  const {offered,abandoned,abandonRate,queueTime,from,updatedAt,recordCount,historical,archivedOnly,insights}=data;
  return {offered,abandoned,abandonRate,queueTime,from,updatedAt,recordCount,historical,archivedOnly,queues:[],hourly:[],...(insights?{insights:sanitizeReport(report,'insights',insights)}:{})};
 }
 if(endpoint==='insights'||endpoint==='dashboard'){
  const result={...data};
  if(report==='senior'){delete result.heat;delete result.queues}
  if(report==='agent'&&endpoint==='insights'){result.daily=[];result.weekly=[];result.monthly=[];result.heat=[]}
  if(report==='agent'&&result.insights)result.insights=sanitizeReport(report,'insights',result.insights);
  return result;
 }
 return data;
}
export function reportLabel(report){return names[report]}
