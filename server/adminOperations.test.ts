import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from './app';
import { Store } from './store';
import { AuthServiceServer } from './auth';
import { AuditLogger } from './audit';
import { deliveryAggregates } from './adminOperations';

const adminToken='a'.repeat(64),customerToken='b'.repeat(64);
test('admin operational APIs require a server-verified role and return delivery records without private links',async context=>{
 const order:any={id:'one',userId:'buyer',customerEmail:'buyer@example.com',total:100,createdAt:'2026-10-21T00:00:00Z',paymentProvider:'Razorpay',paymentEnvironment:'live',paymentStatus:'PAID',transactionId:'pay_one',deliveryStatus:'DELIVERED',downloadStatus:'AVAILABLE',deliveredAt:'2026-10-21T00:01:00Z',emailDelivery:{status:'sent',emailId:'email_one',providerStatus:'delivered',providerEventAt:'2026-10-21T00:02:00Z'},items:[{productId:'first',price:100}],privateDownloadUrl:'https://example.invalid/secret.zip',notificationPayload:{secret:'secret'}};
 context.mock.method(AuthServiceServer,'verifyOpaqueSession',async (token: string)=>token===adminToken?{userId:'owner',email:'owner@example.com'}:token===customerToken?{userId:'buyer',email:'buyer@example.com'}:null);
 context.mock.method(Store,'getUserProfile',async (id: string)=>({id,role:id==='owner'?'admin':'customer'}));
 context.mock.method(Store,'getGlobalOrder',async (id: string)=>id==='one'?order:null);
 context.mock.method(Store,'get',async (key: string)=>key==='downloadLogs'?{log_one:{orderId:'one',productId:'first',authorizedAt:'2026-10-21T00:03:00Z',event:'DOWNLOAD_AUTHORIZED',token:'do-not-return',downloadUrl:'https://example.invalid/private'}}:key==='orderAuditIndex/one'?{audit_one:{eventType:'PAYMENT_VERIFIED',timestamp:'2026-10-21T00:01:00Z',metadata:{private:'not-needed'}}}:null);
 context.mock.method(Store,'rpc',async (operation: string)=>{assert.equal(operation,'rate');return true;});
 context.mock.method(AuditLogger,'log',async()=>{});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');context.after(()=>server.close());
 const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const request=(path:string,token?:string,method='GET')=>fetch(base+path,{method,headers:token?{Cookie:`sid=${token}`}:{}});
 for(const path of ['/api/admin/orders/one/delivery','/api/admin/support','/api/admin/subscribers','/api/admin/downloads','/api/admin/readiness','/api/admin/products/first/file']){
  assert.equal((await request(path)).status,401,path);
  assert.equal((await request(path,customerToken)).status,403,path);
 }
 assert.equal((await request('/api/admin/orders/one/retry-email',customerToken,'POST')).status,403);
 const response=await request('/api/admin/orders/one/delivery',adminToken);assert.equal(response.status,200);const data=await response.json();
 assert.equal(data.order.emailDelivery.providerStatus,'delivered');assert.equal(data.order.deliveryStatus,'DELIVERED');
 assert.equal(data.downloadLogs.length,1);assert.equal(data.downloadLogs[0].event,'DOWNLOAD_AUTHORIZED');
 assert.equal(data.order.privateDownloadUrl,undefined);assert.equal(data.order.notificationPayload,undefined);assert.equal(data.downloadLogs[0].token,undefined);assert.equal(data.downloadLogs[0].downloadUrl,undefined);
 assert.ok(!JSON.stringify(data).includes('do-not-return'));
 assert.equal((await request('/api/admin/orders/missing/delivery',adminToken)).status,404);
 const retry=await request('/api/admin/orders/one/retry-email',adminToken,'POST');assert.equal(retry.status,200);assert.equal((await retry.json()).result.status,'sent','accepted mail never resent');
 order.paymentStatus='PENDING';order.transactionId=null;
 const skipped=await request('/api/admin/orders/one/retry-email',adminToken,'POST');assert.equal((await skipped.json()).result.status,'skipped','unpaid order cannot send purchase confirmation');
});

test('admin database outages are not reported as denied admin privileges',async context=>{
 context.mock.method(AuthServiceServer,'verifyOpaqueSession',async()=>({userId:'owner'}));
 context.mock.method(Store,'getUserProfile',async()=>{throw new Error('private database error');});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');context.after(()=>server.close());
 const response=await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/admin/me`,{headers:{Cookie:`sid=${adminToken}`}});
 assert.equal(response.status,503);const body=await response.json();assert.ok(!JSON.stringify(body).includes('private database error'));
});

test('admin readiness probes real table and private-bucket metadata without exposing configured secrets',async context=>{
 const names=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','CASHFREE_APP_ID','CASHFREE_SECRET_KEY','RESEND_API_KEY','RESEND_FROM_EMAIL','RESEND_WEBHOOK_SECRET','CRON_SECRET'];
 const before=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 Object.assign(process.env,{SUPABASE_URL:'https://readiness.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-private',SUPABASE_ANON_KEY:'synthetic-anon',CASHFREE_APP_ID:'synthetic-cf-app',CASHFREE_SECRET_KEY:'synthetic-cf-private',RESEND_API_KEY:'synthetic-resend-private',RESEND_FROM_EMAIL:'orders@example.com',RESEND_WEBHOOK_SECRET:'synthetic-webhook-private',CRON_SECRET:'synthetic-cron-private'});
 context.after(()=>{for(const [name,value] of Object.entries(before)){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
 context.mock.method(AuthServiceServer,'verifyOpaqueSession',async()=>({userId:'owner'}));
 context.mock.method(Store,'getUserProfile',async()=>({role:'admin'}));
 context.mock.method(Store,'testConnection',async()=>({connected:true}));
 context.mock.method(Store,'get',async()=>({completedAt:'2026-10-23T00:00:00Z'}));
 const originalFetch=globalThis.fetch;
 context.mock.method(globalThis,'fetch',async(input:any,init?:any)=>{
  const url=String(input?.url||input);
  if(url.startsWith('https://readiness.supabase.co/rest/v1/cashfree_order_bindings')){assert.ok(url.includes('cashfree_order_id'));return Response.json([]);}
  if(url==='https://readiness.supabase.co/storage/v1/bucket/products')return Response.json({id:'products',public:false});
  return originalFetch(input,init);
 });
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');context.after(()=>server.close());
 const response=await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/admin/readiness`,{headers:{Cookie:`sid=${adminToken}`}});
 assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.readiness.supabase.reachable,true);assert.equal(result.readiness.supabase.schemaReady,true);assert.equal(result.readiness.productStorage.private,true);
 assert.equal(result.lastReconciledAt,'2026-10-23T00:00:00Z');assert.ok(result.checks.some((row:any)=>row.id==='scheduler'&&row.status==='manual'));
 for(const secret of ['synthetic-service-private','synthetic-cf-private','synthetic-resend-private','synthetic-webhook-private','synthetic-cron-private'])assert.ok(!JSON.stringify(result).includes(secret));
});
