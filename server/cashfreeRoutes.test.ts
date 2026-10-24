import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { Store } from './store';
import { AuthServiceServer } from './auth';
import { PRODUCTS } from '../src/data/products';
import { cashfreeIdempotencyKey, matchesCashfreePayment, moneyPaise, verifyCashfreeSignature } from './cashfree';

test('Cashfree amounts, reference and raw signature validation reject manipulated inputs', () => {
 process.env.CASHFREE_ENV='sandbox';process.env.CASHFREE_SECRET_KEY='test-secret';
 assert.equal(moneyPaise('100.01'),10001);assert.equal(moneyPaise('100.001'),null);assert.equal(moneyPaise(null),null);assert.equal(moneyPaise(-1),null);
 assert.match(cashfreeIdempotencyKey('one'),/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
 assert.equal(cashfreeIdempotencyKey('one'),cashfreeIdempotencyKey('one'));
 const raw=Buffer.from('{"amount":1.00}'),timestamp=String(Date.now()),signature=crypto.createHmac('sha256','test-secret').update(timestamp).update(raw).digest('base64');
 assert.equal(verifyCashfreeSignature(raw,signature,timestamp),true);assert.equal(verifyCashfreeSignature(Buffer.from('{"amount":1}'),signature,timestamp),false);
 assert.equal(verifyCashfreeSignature(raw,'bad',timestamp),false);
 const order={id:'local',paymentProvider:'Cashfree',cashfreeOrderId:'provider',paymentEnvironment:'test',total:100};
 const payment={cf_payment_id:'1001',order_id:'provider',payment_amount:100,payment_currency:'INR',payment_status:'SUCCESS'};
 assert.equal(matchesCashfreePayment(payment,order),true);
 for(const invalid of [{...payment,payment_amount:1},{...payment,order_id:'wrong'},{...payment,payment_currency:'USD'}])assert.equal(matchesCashfreePayment(invalid,order),false);
 assert.equal(matchesCashfreePayment(payment,{...order,paymentEnvironment:'live'}),false);
});

test('Cashfree HTTP purchase flow: trusted totals, file readiness, retry/replay, ownership, partial allocation, refunds and test isolation',async()=>{
 process.env.SUPABASE_URL='https://synthetic.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';process.env.SUPABASE_ANON_KEY='synthetic-anon';
 process.env.CASHFREE_APP_ID='synthetic-app';process.env.CASHFREE_SECRET_KEY='test-secret';process.env.CASHFREE_ENV='production';delete process.env.RESEND_API_KEY;
 const db=new PGlite();
 await db.exec('create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key,name text,public boolean); create table storage.objects(id text,bucket_id text);');
 await db.exec(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
 const originalRpc=Store.rpc,originalFetch=globalThis.fetch;
 Store.rpc=async(operation:string,key='',value:any=null)=>(await db.query<{result:any}>('select public.store_operation($1,$2,$3::jsonb) as result',[operation,key,JSON.stringify(value)])).rows[0].result;
 await Store.set('marketplace/gateway-settings',{version:1,enabled:{cashfree:true,razorpay:false,easebuzz:false},defaultProvider:'cashfree',commissionBps:1000});
 const remotes=new Map<string,any>(),attempts=new Map<string,any[]>(),refunds=new Map<string,any[]>();
 let missingFile=false,refundUnavailable=false,createCalls=0;const keys:string[]=[];
 globalThis.fetch=async(input:any,init?:any)=>{
  const url=String(input?.url||input);
  if(url.includes('cashfree.com/pg/')){
   const endpoint=url.split('/pg/')[1],parts=endpoint.split('/');
   if(endpoint==='orders'&&init?.method==='POST'){
    createCalls++;const body=JSON.parse(init.body);keys.push(new Headers(init.headers).get('x-idempotency-key')!);
    if(!remotes.has(body.order_id))remotes.set(body.order_id,{...body,cf_order_id:String(10000+remotes.size),payment_session_id:'session_synthetic',order_status:'ACTIVE'});
    return Response.json(remotes.get(body.order_id));
   }
   if(parts[0]==='orders'&&parts.length===2)return Response.json(remotes.get(parts[1]));
   if(parts[2]==='payments')return Response.json(attempts.get(parts[1])||[]);
   if(parts[2]==='refunds')return refundUnavailable?Response.json({code:'service_unavailable'},{status:503}):Response.json(refunds.get(parts[1])||[]);
   throw new Error('Unexpected Cashfree request');
  }
  if(url.includes('/storage/v1/object/info/'))return missingFile?Response.json({message:'missing'},{status:404}):Response.json({id:'file',metadata:{size:100}});
  if(url.includes('/storage/v1/object/sign/'))return Response.json({signedURL:'/object/sign/products/file.zip?token=synthetic'});
  if(url.startsWith('https://synthetic.supabase.co/'))throw new Error('Unexpected provider request');
  return originalFetch(input,init);
 };
 const {app}=await import('./app');const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as any).port}`;
 try{
  await Store.setUserProfile('alice',{id:'alice',email:'alice@example.com',role:'customer'});await Store.setUserProfile('bob',{id:'bob',email:'bob@example.com',role:'customer'});await Store.setUserProfile('owner',{id:'owner',email:'owner@example.com',role:'admin'});
  const alice=await AuthServiceServer.createOpaqueSession('alice','alice@example.com','alice'),bob=await AuthServiceServer.createOpaqueSession('bob','bob@example.com','bob'),owner=await AuthServiceServer.createOpaqueSession('owner','owner@example.com','owner');
  const post=(path:string,body:any,sid=alice)=>originalFetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:`sid=${sid}`},body:JSON.stringify(body)});
  const makeOrder=async()=>{
   const response=await post('/api/orders/create',{items:PRODUCTS.slice(0,2).map(p=>({productId:p.id,quantity:1,price:1})),total:1,customer:{fullName:'Alice',email:'alice@example.com',phone:'9876543210'}});
   assert.equal(response.status,201);return (await response.json()).order;
  };
  const webhook=async(id:string,valid=true)=>{
   const raw=JSON.stringify({type:'PAYMENT_SUCCESS_WEBHOOK',data:{order:{order_id:id},payment:{payment_status:'SUCCESS'}}}),timestamp=String(Date.now());
   const signature=crypto.createHmac('sha256','test-secret').update(timestamp).update(raw).digest('base64');
   return originalFetch(base+'/api/payments/cashfree/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-webhook-signature':valid?signature:'bad','x-webhook-timestamp':timestamp,Origin:'https://cashfree.com'},body:raw});
  };
  const config=await(await originalFetch(base+'/api/config/payments')).json();assert.equal(config.gateways.cashfree.configured,true);
  const order=await makeOrder();assert.equal(order.total,PRODUCTS[0].price+PRODUCTS[1].price);
  // Cashfree's documented INR minimum is ₹1; reject an unsupported trusted total before any gateway call.
  const belowMinimum={...order,id:'minimum_total_order',total:0.99};await Store.saveGlobalOrder(belowMinimum);
  const minimumResponse=await post('/api/payments/cashfree/initiate',{orderId:belowMinimum.id,agreeTerms:true});
  assert.equal(minimumResponse.status,400);assert.match((await minimumResponse.json()).message,/at least ₹1/);assert.equal(createCalls,0);
  assert.equal((await post('/api/payments/cashfree/initiate',{orderId:order.id,agreeTerms:true},bob)).status,404);
  assert.equal((await post('/api/payments/cashfree/initiate',{orderId:order.id,agreeTerms:false})).status,400);
  missingFile=true;assert.equal((await post('/api/payments/cashfree/initiate',{orderId:order.id,agreeTerms:true})).status,503);assert.equal(createCalls,0);missingFile=false;
  const started=await post('/api/payments/cashfree/initiate',{orderId:order.id,agreeTerms:true});assert.equal(started.status,200);const checkout=await started.json();assert.equal(checkout.mode,'production');assert.equal(checkout.paymentSessionId,'session_synthetic');
  assert.equal(remotes.get(order.id).order_amount,order.total);assert.match(keys[0],/^[a-f\d-]{36}$/);
  assert.equal((await post('/api/payments/cashfree/initiate',{orderId:order.id,agreeTerms:true})).status,200);assert.equal(createCalls,1);
  assert.equal((await post(`/api/downloads/${PRODUCTS[0].id}/token`,{orderId:order.id})).status,403);
  const payment={cf_payment_id:'100001',order_id:order.id,payment_amount:order.total,payment_currency:'INR',payment_status:'FAILED'};attempts.set(order.id,[payment]);
  let response=await post(`/api/payments/cashfree/reconcile/${order.id}`,{});assert.equal((await response.json()).status,'FAILED');
  payment.payment_status='SUCCESS';payment.payment_amount=1;assert.equal((await webhook(order.id)).status,200);assert.equal((await Store.getGlobalOrder(order.id)).paymentStatus,'PENDING');
  payment.payment_amount=order.total;assert.equal((await webhook(order.id,false)).status,400);
  refundUnavailable=true;assert.equal((await webhook(order.id)).status,503);
  assert.equal((await Store.getGlobalOrder(order.id)).paymentStatus,'PENDING');
  assert.equal(Object.keys(await Store.get<Record<string,unknown>>('purchases') || {}).length,0);
  assert.equal((await post(`/api/downloads/${PRODUCTS[0].id}/token`,{orderId:order.id})).status,403);
  refundUnavailable=false;
  await Store.set('marketplace/gateway-settings',{version:1,enabled:{cashfree:false,razorpay:false,easebuzz:false},defaultProvider:'cashfree',commissionBps:1000});
  assert.equal((await post('/api/payments/cashfree/initiate',{orderId:order.id,agreeTerms:true})).status,409);
  const successes=await Promise.all([webhook(order.id),webhook(order.id),post(`/api/payments/cashfree/reconcile/${order.id}`,{})]);for(const success of successes)assert.equal(success.status,200);
  let saved=await Store.getGlobalOrder(order.id);assert.equal(saved.paymentStatus,'PAID');assert.equal(saved.deliveryStatus,'DELIVERED');
  assert.equal(Object.keys(await Store.get<Record<string,unknown>>('purchases') || {}).length,2);
  assert.equal((await post(`/api/downloads/${PRODUCTS[0].id}/token`,{orderId:order.id},bob)).status,403);
  assert.equal((await post(`/api/downloads/${PRODUCTS[0].id}/token`,{orderId:order.id})).status,200);
  assert.equal((await originalFetch(base+`/api/orders/${order.id}/invoice`,{headers:{Cookie:`sid=${alice}`}})).status,200);
  const smallRefund={refund_id:'refund_small',cf_payment_id:'100001',order_id:order.id,refund_amount:1,refund_currency:'INR',refund_status:'SUCCESS'};refunds.set(order.id,[smallRefund]);
  assert.equal((await webhook(order.id)).status,200);saved=await Store.getGlobalOrder(order.id);assert.equal(saved.paymentStatus,'PARTIALLY_REFUNDED');assert.equal(saved.downloadStatus,'AVAILABLE');assert.equal(saved.refundReviewRequired,true);
  const allocation={reviewed:true,reason:'Verified goodwill price adjustment',allocations:[{productId:PRODUCTS[0].id,amountPaise:100}]};
  assert.equal((await post(`/api/admin/cashfree/orders/${order.id}/refunds/refund_small/allocate`,allocation,alice)).status,403);
  assert.equal((await post(`/api/admin/cashfree/orders/${order.id}/refunds/refund_small/allocate`,allocation,owner)).status,200);
  assert.equal((await post(`/api/downloads/${PRODUCTS[1].id}/token`,{orderId:order.id})).status,200);
  refunds.set(order.id,[smallRefund,{...smallRefund,refund_id:'refund_remaining',refund_amount:Number((order.total-1).toFixed(2))}]);
  assert.equal((await webhook(order.id)).status,200);assert.equal((await Store.getGlobalOrder(order.id)).downloadStatus,'UNAVAILABLE');
  assert.equal((await post(`/api/downloads/${PRODUCTS[1].id}/token`,{orderId:order.id})).status,403);
  assert.equal((await webhook(order.id)).status,200);assert.equal((await Store.getGlobalOrder(order.id)).paymentStatus,'REFUNDED');
  await Store.set('marketplace/gateway-settings',{version:1,enabled:{cashfree:true,razorpay:false,easebuzz:false},defaultProvider:'cashfree',commissionBps:1000});
  process.env.CASHFREE_ENV='sandbox';const sandbox=await makeOrder();assert.equal((await post('/api/payments/cashfree/initiate',{orderId:sandbox.id,agreeTerms:true})).status,200);
  attempts.set(sandbox.id,[{...payment,cf_payment_id:'100002',order_id:sandbox.id,payment_amount:sandbox.total}]);assert.equal((await webhook(sandbox.id)).status,200);assert.equal((await Store.getGlobalOrder(sandbox.id)).deliveryStatus,'TEST_ONLY');
  assert.equal((await post(`/api/downloads/${PRODUCTS[0].id}/token`,{orderId:sandbox.id})).status,403);
  assert.equal((await originalFetch(base+`/api/orders/${sandbox.id}/invoice`,{headers:{Cookie:`sid=${alice}`}})).status,403);
 }finally{await new Promise<void>(r=>server.close(()=>r()));Store.rpc=originalRpc;globalThis.fetch=originalFetch;await db.close();}
});
