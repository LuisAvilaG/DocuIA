// Creates an isolated, disposable PostgreSQL container; never loads .env.local.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { hash } from 'bcryptjs';
import { SignJWT } from 'jose';
import assert from 'node:assert/strict';

const root=process.cwd();
const container=`docuia-security-${randomBytes(5).toString('hex')}`;
const password=randomBytes(24).toString('hex');
const port=3197;
const origin=`http://127.0.0.1:${port}`;
const jwtSecret=randomBytes(32).toString('hex');
const refreshSecret=randomBytes(32).toString('hex');
const logDir=path.join(root,'output/security');
fs.mkdirSync(logDir,{recursive:true});
const results=[];
let server, client, created=false;
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true}).trim();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function runNode(args,env,log) {
  const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const out=fs.createWriteStream(path.join(logDir,log));
  child.stdout.pipe(out); child.stderr.pipe(out);
  const [code]=await once(child,'exit'); out.end();
  if(code!==0) throw new Error(`${args[0]} failed; see ${log}`);
}
async function check(name,fn){ await fn(); results.push({name,pass:true}); console.log(`PASS ${name}`); }
try {
  docker('run','--rm','-d','--name',container,'--label','docuia.security-test=true','-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_USER=security','-e','POSTGRES_DB=security','-p','127.0.0.1::5432','postgres:16-alpine'); created=true;
  const hostPort=JSON.parse(docker('inspect','--format','{{json .NetworkSettings.Ports}}',container))['5432/tcp'][0].HostPort;
  const databaseUrl=`postgres://security:${password}@127.0.0.1:${hostPort}/security`;
  const env={...process.env,DATABASE_URL:databaseUrl,DATABASE_SSL:'false',NEXT_PUBLIC_APP_URL:origin,JWT_SECRET:jwtSecret,REFRESH_SECRET:refreshSecret,JWT_EXPIRES_IN:'15m',JWT_REFRESH_EXPIRES_IN:'7d',TRUSTED_PROXY_HOPS:'0',ENCRYPTION_KEY:randomBytes(32).toString('hex'),PLATFORM_ADMIN_EMAIL:'',PLATFORM_ADMIN_PASSWORD:'',RESEND_API_KEY:'',GOOGLE_API_KEY:'',GEMINI_API_KEY:'',MINIO_ACCESS_KEY:'',MINIO_SECRET_KEY:'',CRON_SECRET:randomBytes(32).toString('hex'),NEXT_TELEMETRY_DISABLED:'1'};
  for(let i=0;i<40;i++){ try{ client=new pg.Client({connectionString:databaseUrl}); await client.connect(); break; }catch{ await client?.end().catch(()=>{}); client=null; await pause(500); } }
  if(!client) throw new Error('Test database not ready');
  console.log('Isolated PostgreSQL ready; applying migrations.');
  await runNode(['scripts/migrate.mjs'],env,'integration-migrations.log');
  const dev=process.argv.includes('--dev');
  if(!dev){console.log('Building production bundle against isolated database.');await runNode(['node_modules/next/dist/bin/next','build'],{...env,NODE_ENV:'production'},'build.log');}
  server=spawn(process.execPath,['node_modules/next/dist/bin/next',dev?'dev':'start','-p',String(port),'-H','127.0.0.1'],{env:{...env,NODE_ENV:dev?'development':'production'},cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const serverLog=fs.createWriteStream(path.join(logDir,'integration-server.log')); server.stdout.pipe(serverLog);server.stderr.pipe(serverLog);
  let ready=false;
  for(let i=0;i<90;i++){ if(server.exitCode!==null) break; try{const r=await fetch(origin+'/login',{signal:AbortSignal.timeout(1000)});await r.body?.cancel();if(r.ok){ready=true;break;}}catch{} await pause(500); }
  if(!ready) throw new Error('Test server not ready; see integration-server.log');
  const orgA=randomUUID(),orgB=randomUUID(),adminId=randomUUID();
  await client.query('INSERT INTO organizations(id,name,slug,status) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',[orgA,'Security A','security-a','active',orgB,'Security B','security-b','active']);
  const userPassword='Security-test-strong-password'; const passwordHash=await hash(userPassword,4);
  const users={};
  for(const role of ['admin','operator','viewer','expense_submitter']) {
    const id=randomUUID(); users[role]=id;
    await client.query('INSERT INTO org_users(id,organization_id,email,password_hash,role) VALUES($1,$2,$3,$4,$5)',[id,orgA,`${role}@security.invalid`,passwordHash,role]);
  }
  await client.query('INSERT INTO platform_admins(id,email,password_hash) VALUES($1,$2,$3)',[adminId,'platform@security.invalid',passwordHash]);
  const req=async(route,{cookie,method='GET',body,originHeader=origin,headers={}}={})=>fetch(origin+route,{method,redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:originHeader}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const cookies=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const login=async(role)=>{const r=await req('/api/v1/auth/login',{method:'POST',body:{email:`${role}@security.invalid`,password:userPassword}});assert.equal(r.status,200,await r.text());return cookies(r);};
  const tokenCookie=async(role)=>{
    const id=randomUUID(),nonce=randomBytes(32).toString('hex');
    await client.query("INSERT INTO auth_sessions(id,user_id,user_type,organization_id,refresh_token,expires_at) VALUES($1,$2,'org_user',$3,$4,now()+interval '1 day')",[id,users[role],orgA,nonce]);
    const token=await new SignJWT({sub:users[role],type:'org_user',orgId:orgA,role,email:`${role}@security.invalid`,sessionId:id,tokenUse:'access'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('15m').sign(new TextEncoder().encode(jwtSecret));
    return {cookie:`access_token=${token}`,sessionId:id};
  };
  await check('anonymous API requests are denied',async()=>{
    for(const route of ['/api/admin/clients','/api/admin/features','/api/v1/contracts/cases','/api/v1/expenses/reports','/api/v1/workflow/status']) assert.equal((await req(route)).status,401,route);
  });
  await check('cross-origin login rejected before checking credentials',async()=>assert.equal((await req('/api/v1/auth/login',{method:'POST',originHeader:'https://evil.invalid',body:{email:'operator@security.invalid',password:userPassword}})).status,403));
  await check('login issues session-bound cookies with secure attributes',async()=>{
    const r=await req('/api/v1/auth/login',{method:'POST',body:{email:'operator@security.invalid',password:userPassword}});assert.equal(r.status,200);
    for(const c of r.headers.getSetCookie()){assert.match(c,/HttpOnly/i);if(!dev)assert.match(c,/Secure/i);assert.match(c,/SameSite=lax/i);}
  });
  await check('viewer reads documents but cannot upload',async()=>{const {cookie}=await tokenCookie('viewer');assert.equal((await req('/api/v1/workflow/status',{cookie})).status,200);assert.equal((await req('/api/v1/workflow/upload',{cookie,method:'POST'})).status,401);});
  await check('expense submitter cannot read contract data or manage settings',async()=>{const {cookie}=await tokenCookie('expense_submitter');for(const route of ['/api/v1/contracts/cases','/api/v1/settings/api-keys'])assert.equal((await req(route,{cookie})).status,401);});
  await check('cross-origin authenticated writes rejected',async()=>{const {cookie}=await tokenCookie('admin');assert.equal((await req('/api/v1/team',{cookie,method:'POST',originHeader:'https://evil.invalid',body:{email:'x@example.com'}})).status,403);});
  await check('role changes take effect on already-issued access tokens',async()=>{const {cookie}=await tokenCookie('admin');await client.query("UPDATE org_users SET role='viewer' WHERE id=$1",[users.admin]);assert.equal((await req('/api/v1/settings/api-keys',{cookie})).status,401);await client.query("UPDATE org_users SET role='admin' WHERE id=$1",[users.admin]);});
  await check('disabled users and revoked sessions are rejected immediately',async()=>{const {cookie,sessionId}=await tokenCookie('operator');await client.query('UPDATE org_users SET is_active=false WHERE id=$1',[users.operator]);assert.equal((await req('/api/v1/workflow/status',{cookie})).status,401);await client.query('UPDATE org_users SET is_active=true WHERE id=$1',[users.operator]);await client.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1',[sessionId]);assert.equal((await req('/api/v1/workflow/status',{cookie})).status,401);});
  await check('suspended organizations lose access immediately',async()=>{const {cookie}=await tokenCookie('operator');await client.query("UPDATE organizations SET status='suspended' WHERE id=$1",[orgA]);assert.equal((await req('/api/v1/workflow/status',{cookie})).status,401);await client.query("UPDATE organizations SET status='active' WHERE id=$1",[orgA]);});
  await check('cross-tenant document identifiers never return foreign data',async()=>{const {cookie}=await tokenCookie('operator');const {rows}=await client.query("INSERT INTO history_documents(organization_id,subsidiary_id,document_type,vendor,storage_key) VALUES($1,$2,'invoice','FOREIGN-SECRET','foreign-file.pdf') RETURNING id",[orgB,randomUUID()]);const id=rows[0].id;const r=await req(`/api/v1/workflow/status?ids=${id}`,{cookie});assert.equal(r.status,200);assert.deepEqual((await r.json()).documents,[]);assert.equal((await req(`/api/v1/documents/${id}/file`,{cookie})).status,404);});
  await check('refresh token cannot masquerade as access token',async()=>{const cookie=await login('operator');const refresh=cookie.split('; ').find(c=>c.startsWith('refresh_token=')).slice('refresh_token='.length);assert.equal((await req('/api/v1/workflow/status',{cookie:`access_token=${refresh}`})).status,401);});
  await check('only one concurrent refresh consumes the nonce',async()=>{const cookie=await login('operator');const responses=await Promise.all([req('/api/v1/auth/refresh',{cookie,method:'POST'}),req('/api/v1/auth/refresh',{cookie,method:'POST'})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,401]);});
  await check('logout invalidates the captured access token',async()=>{const cookie=await login('operator');assert.equal((await req('/api/v1/auth/logout',{cookie,method:'POST'})).status,200);assert.equal((await req('/api/v1/workflow/status',{cookie})).status,401);});
  await check('oversized unauthenticated login rejected',async()=>assert.equal((await req('/api/v1/auth/login',{method:'POST',body:{email:'operator@security.invalid',password:'x'.repeat(20000)}})).status,413));
  await check('password reset is consumed atomically',async()=>{const token=randomBytes(32).toString('hex');await client.query("UPDATE org_users SET reset_token=$1,reset_token_expires_at=now()+interval '1 hour' WHERE id=$2",[createHash('sha256').update(token).digest('hex'),users.viewer]);const responses=await Promise.all([req('/api/v1/auth/reset-password',{method:'POST',body:{token,password:'replacement-password-one'}}),req('/api/v1/auth/reset-password',{method:'POST',body:{token,password:'replacement-password-two'}})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);});
  await check('API keys enforce explicit scopes and cannot manage team',async()=>{
    await client.query("INSERT INTO org_features(organization_id,feature_id,admin_granted,is_enabled) VALUES($1,'api_keys',true,true)",[orgA]);
    const raw=`dk_${randomBytes(32).toString('hex')}`,id=randomUUID();
    await client.query('INSERT INTO api_keys(id,organization_id,name,key_hash,key_prefix,scopes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,orgA,'read-only test',createHash('sha256').update(raw).digest('hex'),raw.slice(0,12),JSON.stringify(['documents:read']),users.admin]);
    const headers={Authorization:`Bearer ${raw}`};
    assert.equal((await req('/api/v1/workflow/status',{headers})).status,200);
    assert.equal((await req('/api/v1/workflow/upload',{method:'POST',headers})).status,401);
    assert.equal((await req('/api/v1/team',{method:'POST',headers,body:{email:'nobody@example.com'}})).status,401);
    await client.query("UPDATE api_keys SET scopes='[]' WHERE id=$1",[id]);
    assert.equal((await req('/api/v1/workflow/status',{headers})).status,401);
  });
  await check('forged localhost IP headers cannot bypass an enabled allowlist',async()=>{
    const {cookie}=await tokenCookie('operator');
    await client.query("INSERT INTO org_features(organization_id,feature_id,admin_granted,is_enabled,config_json) VALUES($1,'ip_allowlist',true,true,$2)",[orgA,JSON.stringify({allowed_ips:['8.8.8.8']})]);
    assert.equal((await req('/api/v1/workflow/status',{cookie,headers:{'X-Forwarded-For':'127.0.0.1','X-Real-IP':'127.0.0.1'}})).status,401);
    await client.query("DELETE FROM org_features WHERE organization_id=$1 AND feature_id='ip_allowlist'",[orgA]);
  });
  await check('login account limit resists changing spoofed IP headers',async()=>{
    for(let i=0;i<5;i++)assert.equal((await req('/api/v1/auth/login',{method:'POST',headers:{'X-Forwarded-For':`8.8.8.${i+1}`},body:{email:'expense_submitter@security.invalid',password:'wrong-password'}})).status,401);
    assert.equal((await req('/api/v1/auth/login',{method:'POST',headers:{'X-Forwarded-For':'1.1.1.1'},body:{email:'expense_submitter@security.invalid',password:'wrong-password'}})).status,429);
  });
  await check('disabled platform admins cannot keep using an access token',async()=>{
    const response=await req('/api/admin/auth/login',{method:'POST',body:{email:'platform@security.invalid',password:userPassword}});assert.equal(response.status,200);
    const cookie=cookies(response);assert.equal((await req('/api/admin/clients',{cookie})).status,200);
    await client.query('UPDATE platform_admins SET is_active=false WHERE id=$1',[adminId]);
    assert.equal((await req('/api/admin/clients',{cookie})).status,401);
    assert.equal((await req('/admin',{cookie})).status,307);
  });
  console.log(`All ${results.length} integration checks passed.`);
} catch(error) {
  results.push({name:error instanceof Error?error.message:'integration failure',pass:false});
  console.error(error instanceof Error?error.message:error);process.exitCode=1;
} finally {
  fs.writeFileSync(path.join(logDir,'integration-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),isolated:true,results},null,2));
  if(server){server.kill();await Promise.race([once(server,'exit'),pause(5000)]);}
  await client?.end().catch(()=>{});
  if(created){try{ if(docker('inspect','--format','{{index .Config.Labels "docuia.security-test"}}',container)==='true') docker('stop',container);}catch{}}
}
