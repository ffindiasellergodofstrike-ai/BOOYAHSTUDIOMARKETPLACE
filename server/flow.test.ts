import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { Store } from './store';
import { AuthServiceServer } from './auth';
import { PRODUCTS } from '../src/data/products';

test('HTTP purchase flow: server totals, verified webhooks, ownership, refunds and recovery failures', async () => {
 process.env.SUPABASE_URL='https://synthetic.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';process.env.SUPABASE_ANON_KEY='synthetic-anon';
 process.env.RAZORPAY_KEY_ID='rzp_live_synthetic';process.env.RAZORPAY_KEY_SECRET='synthetic-key-secret';process.env.RAZORPAY_WEBHOOK_SECRET='synthetic-webhook-secret';delete process.env.RESEND_API_KEY;
 const db=new PGlite();
 await db.exec('create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key, name text, public boolean); create table storage.objects(id text, bucket_id text); alter table storage.objects enable row level security;');
 await db.exec(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
 const originalRpc=Store.rpc, originalFetch=globalThis.fetch;
 Store.rpc=async (operation:string,key='',value:any=null) => (await db.query<{result:any}>('select public.store_operation($1,$2,$3::jsonb) as result',[operation,key,JSON.stringify(value)])).rows[0].result;
 let providerPayment:any, providerRequests:any[]=[], disputeStatus='open';
 globalThis.fetch=async (input:any,init?:any) => {
  const url=String(input?.url || input);
  if(url.startsWith('https://api.razorpay.com/')) {
   providerRequests.push({url,body:init?.body?JSON.parse(init.body):undefined});
   if(url.endsWith('/orders')) { const body=JSON.parse(init.body); return Response.json({id:'order_synthetic',amount:body.amount,currency:body.currency}); }
   if(url.includes('/disputes/disp_synthetic'))return Response.json({id:'disp_synthetic',payment_id:'pay_synthetic',amount:providerPayment.amount,currency:'INR',status:disputeStatus,reason_code:'not_received'});
   if(url.includes('/payments/pay_'))return Response.json(providerPayment);
   if(url.endsWith('/payments'))return Response.json({items:[providerPayment]});
   throw new Error('Unexpected provider URL');
  }
  if(url.startsWith('https://synthetic.supabase.co/storage/v1/object/info/'))return Response.json({id:'file',name:'template.zip',metadata:{size:100}});
  if(url.includes('/storage/v1/object/sign/'))return Response.json({signedURL:'/object/sign/products/template.zip?token=synthetic'});
  if(url.includes('/auth/v1/signup'))return Response.json({id:'carol',email:'carol@example.com'});
  if(url.includes('/auth/v1/recover'))return Response.json({});
  if(url.includes('/auth/v1/token'))return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'bearer',user:{id:'bob',email:'bob@example.com',email_confirmed_at:new Date().toISOString(),user_metadata:{name:'Bob'},created_at:new Date().toISOString()}});
  if(url.includes('/auth/v1/verify')) {
   if(JSON.parse(init.body).token_hash === 'valid-synthetic-recovery') return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'bearer',user:{id:'alice',email:'alice@example.com'}});
   return Response.json({error:'invalid_grant',error_description:'Invalid recovery token'},{status:400});
  }
  if(url.includes('/auth/v1/user'))return Response.json({id:'alice',email:'alice@example.com'});
  if(url.includes('/auth/v1/logout'))return new Response(null,{status:204});
  if(url.startsWith('https://synthetic.supabase.co/'))throw new Error('Unexpected auth operation: '+url);
  return originalFetch(input,init);
 };
 const { app }=await import('./app');
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as any).port}`;
 try {
  await Store.setUserProfile('alice',{id:'alice',email:'alice@example.com',name:'Alice',role:'customer'});
  await Store.setUserProfile('bob',{id:'bob',email:'bob@example.com',name:'Bob',role:'customer'});
  const sid=await AuthServiceServer.createOpaqueSession('alice','alice@example.com','alice');
  const bob=await AuthServiceServer.createOpaqueSession('bob','bob@example.com','bob');
  const post=async(path:string,body:any,cookie=sid,extra:any={})=>originalFetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:`sid=${cookie}`,...extra},body:JSON.stringify(body)});
  assert.equal((await post('/api/orders/create',{},sid,{Origin:'https://attacker.example'})).status,403);
  assert.equal((await originalFetch(base+'/api/admin/me',{headers:{Cookie:`sid=${sid}`}})).status,403);
  const signup=await post('/api/auth/register',{name:'Carol',email:'carol@example.com',mobile:'9876543210',password:'synthetic-password',confirmPassword:'synthetic-password'},'');
  assert.equal(signup.status,201);assert.equal(signup.headers.get('set-cookie'),null,'registration must not authenticate before confirmation');
  assert.equal((await post('/api/auth/forgot-password',{email:'carol@example.com'},'')).status,200);
  const login=await post('/api/auth/login',{identifier:'bob@example.com',password:'synthetic-password'},'');
  assert.equal(login.status,200);assert.match(login.headers.get('set-cookie') || '',/HttpOnly/);
  const loginCookie=(login.headers.get('set-cookie') || '').match(/sid=([^;]+)/)![1];
  assert.equal((await originalFetch(base+'/api/auth/me',{headers:{Cookie:`sid=${loginCookie}`}})).status,200);
  assert.equal((await post('/api/auth/logout',{},loginCookie)).status,200);
  assert.equal(await AuthServiceServer.verifyOpaqueSession(loginCookie),null);
  await Store.updateUserProfile('bob',{blocked:true});
  assert.equal(await AuthServiceServer.verifyOpaqueSession(bob),null);
  assert.equal((await post('/api/auth/login',{identifier:'bob@example.com',password:'synthetic-password'},'')).status,403);
  await Store.updateUserProfile('bob',{blocked:false});
  const product=PRODUCTS[0];
  const checkoutInput={items:[{productId:product.id,quantity:1,price:1}],customer:{email:'alice@example.com',fullName:'Alice'},paymentMethod:'Razorpay',total:1};
  assert.equal((await post('/api/orders/create',checkoutInput)).status,409,'new marketplace checkout defaults disabled until deliberately configured');
  await Store.set('marketplace/gateway-settings',{version:1,enabled:{cashfree:false,razorpay:true,easebuzz:false},defaultProvider:'razorpay',commissionBps:1000});
  const created=await post('/api/orders/create',{items:[{productId:product.id,quantity:1,price:1}],customer:{email:'alice@example.com',fullName:'Alice'},paymentMethod:'Razorpay',total:1});
  assert.equal(created.status,201);
  const creation=await created.json();const order=creation.order;
  assert.equal(order.total,product.price);
  assert.equal((await post(`/api/downloads/${product.id}/token`,{orderId:order.id})).status,403);
  assert.equal((await post('/api/payments/razorpay/initiate',{orderId:order.id,agreeTerms:false})).status,400);
  const initiation=await post('/api/payments/razorpay/initiate',{orderId:order.id,agreeTerms:true});assert.equal(initiation.status,200);
  assert.equal(providerRequests[0].body.amount,Math.round(product.price*100));
  assert.equal((await post(`/api/downloads/${product.id}/token`,{orderId:order.id},'')).status,401);
  assert.equal((await post(`/api/downloads/${PRODUCTS[1].id}/token`,{orderId:order.id})).status,403);
  const verify={orderId:order.id,razorpay_order_id:'order_synthetic',razorpay_payment_id:'pay_synthetic',razorpay_signature:'0'.repeat(64)};
  assert.equal((await post('/api/payments/razorpay/verify',verify)).status,400);
  providerPayment={id:'pay_synthetic',order_id:'order_synthetic',currency:'INR',amount:Math.round(product.price*100),amount_refunded:0,captured:true,status:'captured'};
  verify.razorpay_signature=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update('order_synthetic|pay_synthetic').digest('hex');
  const captured={...providerPayment};
  for (const status of ['created','authorized','failed']) {
   providerPayment={...captured,status,captured:false};
   const result=await post('/api/payments/razorpay/verify',verify);
   assert.equal(result.status,200);assert.equal((await result.json()).success,false);
   assert.equal((await post(`/api/downloads/${product.id}/token`,{orderId:order.id})).status,403);
  }
  for (const patch of [{id:'pay_wrong'},{amount:1},{order_id:'order_wrong'},{currency:'USD'},{captured:false}]) {
   providerPayment={...captured,...patch};assert.equal((await post('/api/payments/razorpay/verify',verify)).status,409);
  }
  assert.equal((await post('/api/payments/razorpay/checkout-closed',{orderId:order.id})).status,200);
  assert.equal((await Store.getGlobalOrder(order.id)).paymentStatus,'PENDING');
  providerPayment=captured;
  const body={event:'payment.captured',payload:{payment:{entity:{id:'pay_synthetic'}}}};
  const signature=crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(body)).digest('hex');
  assert.equal((await post('/api/payments/razorpay/webhook',body,'',{'x-razorpay-signature':'0'.repeat(64)})).status,400);
  for(let i=0;i<3;i++)assert.equal((await post('/api/payments/razorpay/webhook',body,'',{'x-razorpay-signature':signature})).status,200);
  assert.equal(Object.keys(await Store.get<any>('purchases') || {}).length,1);
  assert.equal(Object.keys(await Store.get<any>('paymentEvents') || {}).length,1);
  assert.equal((await Store.getGlobalOrder(order.id)).paymentStatus,'PAID');
  assert.equal((await post(`/api/downloads/${product.id}/token`,{orderId:order.id},bob)).status,403);
  const downloaded=await post(`/api/downloads/${product.id}/token`,{orderId:order.id});assert.equal(downloaded.status,200);
  assert.match((await downloaded.json()).downloadUrl,/storage\/v1\/object\/sign/);
  assert.equal(Object.keys(await Store.get<any>('downloadLogs') || {}).length,1);
  // A second captured payment is retained for review; its refund must not revoke the first purchase.
  providerPayment={...captured,id:'pay_duplicate'};
  const duplicateBody={event:'payment.captured',payload:{payment:{entity:{id:'pay_duplicate'}}}};
  const sendEvent=async(payload:any)=>post('/api/payments/razorpay/webhook',payload,'',{'x-razorpay-signature':crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET!).update(JSON.stringify(payload)).digest('hex')});
  assert.equal((await sendEvent(duplicateBody)).status,200);
  providerPayment={...providerPayment,status:'refunded',amount_refunded:captured.amount};
  assert.equal((await sendEvent(duplicateBody)).status,200);
  assert.equal((await Store.getGlobalOrder(order.id)).deliveryStatus,'DELIVERED');
  assert.equal((await Store.getGlobalOrder(order.id)).duplicatePaymentReview,true);
  providerPayment=captured;
  const disputeBody={event:'payment.dispute.created',payload:{payment:{entity:{id:'pay_synthetic'}},dispute:{entity:{id:'disp_synthetic'}}}};
  assert.equal((await sendEvent(disputeBody)).status,200);
  assert.equal((await Store.getGlobalOrder(order.id)).deliveryStatus,'DELIVERED','open dispute is not automatic wrongdoing');
  disputeStatus='lost';disputeBody.event='payment.dispute.lost';assert.equal((await sendEvent(disputeBody)).status,200);
  assert.equal((await post(`/api/downloads/${product.id}/token`,{orderId:order.id})).status,403);
  assert.equal((await sendEvent(body)).status,200);
  assert.equal((await Store.getGlobalOrder(order.id)).deliveryStatus,'REVOKED','late capture cannot restore a lost dispute');
  await Store.setUserProfile('owner',{id:'owner',email:'owner@example.com',role:'admin'});
  const owner=await AuthServiceServer.createOpaqueSession('owner','owner@example.com','owner');
  assert.equal((await originalFetch(base+`/api/admin/orders/${order.id}/evidence`,{headers:{Cookie:`sid=${sid}`}})).status,403);
  const evidence=await originalFetch(base+`/api/admin/orders/${order.id}/evidence`,{headers:{Cookie:`sid=${owner}`}});
  assert.equal(evidence.status,200);const exportText=await evidence.text();assert.match(exportText,/disp_synthetic/);assert.doesNotMatch(exportText,/synthetic-key-secret|synthetic-webhook-secret|synthetic-access/);
  providerPayment={...providerPayment,status:'refunded',amount_refunded:providerPayment.amount};
  assert.equal((await post('/api/payments/razorpay/webhook',body,'',{'x-razorpay-signature':signature})).status,200);
  assert.equal((await post(`/api/downloads/${product.id}/token`,{orderId:order.id})).status,403);
  assert.equal((await post('/api/auth/reset-password',{email:'alice@example.com',mobile:'9999999999',password:'new-password'})).status,400);
  assert.equal((await post('/api/auth/reset-password',{tokenHash:'invalid-token-hash',password:'new-password'})).status,400);
  assert.ok(await AuthServiceServer.verifyOpaqueSession(sid),'invalid recovery must not mutate sessions');
  const reset=await post('/api/auth/reset-password',{tokenHash:'valid-synthetic-recovery',password:'new-password'});
  assert.equal(reset.status,200);assert.equal((await reset.json()).success,true);
  assert.equal(await AuthServiceServer.verifyOpaqueSession(sid),null,'verified recovery invalidates older sessions');
 } finally { await new Promise<void>(r=>server.close(()=>r()));globalThis.fetch=originalFetch;Store.rpc=originalRpc;await db.close(); }
});
