import { SecureFileManager } from './secureFiles';
import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { FirebaseRtdb as DB } from './firebaseRtdb';
import { atomicDocument } from './atomicStore';
import { unseal } from './privateData';
import * as M from './marketplace';
import * as gateway from './easebuzzMarketplace';
import { settleSale, requestRefund, reconcileRefund, linkUnknownRefund, recordChargeback } from './marketplaceFinance';
const wrap=(handler:(req:any,res:any)=>Promise<any>):RequestHandler=>(req,res)=>{Promise.resolve(handler(req,res)).catch(e=>{
 if(e instanceof z.ZodError)return res.status(400).json({message:'Check the required fields and declarations.',fields:e.issues.map(i=>i.path.join('.'))});
 res.status(e instanceof M.MarketplaceError?409:503).json({message:e instanceof M.MarketplaceError?e.message:'This operation could not be confirmed. Please contact support before retrying a financial request.'});});};
const idSchema=z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
export function marketplaceRouter(auth:RequestHandler,admin:RequestHandler) {
 const r=Router();
 r.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&req.headers.origin!==new URL(process.env.APP_URL || 'http://localhost:3000').origin)return res.status(403).json({message:'Request origin is not allowed.'});next();});
 r.get('/config',wrap(async(req,res)=>res.json(M.config())));
 r.get('/stores/:id',wrap(async(req,res)=>{const s=await M.getSeller(idSchema.parse(req.params.id));M.ensure(s?.status==='approved','Store is unavailable.');res.json({id:s.id,name:s.storeName,products:(await M.publicMarketplaceProducts()).filter(p=>p.sellerId===s.id)});}));
 r.get('/seller',auth,wrap(async(req,res)=>{const s=await M.getSeller(req.userId);res.json({seller:s?M.sellerView(s):null});}));
 r.post('/seller',auth,wrap(async(req,res)=>{const s=await M.registerSeller(req.userId,req.userEmail,req.body,req.ip||'');res.status(201).json({seller:M.sellerView(s)});}));
 r.post('/seller/products',auth,wrap(async(req,res)=>{const s=await M.submitProduct(req.userId,req.body);res.status(201).json({seller:M.sellerView(s)});}));
 r.post('/seller/onboard',auth,wrap(async(req,res)=>{
  gateway.marketplaceCredentials();
  const password=z.string().min(12).max(100).parse(req.body.password);let reserved=false;
  const s=await atomicDocument<M.Seller>('marketplace_sellers',req.userId,s=>{reserved=false;M.ensure(s&&s.status!=='suspended'&&s.status!=='permanent_suspension','Seller account is unavailable.');M.ensure(!s.providerId&&!s.onboardingStatus,'Onboarding is already processing. Contact support to reconcile the existing request.');s.onboardingStatus='pending';reserved=true;return s;});
  M.ensure(reserved,'Onboarding request is already processing.');
  try{const result=await gateway.createSubmerchant(s,unseal(s.privateData,`seller:${s.id}`),password);M.ensure(typeof result.submerchant_id==='string','Onboarding reference is missing.');
   await atomicDocument<M.Seller>('marketplace_sellers',s.id,current=>{M.ensure(current,'Seller missing.');current.providerId=result.submerchant_id;current.onboardingStatus='created';return M.record(current,s.id,'ONBOARDING_CREATED',result.submerchant_id);});
   res.json({success:true});
  }catch(e){await atomicDocument<M.Seller>('marketplace_sellers',s.id,current=>{M.ensure(current,'Seller missing.');current.onboardingStatus='unknown';return current;});throw e;}
 }));
 r.post('/seller/kyc-link',auth,wrap(async(req,res)=>{const s=await M.getSeller(req.userId);M.ensure(s?.providerId,'Complete payment onboarding first.');res.json({url:await gateway.kycLink(s)});}));
 r.post('/kyc-webhook',wrap(async(req,res)=>{
  const payload={...req.body,data:typeof req.body.data==='string'?JSON.parse(req.body.data):req.body.data};
  M.ensure(gateway.verifyKycWebhook(payload),'Invalid verification notification.');
  const data=payload.data;M.ensure(String(payload.status)==='1'&&String(data.status).toLowerCase()==='true','Verification has not been approved.');
  const seller=(await M.getSellers()).find(s=>s.providerId===data.submerchant_id);M.ensure(seller,'Unknown verification account.');
  M.ensure(data.email?.toLowerCase()===seller.email.toLowerCase()&&String(data.mobile)===seller.phone&&data.name===seller.legalName,'Verification identity mismatch.');
  await atomicDocument<M.Seller>('marketplace_sellers',seller.id,s=>{M.ensure(s,'Seller missing.');if(s.kycStatus==='approved')return s;s.kycStatus='approved';return M.record(s,'provider','KYC_APPROVED',data.submerchant_id);});res.json({success:true});
 }));
 r.post('/complaints',auth,wrap(async(req,res)=>{
  const data=z.object({orderId:idSchema,category:z.enum(['delivery','refund','fraud','copyright','other']),message:z.string().trim().min(20).max(5000)}).parse(req.body);
  const order=await DB.getGlobalOrder(data.orderId);M.ensure(order?.userId===req.userId&&order.marketplace?.sellerId,'Select your marketplace order.');
  const caseId=`case_${crypto.randomBytes(12).toString('hex')}`;
  await atomicDocument<M.Seller>('marketplace_sellers',order.marketplace.sellerId,s=>{M.ensure(s,'Seller missing.');M.ensure(!Object.values(s.cases).some((c:any)=>c.orderId===data.orderId&&!['resolved','rejected'].includes(c.status)),'A complaint for this order is already open.');s.cases[caseId]={...data,id:caseId,customerId:req.userId,status:'open',createdAt:M.now()};return M.record(s,req.userId,'COMPLAINT_OPENED',caseId);});res.status(201).json({caseId});
 }));
 r.get('/complaints',auth,wrap(async(req,res)=>res.json({complaints:(await M.getSellers()).flatMap(s=>Object.values(s.cases).filter((c:any)=>c.customerId===req.userId))})));
 r.get('/admin/sellers',admin,wrap(async(req,res)=>res.json({sellers:(await M.getSellers()).map(s=>M.sellerView(s,true))})));
 r.get('/admin/sellers/:id/products/:productId/file',admin,wrap(async(req,res)=>{
  const seller=await M.getSeller(idSchema.parse(req.params.id));const product=seller?.products[idSchema.parse(req.params.productId)];M.ensure(product,'Product missing.');
  const source=await SecureFileManager.openProductFile(product.id);SecureFileManager.streamProductFileToResponse(source,product.id+'.zip',res);
 }));
 r.post('/admin/sellers/:id/onboarding-reference',admin,wrap(async(req,res)=>{
  const data=z.object({providerId:idSchema,reference:z.string().min(10).max(500)}).parse(req.body);
  const id=idSchema.parse(req.params.id);M.ensure(!(await M.getSellers()).some(s=>s.id!==id&&s.providerId===data.providerId),'This provider account is already linked.');
  await atomicDocument<M.Seller>('marketplace_sellers',id,s=>{M.ensure(s&&!s.providerId&&s.onboardingStatus==='unknown','Only an unknown onboarding request can be reconciled this way.');s.providerId=data.providerId;s.onboardingStatus='created';return M.record(s,req.userId,'ONBOARDING_RECONCILED',data.reference);});res.json({success:true});
 }));
 r.post('/admin/sellers/:id/decision',admin,wrap(async(req,res)=>{
  const id=idSchema.parse(req.params.id),data=z.object({action:z.enum(['approve','suspend','permanent_suspension','release_hold','hold']),reason:z.string().min(10).max(2000),providerReference:z.string().max(300).default(''),splitLabel:z.string().max(100).default('')}).parse(req.body);
  const s=await atomicDocument<M.Seller>('marketplace_sellers',id,s=>{M.ensure(s,'Seller missing.');
   M.ensure(!Object.values(s.ledger).some((l:any)=>['split_processing','settlement_pending'].includes(l.status)),'A settlement is processing; reconcile it and contact the payment partner before changing restrictions.');
   if(data.action==='approve'){M.ensure(s.kycStatus==='approved'&&s.providerId&&data.providerReference&&data.splitLabel,'Approved KYC, settlement label and approval reference are required.');M.ensure(s.status!=='permanent_suspension','Permanent suspension requires a separate documented appeal review.');s.status='approved';s.splitLabel=data.splitLabel;s.approvalReference=data.providerReference;}
   if(data.action==='suspend'||data.action==='permanent_suspension')s.status=data.action==='suspend'?'suspended':'permanent_suspension';
   if(['hold','suspend','permanent_suspension'].includes(data.action))s.hold={reason:data.reason,startedAt:M.now(),reviewAt:new Date(Date.now()+120*86400000).toISOString(),providerReference:data.providerReference,bankHoldConfirmed:!!data.providerReference};
   if(data.action==='release_hold'){M.ensure(data.providerReference,'Record the provider release/reconciliation reference.');delete s.hold;}
   return M.record(s,req.userId,data.action.toUpperCase(),data.reason);});res.json({seller:M.sellerView(s,true)});
 }));
 r.post('/admin/sellers/:id/products/:productId',admin,wrap(async(req,res)=>{
  const data=z.object({status:z.enum(['active','rejected','removed']),reason:z.string().min(10).max(1000)}).parse(req.body);
  const s=await atomicDocument<M.Seller>('marketplace_sellers',idSchema.parse(req.params.id),s=>{M.ensure(s,'Seller missing.');const p=s.products[idSchema.parse(req.params.productId)];M.ensure(p,'Product missing.');if(data.status==='active')M.ensure(s.status==='approved'&&s.kycStatus==='approved','Seller approval is required.');p.status=data.status;p.reviewNote=data.reason;return M.record(s,req.userId,'PRODUCT_'+data.status.toUpperCase(),p.id+': '+data.reason);});res.json({seller:M.sellerView(s,true)});
 }));
 r.post('/admin/sellers/:id/cases/:caseId',admin,wrap(async(req,res)=>{const data=z.object({status:z.enum(['under_review','waiting_for_seller','resolved','rejected']),note:z.string().min(10).max(2000)}).parse(req.body);await atomicDocument<M.Seller>('marketplace_sellers',idSchema.parse(req.params.id),s=>{M.ensure(s,'Seller missing.');const c=s.cases[idSchema.parse(req.params.caseId)];M.ensure(c,'Complaint missing.');Object.assign(c,data,{updatedAt:M.now()});return M.record(s,req.userId,'COMPLAINT_UPDATED',c.id+': '+data.note);});res.json({success:true});}));
 r.post('/admin/sellers/:id/sales/:orderId/:action',admin,wrap(async(req,res)=>{
  const id=idSchema.parse(req.params.id),orderId=idSchema.parse(req.params.orderId),action=req.params.action;
  if(action==='settle')await settleSale(id,orderId);
  else if(action==='refund'){const data=z.object({amountPaise:z.number().int().positive(),reason:z.string().min(10).max(2000)}).parse(req.body);await requestRefund(id,orderId,data.amountPaise,data.reason,req.userId);}
  else if(action==='link-refund'){const providerId=idSchema.parse(req.body.providerId);await linkUnknownRefund(id,orderId,providerId,req.userId);}
  else if(action==='chargeback'){const data=z.object({amountPaise:z.number().int().positive(),reference:z.string().min(10).max(300),reason:z.string().min(10).max(2000)}).parse(req.body);await recordChargeback(id,orderId,data.amountPaise,data.reference,data.reason,req.userId);}
  else if(action==='reconcile-refund')await reconcileRefund(id,orderId);else throw new M.MarketplaceError('Unknown action.');res.json({success:true});
 }));
 r.get('/reconcile-cron',wrap(async(req,res)=>{
  M.ensure(process.env.CRON_SECRET&&req.headers.authorization===`Bearer ${process.env.CRON_SECRET}`,'Unauthorized.');let completed=0,review=0;
  const queue=(await M.getSellers()).flatMap(s=>Object.values(s.ledger).map((sale:any)=>({sellerId:s.id,sale})))
   .filter(({sale})=>['refund_pending','pending','split_processing','split_unknown','settlement_pending','settlement_unknown'].includes(sale.status))
   .filter(({sale})=>sale.status!=='pending'||new Date(sale.eligibleAt).getTime()<=Date.now())
   .sort((a,b)=>String(a.sale.lastReconciledAt||'').localeCompare(String(b.sale.lastReconciledAt||''))).slice(0,20);
  for(const {sellerId,sale} of queue){
   try{if(sale.status==='refund_pending')await reconcileRefund(sellerId,sale.orderId);else await settleSale(sellerId,sale.orderId);completed++;}catch{review++;}
   await atomicDocument<M.Seller>('marketplace_sellers',sellerId,s=>{M.ensure(s,'Seller missing.');s.ledger[sale.orderId].lastReconciledAt=M.now();return s;});
  }
  res.json({completed,requiresReview:review});
 }));
 return r;
}
