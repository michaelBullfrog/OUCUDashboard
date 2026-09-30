import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import worker from './worker/index.js';
const required=['APP_ORIGIN','DASHBOARD_PASSWORD','WEBEX_CLIENT_ID','WEBEX_ORG_ID','APP_SECRET'];
for(const k of required)if(!process.env[k])throw new Error(`Missing ${k}`);
const origin=new URL(process.env.APP_ORIGIN).origin;
const dir=process.env.DATA_DIR||'./data';await fs.mkdir(dir,{recursive:true,mode:0o700});
const filename=k=>path.join(dir,createHash('sha256').update(k).digest('hex')+'.json');
const env={...process.env,APP_ORIGIN:origin,OWNER_EMAIL:'render-dashboard-owner',WEBEX_API_BASE:process.env.WEBEX_API_BASE||'https://api.wxcc-us1.cisco.com',TOKEN_ENCRYPTION_KEY:createHash('sha256').update(process.env.APP_SECRET).digest('hex'),BUCKET:{async get(k){try{const content=await fs.readFile(filename(k),'utf8');return{json:async()=>JSON.parse(content)}}catch(e){if(e.code==='ENOENT')return null;throw e}},async put(k,v){const target=filename(k),tmp=target+'.'+randomBytes(8).toString('hex');await fs.writeFile(tmp,v,{mode:0o600});await fs.rename(tmp,target)},async delete(k){await fs.rm(filename(k),{force:true})}}};
function matches(a,b){const x=createHash('sha256').update(a).digest(),y=createHash('sha256').update(b).digest();return timingSafeEqual(x,y)}
function authenticated(req){const h=req.headers.authorization;if(!h?.startsWith('Basic '))return false;const decoded=Buffer.from(h.slice(6),'base64').toString();const i=decoded.indexOf(':');return i>0&&matches(decoded.slice(0,i),process.env.DASHBOARD_USER||'oucu')&&matches(decoded.slice(i+1),process.env.DASHBOARD_PASSWORD)}
const server=http.createServer(async(req,res)=>{try{
 if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"status":"ok"}');return}
 if(!authenticated(req)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="OUCU Contact Center", charset="UTF-8"','Cache-Control':'no-store'});res.end('Sign in to OUCU Contact Center');return}
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413);res.end('Request too large');return}chunks.push(chunk)}
 const headers=new Headers();for(const [k,v]of Object.entries(req.headers)){if(v&&!['host','authorization','oai-authenticated-user-id','oai-authenticated-user-email','content-length'].includes(k.toLowerCase()))headers.set(k,Array.isArray(v)?v.join(','):v)}headers.set('oai-authenticated-user-email',env.OWNER_EMAIL);
 const request=new Request(new URL(req.url,origin),{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});const response=await worker.fetch(request,env);const out=Object.fromEntries(response.headers);if(response.headers.getSetCookie().length)out['set-cookie']=response.headers.getSetCookie();out['X-Content-Type-Options']='nosniff';out['Referrer-Policy']='no-referrer';res.writeHead(response.status,out);res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){console.error('Request failed',e.message);res.writeHead(500,{'Content-Type':'text/plain'});res.end('Service unavailable. Check the Render logs.')}});
server.listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>console.log('OUCU dashboard running'));
