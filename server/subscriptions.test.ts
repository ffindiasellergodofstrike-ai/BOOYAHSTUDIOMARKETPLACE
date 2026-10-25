import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import { Store } from './store';
import { CREATOR_PLANS } from './creatorPlans';
import { CREATOR_AGREEMENT } from './creatorMarketplace';
import { addBillingPeriod, currentPaidPeriod, getCreatorEntitlements, hasMembershipAccess, registerSubscriptionRoutes, subscriptionSummary, reconcileSubscriptions, subscriptionCheckoutQuote, getCreatorMembershipEarnings } from './subscriptions';
const migration=readFileSync(new URL('../supabase/migrations/202610230004_subscriptions.sql',import.meta.url),'utf8');
async function database(){const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(migration);return db;}
const rpcFor=(db:PGlite)=>async(operation:string,key='',value:any=null)=>(await db.query<any>('select public.subscription_operation($1,$2,$3::jsonb) as result',[operation,key,JSON.stringify(value)])).rows[0].result;
const creatorPlan={id:'test_creator_plan',name:'Creator',description:'More listings',audience:'creator',amount:499,currency:'INR',interval:'month',billingMode:'automatic',published:true,productLimit:25,features:['25 listings']};

test('subscription ledger: immutable snapshots, concurrency, payment/period binding, refunds, cancellation, expiry and test isolation',async()=>{
 const db=await database(),rpc=rpcFor(db);try{
  await rpc('plan','test_creator_plan',creatorPlan);
  const createdAt=new Date().toISOString();
  const start=async(id:string,uid=id,environment='live')=>rpc('reserve',id,{planId:'test_creator_plan',userId:uid,provider:'cashfree',environment,createdAt});
  let s=await start('sub_one');assert.equal(s.plan.amount,499);
  const duplicates=await Promise.all(Array.from({length:5},(_,i)=>start(`sub_dup_${i}`,'sub_one')));assert.ok(duplicates.every(s=>s.id==='sub_one'),'simultaneous starts reuse one immutable mandate');
  const acceptance={id:'agree_one',acceptedBy:'sub_one',acceptedAt:createdAt,policyVersion:'2026-10-23-example',offer:{id:'test_creator_plan',amount:499,currency:'INR',interval:'month',billingMode:'automatic'}};await rpc('acceptance','sub_one',acceptance);await assert.rejects(rpc('acceptance','sub_one',acceptance),/immutable/);await assert.rejects(rpc('acceptance','sub_one',{...acceptance,id:'bad_owner',acceptedBy:'other'}),/agreement/);await assert.rejects(rpc('acceptance','sub_one',{...acceptance,id:'bad_price',offer:{...acceptance.offer,amount:1}}),/agreement/);
  await rpc('plan','test_creator_plan',{...creatorPlan,amount:999,productLimit:100});await assert.rejects(rpc('reserve','changed_quote',{planId:'test_creator_plan',userId:'other',provider:'cashfree',environment:'live',createdAt,expectedPlan:creatorPlan}),/Plan changed/);const seeded=await rpc('seed_plan','test_creator_plan',creatorPlan);assert.equal(seeded.amount,999,'late default seeding cannot overwrite administrator pricing');assert.equal((await rpc('state')).subscriptions.sub_one.plan.amount,499,'editing catalog does not rewrite existing billing contract');
  assert.equal((await rpc('claim_checkout','sub_one',{leaseUntil:new Date(Date.now()+90000).toISOString()})).id,'sub_one');assert.equal(await rpc('claim_checkout','sub_one',{leaseUntil:new Date(Date.now()+90000).toISOString()}),null,'durable checkout lease prevents concurrent provider creates');await rpc('release_checkout','sub_one',{});
  s=await rpc('bind','sub_one',{providerRef:'native_one',provider:'razorpay',environment:'test',userId:'attacker',plan:{amount:1},payments:{fake:{verified:true}}});assert.equal(s.provider,'cashfree');assert.equal(s.environment,'live');assert.equal(s.userId,'sub_one');assert.deepEqual(s.payments,{});
  await assert.rejects(rpc('bind','sub_one',{providerRef:'different'}),/immutable/);
  const period={id:'pay_one',subscriptionRef:'native_one',amountPaise:49900,currency:'INR',periodStart:createdAt,periodEnd:addBillingPeriod(createdAt,'month')};
  const snapshot=(payments:any[],revocations:any[]=[])=>rpc('snapshot','sub_one',{provider:'cashfree',environment:'live',providerRef:'native_one',providerStatus:'ACTIVE',checkedAt:new Date().toISOString(),payments,revocations});
  s=await snapshot([]);assert.equal(currentPaidPeriod(s),undefined,'an active mandate without captured receipt cannot grant access');
  for(const wrong of [{...period,amountPaise:1},{...period,currency:'USD'},{...period,subscriptionRef:'other'},{...period,periodEnd:addBillingPeriod(period.periodEnd,'year')},{...period,periodStart:'2020-01-01T00:00:00Z'}])await assert.rejects(snapshot([wrong]),/mismatch|period/);
  await assert.rejects(rpc('snapshot','sub_one',{provider:'razorpay',environment:'live',providerRef:'native_one',payments:[period],revocations:[]}),/provider mismatch/);
  await Promise.all(Array.from({length:8},()=>snapshot([period])));s=(await rpc('state')).subscriptions.sub_one;assert.equal(Object.keys(s.payments).length,1);assert.equal(currentPaidPeriod(s)?.id,'pay_one');
  assert.equal(currentPaidPeriod(s,Date.parse(period.periodEnd)),undefined,'period expiry requires no asynchronous flag job');
  const next={...period,id:'pay_next',periodStart:period.periodEnd,periodEnd:addBillingPeriod(period.periodEnd,'month')};s=await snapshot([period,next]);assert.equal(currentPaidPeriod(s)?.id,'pay_one','future receipt does not grant its period early');
  s=await rpc('cancel','sub_one',{cancelledAt:createdAt});assert.equal(subscriptionSummary(s).cancelAtPeriodEnd,true);assert.equal(currentPaidPeriod(s)?.id,'pay_one','cancel retains only already paid period');s=await snapshot([period,next]);assert.equal(s.cancelAtPeriodEnd,true,'late active events cannot undo cancellation');
  s=await snapshot([period],[{id:'refund_one',paymentId:'pay_one',reason:'provider_refund'}]);assert.equal(currentPaidPeriod(s),undefined);s=await snapshot([period]);assert.equal(currentPaidPeriod(s),undefined,'success replay cannot restore a refunded period');
  await assert.rejects(snapshot([period],[{id:'refund_unknown',paymentId:'other'}]),/Unknown revoked/);
  await rpc('plan','test_creator_plan',creatorPlan);await start('sub_two');await rpc('bind','sub_two',{providerRef:'native_two'});
  await assert.rejects(rpc('snapshot','sub_two',{provider:'cashfree',environment:'live',providerRef:'native_two',payments:[{...period,subscriptionRef:'native_two'}],revocations:[]}),/another subscription/);
  const liveFromTest=await rpc('reserve','live_from_test',{planId:'test_creator_plan',userId:'test_to_live',provider:'cashfree',environment:'test',createdAt});assert.equal(liveFromTest.environment,'test');assert.equal((await rpc('reserve','live_after_test',{planId:'test_creator_plan',userId:'test_to_live',provider:'cashfree',environment:'live',createdAt})).environment,'live','test subscriptions do not block independent live activation');
  await start('sub_test','sub_test','test');await rpc('bind','sub_test',{providerRef:'native_test'});const testPaid=await rpc('snapshot','sub_test',{provider:'cashfree',environment:'test',providerRef:'native_test',payments:[{...period,id:'pay_test',subscriptionRef:'native_test'}],revocations:[]});assert.equal(currentPaidPeriod(testPaid),undefined,'sandbox receipts never grant listing limits or downloads');
  const event=await rpc('event','event_retry',{subscriptionId:'sub_one',provider:'cashfree'});await rpc('event_done','event_retry',{processedAt:createdAt});assert.equal((await rpc('event','event_retry',event)).status,'done','webhook replay is durably deduplicated');
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(db.query('select public.subscription_operation(\'state\',\'\',null)'),/permission denied/);await assert.rejects(db.query('select * from public.marketplace_billing_state'),/permission denied/);await db.exec('reset role');}
  await db.exec(migration);assert.equal((await rpc('state')).subscriptions.sub_one.payments.pay_one.revoked,true,'migration reapplication preserves revoked receipts');
 }finally{await db.close();}
});

test('manual renewal ledger binds a single paid period to a server-created attempt and preserves plan owner',async()=>{
 const db=await database(),rpc=rpcFor(db);try{
  const plan={...creatorPlan,id:'member',audience:'customer',creatorId:'creator_a',billingMode:'manual'};await rpc('plan','member',plan);
  await assert.rejects(rpc('plan','member',{...plan,creatorId:'creator_b'}),/ownership/);
  const s=await rpc('reserve','manual',{userId:'buyer',planId:'member',provider:'easebuzz',environment:'live',createdAt:new Date().toISOString()});await rpc('bind',s.id,{providerRef:'manual_parent'});
  const attempt=await rpc('attempt',s.id,{id:'bill_one',createdAt:new Date().toISOString()});assert.equal((await rpc('attempt',s.id,{id:'bill_other',createdAt:new Date().toISOString()})).id,attempt.id);await rpc('attempt_bind',s.id,{id:attempt.id,providerRef:'bill_one'});
  const payment={id:'paid_one',subscriptionRef:'manual_parent',amountPaise:49900,currency:'INR',periodStart:attempt.periodStart,periodEnd:attempt.periodEnd,attemptId:'bill_one',orderRef:'bill_one'};
  const snapshot=(p:any)=>rpc('snapshot',s.id,{provider:'easebuzz',environment:'live',providerRef:'manual_parent',payments:[p],revocations:[],checkedAt:new Date().toISOString()});
  await assert.rejects(snapshot({...payment,periodEnd:addBillingPeriod(payment.periodEnd,'month')}),/period/);await assert.rejects(snapshot({...payment,orderRef:'other'}),/Renewal period/);const paid=await snapshot(payment);assert.equal(currentPaidPeriod(paid)?.id,'paid_one');
  const renewal=await rpc('attempt',s.id,{id:'bill_renew',createdAt:new Date().toISOString()});assert.equal(Date.parse(renewal.periodStart),Date.parse(attempt.periodEnd),'renewal starts after the existing paid period and does not reset paid access');
 }finally{await db.close();}
});

test('calendar billing handles month end and leap years without granting extra months',()=>{assert.equal(addBillingPeriod('2026-01-31T13:20:00.000Z','month'),'2026-02-28T13:20:00.000Z');assert.equal(addBillingPeriod('2024-02-29T13:20:00.000Z','year'),'2025-02-28T13:20:00.000Z');});

test('subscription HTTP: authenticated trusted prices, manual billing, signed replay, provider switching, refunds and creator ownership',async t=>{
 const db=await database(),rpc=rpcFor(db),savedEnv={...process.env},nativeFetch=globalThis.fetch;
 Object.assign(process.env,{SUPABASE_URL:'https://billing.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role',CASHFREE_APP_ID:'synthetic-app',CASHFREE_SECRET_KEY:'synthetic-cashfree-secret',CASHFREE_ENV:'production',APP_URL:'https://market.example.test',RAZORPAY_KEY_ID:'rzp_live_synthetic',RAZORPAY_KEY_SECRET:'synthetic-rzp',RAZORPAY_WEBHOOK_SECRET:'synthetic-webhook'});
 const records:Record<string,any>={
  'marketplace/gateway-settings':{version:1,enabled:{cashfree:true,razorpay:true,easebuzz:false},defaultProvider:'cashfree',commissionBps:1000},
  'marketplace/creatorUsers/owner':'creator_owner',
  'marketplace/creators/creator_owner':{id:'creator_owner',userId:'owner',slug:'owner',displayName:'Owner studio',status:'approved',providerAccounts:{},publicBusiness:{businessName:'Test Owner',businessAddress:'Test street Varanasi 221003',supportEmail:'support@example.test',supportPhone:'9876543210',grievanceName:'Test Owner'},agreementVersion:CREATOR_AGREEMENT.version,agreementAcceptance:{userId:'owner',version:CREATOR_AGREEMENT.version,hash:CREATOR_AGREEMENT.hash,acceptedAt:new Date().toISOString()}},
  'marketplace/listings/product_one':{id:'product_one',sellerId:'creator_owner',status:'active',membershipEligible:true,file:{published:true}},
 };
 t.mock.method(Store,'get',async(key:string)=>records[key]??null);
 t.mock.method(Store,'set',async(key:string,value:any)=>{records[key]=value;});
 t.mock.method(Store,'getUserProfile',async(userId:string)=>({id:userId,name:'Test Customer',email:'customer@example.test',mobile:'9876543210'}));
 const orders=new Map<string,any>();let providerCreates=0,providerRefund=false,providerFailure=false;
 t.mock.method(globalThis,'fetch',async(input:any,init:any={})=>{
  const url=new URL(String(input));if(url.hostname==='127.0.0.1')return nativeFetch(input,init);
  if(url.hostname==='billing.example.invalid'){
   assert.equal(url.pathname,'/rest/v1/rpc/subscription_operation');const args=JSON.parse(init.body);try{return Response.json(await rpc(args.operation,args.key,args.value));}catch(error){return Response.json({message:String(error),code:'P0001'},{status:400});}
  }
  if(url.hostname==='api.cashfree.com'){
   if(providerFailure)return Response.json({code:'TEMPORARY'},{status:503});
   const path=url.pathname.replace('/pg/','');
   if(path==='orders'&&init.method==='POST'){const body=JSON.parse(init.body);providerCreates++;assert.equal(body.order_amount,499);const order={...body,payment_session_id:'synthetic-session'};orders.set(body.order_id,order);return Response.json(order);}
   const [resource,id,child]=path.split('/');if(resource==='orders'&&orders.has(id)){
    if(child==='payments')return Response.json([{order_id:id,cf_payment_id:`cf_${id}`,payment_status:'SUCCESS',payment_currency:'INR',payment_amount:499}]);
    if(child==='refunds')return Response.json(providerRefund?[{cf_payment_id:`cf_${id}`,refund_id:`refund_${id}`,refund_amount:499,refund_status:'SUCCESS'}]:[]);
    return Response.json(orders.get(id));
   }
  }
  throw new Error(`Unexpected external request in test: ${url.origin}${url.pathname}`);
 });
 const app=express();app.use(express.json({verify:(req:any,_res,buf)=>{req.rawBody=buf;}}));app.use(express.urlencoded({extended:false}));
 const auth:any=(req:any,res:any,next:any)=>{if(!req.headers['x-user'])return res.status(401).json({success:false});req.userId=String(req.headers['x-user']);next();};
 const admin:any=(req:any,res:any,next:any)=>req.userId==='admin'?next():res.status(403).json({success:false});const pass:any=(_req:any,_res:any,next:any)=>next();registerSubscriptionRoutes(app,auth,admin,pass);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const send=async(path:string,body?:unknown,user='owner',method=body===undefined?'GET':'POST')=>{const response=await fetch(`${origin}/api/marketplace${path}`,{method,headers:{'Content-Type':'application/json',...(user?{'x-user':user}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};};
 try{
  assert.equal((await send('/subscriptions',{},'')).status,401);assert.equal((await send('/admin/plans',undefined,'owner')).status,403);
  const plans=await send('/plans?audience=creator');assert.deepEqual(plans.data.plans.map((p:any)=>p.id),['creator_monthly_499','studio_monthly_899'],'the two authorised paid creator offers are published');
  const {id:_planId,...planFields}=creatorPlan;const manual={...planFields,billingMode:'manual',reason:'Configured creator pricing for launch'};assert.equal((await send('/admin/plans/test_creator_plan',manual,'admin','PUT')).status,200);
  assert.equal((await send('/subscriptions',{planId:'test_creator_plan',amount:1,agreeTerms:true,checkoutQuote:subscriptionCheckoutQuote((await rpc('state')).plans.test_creator_plan)})).status,400,'browser amount overrides are rejected');
  assert.equal((await send('/subscriptions',{planId:'test_creator_plan'})).status,400,'starting billing requires explicit terms consent');
  assert.equal((await send('/subscriptions',{planId:'test_creator_plan',agreeTerms:false})).status,400);assert.equal(providerCreates,0);
  assert.equal((await send('/subscriptions',{planId:'test_creator_plan',agreeTerms:true,checkoutQuote:'0'.repeat(64)})).status,409,'stale offer quotes stop before provider creation');assert.equal(providerCreates,0);
  const started=await send('/subscriptions',{planId:'test_creator_plan',agreeTerms:true,checkoutQuote:subscriptionCheckoutQuote((await rpc('state')).plans.test_creator_plan)});assert.equal(started.status,200);assert.equal(started.data.subscription.amount,499);assert.equal(started.data.subscription.hasAccess,false);assert.equal(providerCreates,1);assert.equal(started.data.checkout.mode,'cashfree');
  const id=started.data.subscription.id;const acceptance=Object.values((await rpc('state')).subscriptions[id].acceptances)[0] as any;assert.equal(acceptance.acceptedBy,'owner');assert.equal(acceptance.offer.amount,499);assert.equal(acceptance.offer.billingMode,'manual');assert.ok(records[`policyDocuments/${acceptance.policyVersion}`]);assert.equal((await send(`/admin/subscriptions/${id}/reconcile`,{reason:'Customer asked for billing review'},'owner')).status,403);assert.equal((await send(`/admin/subscriptions/${id}/reconcile`,{reason:'short'},'admin')).status,400);assert.equal((await send(`/subscriptions/${id}/reconcile`,{},'other')).status,404);
  const paid=await send(`/subscriptions/${id}/reconcile`,{});assert.equal(paid.status,200);assert.equal(paid.data.subscription.hasAccess,true);assert.equal((await getCreatorEntitlements('owner')).productLimit,25);
  records['marketplace/gateway-settings'].defaultProvider='razorpay';records['marketplace/gateway-settings'].enabled.cashfree=false;
  const afterSwitch=await send(`/subscriptions/${id}/reconcile`,{});assert.equal(afterSwitch.status,200);assert.equal(afterSwitch.data.subscription.provider,'cashfree','existing subscriptions keep their original provider after admin switch');
  const attempt=Object.values((await rpc('state')).subscriptions[id].attempts)[0] as any;
  const raw=JSON.stringify({type:'PAYMENT_SUCCESS_WEBHOOK',data:{order:{order_id:attempt.providerRef}}}),timestamp=String(Date.now()),signature=crypto.createHmac('sha256',process.env.CASHFREE_SECRET_KEY!).update(timestamp).update(raw).digest('base64');
  const webhook=async(sig=signature)=>fetch(`${origin}/api/marketplace/subscriptions/webhooks/cashfree`,{method:'POST',headers:{'Content-Type':'application/json','x-webhook-signature':sig,'x-webhook-timestamp':timestamp},body:raw});
  assert.equal((await webhook('bad')).status,400);assert.equal((await webhook()).status,200);assert.equal((await webhook()).status,200);assert.equal(Object.keys((await rpc('state')).events).length,1,'signed replay is durable');
  providerFailure=true;assert.equal((await send(`/subscriptions/${id}/reconcile`,{})).status,503);assert.equal((await rpc('state')).subscriptions[id].payments[`cf_${attempt.id}`].revoked,false,'provider failure cannot mutate paid receipts');providerFailure=false;
  providerRefund=true;const refunded=await send(`/subscriptions/${id}/reconcile`,{});assert.equal(refunded.data.subscription.hasAccess,false);assert.equal((await getCreatorEntitlements('owner')).productLimit,0);providerRefund=false;assert.equal((await send(`/subscriptions/${id}/reconcile`,{})).data.subscription.hasAccess,false,'late success does not restore a refunded period');
  const offer={name:'Monthly collection',description:'Creator-owned collection',amount:199,currency:'INR',interval:'month',billingMode:'manual',published:true,features:['Included downloads']};
  assert.equal((await send('/me/membership-plans',offer)).status,403,'a refunded or missing creator plan cannot create premium membership offers');
  const basicPlan=CREATOR_PLANS.find(plan=>plan.id==='creator_monthly_499')!;
  const basicStart=new Date().toISOString();await rpc('reserve','basic_paid',{userId:'owner',planId:basicPlan.id,provider:'cashfree',environment:'live',createdAt:basicStart});await rpc('bind','basic_paid',{providerRef:'basic_parent'});const basicAttempt=await rpc('attempt','basic_paid',{id:'basic_bill',createdAt:basicStart});await rpc('attempt_bind','basic_paid',{id:basicAttempt.id,providerRef:'basic_bill'});
  await rpc('snapshot','basic_paid',{provider:'cashfree',environment:'live',providerRef:'basic_parent',providerStatus:'ACTIVE',checkedAt:basicStart,payments:[{id:'basic_payment',subscriptionRef:'basic_parent',currency:'INR',amountPaise:49900,periodStart:basicAttempt.periodStart,periodEnd:basicAttempt.periodEnd,attemptId:basicAttempt.id,orderRef:'basic_bill'}],revocations:[]});
  assert.equal((await getCreatorEntitlements('owner')).productLimit,10);assert.equal((await getCreatorEntitlements('owner')).features.customerMemberships,false);assert.equal((await send('/me/membership-plans',offer)).status,403,'the 499 plan cannot invoke the Studio-only membership API');
  const studioPlan=CREATOR_PLANS.find(plan=>plan.id==='studio_monthly_899')!;
  await rpc('seed_plan',studioPlan.id,studioPlan);
  const studioStart=new Date().toISOString();
  await rpc('reserve','studio_paid',{userId:'owner',planId:studioPlan.id,provider:'cashfree',environment:'live',createdAt:studioStart});
  await rpc('bind','studio_paid',{providerRef:'studio_parent'});const studioAttempt=await rpc('attempt','studio_paid',{id:'studio_bill',createdAt:studioStart});await rpc('attempt_bind','studio_paid',{id:studioAttempt.id,providerRef:'studio_bill'});
  await rpc('snapshot','studio_paid',{provider:'cashfree',environment:'live',providerRef:'studio_parent',providerStatus:'ACTIVE',checkedAt:studioStart,payments:[{id:'studio_payment',subscriptionRef:'studio_parent',currency:'INR',amountPaise:89900,periodStart:studioAttempt.periodStart,periodEnd:studioAttempt.periodEnd,attemptId:studioAttempt.id,orderRef:'studio_bill'}],revocations:[]});
  assert.equal((await getCreatorEntitlements('owner')).productLimit,null);assert.equal((await getCreatorEntitlements('owner')).features.customerMemberships,true);
  // JSONB sorts subscription keys; this valid basic plan is deliberately visited
  // after the unlimited plan and must never replace its stronger entitlement.
  await rpc('seed_plan','basic_second',{...basicPlan,id:'basic_second'});
  await rpc('reserve','zzz_basic_paid',{userId:'owner',planId:'basic_second',provider:'cashfree',environment:'live',createdAt:studioStart});await rpc('bind','zzz_basic_paid',{providerRef:'zzz_basic_parent'});const lateBasicAttempt=await rpc('attempt','zzz_basic_paid',{id:'zzz_basic_bill',createdAt:studioStart});await rpc('attempt_bind','zzz_basic_paid',{id:lateBasicAttempt.id,providerRef:'zzz_basic_bill'});
  await rpc('snapshot','zzz_basic_paid',{provider:'cashfree',environment:'live',providerRef:'zzz_basic_parent',providerStatus:'ACTIVE',checkedAt:studioStart,payments:[{id:'zzz_basic_payment',subscriptionRef:'zzz_basic_parent',currency:'INR',amountPaise:49900,periodStart:lateBasicAttempt.periodStart,periodEnd:lateBasicAttempt.periodEnd,attemptId:lateBasicAttempt.id,orderRef:'zzz_basic_bill'}],revocations:[]});
  assert.equal((await getCreatorEntitlements('owner')).planId,studioPlan.id);assert.equal((await getCreatorEntitlements('owner')).unlimited,true,'entitlements preserve unlimited access independently of subscription iteration order');
  const saved=await send('/me/membership-plans',offer);assert.equal(saved.status,200);assert.equal(saved.data.plan.creatorId,'creator_owner');assert.equal(saved.data.plan.published,false,'creator cannot self-approve a membership offer');assert.equal((await send(`/me/membership-plans/${saved.data.plan.id}`,offer,'other','PATCH')).status,403);
  const owned=await send('/me/membership-plans');assert.equal(owned.data.plans.length,1);assert.equal((await send('/plans?audience=customer')).data.plans.length,0,'draft customer offers are private');
  assert.equal((await hasMembershipAccess('owner','product_one')),null,'a creator plan does not grant customer membership downloads');
  const memberPlan={...saved.data.plan,published:true};delete memberPlan.id;delete memberPlan.updatedAt;assert.equal((await send(`/admin/plans/${saved.data.plan.id}`,{...memberPlan,reason:'Reviewed creator membership pricing and access'},'admin','PUT')).status,200);
  const memberStart=new Date().toISOString();await rpc('reserve','member_paid',{userId:'buyer',planId:saved.data.plan.id,provider:'cashfree',environment:'live',createdAt:memberStart,split:{accountId:'private_vendor',commissionBps:1000}});await rpc('bind','member_paid',{providerRef:'member_native'});
  await rpc('snapshot','member_paid',{provider:'cashfree',environment:'live',providerRef:'member_native',payments:[],revocations:[],checkedAt:memberStart});assert.equal(await hasMembershipAccess('buyer','product_one'),null,'a pending membership cannot download');
  const legacyQuote=subscriptionCheckoutQuote((await rpc('state')).subscriptions.member_paid.plan);
  records['marketplace/gateway-settings'].enabled.cashfree=true;
  const oldFeeResume=await send('/subscriptions/member_paid/resume',{agreeTerms:true,checkoutQuote:legacyQuote},'buyer');assert.equal(oldFeeResume.status,409);assert.match(oldFeeResume.data.message,/different fee or settlement arrangement/,'a historical percentage split is retained for receipts but cannot silently charge a newly accepted flat-fee period');
  const oldAutomaticPlan={...(await rpc('state')).plans[saved.data.plan.id],id:'old_auto_membership',billingMode:'automatic'};await rpc('seed_plan',oldAutomaticPlan.id,oldAutomaticPlan);await rpc('reserve','old_auto_pending',{userId:'buyer',planId:oldAutomaticPlan.id,provider:'cashfree',environment:'live',createdAt:memberStart,split:{accountId:'private_vendor',commissionBps:1000}});
  const oldAutoResume=await send('/subscriptions/old_auto_pending/resume',{agreeTerms:true,checkoutQuote:subscriptionCheckoutQuote((await rpc('state')).subscriptions.old_auto_pending.plan)},'buyer');assert.equal(oldAutoResume.status,409);assert.match(oldAutoResume.data.message,/requires manual renewal/,'resume cannot bypass the native creator-split reserve gate');
  records['marketplace/gateway-settings'].enabled.cashfree=false;
  // Manual plans require a server-owned attempt even in an internal financial RPC.
  const ma=await rpc('attempt','member_paid',{id:'bill_member',createdAt:memberStart});await rpc('attempt_bind','member_paid',{id:ma.id,providerRef:'bill_member'});
  const mp={id:'cf_member',subscriptionRef:'member_native',amountPaise:19900,currency:'INR',periodStart:ma.periodStart,periodEnd:ma.periodEnd,attemptId:ma.id,orderRef:'bill_member'};
  await rpc('snapshot','member_paid',{provider:'cashfree',environment:'live',providerRef:'member_native',payments:[mp],revocations:[],checkedAt:memberStart});assert.equal((await hasMembershipAccess('buyer','product_one'))?.subscriptionId,'member_paid');const membershipEarnings=await getCreatorMembershipEarnings('creator_owner');assert.equal(membershipEarnings.grossPaise,19900);assert.equal(membershipEarnings.payablePaise,17910);assert.equal(membershipEarnings.entries[0].settlementStatus,'provider_confirmation_required');assert.equal(JSON.stringify(membershipEarnings).includes('private_vendor'),false);
  assert.equal(await hasMembershipAccess('other','product_one'),null,'another account never inherits membership');records['marketplace/listings/product_one'].membershipEligible=false;assert.equal(await hasMembershipAccess('buyer','product_one'),null,'membership cannot open excluded files');records['marketplace/listings/product_one'].membershipEligible=true;records['marketplace/creators/creator_owner'].status='suspended';assert.equal(await hasMembershipAccess('buyer','product_one'),null,'suspension prevents membership downloads');records['marketplace/creators/creator_owner'].status='approved';
  await rpc('snapshot','member_paid',{provider:'cashfree',environment:'live',providerRef:'member_native',payments:[mp],revocations:[{id:'refund_member',paymentId:mp.id}],checkedAt:memberStart});assert.equal(await hasMembershipAccess('buyer','product_one'),null,'refunded membership is revoked');assert.equal((await getCreatorMembershipEarnings('creator_owner')).payablePaise,0);

  assert.equal((await send(`/subscriptions/${id}/cancel`,{})).status,200);assert.equal((await send(`/subscriptions/${id}/renew`,{agreeTerms:true,checkoutQuote:subscriptionCheckoutQuote((await rpc('state')).subscriptions[id].plan)})).status,409);
  assert.equal((await send(`/admin/subscriptions/${id}/reconcile`,{reason:'Owner reviewed provider verification'},'admin')).status,200);assert.equal((await send(`/admin/subscriptions/${id}/cancel`,{reason:'Customer requested cancellation via support'},'admin')).status,200);assert.ok(Object.keys((await rpc('state')).audit).length>=2);
  const jobs=await reconcileSubscriptions();assert.ok(jobs.checked>=1);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));t.mock.restoreAll();for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];Object.assign(process.env,savedEnv);await db.close();}
});

test('native recurring HTTP: Cashfree authorisation is not access; Razorpay requires paid invoice plus captured exact receipt and cancellations preserve only paid periods',async t=>{
 const db=await database(),rpc=rpcFor(db),savedEnv={...process.env},nativeFetch=globalThis.fetch;
 Object.assign(process.env,{SUPABASE_URL:'https://billing.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role',CASHFREE_APP_ID:'synthetic-app',CASHFREE_SECRET_KEY:'synthetic-cashfree-secret',CASHFREE_ENV:'production',CASHFREE_SUBSCRIPTIONS_APPROVED:'true',APP_URL:'https://market.example.test',RAZORPAY_KEY_ID:'rzp_live_synthetic',RAZORPAY_KEY_SECRET:'synthetic-rzp',RAZORPAY_WEBHOOK_SECRET:'synthetic-webhook',RAZORPAY_SUBSCRIPTIONS_APPROVED:'true'});
 t.mock.method(Store,'set',async()=>{});
 const settings={version:1,enabled:{cashfree:true,razorpay:true,easebuzz:false},defaultProvider:'cashfree',commissionBps:1000};
 t.mock.method(Store,'get',async(key:string)=>key==='marketplace/gateway-settings'?settings:key==='marketplace/creatorUsers/owner'?'creator_owner':key==='marketplace/creators/creator_owner'?{id:'creator_owner',userId:'owner',status:'approved',providerAccounts:{}}:null);
 t.mock.method(Store,'getUserProfile',async()=>({name:'Test Customer',email:'customer@example.test',mobile:'9876543210'}));
 let cf:any,rzp:any,rzpPlan:any,charge=false,refunded=false,cfCancelled=false,rzpCancelled=false,rzpCreates=0;const start=new Date().toISOString();
 t.mock.method(globalThis,'fetch',async(input:any,init:any={})=>{
  const url=new URL(String(input));if(url.hostname==='127.0.0.1')return nativeFetch(input,init);
  if(url.hostname==='billing.example.invalid'){const args=JSON.parse(init.body);try{return Response.json(await rpc(args.operation,args.key,args.value));}catch(e){return Response.json({message:String(e),code:'P0001'},{status:400});}}
  if(url.hostname==='api.cashfree.com'){
   const path=url.pathname.replace('/pg/','');
   if(path==='subscriptions'&&init.method==='POST'){const body=JSON.parse(init.body);assert.equal(body.plan_details.plan_amount,499);assert.equal(body.authorization_details.authorization_amount_refund,true);cf={...body,subscription_session_id:'subs_token_synthetic',subscription_status:'ACTIVE'};return Response.json(cf);}
   if(path===`subscriptions/${cf?.subscription_id}`)return Response.json(cf);
   if(path===`subscriptions/${cf?.subscription_id}/payments`)return Response.json([{cf_payment_id:'cf_auth',subscription_id:cf.subscription_id,payment_type:'AUTH',payment_status:'SUCCESS',payment_amount:1,payment_schedule_date:start},...(charge?[{cf_payment_id:'cf_charge',subscription_id:cf.subscription_id,payment_type:'CHARGE',payment_status:'SUCCESS',payment_amount:499,payment_schedule_date:start}]:[])]);
   if(path===`subscriptions/${cf?.subscription_id}/manage`){cfCancelled=true;assert.equal(JSON.parse(init.body).action,'CANCEL');return Response.json({...cf,subscription_status:'CANCELLED'});}
  }
  if(url.hostname==='api.razorpay.com'){
   const path=url.pathname.replace('/v1/','');
   if(path==='plans'&&init.method==='POST'){rzpPlan={id:'plan_native',...JSON.parse(init.body)};return Response.json(rzpPlan);}
   if(path==='subscriptions'&&init.method==='POST'){rzpCreates++;rzp={id:'sub_native',status:'active',...JSON.parse(init.body)};return Response.json(rzp);}
   if(path==='subscriptions/sub_native')return Response.json(rzp);
   if(path==='plans/plan_native')return Response.json(rzpPlan);
   if(path==='invoices')return Response.json({items:charge?[{id:'inv_native',subscription_id:'sub_native',status:'paid',payment_id:'pay_native',amount:49900,amount_paid:49900,amount_due:0,currency:'INR',billing_start:Math.floor(Date.parse(start)/1000),billing_end:Math.floor(Date.parse(addBillingPeriod(start,'month'))/1000)}]:[]});
   if(path==='payments/pay_native')return Response.json({id:'pay_native',invoice_id:'inv_native',status:'captured',captured:true,amount:49900,amount_refunded:refunded?49900:0,currency:'INR'});
   if(path==='subscriptions/sub_native/cancel'){rzpCancelled=true;assert.equal(JSON.parse(init.body).cancel_at_cycle_end,1);return Response.json({...rzp,status:'cancelled'});}
  }
  throw new Error(`Unexpected external request in recurring test: ${url.origin}${url.pathname}`);
 });
 const app=express();app.use(express.json());const auth:any=(req:any,_res:any,next:any)=>{req.userId='owner';next();};const pass:any=(_req:any,_res:any,next:any)=>next();registerSubscriptionRoutes(app,auth,pass,pass);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const send=async(path:string,body:any={})=>{const response=await fetch(`${origin}/api/marketplace${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 try{
  await rpc('plan','test_creator_plan',creatorPlan);let created=await send('/subscriptions',{planId:'test_creator_plan',agreeTerms:true,checkoutQuote:subscriptionCheckoutQuote((await rpc('state')).plans.test_creator_plan)});assert.equal(created.status,200);const cfId=created.data.subscription.id;assert.ok(created.data.checkout.subscriptionSessionId);assert.equal((await send(`/subscriptions/${cfId}/reconcile`)).data.subscription.hasAccess,false,'mandate ACTIVE plus refundable AUTH is not a paid period');
  charge=true;assert.equal((await send(`/subscriptions/${cfId}/reconcile`)).data.subscription.hasAccess,true);assert.equal((await send(`/subscriptions/${cfId}/cancel`)).status,200);assert.equal(cfCancelled,true);assert.equal((await send(`/subscriptions/${cfId}/reconcile`)).data.subscription.cancelAtPeriodEnd,true);
  settings.defaultProvider='razorpay';await rpc('plan','native_studio_plan',{...creatorPlan,id:'native_studio_plan'});created=await send('/subscriptions',{planId:'native_studio_plan',agreeTerms:true,checkoutQuote:subscriptionCheckoutQuote((await rpc('state')).plans.native_studio_plan)});assert.equal(created.status,200);const rzpId=created.data.subscription.id;assert.equal(created.data.checkout.subscriptionId,'sub_native');assert.equal(rzpCreates,1);assert.equal((await send(`/subscriptions/${rzpId}/reconcile`)).data.subscription.hasAccess,true,'exact paid invoice and captured payment bind a real period');
  assert.equal((await send(`/subscriptions/${rzpId}/cancel`)).status,200);assert.equal(rzpCancelled,true);refunded=true;assert.equal((await send(`/subscriptions/${rzpId}/reconcile`)).data.subscription.hasAccess,false);refunded=false;assert.equal((await send(`/subscriptions/${rzpId}/reconcile`)).data.subscription.hasAccess,false,'a stale captured receipt cannot reopen a refunded invoice');
 }finally{await new Promise<void>(r=>server.close(()=>r()));t.mock.restoreAll();for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];Object.assign(process.env,savedEnv);await db.close();}
});
