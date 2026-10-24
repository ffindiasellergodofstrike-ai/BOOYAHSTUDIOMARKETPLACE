import crypto from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import { FirebaseRtdb } from './firebaseRtdb';
import { BUSINESS } from '../src/config/business';

const sha512 = (value: string) => crypto.createHash('sha512').update(value).digest('hex');
export function getPayUConfig() {
  const raw = process.env.PAYU_ENV || 'test';
  if (!['test', 'prod'].includes(raw)) throw new Error('PAYU_ENV must be test or prod.');
  const live = raw === 'prod';
  return {
    key: process.env.PAYU_KEY?.trim() || '', salt: process.env.PAYU_SALT?.trim() || '',
    environment: live ? 'live' : 'test',
    checkoutUrl: live ? 'https://secure.payu.in/_payment' : 'https://test.payu.in/_payment',
    verifyUrl: live ? 'https://info.payu.in/merchant/postservice.php?form=2' : 'https://test.payu.in/merchant/postservice.php?form=2',
  };
}
export function payuRequestHash(fields: Record<string,string>, salt: string): string {
  return sha512([fields.key,fields.txnid,fields.amount,fields.productinfo,fields.firstname,fields.email,
    ...[1,2,3,4,5].map(i=>fields[`udf${i}`]||''), '', '', '', '', '', salt].join('|'));
}
export function verifyPayUHash(fields: Record<string,string>, salt: string): boolean {
  if (!salt || !/^[a-f\d]{128}$/i.test(fields.hash || '')) return false;
  const values = [salt, fields.status, '', '', '', '', '', ...[5,4,3,2,1].map(i=>fields[`udf${i}`]||''),
    fields.email, fields.firstname, fields.productinfo, fields.amount, fields.txnid, fields.key];
  if (fields.splitInfo) return false; // Split settlement is not enabled for this store.
  const additional = fields.additionalCharges ?? fields.additional_charges;
  if (additional !== undefined && additional !== '') values.unshift(additional);
  const expected=sha512(values.join('|'));
  return crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(fields.hash,'hex'));
}
const sameAmount = (a: unknown,b: unknown) => Number(a)>0 && Number(b)>0 && Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.round(Number(a)*100)===Math.round(Number(b)*100);
export function matchesPayUCallback(fields: Record<string,string>, order: any, config: ReturnType<typeof getPayUConfig>): boolean {
  return Boolean(order?.paymentProvider === 'PayU' && order.paymentEnvironment === config.environment &&
    order.payuMerchantKey === config.key && fields.key === config.key && fields.txnid === order.payuTxnId &&
    fields.udf1 === order.id && fields.udf2 === order.userId && fields.udf3 === order.paymentEnvironment &&
    sameAmount(fields.amount,order.total) && fields.email === order.payuIdentity?.email &&
    fields.firstname === order.payuIdentity?.firstname && fields.productinfo === order.payuIdentity?.productinfo);
}
export function matchesPayUVerification(data: any, order: any): boolean {
  return Boolean(data && data.txnid === order.payuTxnId && data.mihpayid &&
    sameAmount(data.transaction_amount ?? data.amt,order.total) &&
    data.status === 'success' && data.unmappedstatus === 'captured');
}
export function registerPayURoutes(app: Express, requireAuth: RequestHandler, helpers: {
  appUrl: () => string; fulfill: (order:any)=>Promise<void>; email: (order:any)=>Promise<void>;
}) {
  const sync = async (id: string) => {
    const order=await FirebaseRtdb.getGlobalOrder(id);
    if(!order || order.paymentProvider!=='PayU') return {success:false,status:'PENDING',message:'PayU order not found.'};
    if(['REFUNDED','PARTIALLY_REFUNDED','REVOKED','CANCELLED'].includes(order.status)) return {success:false,status:'REVOKED',message:'Order access has been revoked.'};
    const config=getPayUConfig();
    if(!config.key || !config.salt || order.paymentEnvironment!==config.environment || order.payuMerchantKey!==config.key) return {success:false,status:'PENDING',message:'The original PayU environment is not configured.'};
    if(order.paymentStatus!=='PAID') {
      const form=new URLSearchParams({key:config.key,command:'verify_payment',var1:order.payuTxnId,hash:sha512(`${config.key}|verify_payment|${order.payuTxnId}|${config.salt}`)});
      const response=await fetch(config.verifyUrl,{method:'POST',body:form,signal:AbortSignal.timeout(15000)});
      if(!response.ok) return {success:false,status:'PENDING',message:'Payment verification is temporarily unavailable.'};
      const payload=await response.json(); const payment=payload.transaction_details?.[order.payuTxnId];
      if(Number(payload.status)===1 && payment?.txnid===order.payuTxnId && sameAmount(payment.transaction_amount ?? payment.amt,order.total) && payment.status==='failure') {
        const latest=await FirebaseRtdb.getGlobalOrder(id);
        if(latest?.paymentStatus==='PAID') return sync(id);
        if(!latest || ['REFUNDED','PARTIALLY_REFUNDED','REVOKED','CANCELLED'].includes(latest.status)) return {success:false,status:'REVOKED'};
        Object.assign(latest,{paymentStatus:'FAILED',status:'FAILED',downloadStatus:'UNAVAILABLE'});
        await FirebaseRtdb.saveGlobalOrder(latest);
        return {success:false,status:'FAILED',message:'PayU confirmed that this payment failed.'};
      }
      if(Number(payload.status)!==1 || !matchesPayUVerification(payment,order)) return {success:false,status:'PENDING',message:'Payment has not been verified as captured.'};
      // Re-read so a concurrent revocation cannot be overwritten by the network request.
      const latest=await FirebaseRtdb.getGlobalOrder(id);
      if(!latest || ['REFUNDED','PARTIALLY_REFUNDED','REVOKED','CANCELLED'].includes(latest.status)) return {success:false,status:'REVOKED'};
      Object.assign(order,latest,{status:'PAID',paymentStatus:'PAID',orderStatus:'PAID',transactionId:String(payment.mihpayid),paymentId:String(payment.mihpayid),paymentVerifiedAt:new Date().toISOString(),deliveryStatus:order.paymentEnvironment==='live'?'PENDING':'TEST_ONLY',downloadStatus:'UNAVAILABLE'});
      if(order.paymentEnvironment==='live') order.invoiceNumber ||= `INV-${order.id}`;
      await FirebaseRtdb.saveGlobalOrder(order);
    }
    await helpers.fulfill(order); await helpers.email(order);
    return {success:true,status:'PAID',orderId:order.id,message:order.paymentEnvironment==='test'?'Test payment confirmed. No products will be delivered.':'Payment confirmed.'};
  };
  app.post('/api/payments/payu/initiate',requireAuth,async(req:any,res)=>{
    try {
      const config=getPayUConfig();
      if(!config.key || !config.salt) return res.status(503).json({success:false,message:'PayU is not configured yet.'});
      if(req.body.agreeTerms!==true) return res.status(400).json({success:false,message:'Accept the terms before paying.'});
      if(typeof req.body.orderId!=='string') return res.status(400).json({success:false,message:'Order ID is required.'});
      const order=await FirebaseRtdb.getUserOrderById(req.userId,req.body.orderId);
      if(order?.marketplace) return res.status(409).json({success:false,message:'Use the marketplace checkout option for this order.'});
      if(!order) return res.status(404).json({success:false,message:'Order not found.'});
      if(order.paymentInitiatedAt || order.transactionId || ['PAID','REFUNDED','REVOKED','CANCELLED'].includes(order.status)) return res.status(409).json({success:false,message:'This order already has a payment attempt. Check its status or create a new order.'});
      const total=Number(order.total); const email=String(order.customer?.email||order.customerEmail||'');
      const phone=String(order.customer?.phone||'').replace(/\D/g,'').replace(/^91(?=\d{10}$)/,'');
      const firstname=String(order.customer?.fullName||'Customer').replace(/[|\r\n]/g,' ').trim().slice(0,60);
      if(!Number.isFinite(total)||total<=0||!/^\d{10}$/.test(phone)||!/^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(email)) return res.status(400).json({success:false,message:'Enter a valid name, account email, and 10-digit Indian mobile number.'});
      const txnid=`BS${crypto.randomBytes(14).toString('hex')}`;
      const callback=`${helpers.appUrl()}/api/payments/payu/callback`;
      const fields:Record<string,string>={key:config.key,txnid,amount:total.toFixed(2),productinfo:`${BUSINESS.name} digital templates`,firstname,email,phone,surl:callback,furl:callback,udf1:order.id,udf2:order.userId,udf3:config.environment,udf4:'',udf5:''};
      fields.hash=payuRequestHash(fields,config.salt);
      Object.assign(order,{payuTxnId:txnid,payuMerchantKey:config.key,payuIdentity:{firstname,email,productinfo:fields.productinfo},paymentEnvironment:config.environment,paymentProvider:'PayU',paymentInitiatedAt:new Date().toISOString(),termsAccepted:true,termsAcceptedAt:new Date().toISOString(),termsAcceptedPolicies:['terms','privacy','refund','cancellation','delivery'],status:'PENDING_PAYMENT'});
      await FirebaseRtdb.saveGlobalOrder(order);
      res.json({success:true,action:config.checkoutUrl,fields,environment:config.environment});
    } catch {res.status(503).json({success:false,message:'Could not start PayU checkout. Please try again.'});}
  });
  const notification = (webhook:boolean):RequestHandler => async(req,res)=>{
    try {
      const config=getPayUConfig();
      if(!config.key||!config.salt) return res.status(503).json({success:false});
      const fields=req.body;
      if(!fields || Object.values(fields).some(v=>typeof v!=='string') || !verifyPayUHash(fields,config.salt)) return res.status(400).json({success:false,message:'Invalid payment signature.'});
      const order=await FirebaseRtdb.getGlobalOrder(fields.udf1);
      if(!matchesPayUCallback(fields,order,config)) return res.status(400).json({success:false,message:'Payment does not match the order.'});
      const result=await sync(order.id);
      if(webhook) return res.status(result.success||result.status==='FAILED'||result.status==='REVOKED'?200:503).json(result);
      res.redirect(303,`${helpers.appUrl()}/checkout?status=${result.success?'success':result.status==='FAILED'?'failed':'pending'}&orderId=${encodeURIComponent(order.id)}`);
    } catch {res.status(503).json({success:false,message:'Payment verification is temporarily unavailable. Check your order in your account.'});}
  };
  app.post('/api/payments/payu/callback',notification(false));
  app.post('/api/payments/payu/webhook',notification(true));
  app.post('/api/payments/payu/reconcile/:orderId',requireAuth,async(req:any,res)=>{
    res.set('Cache-Control','private, no-store');
    try {
      const order=await FirebaseRtdb.getUserOrderById(req.userId,req.params.orderId);
      if(!order)return res.status(404).json({success:false,message:'Order not found.'});
      res.json(await sync(order.id));
    }catch{res.status(503).json({success:false,status:'PENDING',message:'Unable to verify PayU payment right now.'});}
  });
  return sync;
}
