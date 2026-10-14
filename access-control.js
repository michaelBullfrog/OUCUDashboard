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
export function sanitizeReport(report,endpoint,data,session={}){
 if(report==='agent'&&endpoint==='agent-history')return personalAgentReport(data,session);
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

export function personalAgentReport(data,session){
 const email=String(session.email||'').trim().toLowerCase();
 const all=data.agents||[],matches=all.filter(a=>email&&String(a.userLoginId||'').trim().toLowerCase()===email);
 const teams=new Map();
 for(const a of all){
  const name=a.team||'Team not reported';if(!teams.has(name))teams.set(name,{name,complete:true,idleTime:0,callTime:0,agentCount:0});
  const t=teams.get(name);t.agentCount++;t.complete=t.complete&&a.complete===true&&a.idleTime!=null&&a.callTime!=null;t.idleTime+=a.idleTime||0;t.callTime+=a.callTime||0;
 }
 const agents=matches.length===1?matches.map(({userLoginId,...a})=>a):[];
 return {updatedAt:data.updatedAt,from:data.from,agents,personal:true,identityMatched:agents.length===1,personalMessage:agents.length?'':session.id==='local-administrator'?'Sign in with your Webex account to see your individual statistics. Backup admin access has no agent identity.':matches.length>1?'Multiple agent records match your login. Personal statistics are unavailable until the identity mapping is resolved.':'No agent activity record matches your Webex sign-in email for today. Personal statistics are unavailable.',teams:[...teams.values()].map(t=>({...t,idleTime:t.complete?t.idleTime:null,callTime:t.complete?t.callTime:null}))};
}
