import 'express-async-errors';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { registerAuthRoutes, AuthServiceServer } from './auth';
import { Store } from './store';

const issuer='https://recovery-test.supabase.co/auth/v1', signingKey='synthetic-recovery-signing-key';
function token(patch:Record<string,any>={}){
 const now=Math.floor(Date.now()/1000);
 const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
 const claims={iss:issuer,sub:'buyer',aud:'authenticated',role:'authenticated',iat:now,exp:now+3600,email:'buyer@example.test',session_id:crypto.randomUUID(),amr:[{method:'otp',timestamp:now}],...patch};
 const payload=Buffer.from(JSON.stringify(claims)).toString('base64url'),body=`${header}.${payload}`;
 return `${body}.${crypto.createHmac('sha256',signingKey).update(body).digest('base64url')}`;
}

test('default Supabase recovery bearer verifies ownership, rejects expired/forged/non-email sessions and permits one password update',async context=>{
 const previous={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_ANON_KEY:process.env.SUPABASE_ANON_KEY};
 process.env.SUPABASE_URL='https://recovery-test.supabase.co';process.env.SUPABASE_ANON_KEY='synthetic-anon';
 const originalFetch=globalThis.fetch,documents=new Map<string,any>(),claimsUsed=new Set<string>();
 const profile:any={id:'buyer',email:'buyer@example.test',role:'admin'};
 let updates=0,claimsAttempts=0,logouts=0,logoutFails=false,mismatchUser=false,currentPassword='original-password';
 const seenBearers:string[]=[];
 context.mock.method(Store,'getUserProfile',async()=>profile);
 context.mock.method(Store,'updateUserProfile',async(_id:string,patch:any)=>Object.assign(profile,patch));
 context.mock.method(Store,'set',async(key:string,value:any)=>{documents.set(key,value);return value;});
 context.mock.method(Store,'get',async(key:string)=>documents.get(key)||null);
 context.mock.method(Store,'rpc',async(operation:string,key:string)=>{
  assert.equal(operation,'rate');assert.match(key,/^passwordRecoverySessions\/[a-f0-9]{64}$/);claimsAttempts++;
  if(claimsUsed.has(key))return false;claimsUsed.add(key);return true;
 });
 const decodeAndVerify=(bearer:string)=>{
  const parts=bearer.split('.');if(parts.length!==3)return null;
  const expected=crypto.createHmac('sha256',signingKey).update(parts.slice(0,2).join('.')).digest('base64url');
  if(parts[2]!==expected)return null;
  try{const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());return claims.exp>Date.now()/1000?claims:null;}catch{return null;}
 };
 globalThis.fetch=async(input:any,init:any={})=>{
  const url=String(input?.url||input);
  if(!url.startsWith('https://recovery-test.supabase.co/'))return originalFetch(input,init);
  const bearer=new Headers(init.headers).get('authorization')?.replace(/^Bearer /,'')||'';
  const claims=decodeAndVerify(bearer);
  if(url.endsWith('/auth/v1/user')){
   if(!claims)return Response.json({msg:'Invalid JWT',code:'bad_jwt'},{status:401});
   const user={id:mismatchUser?'other':claims.sub,email:'buyer@example.test',email_confirmed_at:new Date().toISOString(),user_metadata:{},is_anonymous:false};
   if(init.method==='PUT'){
    assert.equal(new Headers(init.headers).get('apikey'),'synthetic-anon');assert.equal(init.redirect,'error');
    const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body),['password']);
    seenBearers.push(bearer);updates++;currentPassword=body.password;
   }
   return Response.json(user);
  }
  if(url.includes('/auth/v1/logout')){logouts++;return logoutFails?Response.json({msg:'Provider unavailable'},{status:503}):new Response(null,{status:204});}
  // No refresh endpoint is permitted: only the original verified bearer may update.
  throw new Error('Unexpected external request in recovery regression');
 };
 const app=express();app.use(express.json());registerAuthRoutes(app,(_req,_res,next)=>next());app.use((_err:any,_req:any,res:any,_next:any)=>res.status(503).json({success:false}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 context.after(async()=>{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await new Promise<void>(r=>server.close(()=>r()));});
 const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const reset=(accessToken:string,extra:any={})=>originalFetch(base+'/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessToken,password:'replacement-password',confirmPassword:'replacement-password',...extra})});
 const sid=await AuthServiceServer.createOpaqueSession('buyer','buyer@example.test','buyer');assert.ok(await AuthServiceServer.verifyOpaqueSession(sid));
 const now=Math.floor(Date.now()/1000);
 for(const access of [token({exp:now-10}),token({amr:[{method:'password',timestamp:now}]}),token({amr:[{method:'otp',timestamp:now-3601}]}),token({iss:'https://other.supabase.co/auth/v1'}),token({role:'service_role'}),token({aud:'other'}),token({session_id:undefined}),token({is_anonymous:true}),token().slice(0,-1)+'!',token({iat:now+3600})]){
  const response=await reset(access);assert.equal(response.status,400);assert.equal((await response.json()).code,'RECOVERY_INVALID');
 }
 assert.equal(updates,0);assert.equal(claimsAttempts,0,'unverified links must not consume a session claim');assert.ok(await AuthServiceServer.verifyOpaqueSession(sid));
 const good=token();
 assert.equal((await reset(good,{refreshToken:'different-user-refresh'})).status,400,'refresh credentials are never accepted');
 assert.equal((await reset(good,{tokenHash:'mixed-credentials'})).status,400);
 assert.equal((await reset(good,{confirmPassword:'different'})).status,400);
 mismatchUser=true;assert.equal((await reset(good)).status,400);mismatchUser=false;
 assert.equal(claimsAttempts,0);
 const results=await Promise.all([reset(good),reset(good)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
 const successful=results.find(r=>r.status===200)!;assert.match(successful.headers.get('set-cookie')||'',/sid=;/);
 const payload=await successful.json();assert.equal(payload.success,true);assert.ok(!JSON.stringify(payload).includes(good));
 assert.equal(currentPassword,'replacement-password');assert.equal(updates,1);assert.deepEqual(seenBearers,[good]);assert.equal(logouts,1);
 assert.equal(await AuthServiceServer.verifyOpaqueSession(sid),null);assert.equal(profile.role,'admin','reset preserves owner role');
 assert.equal((await reset(good)).status,400);assert.equal(updates,1,'replayed JWT cannot reset again even while provider JWT remains unexpired');
 const claims=JSON.parse(Buffer.from(good.split('.')[1],'base64url').toString());assert.equal((await reset(token({session_id:claims.session_id,iat:now+1}))).status,400,'rotating a token does not revive the same session');
 logoutFails=true;const next=await reset(token({amr:[{method:'recovery',timestamp:now}]}));assert.equal(next.status,200,'password success is not reversed by logout cleanup failure');assert.equal(updates,2);
 assert.ok([...claimsUsed].every(key=>!key.includes(good)),'durable replay guards contain only a session fingerprint');
});
