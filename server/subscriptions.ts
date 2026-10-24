import crypto from 'node:crypto';
import type { Express, RequestHandler, Request } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from './supabase';
import { Store } from './store';
import { appOrigin } from './config';
import { cashfreeConfig, cashfreeRequest, cashfreeIdempotencyKey, verifyCashfreeSignature, moneyPaise } from './cashfree';
import { paymentEnvironment, razorpayRequest, verifySignature } from './razorpay';
import { getActiveGateway, getGatewayCapabilities, getGatewaySettings, assertGatewayForNewOrder } from './gatewayControl';
import { createEasebuzzHostedPayment, retrieveEasebuzzPayment, verifyEasebuzzCallbackHash, easebuzzConfig } from './easebuzz';
import { verifyCreatorGatewayAccount } from './gatewaySplits';
import { razorpayBillingList } from './subscriptionProviders';
import { getCreatorByUserId, getCreatorById, getCreatorProviderDetails, creatorHasCurrentAgreement } from './creatorMarketplace';
import type { SubscriptionPlan, SubscriptionSummary, SubscriptionCheckout, SubscriptionProvider } from '../src/types/subscription';
import { policyVersion, policyDocuments } from './policies';

type PaidPeriod = { id:string; subscriptionRef:string; currency:'INR'; amountPaise:number; periodStart:string; periodEnd:string; verified?:boolean; revoked?:boolean; attemptId?:string; orderRef?:string };
type Attempt = {id:string; createdAt:string; periodStart:string; periodEnd:string; status:string; providerRef?:string; checkout?:SubscriptionCheckout;creationAttemptedAt?:string};
type SubscriptionRecord = {id:string; userId:string; planId:string; plan:SubscriptionPlan; provider:SubscriptionProvider; environment:'live'|'test'; createdAt:string; status:string; cancelAtPeriodEnd:boolean; providerRef?:string; providerPlanId?:string; checkout?:SubscriptionCheckout; payments:Record<string,PaidPeriod>; attempts:Record<string,Attempt>; buyer?:{email:string;phone:string;name:string}; split?:{accountId:string;commissionBps:number}; firstChargeAt?:string; lastCheckedAt?:string;checkoutLeaseUntil?:string};
type BillingEvent = {id:string; provider:SubscriptionProvider; subscriptionId:string; status:string; refundId?:string; paymentId?:string; disputeId?:string; receivedAt:string};
type BillingState = {plans:Record<string,SubscriptionPlan>; subscriptions:Record<string,SubscriptionRecord>; payments:Record<string,string>; events:Record<string,BillingEvent>;audit?:Record<string,any>};
const idPattern=/^[A-Za-z0-9_-]{1,100}$/;
const defaults:SubscriptionPlan[]=[
 {id:'starter',name:'Starter',description:'Start your creator journey.',audience:'creator',amount:0,currency:'INR',interval:'month',billingMode:'manual',published:true,productLimit:5,features:['5 product listings','Your own storefront','Order management']},
 {id:'creator',name:'Creator',description:'More room for your growing collection.',audience:'creator',amount:499,currency:'INR',interval:'month',billingMode:'manual',published:false,productLimit:25,features:['25 product listings','Your own storefront','Order management']},
 {id:'studio',name:'Studio',description:'A larger catalogue for established creators.',audience:'creator',amount:1499,currency:'INR',interval:'month',billingMode:'manual',published:false,productLimit:100,features:['100 product listings','Your own storefront','Order management']},
];
export class SubscriptionError extends Error { constructor(message:string,public status=400){super(message);} }
/** No filesystem/Firebase fallback: a failed durable write must stop checkout. */
export async function billingOperation<T=any>(operation:string,key='',value:any=null):Promise<T>{
 const {data,error}=await supabaseAdmin().rpc('subscription_operation',{operation,key,value});
 if(error?.message?.includes('Plan changed before checkout'))throw new SubscriptionError('This offer changed before checkout was created. Refresh and review its price again.',409);
 if(error) throw new SubscriptionError('Billing is temporarily unavailable. Please try again later.',503);
 return data as T;
}
async function state():Promise<BillingState>{
 const data=await billingOperation<BillingState>('state');
 for(const plan of defaults) if(!data.plans[plan.id]) data.plans[plan.id]=await billingOperation('seed_plan',plan.id,plan);
 return data;
}
const values=<T>(value:Record<string,T>|undefined):T[]=>Object.values(value||{});
const nowIso=()=>new Date().toISOString();
export const subscriptionCheckoutQuote=(plan:SubscriptionPlan)=>crypto.createHash('sha256').update(JSON.stringify({policyVersion,plan})).digest('hex');
export function addBillingPeriod(start:string,interval:'month'|'year'):string{
 const date=new Date(start); if(!Number.isFinite(date.getTime())) throw new SubscriptionError('Invalid billing date');
 const day=date.getUTCDate(); date.setUTCDate(1);
 if(interval==='year') date.setUTCFullYear(date.getUTCFullYear()+1); else date.setUTCMonth(date.getUTCMonth()+1);
 const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate(); date.setUTCDate(Math.min(day,last));
 return date.toISOString();
}
export function currentPaidPeriod(record:SubscriptionRecord,now=Date.now()):PaidPeriod|undefined{
 if(record.environment!=='live') return;
 return values(record.payments).filter(p=>p.verified===true&&p.revoked===false&&p.subscriptionRef===record.providerRef&&p.currency==='INR'&&p.amountPaise===Math.round(record.plan.amount*100)&&Date.parse(p.periodStart)<=now&&Date.parse(p.periodEnd)>now).sort((a,b)=>Date.parse(b.periodEnd)-Date.parse(a.periodEnd))[0];
}
export function subscriptionSummary(s:SubscriptionRecord):SubscriptionSummary{
 const period=currentPaidPeriod(s); const last=period||values(s.payments).filter(p=>p.verified&&!p.revoked).sort((a,b)=>Date.parse(b.periodEnd)-Date.parse(a.periodEnd))[0];
 return {id:s.id,userId:s.userId,planId:s.plan.id,planName:s.plan.name,audience:s.plan.audience,creatorId:s.plan.creatorId,provider:s.provider,environment:s.environment,billingMode:s.plan.billingMode,status:period?(s.cancelAtPeriodEnd?'cancel_scheduled':'active'):(s.cancelAtPeriodEnd?'cancel_scheduled':values(s.payments).some(p=>p.revoked)?'refunded':last&&Date.parse(last.periodEnd)<=Date.now()?'expired':s.status==='active'?'expired':s.status),amount:s.plan.amount,currency:'INR',interval:s.plan.interval,currentPeriodStart:last?.periodStart,currentPeriodEnd:last?.periodEnd,cancelAtPeriodEnd:s.cancelAtPeriodEnd,createdAt:s.createdAt,hasAccess:Boolean(period),checkoutQuote:subscriptionCheckoutQuote(s.plan)};
}
async function publicPlans(){return process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?values((await state()).plans):defaults;}
export async function getCreatorPlanSummaries(){return (await publicPlans()).filter(p=>p.audience==='creator'&&p.published).map(plan=>({...plan,checkoutQuote:subscriptionCheckoutQuote(plan)}));}
export async function getBillingAudit(){return values((await state()).audit);}
export async function getCreatorEntitlements(userId:string):Promise<{planId:string;productLimit:number;expiresAt?:string;subscriptionId?:string}>{
 const data=await state(); const starter=data.plans.starter;
 let result:{planId:string;productLimit:number;expiresAt?:string;subscriptionId?:string}={planId:'starter',productLimit:starter?.productLimit||5};
 for(const record of values(data.subscriptions)){
  if(record.userId!==userId||record.plan.audience!=='creator') continue;
  let fresh=record;if(record.environment==='live'&&(!record.lastCheckedAt||Date.parse(record.lastCheckedAt)<Date.now()-15*60_000)){try{fresh=await reconcileSubscription(record);}catch{continue;}}
  const period=currentPaidPeriod(fresh); if(!period||!record.plan.productLimit||record.plan.productLimit<=result.productLimit) continue;
  result={planId:record.plan.id,productLimit:record.plan.productLimit,expiresAt:period.periodEnd,subscriptionId:record.id};
 }
 return result;
}
export async function hasMembershipAccess(userId:string,productId:string):Promise<{subscriptionId:string;creatorId:string;expiresAt:string}|null>{
 if(!idPattern.test(userId)||!idPattern.test(productId))return null;
 const listing=await Store.get<any>(`marketplace/listings/${productId}`);
 if(!listing||listing.status!=='active'||listing.membershipEligible!==true||!listing.sellerId||listing.file?.published!==true) return null;
 const creator=await getCreatorById(listing.sellerId); if(!creator||creator.status!=='approved') return null;
 for(const record of values((await state()).subscriptions)){
  if(record.userId!==userId||record.plan.audience!=='customer'||record.plan.creatorId!==listing.sellerId) continue;
  let fresh=record;if(record.environment==='live'&&(!record.lastCheckedAt||Date.parse(record.lastCheckedAt)<Date.now()-15*60_000)){try{fresh=await reconcileSubscription(record);}catch{continue;}}
  const period=currentPaidPeriod(fresh); if(period) return {subscriptionId:record.id,creatorId:listing.sellerId,expiresAt:period.periodEnd};
 }
 return null;
}
/** Read-only accounting view of immutable live receipts; never a bank settlement confirmation. */
export async function getCreatorMembershipEarnings(creatorId:string){
 if(!idPattern.test(creatorId))return {entries:[],grossPaise:0,commissionPaise:0,payablePaise:0,refundPaise:0};
 const earnings=[];
 for(const s of values((await state()).subscriptions)){
  if(s.plan.audience!=='customer'||s.plan.creatorId!==creatorId||s.environment!=='live'||!s.split||!s.providerRef)continue;
  for(const p of values(s.payments)){
   if(p.verified!==true||p.subscriptionRef!==s.providerRef||p.currency!=='INR'||p.amountPaise!==Math.round(s.plan.amount*100))continue;
   const revocation=(p as any).revocation;
   const refundedPaise=p.revoked?Number.isSafeInteger(revocation?.amountPaise)?Math.min(p.amountPaise,Math.max(0,revocation.amountPaise)):p.amountPaise:0;
   const retainedPaise=p.amountPaise-refundedPaise,commissionBps=s.split.commissionBps;
   const grossCommissionPaise=Math.floor(p.amountPaise*commissionBps/10000),commissionPaise=Math.floor(retainedPaise*commissionBps/10000);
   earnings.push({id:`membership_${s.id}_${p.id}`,subscriptionId:s.id,paymentId:p.id,creatorId,planName:s.plan.name,provider:s.provider,currency:'INR' as const,grossPaise:p.amountPaise,refundedPaise,commissionBps,grossCommissionPaise,commissionPaise,sellerPaise:p.amountPaise-grossCommissionPaise,netSellerPaise:retainedPaise-commissionPaise,periodStart:p.periodStart,periodEnd:p.periodEnd,status:p.revoked?'adjusted' as const:'payable' as const,settlementStatus:'provider_confirmation_required' as const});
  }
 }
 return {entries:earnings,grossPaise:earnings.reduce((sum,p)=>sum+p.grossPaise,0),commissionPaise:earnings.reduce((sum,p)=>sum+p.commissionPaise,0),payablePaise:earnings.reduce((sum,p)=>sum+p.netSellerPaise,0),refundPaise:earnings.reduce((sum,p)=>sum+p.refundedPaise,0)};
}
const planInput=z.object({name:z.string().trim().min(2).max(70),description:z.string().trim().max(400).default(''),audience:z.enum(['creator','customer']),creatorId:z.string().regex(idPattern).optional(),amount:z.number().min(0).max(100000).refine(v=>moneyPaise(v)!==null,'Use at most two decimal places.'),currency:z.literal('INR').default('INR'),interval:z.enum(['month','year']).default('month'),billingMode:z.enum(['manual','automatic']).default('manual'),published:z.boolean().default(false),productLimit:z.number().int().min(1).max(10000).optional(),features:z.array(z.string().trim().min(1).max(120)).max(12).default([])}).strict();
const parsedPlan=(value:unknown)=>{const parsed=planInput.safeParse(value);if(!parsed.success) throw new SubscriptionError('Please check the plan name, price, billing interval and limits.');return parsed.data;};
function requireId(value:unknown):string{if(typeof value!=='string'||!idPattern.test(value))throw new SubscriptionError('Invalid billing reference.');return value;}
async function acceptSubscriptionTerms(s:SubscriptionRecord,userId:string):Promise<SubscriptionRecord>{
 if(s.userId!==userId)throw new SubscriptionError('Subscription not found.',404);
 await Store.set(`policyDocuments/${policyVersion}`,policyDocuments);
 return billingOperation('acceptance',s.id,{id:`agree_${crypto.randomUUID().replaceAll('-','')}`,acceptedBy:userId,acceptedAt:nowIso(),policyVersion,offer:{id:s.plan.id,name:s.plan.name,audience:s.plan.audience,creatorId:s.plan.creatorId,amount:s.plan.amount,currency:s.plan.currency,interval:s.plan.interval,billingMode:s.plan.billingMode,productLimit:s.plan.productLimit,scope:s.plan.audience==='creator'?'published_creator_plan_features':'named_creator_eligible_products'}});
}
async function ownedSubscription(userId:string,id:unknown){const s=(await state()).subscriptions[requireId(id)];if(!s||s.userId!==userId)throw new SubscriptionError('Subscription not found.',404);return s;}
function providerEnvironment(provider:SubscriptionProvider):'live'|'test'{return provider==='cashfree'?cashfreeConfig().environment as 'live'|'test':provider==='razorpay'?paymentEnvironment():easebuzzConfig().environment as 'live'|'test';}
function assertCurrentEnvironment(s:SubscriptionRecord){if(s.environment!==providerEnvironment(s.provider))throw new SubscriptionError('This subscription belongs to a different payment environment.',409);}
function validRemoteId(value:unknown):string{if(typeof value!=='string'||!idPattern.test(value))throw new SubscriptionError('Payment provider returned an invalid reference.',502);return value;}
function safeHostedURL(url:unknown,provider:SubscriptionProvider):string{
 if(typeof url!=='string') throw new SubscriptionError('Payment link is not available.',502);
 const u=new URL(url); const hosts=provider==='razorpay'?['rzp.io','rzp.io.in']:provider==='easebuzz'?['pay.easebuzz.in','testpay.easebuzz.in']:['payments.cashfree.com','payments-test.cashfree.com'];
 if(u.protocol!=='https:'||!hosts.includes(u.hostname)||u.username||u.password||u.port)throw new SubscriptionError('Payment provider returned an invalid payment link.',502);return u.href;
}
function cfIdempotent(id:string){return {headers:{'x-idempotency-key':cashfreeIdempotencyKey(id)}};}
async function buyer(userId:string){
 const profile=await Store.getUserProfile(userId);const name=String(profile?.name||profile?.fullName||profile?.displayName||'').trim(),email=String(profile?.email||'').trim(),phone=String(profile?.phoneNumber||profile?.phone||profile?.mobile||'').replace(/\D/g,'').slice(-10);
 if(name.length<2||!z.string().email().safeParse(email).success||!/^[6-9]\d{9}$/.test(phone))throw new SubscriptionError('Add your name, email and Indian mobile number in your account before subscribing.');
 return {name:name.slice(0,70),email,phone};
}
async function subscriptionSplit(plan:SubscriptionPlan,provider:SubscriptionProvider){
 if(plan.audience==='creator'||plan.creatorId==='booyahstudio')return undefined;
 const creator=await getCreatorById(plan.creatorId!);if(!creator||creator.status!=='approved')throw new SubscriptionError('This creator is not accepting memberships.',409);
 if(!creator.publicBusiness||!await creatorHasCurrentAgreement(creator.id))throw new SubscriptionError('This creator is completing the current seller agreement and required business disclosures.',409);
 if(plan.billingMode==='automatic'&&provider==='razorpay')throw new SubscriptionError('Creator memberships use manual renewal with Razorpay. Automatic creator-plan billing is available separately.',409);
 const details:any=await getCreatorProviderDetails(plan.creatorId!,provider);
 const capabilities:any=await getGatewayCapabilities(provider);
 if(!capabilities.marketplace||!details)throw new SubscriptionError('Membership payments for this creator are not enabled with the current gateway.',409);
 // Native recurring Route/Easy Split activation must cover recurring collections too.
 if(plan.billingMode==='automatic'&&process.env[provider==='cashfree'?'CASHFREE_SUBSCRIPTION_SPLITS_APPROVED':'RAZORPAY_SUBSCRIPTION_ROUTE_APPROVED']!=='true')throw new SubscriptionError('Recurring membership payments are awaiting gateway activation. A manual renewal plan can be used meanwhile.',409);
 const account:any=details.account;
 if(account?.status!=='verified'||account.environment!==providerEnvironment(provider))throw new SubscriptionError('Creator payout verification is incomplete for this gateway.',409);
 const accountId=provider==='easebuzz'&&typeof account.reference==='string'&&/^[A-Za-z0-9 _-]{1,100}$/.test(account.reference)?account.reference:validRemoteId(account.reference);
 const productId=account.productId||(/^activated:(acc_prd_[A-Za-z0-9]+)$/.exec(account.providerStatus||'')?.[1]);
 await verifyCreatorGatewayAccount(plan.creatorId!,provider,accountId,productId,false);
 const settings:any=await getGatewaySettings();return {accountId,commissionBps:Number.isSafeInteger(settings.commissionBps)?settings.commissionBps:1000};
}
async function createCheckout(original:SubscriptionRecord):Promise<{subscription:SubscriptionSummary;checkout:SubscriptionCheckout}>{
 assertCurrentEnvironment(original);
 try{await assertGatewayForNewOrder(original.provider);}catch{throw new SubscriptionError('This gateway is unavailable for new checkout. Existing paid periods and payment updates remain available. Cancel this plan and choose a new plan to use the current gateway.',409);}
 if(original.plan.audience==='customer'&&original.plan.creatorId!=='booyahstudio'){
  const creator=await getCreatorById(original.plan.creatorId!),details:any=await getCreatorProviderDetails(original.plan.creatorId!,original.provider),account=details?.account;
  if(creator?.status!=='approved'||!original.split||account?.status!=='verified'||account.reference!==original.split.accountId||account.environment!==original.environment)throw new SubscriptionError('This creator is not currently accepting membership payments.',409);
  if(!creator.publicBusiness||!await creatorHasCurrentAgreement(creator.id))throw new SubscriptionError('This creator is completing the current seller agreement and required business disclosures.',409);
  const productId=account.productId||(/^activated:(acc_prd_[A-Za-z0-9]+)$/.exec(account.providerStatus||'')?.[1]);
  await verifyCreatorGatewayAccount(original.plan.creatorId!,original.provider,original.split.accountId,productId,false);
 }
 const claimed=await billingOperation<SubscriptionRecord|null>('claim_checkout',original.id,{leaseUntil:new Date(Date.now()+90_000).toISOString()});
 if(!claimed)throw new SubscriptionError('A checkout request is already in progress. Please check its status before retrying.',409);
 try{if(claimed.cancelAtPeriodEnd)throw new SubscriptionError('This subscription has been cancelled.',409);return claimed.plan.billingMode==='automatic'?await createAutomaticCheckout(claimed):await createManualCheckout(claimed);}
 finally{await billingOperation('release_checkout',original.id,{});}
}
async function createAutomaticCheckout(s:SubscriptionRecord):Promise<{subscription:SubscriptionSummary;checkout:SubscriptionCheckout}>{
 if(s.provider==='easebuzz')throw new SubscriptionError('Automatic billing is not available for Easebuzz. Choose a manual renewal plan.',409);
 const capabilities:any=await getGatewayCapabilities(s.provider);
 if(!capabilities.subscriptions&&!capabilities.automaticSubscriptions&&!capabilities.recurring)throw new SubscriptionError('Automatic subscriptions have not been activated for this gateway.',409);
 if(s.providerRef&&s.checkout)return {subscription:subscriptionSummary(s),checkout:s.checkout};
 if(s.status==='creation_uncertain')throw new SubscriptionError('Your payment request is being reconciled. Please check its status before trying again.',409);
 const returnUrl=`${appOrigin()}/memberships?subscription=${s.id}`;
 let providerRef:string,checkout:SubscriptionCheckout,providerPlanId:string|undefined,firstChargeAt:string|undefined;
 try{
  if(s.provider==='cashfree'){
   firstChargeAt=new Date(Date.now()+86_400_000).toISOString();
   let remote:any;
   try{remote=await cashfreeRequest('subscriptions',{subscription_id:s.id,customer_details:{customer_name:s.buyer!.name,customer_email:s.buyer!.email,customer_phone:s.buyer!.phone},plan_details:{plan_name:s.plan.name,plan_type:'PERIODIC',plan_amount:s.plan.amount,plan_max_amount:s.plan.amount,plan_currency:'INR',plan_intervals:1,plan_interval_type:s.plan.interval.toUpperCase(),plan_max_cycles:s.plan.interval==='year'?10:120},authorization_details:{authorization_amount:1,authorization_amount_refund:true,payment_methods:['upi','card','enach']},subscription_meta:{return_url:returnUrl},subscription_first_charge_time:firstChargeAt,subscription_tags:{billing_id:s.id,plan_id:s.plan.id},...(s.split?{subscription_payment_splits:[{vendor_id:s.split.accountId,percentage:(10000-s.split.commissionBps)/100}]}:{})},cfIdempotent(s.id));}
   catch(error){try{remote=await cashfreeRequest(`subscriptions/${s.id}`);}catch{throw error;}}
   if(remote.subscription_id!==s.id||!remote.subscription_session_id)throw new SubscriptionError('Subscription creation could not be verified.',502);
   providerRef=s.id;firstChargeAt=remote.subscription_first_charge_time||firstChargeAt;
   checkout={provider:'cashfree',mode:'cashfree',environment:s.environment,subscriptionSessionId:String(remote.subscription_session_id),returnUrl,note:`Cashfree will request a refundable ₹1 mandate authorisation. This is separate from your ₹${s.plan.amount} ${s.plan.interval === 'year' ? 'yearly' : 'monthly'} plan charge. Access starts only after the first full charge is confirmed; the first debit may take several days, depending on the payment method and bank. Future charges follow your authorised schedule. You can cancel future renewals from Memberships.`};
  }else{
   const plan=await razorpayRequest('plans',{period:s.plan.interval==='year'?'yearly':'monthly',interval:1,item:{name:s.plan.name,amount:Math.round(s.plan.amount*100),currency:'INR',description:s.plan.description},notes:{billing_id:s.id}});
   providerPlanId=validRemoteId(plan.id);
   // A timed-out create cannot be retried blindly: it could create a second mandate.
   const remote=await razorpayRequest('subscriptions',{plan_id:providerPlanId,total_count:s.plan.interval==='year'?10:120,quantity:1,customer_notify:0,notes:{billing_id:s.id,plan_id:s.plan.id}});
   providerRef=validRemoteId(remote.id);
   if(remote.plan_id!==providerPlanId)throw new SubscriptionError('Subscription plan binding failed.',502);
   checkout={provider:'razorpay',mode:'razorpay',environment:s.environment,keyId:process.env.RAZORPAY_KEY_ID,subscriptionId:providerRef,returnUrl};
  }
  s=await billingOperation('bind',s.id,{providerRef,providerPlanId,checkout,firstChargeAt});
  return {subscription:subscriptionSummary(s),checkout};
 }catch(error){await billingOperation('uncertain',s.id,{});throw error;}
}
async function createManualCheckout(s:SubscriptionRecord):Promise<{subscription:SubscriptionSummary;checkout:SubscriptionCheckout}>{
 if(s.cancelAtPeriodEnd)throw new SubscriptionError('This subscription has been cancelled. Choose a plan to start a new one.',409);
 if(!s.providerRef)s=await billingOperation('bind',s.id,{providerRef:`manual_${s.id}`});
 let attempt=await billingOperation<Attempt>('attempt',s.id,{id:`bill_${crypto.randomUUID().replaceAll('-','')}`,createdAt:nowIso()});
 if(attempt.checkout)return {subscription:subscriptionSummary(s),checkout:attempt.checkout};
 const returnUrl=`${appOrigin()}/memberships?subscription=${s.id}`;
 let providerRef:string,checkout:SubscriptionCheckout;
 if(s.provider==='cashfree'){
  let remote:any;
  try{remote=await cashfreeRequest('orders',{order_id:attempt.id,order_amount:s.plan.amount,order_currency:'INR',customer_details:{customer_id:s.userId,customer_name:s.buyer!.name,customer_email:s.buyer!.email,customer_phone:s.buyer!.phone},order_meta:{return_url:returnUrl,notify_url:`${appOrigin()}/api/marketplace/subscriptions/webhooks/cashfree`},order_tags:{billing_id:s.id,attempt_id:attempt.id},...(s.split?{order_splits:[{vendor_id:s.split.accountId,amount:(Math.round(s.plan.amount*100)-Math.floor(Math.round(s.plan.amount*100)*s.split.commissionBps/10000))/100}]}:{})},cfIdempotent(attempt.id));}
  catch(error){try{remote=await cashfreeRequest(`orders/${attempt.id}`);}catch{throw error;}}
  if(remote.order_id!==attempt.id||moneyPaise(remote.order_amount)!==Math.round(s.plan.amount*100)||remote.order_currency!=='INR'||!remote.payment_session_id)throw new SubscriptionError('Billing order could not be verified.',502);
  providerRef=attempt.id;checkout={provider:'cashfree',mode:'cashfree',environment:s.environment,paymentSessionId:remote.payment_session_id,returnUrl};
 }else if(s.provider==='razorpay'){
  // Reuse a recorded or recovered order; never blindly repeat an uncertain create.
  let remote:any;
  if(attempt.providerRef)remote=await razorpayRequest(`orders/${attempt.providerRef}`);
  else {
   const candidates=(await razorpayBillingList('orders',{from:Math.floor(Date.parse(attempt.createdAt)/1000)-60})).filter(o=>o.receipt===attempt.id&&o.notes?.billing_id===s.id&&o.notes?.attempt_id===attempt.id);
   if(candidates.length>1)throw new SubscriptionError('The billing request needs reconciliation before checkout can continue.',409);
   remote=candidates[0];
   if(!remote){
    if(attempt.creationAttemptedAt)throw new SubscriptionError('Your payment request is awaiting confirmation. Please check its status before retrying.',409);
    attempt=await billingOperation('attempt_bind',s.id,{id:attempt.id,creationAttemptedAt:nowIso()});
    remote=await razorpayRequest('orders',{amount:Math.round(s.plan.amount*100),currency:'INR',receipt:attempt.id,notes:{billing_id:s.id,attempt_id:attempt.id},...(s.split?{transfers:[{account:s.split.accountId,amount:(Math.round(s.plan.amount*100)-Math.floor(Math.round(s.plan.amount*100)*s.split.commissionBps/10000)),currency:'INR',notes:{billing_id:s.id},on_hold:0}]}:{})});
   }
  }
  providerRef=validRemoteId(remote.id);if(remote.amount!==Math.round(s.plan.amount*100)||remote.currency!=='INR')throw new SubscriptionError('Billing order could not be verified.',502);
  checkout={provider:'razorpay',mode:'razorpay',environment:s.environment,keyId:process.env.RAZORPAY_KEY_ID,orderId:providerRef,amount:remote.amount,currency:'INR',returnUrl};
 }else{
  const remote:any=await createEasebuzzHostedPayment({transactionId:attempt.id,amount:s.plan.amount,email:s.buyer!.email,name:s.buyer!.name,phone:s.buyer!.phone,successUrl:`${appOrigin()}/api/marketplace/subscriptions/easebuzz/return`,failureUrl:`${appOrigin()}/api/marketplace/subscriptions/easebuzz/return`,udf1:s.id,udf2:attempt.id,...(s.split?{splitPayments:{[s.split.accountId]:(Math.round(s.plan.amount*100)-Math.floor(Math.round(s.plan.amount*100)*s.split.commissionBps/10000))/100}}:{})});
  providerRef=attempt.id;checkout={provider:'easebuzz',mode:'hosted',environment:s.environment,url:safeHostedURL(typeof remote==='string'?remote:remote.url||remote.paymentUrl,s.provider),returnUrl};
 }
 await billingOperation('attempt_bind',s.id,{id:attempt.id,providerRef,checkout});
 if(!s.providerRef)s=await billingOperation('bind',s.id,{providerRef:`manual_${s.id}`});
 return {subscription:subscriptionSummary(s),checkout};
}
function nativeCashfreePeriod(s:SubscriptionRecord,p:any):PaidPeriod|undefined{
 if(p.subscription_id!==s.providerRef||p.payment_type!=='CHARGE'||p.payment_status!=='SUCCESS')return;
 if(p.payment_currency!==undefined&&p.payment_currency!=='INR')throw new SubscriptionError('Recurring payment currency mismatch.',502);
 if(moneyPaise(p.payment_amount)!==Math.round(s.plan.amount*100))throw new SubscriptionError('Recurring payment amount mismatch.',502);
 // AUTH payments are deliberately excluded, including the refundable mandate authorisation.
 const scheduled=typeof p.payment_schedule_date==='string'?p.payment_schedule_date.replace(' ','T'):'';
 const start=Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(scheduled)?`${scheduled}+05:30`:scheduled);if(!Number.isFinite(start)||start<Date.parse(s.createdAt)-300000||start>Date.now()+300000)throw new SubscriptionError('Recurring payment period could not be verified.',502);
 const periodStart=new Date(start).toISOString();return {id:validRemoteId(String(p.cf_payment_id||p.payment_id||'')),subscriptionRef:s.providerRef!,currency:'INR',amountPaise:Math.round(s.plan.amount*100),periodStart,periodEnd:addBillingPeriod(periodStart,s.plan.interval)};
}
async function verifyRazorpayReceipt(s:SubscriptionRecord,p:any,period:{periodStart:string;periodEnd:string},reference:{orderRef?:string;attemptId?:string;invoiceId?:string}):Promise<{payment?:PaidPeriod;revocation?:any}>{
 if(!/^pay_[A-Za-z0-9]+$/.test(p?.id||'')||p.currency!=='INR'||p.amount!==Math.round(s.plan.amount*100)||!Number.isSafeInteger(p.amount_refunded)||p.amount_refunded<0||p.amount_refunded>p.amount)throw new SubscriptionError('Recurring payment mismatch.',502);
 if(reference.orderRef&&p.order_id!==reference.orderRef)throw new SubscriptionError('Billing order mismatch.',502);
 if(reference.invoiceId&&p.invoice_id!==reference.invoiceId)throw new SubscriptionError('Billing invoice mismatch.',502);
 if(!['captured','refunded'].includes(p.status)||p.captured!==true)return {};
 const payment:PaidPeriod={id:p.id,subscriptionRef:s.providerRef!,currency:'INR',amountPaise:p.amount,...period,...(reference.orderRef?{orderRef:reference.orderRef}:{}),...(reference.attemptId?{attemptId:reference.attemptId}:{})};
 return {payment,...(p.amount_refunded>0?{revocation:{id:`refund_${p.id}`,paymentId:p.id,reason:'provider_refund',amountPaise:p.amount_refunded}}:{})};
}
async function recoverUnknownRazorpay(s:SubscriptionRecord):Promise<SubscriptionRecord>{
 if(s.provider!=='razorpay'||s.providerRef||s.plan.billingMode!=='automatic')return s;
 const candidates=(await razorpayBillingList('subscriptions',{from:Math.floor(Date.parse(s.createdAt)/1000)-60})).filter(remote=>remote.notes?.billing_id===s.id);
 if(candidates.length!==1)throw new SubscriptionError('The payment provider has not confirmed this request yet. Please contact support if it remains pending.',409);
 const remote=candidates[0],plan=await razorpayRequest(`plans/${validRemoteId(remote.plan_id)}`);
 if(plan.item?.amount!==Math.round(s.plan.amount*100)||plan.item?.currency!=='INR'||plan.interval!==1||plan.period!==(s.plan.interval==='year'?'yearly':'monthly'))throw new SubscriptionError('Recovered subscription plan mismatch.',502);
 return billingOperation('bind',s.id,{providerRef:validRemoteId(remote.id),providerPlanId:plan.id,checkout:{provider:'razorpay',mode:'razorpay',environment:s.environment,keyId:process.env.RAZORPAY_KEY_ID,subscriptionId:remote.id,returnUrl:`${appOrigin()}/memberships?subscription=${s.id}`}});
}
export async function reconcileSubscription(record:SubscriptionRecord,event?:BillingEvent):Promise<SubscriptionRecord>{
 let s=record;assertCurrentEnvironment(s);
 if(!s.providerRef&&s.status==='creation_uncertain'){
  if(s.provider==='cashfree'){const remote=await cashfreeRequest(`subscriptions/${s.id}`);if(remote.subscription_id!==s.id||!remote.subscription_session_id)throw new SubscriptionError('Subscription recovery is pending.',409);s=await billingOperation('bind',s.id,{providerRef:s.id,firstChargeAt:remote.subscription_first_charge_time,checkout:{provider:'cashfree',mode:'cashfree',environment:s.environment,subscriptionSessionId:remote.subscription_session_id,returnUrl:`${appOrigin()}/memberships?subscription=${s.id}`}});}
  else s=await recoverUnknownRazorpay(s);
 }
 if(!s.providerRef)return s;
 const payments:PaidPeriod[]=[],revocations:any[]=[];let providerStatus='pending';
 if(s.plan.billingMode==='automatic'){
  if(s.provider==='cashfree'){
   const remote=await cashfreeRequest(`subscriptions/${s.providerRef}`),plan=remote.plan_details;
   if(remote.subscription_id!==s.providerRef||plan?.plan_type!=='PERIODIC'||plan.plan_currency!=='INR'||moneyPaise(plan.plan_recurring_amount??plan.plan_amount)!==Math.round(s.plan.amount*100)||Number(plan.plan_intervals)!==1||plan.plan_interval_type!==s.plan.interval.toUpperCase())throw new SubscriptionError('Subscription plan mismatch.',502);
   providerStatus=String(remote.subscription_status||'pending');const receipts=await cashfreeRequest(`subscriptions/${s.providerRef}/payments`);
   if(!Array.isArray(receipts))throw new SubscriptionError('Subscription payments could not be verified.',502);
   for(const receipt of receipts){const period=nativeCashfreePeriod(s,receipt);if(period)payments.push(period);}
   // Refund callbacks are hints only: every referenced refund is fetched from the provider.
   const pendingRefunds=values((await state()).events).filter(e=>e.subscriptionId===s.id&&e.refundId);
   for(const e of pendingRefunds){
    const refund=await cashfreeRequest(`subscriptions/${s.providerRef}/refunds/${validRemoteId(e.refundId)}`);
    const refundPaise=moneyPaise(refund.refund_amount);
    if(refund.subscription_id!==s.providerRef||refund.refund_id!==e.refundId||refundPaise===null||refundPaise<=0||(refund.refund_currency&&refund.refund_currency!=='INR'))throw new SubscriptionError('Subscription refund mismatch.',502);
    if(refund.refund_status==='SUCCESS'){
     const paymentId=String(refund.cf_payment_id||'');if(!payments.some(p=>p.id===paymentId)&&!s.payments[paymentId])continue;
     const paid=payments.find(p=>p.id===paymentId)||s.payments[paymentId];if(refundPaise>paid.amountPaise)throw new SubscriptionError('Subscription refund amount mismatch.',502);
     revocations.push({id:e.refundId,paymentId,reason:'provider_refund',amountPaise:refundPaise});
    }
   }
  }else if(s.provider==='razorpay'){
   const remote=await razorpayRequest(`subscriptions/${s.providerRef}`);
   if(remote.id!==s.providerRef||remote.plan_id!==s.providerPlanId||remote.quantity!==1)throw new SubscriptionError('Subscription binding mismatch.',502);
   providerStatus=String(remote.status||'pending');const plan=await razorpayRequest(`plans/${validRemoteId(s.providerPlanId)}`);
   if(plan.item?.amount!==Math.round(s.plan.amount*100)||plan.item?.currency!=='INR'||plan.interval!==1||plan.period!==(s.plan.interval==='year'?'yearly':'monthly'))throw new SubscriptionError('Subscription price mismatch.',502);
   const invoices=await razorpayBillingList('invoices',{subscription_id:s.providerRef});
   for(const invoice of invoices){
    if(invoice.subscription_id!==s.providerRef)throw new SubscriptionError('Subscription invoice mismatch.',502);
    if(invoice.status!=='paid'||!invoice.payment_id)continue;
    if(invoice.amount!==Math.round(s.plan.amount*100)||invoice.amount_paid!==invoice.amount||invoice.amount_due!==0||invoice.currency!=='INR'||!Number.isSafeInteger(invoice.billing_start)||!Number.isSafeInteger(invoice.billing_end))throw new SubscriptionError('Paid subscription invoice mismatch.',502);
    const receipt=await razorpayRequest(`payments/${validRemoteId(invoice.payment_id)}`);
    const verified=await verifyRazorpayReceipt(s,receipt,{periodStart:new Date(invoice.billing_start*1000).toISOString(),periodEnd:new Date(invoice.billing_end*1000).toISOString()},{invoiceId:invoice.id});
    if(verified.payment)payments.push(verified.payment);if(verified.revocation)revocations.push(verified.revocation);
   }
  }else throw new SubscriptionError('Unsupported automatic billing provider.',409);
 }else{
  for(let attempt of values(s.attempts)){
   if(!attempt.providerRef){
    if(s.provider==='razorpay'){
     const orders=await razorpayBillingList('orders',{from:Math.floor(Date.parse(attempt.createdAt)/1000)-60});
     const matching=orders.filter(o=>o.receipt===attempt.id&&o.notes?.billing_id===s.id&&o.notes?.attempt_id===attempt.id);
     if(matching.length!==1)continue;
     attempt=await billingOperation('attempt_bind',s.id,{id:attempt.id,providerRef:validRemoteId(matching[0].id)});
    }else{attempt=await billingOperation('attempt_bind',s.id,{id:attempt.id,providerRef:attempt.id});}
   }
   if(s.provider==='cashfree'){
    const order=await cashfreeRequest(`orders/${attempt.providerRef}`);
    if(order.order_id!==attempt.providerRef||order.order_currency!=='INR'||moneyPaise(order.order_amount)!==Math.round(s.plan.amount*100)||order.order_tags?.billing_id!==s.id||order.order_tags?.attempt_id!==attempt.id)throw new SubscriptionError('Billing order mismatch.',502);
    const receipts=await cashfreeRequest(`orders/${attempt.providerRef}/payments`),refunds=await cashfreeRequest(`orders/${attempt.providerRef}/refunds`);
    if(!Array.isArray(receipts)||!Array.isArray(refunds))throw new SubscriptionError('Billing history could not be verified.',502);
    for(const p of receipts){
     if(p.payment_status!=='SUCCESS')continue;
     if(p.order_id!==attempt.providerRef||p.payment_currency!=='INR'||moneyPaise(p.payment_amount)!==Math.round(s.plan.amount*100))throw new SubscriptionError('Billing payment mismatch.',502);
     const id=validRemoteId(String(p.cf_payment_id||''));payments.push({id,subscriptionRef:s.providerRef,currency:'INR',amountPaise:Math.round(s.plan.amount*100),periodStart:attempt.periodStart,periodEnd:attempt.periodEnd,attemptId:attempt.id,orderRef:attempt.providerRef});
     for(const refund of refunds){if(refund.refund_status!=='SUCCESS'||String(refund.cf_payment_id)!==id)continue;const amount=moneyPaise(refund.refund_amount);if(amount===null||amount<=0||amount>Math.round(s.plan.amount*100)||(refund.refund_currency&&refund.refund_currency!=='INR'))throw new SubscriptionError('Billing refund mismatch.',502);revocations.push({id:validRemoteId(refund.refund_id),paymentId:id,reason:'provider_refund',amountPaise:amount});}
    }
   }else if(s.provider==='razorpay'){
    const order=await razorpayRequest(`orders/${attempt.providerRef}`);
    if(order.id!==attempt.providerRef||order.amount!==Math.round(s.plan.amount*100)||order.currency!=='INR'||order.receipt!==attempt.id||order.notes?.billing_id!==s.id)throw new SubscriptionError('Billing order mismatch.',502);
    const receipts=await razorpayRequest(`orders/${attempt.providerRef}/payments`);if(!Array.isArray(receipts.items))throw new SubscriptionError('Billing payments are unavailable.',502);
    for(const p of receipts.items){const verified=await verifyRazorpayReceipt(s,p,{periodStart:attempt.periodStart,periodEnd:attempt.periodEnd},{orderRef:attempt.providerRef,attemptId:attempt.id});if(verified.payment)payments.push(verified.payment);if(verified.revocation)revocations.push(verified.revocation);}
   }else{
    const p=await retrieveEasebuzzPayment(attempt.providerRef!);
    if((p.currency&&p.currency!=='INR')||p.productinfo!=='Booyahstudio digital products'||p.txnid!==attempt.providerRef||p.key!==process.env.EASEBUZZ_KEY||p.udf1!==s.id||p.udf2!==attempt.id||moneyPaise(p.amount)!==Math.round(s.plan.amount*100)||String(p.email).toLowerCase()!==s.buyer!.email.toLowerCase()||String(p.phone).replace(/\D/g,'').slice(-10)!==s.buyer!.phone)throw new SubscriptionError('Billing payment mismatch.',502);
    if(p.status==='success'){
     const id=validRemoteId(p.easepayid);payments.push({id,subscriptionRef:s.providerRef,currency:'INR',amountPaise:Math.round(s.plan.amount*100),periodStart:attempt.periodStart,periodEnd:attempt.periodEnd,attemptId:attempt.id,orderRef:attempt.providerRef});
     const refunded=moneyPaise(p.refund_amount??p.refunded_amount??0),refundStatus=String(p.refund_status||'').toLowerCase();if(refunded===null||refunded>Math.round(s.plan.amount*100))throw new SubscriptionError('Billing refund mismatch.',502);
     if(refundStatus&&!['no_refund','none','na','success','refunded','processed','approved'].includes(refundStatus))throw new SubscriptionError('This refund is awaiting verification. Please check again later.',503);
     if(refunded>0||['success','refunded','processed','approved'].includes(refundStatus))revocations.push({id:`refund_${id}`,paymentId:id,reason:'provider_refund',...(refunded>0?{amountPaise:refunded}:{})});
    }else if(['refunded','partially_refunded'].includes(String(p.status))){const existing=values(s.payments).find(r=>r.orderRef===attempt.providerRef);if(existing)revocations.push({id:`refund_${existing.id}`,paymentId:existing.id,reason:'provider_refund'});}
   }
  }
 }
 if(event?.disputeId&&s.provider==='cashfree'){
  const dispute=await cashfreeRequest(`disputes/${validRemoteId(event.disputeId)}`);const row=Array.isArray(dispute)?dispute[0]:dispute?.data||dispute;const paymentId=String(row?.order_details?.cf_payment_id||'');
  const paid=payments.find(p=>p.id===paymentId)||s.payments[paymentId],amount=moneyPaise(row?.dispute_amount);
  if(String(row?.dispute_id||row?.cf_dispute_id)!==event.disputeId||row.dispute_amount_currency!=='INR'||!paid||amount===null||amount<=0||amount>paid.amountPaise||(row.order_details?.payment_currency&&row.order_details.payment_currency!=='INR'))throw new SubscriptionError('Dispute mismatch.',502);
  if(String(row.dispute_status).endsWith('_MERCHANT_LOST'))revocations.push({id:event.disputeId,paymentId,reason:'provider_dispute'});
 }
 if(event?.disputeId&&s.provider==='razorpay'){
  const dispute=await razorpayRequest(`disputes/${validRemoteId(event.disputeId)}`),paid=payments.find(p=>p.id===dispute.payment_id)||s.payments[dispute.payment_id];if(dispute.id!==event.disputeId||dispute.currency!=='INR'||!paid||!Number.isSafeInteger(dispute.amount)||dispute.amount<=0||dispute.amount>paid.amountPaise||!['open','won','lost','closed','under_review','action_required'].includes(dispute.status))throw new SubscriptionError('Dispute mismatch.',502);
  if(dispute.status==='lost')revocations.push({id:event.disputeId,paymentId:dispute.payment_id,reason:'provider_dispute'});
 }
 // One atomic snapshot includes refunds; a replay cannot restore a revoked period.
 return billingOperation('snapshot',s.id,{provider:s.provider,environment:s.environment,providerRef:s.providerRef,providerStatus,checkedAt:nowIso(),payments,revocations});
}
export async function reconcileSubscriptions(limit=20):Promise<{checked:number;failed:number}>{
 const data=await state();let checked=0,failed=0;
 const pending=values(data.events).filter(e=>e.status!=='done').slice(0,limit);
 for(const event of pending){const s=data.subscriptions[event.subscriptionId];if(!s)continue;try{await reconcileSubscription(s,event);await billingOperation('event_done',event.id,{processedAt:nowIso()});checked++;}catch{failed++;}}
 const records=values(data.subscriptions).filter(s=>s.providerRef||s.status==='creation_uncertain').sort((a,b)=>Date.parse(a.lastCheckedAt||a.createdAt)-Date.parse(b.lastCheckedAt||b.createdAt)).slice(0,Math.max(0,limit-checked-failed));
 for(const s of records)try{await reconcileSubscription(s);checked++;}catch{failed++;}
 return {checked,failed};
}

async function cancelSubscription(original:SubscriptionRecord):Promise<SubscriptionRecord>{
 let s=original;assertCurrentEnvironment(s);
  if(s.checkoutLeaseUntil&&Date.parse(s.checkoutLeaseUntil)>Date.now())throw new SubscriptionError('Checkout is being prepared. Please try cancellation again in a moment.',409);
  if(s.plan.billingMode==='automatic'&&!s.providerRef&&s.status==='creation_uncertain')s=await reconcileSubscription(s);
  if(s.plan.billingMode==='automatic'&&!s.providerRef&&s.status==='creation_uncertain')throw new SubscriptionError('The mandate must be reconciled before cancellation can be confirmed. Please contact support.',409);
  if(!s.cancelAtPeriodEnd){
   if(s.plan.billingMode==='automatic'&&s.providerRef){
    if(s.provider==='cashfree'){
     try{const acknowledged=await cashfreeRequest(`subscriptions/${s.providerRef}/manage`,{subscription_id:s.providerRef,action:'CANCEL'},cfIdempotent(`cancel_${s.id}`));if(acknowledged.subscription_id!==s.providerRef)throw new SubscriptionError('Cancellation acknowledgement mismatch.',502);}
     catch(error){const remote=await cashfreeRequest(`subscriptions/${s.providerRef}`);if(remote.subscription_id!==s.providerRef||!['CANCELLED','CUSTOMER_CANCELLED','COMPLETED','EXPIRED','LINK_EXPIRED','CARD_EXPIRED'].includes(remote.subscription_status))throw error;}
    }else if(s.provider==='razorpay'){
     try{const acknowledged=await razorpayRequest(`subscriptions/${s.providerRef}/cancel`,{cancel_at_cycle_end:1});if(acknowledged.id!==s.providerRef)throw new SubscriptionError('Cancellation acknowledgement mismatch.',502);}
     catch(error){const remote=await razorpayRequest(`subscriptions/${s.providerRef}`);if(remote.id!==s.providerRef||!['cancelled','completed','expired'].includes(remote.status))throw error;}
    }else throw new SubscriptionError('Unsupported recurring provider.',409);
   }
   s=await billingOperation('cancel',s.id,{cancelledAt:nowIso()});
  }
 return s;
}
const run=(handler:(req:any,res:any)=>Promise<any>):RequestHandler=>(req,res)=>{void handler(req,res).catch(error=>{const status=error instanceof SubscriptionError?error.status:503;res.status(status).json({success:false,message:error instanceof SubscriptionError?error.message:'We could not complete this billing request. Please try again later.'});});};
async function handleBillingEvent(provider:SubscriptionProvider,raw:Buffer,body:any){
 const data=await state();let reference:string|undefined,refundId:string|undefined,disputeId:string|undefined;
 if(provider==='cashfree'){
  const e=body?.data||{};if(e.dispute){disputeId=e.dispute.dispute_id||e.dispute.cf_dispute_id;const paymentId=String(e.dispute.order_details?.cf_payment_id||'');const found=values(data.subscriptions).find(s=>s.provider===provider&&s.payments[paymentId]);if(found)reference=found.providerRef;}
  reference=reference||e.subscription_details?.subscription_id||e.subscription_id||e.subscription?.subscription_id||e.order?.order_id||e.payment?.subscription_id;
  refundId=e.refund_details?.refund_id||e.refund?.refund_id;
 }else{
  const e=body?.payload||{};reference=e.subscription?.entity?.id||e.payment?.entity?.subscription_id||e.payment?.entity?.order_id||e.invoice?.entity?.subscription_id;
  if(e.dispute?.entity){disputeId=e.dispute.entity.id;const paymentId=e.dispute.entity.payment_id;const found=values(data.subscriptions).find(s=>s.provider===provider&&s.payments[paymentId]);if(found)reference=found.providerRef;}
  if(e.refund?.entity&&!reference){const paymentId=e.refund.entity.payment_id;const found=values(data.subscriptions).find(s=>s.provider===provider&&s.payments[paymentId]);if(found)reference=found.providerRef;}
 }
 const subscription=values(data.subscriptions).find(s=>s.provider===provider&&(s.providerRef===reference||s.id===reference||values(s.attempts).some(a=>a.providerRef===reference||a.id===reference)));
 if(!subscription)return; // Valid unrelated events do not create financial records.
 const eventId=crypto.createHash('sha256').update(provider).update(raw).digest('hex');
 const event=await billingOperation<BillingEvent>('event',eventId,{provider,subscriptionId:subscription.id,receivedAt:nowIso(),...(refundId&&idPattern.test(refundId)?{refundId}:{}),...(disputeId&&idPattern.test(disputeId)?{disputeId}:{})});
 if(event.status==='done')return;
 const result=await reconcileSubscription(subscription,event);
 if(!result.providerRef)throw new SubscriptionError('Billing binding is not yet ready. The event will be retried.',503);
 await billingOperation('event_done',eventId,{processedAt:nowIso()});
}
export function registerSubscriptionRoutes(app:Express,auth:RequestHandler,admin:RequestHandler,limiter:RequestHandler){
 app.get('/api/marketplace/plans',run(async(req,res)=>{
  const audience=req.query.audience,creatorId=req.query.creatorId;
  if(audience!==undefined&&!['creator','customer'].includes(audience))throw new SubscriptionError('Invalid plan audience.');
  if(creatorId!==undefined)requireId(creatorId);
  let plans=(await publicPlans()).filter(p=>p.published&&(!audience||p.audience===audience)&&(!creatorId||p.creatorId===creatorId));
  const approved:SubscriptionPlan[]=[];for(const p of plans){if(p.audience==='creator'||p.creatorId==='booyahstudio'||(await getCreatorById(p.creatorId!))?.status==='approved')approved.push(p);}
  res.json({success:true,plans:approved.map(plan=>({...plan,checkoutQuote:subscriptionCheckoutQuote(plan)}))});
 }));
 app.get('/api/marketplace/subscriptions',auth,run(async(req,res)=>{const subscriptions=values((await state()).subscriptions).filter(s=>s.userId===req.userId).map(subscriptionSummary);res.json({success:true,subscriptions});}));
 app.post('/api/marketplace/subscriptions',auth,limiter,run(async(req,res)=>{
  const input=z.object({planId:z.string().regex(idPattern),agreeTerms:z.literal(true),checkoutQuote:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(req.body);if(!input.success)throw new SubscriptionError('Choose a valid plan and accept its current price and terms before continuing.');
  const plan=(await state()).plans[input.data.planId];if(!plan?.published||plan.amount<=0)throw new SubscriptionError('This paid plan is unavailable.',409);
  if(input.data.checkoutQuote!==subscriptionCheckoutQuote(plan))throw new SubscriptionError('This offer or its terms have changed. Refresh the plans and review the price before continuing.',409);
  if(plan.audience==='creator'&&!(await getCreatorByUserId(req.userId)))throw new SubscriptionError('Create your creator profile before choosing a paid plan.',409);
  if(plan.audience==='customer'&&!plan.creatorId)throw new SubscriptionError('This membership has no creator.',409);
  const provider=await getActiveGateway();if(!provider)throw new SubscriptionError('Subscriptions are not accepting payments yet.',503);
  if(plan.billingMode==='automatic'&&!getGatewayCapabilities(provider).subscriptions)throw new SubscriptionError('Automatic subscriptions are not activated for the selected gateway. Choose a manual renewal plan.',409);
  const split=await subscriptionSplit(plan,provider),contact=await buyer(req.userId);
  const s=await billingOperation<SubscriptionRecord>('reserve',`sub_${crypto.randomUUID().replaceAll('-','')}`,{userId:req.userId,planId:plan.id,expectedPlan:plan,provider,environment:providerEnvironment(provider),createdAt:nowIso(),buyer:contact,...(split?{split}:{})});
  if(currentPaidPeriod(s))throw new SubscriptionError('You already have this plan. You can manage it in Memberships.',409);
  if(input.data.checkoutQuote!==subscriptionCheckoutQuote(s.plan))throw new SubscriptionError('An earlier subscription has different terms. Open Memberships to review and resume or cancel it.',409);
  const accepted=await acceptSubscriptionTerms(s,req.userId);
  const result=await createCheckout(accepted);res.json({success:true,...result});
 }));
 app.post('/api/marketplace/subscriptions/:id/renew',auth,limiter,run(async(req,res)=>{
  const input=z.object({agreeTerms:z.literal(true),checkoutQuote:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(req.body);if(!input.success)throw new SubscriptionError('Accept the renewal price and terms before continuing.');
  const s=await ownedSubscription(req.userId,req.params.id);if(s.plan.billingMode!=='manual')throw new SubscriptionError('This subscription renews through its existing mandate.',409);
  if(input.data.checkoutQuote!==subscriptionCheckoutQuote(s.plan))throw new SubscriptionError('The renewal terms have changed. Refresh your memberships and review them before continuing.',409);
  const active=currentPaidPeriod(s);if(active&&Date.parse(active.periodEnd)>Date.now()+7*86_400_000)throw new SubscriptionError('Your membership is active. Renewal opens seven days before it expires.',409);
  res.json({success:true,...await createCheckout(await acceptSubscriptionTerms(s,req.userId))});
 }));
 app.post('/api/marketplace/subscriptions/:id/resume',auth,limiter,run(async(req,res)=>{
  const input=z.object({agreeTerms:z.literal(true),checkoutQuote:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(req.body);if(!input.success)throw new SubscriptionError('Review and accept this subscription’s current terms before continuing.');
  const s=await ownedSubscription(req.userId,req.params.id);if(currentPaidPeriod(s)||s.cancelAtPeriodEnd)throw new SubscriptionError('This subscription does not need a new checkout.',409);
  if(input.data.checkoutQuote!==subscriptionCheckoutQuote(s.plan))throw new SubscriptionError('The subscription terms have changed. Refresh Memberships and review them again.',409);
  res.json({success:true,...await createCheckout(await acceptSubscriptionTerms(s,req.userId))});
 }));
 app.post('/api/marketplace/subscriptions/:id/reconcile',auth,limiter,run(async(req,res)=>{const s=await ownedSubscription(req.userId,req.params.id);res.json({success:true,subscription:subscriptionSummary(await reconcileSubscription(s))});}));
 app.post('/api/marketplace/subscriptions/:id/cancel',auth,limiter,run(async(req,res)=>{const s=await cancelSubscription(await ownedSubscription(req.userId,req.params.id));res.json({success:true,subscription:subscriptionSummary(s),message:'Future renewals are cancelled. Any verified paid access continues until its expiry.'});}));
 app.get('/api/marketplace/me/membership-plans',auth,run(async(req,res)=>{const creator=await getCreatorByUserId(req.userId);if(!creator)throw new SubscriptionError('Creator profile not found.',404);res.json({success:true,plans:values((await state()).plans).filter(p=>p.audience==='customer'&&p.creatorId===creator.id)});}));
 const saveMemberPlan=run(async(req,res)=>{
  const creator=await getCreatorByUserId(req.userId);if(!creator||creator.status!=='approved')throw new SubscriptionError('Your creator profile must be approved before offering memberships.',403);
  if(!creator.publicBusiness||!await creatorHasCurrentAgreement(creator.id))throw new SubscriptionError('Complete the current seller agreement and required business disclosures before offering memberships.',409);
  const id=req.params.id?requireId(req.params.id):`member_${crypto.randomUUID().replaceAll('-','')}`;
  const existing=(await state()).plans[id];if(req.params.id&&(!existing||existing.creatorId!==creator.id||existing.audience!=='customer'))throw new SubscriptionError('Membership plan not found.',404);
  const allowed=parsedPlan({...req.body,audience:'customer',creatorId:creator.id});if(allowed.amount<=0)throw new SubscriptionError('Memberships need a positive price.');
  // Price/content changes return the offer to review; existing paid snapshots are immutable.
  const plan=await billingOperation('save_plan',id,{plan:{...allowed,id,productLimit:undefined,published:false,updatedAt:nowIso()},actorId:req.userId,reason:'Creator submitted membership offer for review.',auditId:`audit_${crypto.randomUUID().replaceAll('-','')}`});res.json({success:true,plan,message:'Membership offer saved for review.'});
 });
 app.post('/api/marketplace/me/membership-plans',auth,limiter,saveMemberPlan);app.patch('/api/marketplace/me/membership-plans/:id',auth,limiter,saveMemberPlan);
 app.get('/api/marketplace/admin/plans',auth,admin,run(async(_req,res)=>res.json({success:true,plans:values((await state()).plans)})));
 app.put('/api/marketplace/admin/plans/:id',auth,admin,limiter,run(async(req,res)=>{
  const {reason,...fields}=req.body||{};if(!z.string().trim().min(10).max(1000).safeParse(reason).success)throw new SubscriptionError('Give a review reason of at least 10 characters.');
  const id=requireId(req.params.id),input=parsedPlan(fields),old=(await state()).plans[id];
  if(input.audience==='customer'&&(!old||!input.creatorId||old.creatorId!==input.creatorId))throw new SubscriptionError('Membership offers must first be created by their creator.');
  if(id==='starter'&&(input.amount!==0||input.audience!=='creator'))throw new SubscriptionError('Starter remains a free creator plan.');
  if(id!=='starter'&&input.amount<=0)throw new SubscriptionError('Paid plans need a positive price.');
  if(input.audience==='creator'&&!input.productLimit)throw new SubscriptionError('Creator plans need a listing limit.');
  if(input.audience==='creator'&&input.creatorId)throw new SubscriptionError('Creator plans belong to Booyahstudio.');
  if(input.audience==='customer'&&input.published&&(await getCreatorById(input.creatorId!))?.status!=='approved')throw new SubscriptionError('Only approved creators can publish memberships.');
  if(input.audience==='customer'&&input.published&&(!await creatorHasCurrentAgreement(input.creatorId!)||!(await getCreatorById(input.creatorId!))?.publicBusiness))throw new SubscriptionError('The creator must complete the current seller agreement and required business disclosures.');
  res.json({success:true,plan:await billingOperation('save_plan',id,{plan:{...input,id,updatedAt:nowIso()},actorId:req.userId,reason:reason.trim(),auditId:`audit_${crypto.randomUUID().replaceAll('-','')}`})});
 }));
 app.get('/api/marketplace/admin/subscriptions',auth,admin,run(async(_req,res)=>res.json({success:true,subscriptions:values((await state()).subscriptions).map(subscriptionSummary)})));
 const adminBillingAction=(action:'reconcile'|'cancel')=>run(async(req,res)=>{
  const parsed=z.object({reason:z.string().trim().min(10).max(1000)}).strict().safeParse(req.body);if(!parsed.success)throw new SubscriptionError('Give a review reason of at least 10 characters.');
  const id=requireId(req.params.id),record=(await state()).subscriptions[id];if(!record)throw new SubscriptionError('Subscription not found.',404);
  const result=action==='cancel'?await cancelSubscription(record):await reconcileSubscription(record);
  await billingOperation('audit',`audit_${crypto.randomUUID().replaceAll('-','')}`,{actorId:req.userId,action:`subscription_${action}`,subscriptionId:id,reason:parsed.data.reason,createdAt:nowIso(),provider:record.provider,environment:record.environment});
  res.json({success:true,subscription:subscriptionSummary(result),...(action==='cancel'?{message:'Future renewals are cancelled; verified paid periods retain their original expiry.'}:{})});
 });
 app.post('/api/marketplace/admin/subscriptions/:id/reconcile',auth,admin,limiter,adminBillingAction('reconcile'));
 app.post('/api/marketplace/admin/subscriptions/:id/cancel',auth,admin,limiter,adminBillingAction('cancel'));
 app.post('/api/marketplace/subscriptions/webhooks/cashfree',run(async(req,res)=>{const raw=(req as any).rawBody;if(!verifyCashfreeSignature(raw,req.headers['x-webhook-signature'],req.headers['x-webhook-timestamp']))throw new SubscriptionError('Invalid signature.',400);await handleBillingEvent('cashfree',raw,req.body);res.json({success:true});}));
 app.post('/api/marketplace/subscriptions/webhooks/razorpay',run(async(req,res)=>{const raw=(req as any).rawBody;if(!Buffer.isBuffer(raw)||!verifySignature(raw,req.headers['x-razorpay-signature'],process.env.RAZORPAY_WEBHOOK_SECRET||''))throw new SubscriptionError('Invalid signature.',400);await handleBillingEvent('razorpay',raw,req.body);res.json({success:true});}));
 app.post('/api/marketplace/subscriptions/easebuzz/return',run(async(req,res)=>{
  if(req.body?.key!==process.env.EASEBUZZ_KEY||!verifyEasebuzzCallbackHash(req.body,process.env.EASEBUZZ_SALT||''))throw new SubscriptionError('Invalid payment response.',400);
  const id=requireId(req.body.udf1),s=(await state()).subscriptions[id];if(!s||s.provider!=='easebuzz'||!s.attempts[req.body.udf2]||s.attempts[req.body.udf2].id!==req.body.txnid)throw new SubscriptionError('Payment reference mismatch.',400);
  await reconcileSubscription(s);res.redirect(303,`${appOrigin()}/memberships?subscription=${s.id}`);
 }));
}
