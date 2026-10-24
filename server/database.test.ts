import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL schema: role isolation, atomic fulfilment, duplicate events and refund/revocation ordering', async () => {
 const db=new PGlite();
 try {
  await db.exec('create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key, name text, public boolean); create table storage.objects(id text, bucket_id text); alter table storage.objects enable row level security;');
  await db.exec(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  await db.exec("update storage.buckets set public=true where id='products'");
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005_payment_security.sql',import.meta.url),'utf8'));
  assert.equal((await db.query<any>("select public from storage.buckets where id='products'")).rows[0].public,false);
  const rpc=async (operation:string,key:string,value:any=null) => (await db.query<{result:any}>('select public.store_operation($1,$2,$3::jsonb) as result',[operation,key,JSON.stringify(value)])).rows[0].result;
  await db.exec("insert into storage.objects values ('paid-file','products'),('cover','product-images'); grant usage on schema storage to anon,authenticated; grant select on storage.objects to anon,authenticated; create policy old_broad_policy on storage.objects for select to anon,authenticated using(true);");
  for (const role of ['anon','authenticated']) {
   await db.exec(`set role ${role}`);
   await assert.rejects(db.query("select public.store_operation('get','orders',null)"),/permission denied/);
   await assert.rejects(db.query('select * from public.store_state'),/permission denied/);
   assert.deepEqual((await db.query<any>('select id from storage.objects')).rows.map(r=>r.id),['cover'],'restrictive paid-file rule defeats broad legacy policy');
   await db.exec('reset role');
  }
  const order={id:'one',userId:'alice',total:299,paymentStatus:'PENDING',status:'PENDING',items:[{productId:'template',productTitle:'Template'}]};
  await rpc('set','orders/one',order);
  await rpc('bind_payment','orders/one',{razorpayOrderId:'order_one',paymentProvider:'Razorpay',paymentEnvironment:'live'});
  const payment={id:'pay_one',order_id:'order_one',environment:'live',amount:29900,currency:'INR',status:'captured',amount_refunded:0};
  await assert.rejects(rpc('confirm_payment','orders/one',{}),/mismatch/);
  await assert.rejects(rpc('confirm_payment','orders/one',{...payment,amount:1}),/mismatch/);
  await Promise.all(Array.from({length:8},()=>rpc('confirm_payment','orders/one',payment)));
  const paid=await rpc('get','orders/one');
  assert.equal(paid.paymentStatus,'PAID');assert.equal(paid.deliveryStatus,'DELIVERED');
  assert.equal(Object.keys(await rpc('get','purchases')).length,1);
  assert.deepEqual(await rpc('get','users/alice/orders/one'),paid);
  assert.equal(Object.keys(paid.paymentHistory).length,1);
  await rpc('record_dispute','orders/one',{id:'disp_one',payment_id:'pay_one',status:'lost'});
  await assert.rejects(rpc('restore_order_access','orders/one'),/Dispute requires review/);
  await rpc('record_dispute','orders/one',{id:'disp_one',payment_id:'pay_one',status:'won'});
  await rpc('restore_order_access','orders/one');
  assert.equal((await rpc('get','orders/one')).deliveryStatus,'DELIVERED');
  await rpc('revoke_order','orders/one');
  await rpc('confirm_payment','orders/one',payment);
  assert.equal((await rpc('get','orders/one')).deliveryStatus,'REVOKED');
  await rpc('confirm_payment','orders/one',{...payment,amount_refunded:29900,status:'refunded'});
  await rpc('confirm_payment','orders/one',payment);
  assert.equal((await rpc('get','orders/one')).paymentStatus,'REFUNDED');
  await assert.rejects(rpc('restore_order_access','orders/one'),/cannot be restored/);
  await rpc('set','orders/test',{...order,id:'test'});
  await rpc('bind_payment','orders/test',{razorpayOrderId:'order_test',paymentProvider:'Razorpay',paymentEnvironment:'test'});
  await rpc('confirm_payment','orders/test',{...payment,order_id:'order_test',environment:'test'});
  assert.equal((await rpc('get','orders/test')).deliveryStatus,'TEST_ONLY');
  assert.equal(Object.keys(await rpc('get','purchases')).length,1);
  const claims=await Promise.all(Array.from({length:8},()=>rpc('claim_email','notifications/one',{now:1000})));
  assert.equal(claims.filter(Boolean).length,1);
  await rpc('update','notifications/one',{status:'sent'});
  assert.equal(await rpc('claim_email','notifications/one',{now:90000000}),false);
  const count=await Promise.all(Array.from({length:25},()=>rpc('rate','limits/example',{now:1,windowMs:60000,maxAttempts:20})));
  assert.equal(count.filter(Boolean).length,20);
 } finally { await db.close(); }
});
