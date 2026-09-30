import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import worker, { syncArchive } from './worker/index.js';
import { createArchive } from './database.js';
const required=['WEBEX_CLIENT_ID','WEBEX_CLIENT_SECRET','WEBEX_ORG_ID','APP_SECRET'];
for(const k of required)if(!process.env[k])throw new Error(`Missing ${k}`);
const origin=new URL(process.env.APP_ORIGIN||process.env.RENDER_EXTERNAL_URL).origin;
const allowedOrigins=new Set([origin,...(process.env.RENDER_EXTERNAL_URL?[new URL(process.env.RENDER_EXTERNAL_URL).origin]:[])]);
function trustedOrigin(value){try{return value===new URL(value).origin&&allowedOrigins.has(value)}catch{return false}}
const dir=process.env.DATA_DIR||'./data';await fs.mkdir(dir,{recursive:true,mode:0o700});
const filename=k=>path.join(dir,createHash('sha256').update(k).digest('hex')+'.json');
const env={...process.env,APP_ORIGIN:origin,OWNER_EMAIL:'render-dashboard-owner',WEBEX_API_BASE:process.env.WEBEX_API_BASE||'https://api.wxcc-us1.cisco.com',TOKEN_ENCRYPTION_KEY:createHash('sha256').update(process.env.APP_SECRET).digest('hex'),BUCKET:{async get(k){try{const content=await fs.readFile(filename(k),'utf8');return{json:async()=>JSON.parse(content)}}catch(e){if(e.code==='ENOENT')return null;throw e}},async put(k,v){const target=filename(k),tmp=target+'.'+randomBytes(8).toString('hex');await fs.writeFile(tmp,v,{mode:0o600});await fs.rename(tmp,target)},async delete(k){await fs.rm(filename(k),{force:true})}}};
async function initializeArchive(){
 if(!process.env.DATABASE_URL||env.ARCHIVE)return;
 env.ARCHIVE=await createArchive(process.env.DATABASE_URL,env.WEBEX_ORG_ID);
 const diskBucket=env.BUCKET;
 env.BUCKET={
  async get(k){let v=await env.ARCHIVE.get(k);if(v===null){const old=await diskBucket.get(k);if(old){v=JSON.stringify(await old.json());await env.ARCHIVE.put(k,v)}}return v===null?null:{json:async()=>JSON.parse(v)}},
  async put(k,v){await env.ARCHIVE.put(k,v)},
  async delete(k){await env.ARCHIVE.delete(k);await diskBucket.delete(k)}
 };
 for(const k of ['webex/tokens','webex/config','webex/reporting-check'])await env.BUCKET.get(k);
 console.log('OUCU database connected');
}
try{await initializeArchive()}catch(e){console.error('OUCU database unavailable:',e.code||e.message)}
let archiveBusy=false;
async function collectArchive(){
 if(!process.env.DATABASE_URL||archiveBusy)return;archiveBusy=true;
 try{await initializeArchive();await syncArchive(env);console.log('OUCU archive sync completed')}catch(e){console.error('OUCU archive sync failed:',e.message)}finally{archiveBusy=false}
}
if(process.env.DATABASE_URL){setTimeout(collectArchive,10000).unref();setInterval(collectArchive,300000).unref()}
function signed(value){const body=Buffer.from(JSON.stringify(value)).toString('base64url');return body+'.'+createHmac('sha256',process.env.APP_SECRET).update(body).digest('base64url')}
function verified(value){try{const [body,signature,...extra]=value.split('.');if(extra.length||!signature)return null;const expected=createHmac('sha256',process.env.APP_SECRET).update(body).digest();const got=Buffer.from(signature,'base64url');if(got.length!==expected.length||!timingSafeEqual(got,expected))return null;const result=JSON.parse(Buffer.from(body,'base64url'));return result.exp>Date.now()?result:null}catch{return null}}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split(/=(.*)/s)).filter(x=>x.length>=2).map(x=>[x[0],x[1]]))}
function orgUUID(id){if(id===process.env.WEBEX_ORG_ID)return id;try{const decoded=Buffer.from(id,'base64').toString();return decoded.startsWith('ciscospark://')&&decoded.includes('/ORGANIZATION/')?decoded.split('/').at(-1):null}catch{return null}}
function send(res,status,body,headers={}){res.writeHead(status,{'Cache-Control':'no-store','Referrer-Policy':'same-origin',...headers});res.end(body)}
function cookieValue(name,value,age){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`}
const adminAttempts=new Map();
function adminEnabled(){return typeof env.ADMIN_ACCESS_PASSWORD==='string'&&env.ADMIN_ACCESS_PASSWORD.length>=12}
function adminPage(csrf,error=''){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OUCU | Admin access</title></head><body style="margin:0;background:#f2f7f8;font:16px/1.5 Segoe UI,Arial;color:#16383d"><main style="max-width:440px;margin:10vh auto;padding:36px;background:white;border:1px solid #deeaec;border-radius:12px"><img src="/logo.png" alt="OUCU Financial" style="width:180px"><h1>Administrator access</h1><p>Sign in with the administrator password configured in Render.</p><p style="color:#a13727">${error}</p><form method="post" action="/admin/login"><input type="hidden" name="csrf" value="${csrf}"><label for="password">Admin password</label><input id="password" name="password" type="password" required autocomplete="current-password" maxlength="512" style="box-sizing:border-box;width:100%;padding:12px;margin:8px 0 18px;font:inherit;border:1px solid #b6cdd1;border-radius:6px"><button style="background:#0b8295;color:white;border:0;border-radius:6px;padding:12px 18px;font:inherit;cursor:pointer">Sign in as administrator</button></form><p><a href="/login" style="color:#0b8295">Sign in with Webex</a></p></main></body></html>`}
function loginPage(){return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OUCU | Sign in</title></head><body style="margin:0;background:#f2f7f8;font:16px/1.5 Segoe UI,Arial;color:#16383d"><main style="max-width:440px;margin:12vh auto;padding:40px;background:white;border:1px solid #deeaec;border-radius:12px;text-align:center"><img src="/logo.png" alt="OUCU Financial" style="width:210px"><h1>Contact Center</h1><p>Sign in with your OUCU Webex account.</p><a href="/auth/webex/start" style="display:block;padding:13px;background:#0b8295;color:white;text-decoration:none;border-radius:6px;margin-top:24px">Sign in with Webex</a><p style="font-size:13px;color:#60777b">Access is restricted to OUCU organization members.</p></main></body></html>`}
const server=http.createServer(async(req,res)=>{try{
 if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"status":"ok"}');return}
 const url=new URL(req.url,origin),pathName=url.pathname;
 if(pathName==='/logo.png'){const response=await worker.fetch(new Request(url),env);send(res,response.status,Buffer.from(await response.arrayBuffer()),{'Content-Type':'image/png'});return}
 if(pathName==='/login'){send(res,200,loginPage(),{'Content-Type':'text/html;charset=utf-8'});return}
 if(pathName==='/admin'&&req.method==='GET'){
  if(!adminEnabled()){send(res,503,'Admin access is disabled. Set ADMIN_ACCESS_PASSWORD in Render to a password of at least 12 characters.');return}
  const state=signed({nonce:randomBytes(32).toString('hex'),exp:Date.now()+600000});send(res,200,adminPage(state),{'Content-Type':'text/html;charset=utf-8','Set-Cookie':cookieValue('oucu_admin_state',state,600)});return
 }
 if(pathName==='/admin/login'&&req.method==='POST'){
  if(!adminEnabled()){send(res,503,'Admin access is disabled.');return}
  if(!trustedOrigin(req.headers.origin)){send(res,403,'Invalid request origin.');return}
  const client=req.socket.remoteAddress||'unknown';const now=Date.now();for(const [k,v]of adminAttempts)if(v.until<now)adminAttempts.delete(k);const attempt=adminAttempts.get(client)||{count:0,until:now+900000};if(attempt.count>=5){send(res,429,'Too many admin login attempts. Try again in 15 minutes.',{'Retry-After':String(Math.ceil((attempt.until-now)/1000))});return}
  const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>2048){send(res,413,'Request too large.');return}parts.push(part)}const form=new URLSearchParams(Buffer.concat(parts).toString());const csrf=form.get('csrf');if(!csrf||csrf!==cookies(req).oucu_admin_state||!verified(csrf)){send(res,403,'Login expired or invalid. Return to /admin and try again.');return}
  const received=createHash('sha256').update(form.get('password')||'').digest();const expected=createHash('sha256').update(env.ADMIN_ACCESS_PASSWORD).digest();if(!timingSafeEqual(received,expected)){attempt.count++;adminAttempts.set(client,attempt);send(res,401,adminPage(csrf,'Incorrect admin password.'),{'Content-Type':'text/html;charset=utf-8'});return}
  adminAttempts.delete(client);const session=signed({id:'local-administrator',email:'local-administrator',admin:true,orgId:env.WEBEX_ORG_ID,exp:now+3600000});send(res,303,'',{Location:'/','Set-Cookie':[cookieValue('oucu_session',session,3600),cookieValue('oucu_admin_state','',0)]});return
 }
 if(pathName==='/auth/webex/start'){
  const nonce=randomBytes(32).toString('hex');const state=signed({nonce,exp:Date.now()+600000});const dest=new URL('https://webexapis.com/v1/authorize');dest.search=new URLSearchParams({client_id:env.WEBEX_CLIENT_ID,response_type:'code',redirect_uri:origin+'/auth/webex/callback',scope:'spark:people_read',state}).toString();send(res,303,'',{Location:dest.toString(),'Set-Cookie':cookieValue('oucu_login_state',state,600)});return
 }
 if(pathName==='/auth/webex/callback'){
  const state=url.searchParams.get('state');if(!state||cookies(req).oucu_login_state!==state||!verified(state)){send(res,400,'Webex sign-in expired or invalid. Return to /login.');return}
  if(url.searchParams.has('error')||!url.searchParams.get('code')){send(res,400,'Webex sign-in was not completed. Return to /login.');return}
  const tokenResponse=await fetch('https://webexapis.com/v1/access_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:env.WEBEX_CLIENT_ID,client_secret:env.WEBEX_CLIENT_SECRET,code:url.searchParams.get('code'),redirect_uri:origin+'/auth/webex/callback'}),signal:AbortSignal.timeout(20000)});
  if(!tokenResponse.ok){send(res,502,'Webex sign-in failed. Check the Client Secret and SSO redirect URI.');return}
  const token=await tokenResponse.json();const profileResponse=await fetch('https://webexapis.com/v1/people/me',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(20000)});
  if(!profileResponse.ok){send(res,502,'Webex identity could not be verified. Add spark:people_read to the Integration scopes.');return}
  const profile=await profileResponse.json();if(orgUUID(profile.orgId)!==env.WEBEX_ORG_ID){send(res,403,'Access denied. Sign in using your account inside OUCU’s organization.',{'Set-Cookie':cookieValue('oucu_session','',0)});return}
  const session=signed({id:profile.id,email:profile.emails?.[0]||'',orgId:env.WEBEX_ORG_ID,exp:Date.now()+8*3600000});send(res,303,'',{Location:'/','Set-Cookie':[cookieValue('oucu_session',session,28800),cookieValue('oucu_login_state','',0)]});return
 }
 const session=verified(cookies(req).oucu_session||'');if(!session||session.orgId!==env.WEBEX_ORG_ID){send(res,303,'',{Location:'/login'});return}
 if(pathName==='/logout'&&req.method==='POST'){if(!trustedOrigin(req.headers.origin)){send(res,403,'Invalid origin');return}send(res,303,'',{Location:'/login','Set-Cookie':cookieValue('oucu_session','',0)});return}
 const admins=(env.WEBEX_ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);const isAdmin=session.admin===true||admins.includes(session.email.toLowerCase());
 if(pathName==='/api/session'){send(res,200,JSON.stringify({email:session.email,isAdmin}),{'Content-Type':'application/json'});return}
 if(pathName.startsWith('/settings/')||pathName.startsWith('/oauth/')||pathName==='/api/webex/check'){if(!isAdmin){send(res,403,'Only a configured dashboard administrator can manage reporting authorization. Set WEBEX_ADMIN_EMAILS in Render.');return}}
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413);res.end('Request too large');return}chunks.push(chunk)}
 const headers=new Headers();for(const [k,v]of Object.entries(req.headers)){if(v&&!['host','authorization','oai-authenticated-user-id','oai-authenticated-user-email','content-length'].includes(k.toLowerCase()))headers.set(k,Array.isArray(v)?v.join(','):v)}headers.set('oai-authenticated-user-email',isAdmin?env.OWNER_EMAIL:'oucu-viewer');if(trustedOrigin(headers.get('origin')))headers.set('origin',origin);
 const request=new Request(new URL(req.url,origin),{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});const response=await worker.fetch(request,env);const out=Object.fromEntries(response.headers);if(response.headers.getSetCookie().length)out['set-cookie']=response.headers.getSetCookie();out['X-Content-Type-Options']='nosniff';out['Referrer-Policy']='same-origin';res.writeHead(response.status,out);res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){console.error('Request failed',e.message);res.writeHead(500,{'Content-Type':'text/plain'});res.end('Service unavailable. Check the Render logs.')}});
server.listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>console.log('OUCU dashboard running'));
