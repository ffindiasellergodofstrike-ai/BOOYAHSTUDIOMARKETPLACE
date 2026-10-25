import { Router } from 'express';
import { Store } from './store';
import { AuditLogger, generateRequestId } from './audit';
import { appOrigin } from './config';
import { cashfreeConfig } from './cashfree';
import { paymentEnvironment } from './razorpay';
import { supabaseAdmin, isSupabaseAdminConfigured, isSupabaseAuthConfigured } from './supabase';
import { sendOrderEmail } from './orderEmail';
import { adminAccessStatus, adminEmailStatus } from '../src/services/AdminOrderStatus';

/** Mount behind requireAdmin. Never return provider secrets or private signed URLs. */
export const adminOperationsRouter = Router();
const validId = (id: unknown) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
const pick = (record: any, keys: string[]) => Object.fromEntries(keys.filter(key => record?.[key] !== undefined).map(key => [key, record[key]]));
export function adminOrderSummary(order: any) {
  return pick(order, ['id','orderNumber','invoiceNumber','userId','customerName','customerEmail','customer','date','createdAt','total','currency','items','status','paymentStatus','latestPaymentStatus','paymentProvider','paymentEnvironment','transactionId','paymentId','payments','cashfreeOrderId','cfOrderId','razorpayOrderId','paymentInitiatedAt','paymentVerifiedAt','paidAt','deliveredAt','deliveryStatus','downloadStatus','refundVerifiedAt','refundedAmount','refunds','refundReviewRequired','duplicatePaymentReview','policyVersion','policyAcceptedAt','emailDelivery','refundEmailDelivery','cashfreeDisputes','disputes','checkoutClosedAt']);
}
export function deliveryAggregates(orders: any[]) {
  const delivery = { available: 0, partial: 0, pending: 0, revoked: 0, testOnly: 0 };
  const orderEmails = { delivered: 0, accepted: 0, delayed: 0, failed: 0, notConfigured: 0, pending: 0 };
  for (const order of orders) {
    const access = adminAccessStatus(order).key;
    if (access === 'test') delivery.testOnly++;
    else if (access === 'revoked') delivery.revoked++;
    else if (access === 'partial') delivery.partial++;
    else if (access === 'available') delivery.available++;
    else delivery.pending++;
    const email = adminEmailStatus(order).key;
    if (email === 'delivered') orderEmails.delivered++;
    else if (['failed','review'].includes(email)) orderEmails.failed++;
    else if (email === 'delayed') orderEmails.delayed++;
    else if (email === 'accepted') orderEmails.accepted++;
    else if (email === 'not_configured') orderEmails.notConfigured++;
    else orderEmails.pending++;
  }
  return { delivery, orderEmails };
}
adminOperationsRouter.get('/orders/:id/delivery', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid order reference.' });
  const order = await Store.getGlobalOrder(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
  const [audit, downloads] = await Promise.all([
    Store.get<Record<string, any>>(`orderAuditIndex/${order.id}`),
    Store.get<Record<string, any>>('downloadLogs'),
  ]);
  const lifecycle = [
    ['ORDER_CREATED',order.createdAt || order.date], ['PAYMENT_INITIATED',order.paymentInitiatedAt],
    ['PAYMENT_VERIFIED',order.paymentVerifiedAt], ['ACCOUNT_ACCESS_AVAILABLE',order.deliveredAt],
    ['REFUND_VERIFIED',order.refundVerifiedAt], ['EMAIL_ACCEPTED',order.emailDelivery?.acceptedAt || order.emailDelivery?.sentAt],
    ['EMAIL_DELIVERED',order.emailDelivery?.providerStatus === 'delivered' ? order.emailDelivery?.providerEventAt : null], ['CHECKOUT_CLOSED',order.checkoutClosedAt],
  ].filter(([,timestamp])=>timestamp).map(([eventType,timestamp])=>({ eventType, timestamp, source: 'STORED_ORDER' }));
  const timeline = [...Object.values(audit || {}).map(row=>pick(row,['logId','eventType','eventStatus','timestamp','source','requestId'])), ...lifecycle]
    .sort((a,b)=>new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime());
  const downloadLogs = Object.entries(downloads || {}).filter(([,row])=>row.orderId === order.id).map(([id,row])=>({ id,...pick(row,['orderId','productId','userId','authorizedAt','expiresAt','event']) }))
    .sort((a:any,b:any)=>Date.parse(b.authorizedAt)-Date.parse(a.authorizedAt));
  res.json({ success: true, order: adminOrderSummary(order), timeline, downloadLogs, limitations: 'Account access and signed-link issuance do not prove a completed download. Email delivery is known only from verified provider events.' });
});
adminOperationsRouter.post('/orders/:id/retry-email', async (req:any,res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid order reference.' });
  const order = await Store.getGlobalOrder(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
  const allowed = await Store.rpc('rate',`adminEmailRates/${req.userId}_${order.id}`,{now:Date.now(),windowMs:600000,maxAttempts:5});
  if (!allowed) return res.status(429).json({success:false,message:'Email retry requests are temporarily limited. Please wait before trying again.'});
  const result = await sendOrderEmail(order);
  await AuditLogger.log({requestId:generateRequestId(),userId:req.userId,orderId:order.id,eventType:'ORDER_UPDATED',eventStatus:'SUCCESS',source:'ADMIN_PANEL',metadata:{action:'RETRY_ORDER_EMAIL',result:result.status}});
  const messages: Record<string,string> = {
    sent:'The email was already accepted or has now been accepted by the provider. Check the delivery status.',
    queued:'The email is queued; retry backoff or an active send is still in effect.',
    not_configured:'Configure the Resend API key and verified sender in hosting settings, then retry.',
    review_required:'Review the provider delivery record before resending. Automatic retry is paused.',
    skipped:'This order is not eligible for a purchase confirmation. Verify payment and active access first.',
    unavailable:'Email processing is temporarily unavailable. The purchase has not been changed.',
  };
  res.json({success:true,result,order:adminOrderSummary(await Store.getGlobalOrder(order.id)),message:messages[result.status]});
});
adminOperationsRouter.get('/readiness', async (_req,res) => {
  const configured = isSupabaseAdminConfigured();
  let reachable = false, schemaReady = false, privateBucket: boolean | null = null;
  if (configured) {
    const checks = await Promise.allSettled([
      Store.testConnection(),
      supabaseAdmin().from('cashfree_order_bindings').select('cashfree_order_id').limit(1),
      supabaseAdmin().storage.getBucket('products'),
    ]);
    // Store.testConnection returns a status object; non-connected results stay errors.
    if (checks[0].status === 'fulfilled') reachable = ['connected','ok'].includes(String((checks[0].value as any)?.status)) || (checks[0].value as any)?.connected === true || (checks[0].value as any)?.success === true;
    schemaReady = checks[1].status === 'fulfilled' && !checks[1].value.error;
    if (checks[2].status === 'fulfilled' && !checks[2].value.error && checks[2].value.data) privateBucket = checks[2].value.data.public === false;
  }
  let origin: string | null = null;
  try { origin = appOrigin(); } catch { /* reported without echoing invalid input */ }
  let cashfree: any;
  try { const cf=cashfreeConfig();cashfree={configured:cf.configured,environment:cf.environment}; } catch { cashfree={configured:false,environment:'invalid'}; }
  let lastRun: any = null;
  if (reachable) { try { lastRun = await Store.get('operations/reconciliationLastRun'); } catch { /* health remains useful during a partial outage */ } }
  const readiness = {
    appUrl:{configured:Boolean(origin),origin},
    supabase:{configured,reachable,schemaReady,authConfigured:isSupabaseAuthConfigured()},
    productStorage:{private:privateBucket},cashfree,
    razorpay:{configured:Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),environment:paymentEnvironment()},
    resend:{apiConfigured:Boolean(process.env.RESEND_API_KEY),senderConfigured:Boolean(process.env.RESEND_FROM_EMAIL),webhookConfigured:Boolean(process.env.RESEND_WEBHOOK_SECRET)},
    scheduler:{configured:Boolean(process.env.CRON_SECRET),lastRun},
  };
  const checks = [
    {id:'origin',label:'Trusted website URL',status:origin?'ready':'error',message:origin || 'Set a valid APP_URL in hosting settings and redeploy.'},
    {id:'database',label:'Supabase database connection',status:reachable?'ready':configured?'error':'not_configured',message:reachable?'The server-only store responded.':'Check the Supabase URL/server secret key and apply the current SQL migrations.'},
    {id:'schema',label:'Cashfree database migration',status:schemaReady?'ready':configured?'error':'not_configured',message:schemaReady?'Cashfree reference table is available.':'Apply the baseline and current SQL migrations from the repository deployment guide.'},
    {id:'auth',label:'Supabase email/password Auth',status:readiness.supabase.authConfigured?'manual':'not_configured',message:'Configure confirmation, recovery redirects/template and Resend SMTP in Supabase; test a real inbox.'},
    {id:'storage',label:'Private product storage',status:privateBucket===true?'ready':'error',message:privateBucket===true?'The products bucket is private. Verify each file in Products.':'Create or secure the private products bucket before accepting payments.'},
    {id:'cashfree',label:'Cashfree configuration',status:cashfree.configured?'manual':'not_configured',message:cashfree.configured?`Keys configured for ${cashfree.environment}; merchant activation, webhooks and a real payment still need verification.`:'Set matching CASHFREE_APP_ID, CASHFREE_SECRET_KEY and CASHFREE_ENV in hosting settings.'},
    {id:'resend',label:'Order email configuration',status:readiness.resend.apiConfigured&&readiness.resend.senderConfigured?'manual':'not_configured',message:'Verify the Resend sending domain, API key and sender; test inbox delivery.'},
    {id:'email_events',label:'Email delivery tracking',status:readiness.resend.webhookConfigured?'manual':'not_configured',message:'Configure the signed Resend webhook; API acceptance alone is not inbox delivery.'},
    {id:'scheduler',label:'Reconciliation and email retry scheduler',status:readiness.scheduler.configured?'manual':'not_configured',message:'Configure the authenticated scheduler supported by your hosting plan, set CRON_SECRET and verify its actual last run after deployment. Free-plan timing and usage limits apply; a configured secret alone does not prove a job ran.'},
  ];
  res.json({success:true,readiness,checks,appUrl:origin,environment:cashfree.environment,lastReconciledAt:lastRun?.completedAt || null});
});
