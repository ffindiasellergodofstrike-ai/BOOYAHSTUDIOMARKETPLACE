import crypto from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import { BUSINESS } from '../src/config/business';
import { z } from 'zod';
import { Store } from './store';
import { supabaseAdmin, isSupabaseAdminConfigured } from './supabase';
import { appOrigin } from './config';
import { policyDocuments, policyVersion } from './policies';
import { sendOrderEmail, sendRefundEmail } from './orderEmail';
import { assertGatewayForNewOrder } from './gatewayControl';
import { marketplaceSplitForOrder } from './gatewaySplits';
import { fulfillCreatorOrder } from './creatorMarketplace';

const merchantOrderId = /^[A-Za-z0-9_-]{3,45}$/;
const providerId = /^[A-Za-z0-9_-]{1,100}$/;
const paymentStates = new Set(['SUCCESS', 'FAILED', 'PENDING', 'USER_DROPPED', 'CANCELLED', 'NOT_ATTEMPTED']);
export function cashfreeConfig() {
  const mode = process.env.CASHFREE_ENV || 'sandbox';
  if (!['sandbox', 'production'].includes(mode)) throw new Error('CASHFREE_ENV must be sandbox or production.');
  const version = process.env.CASHFREE_API_VERSION || '2026-01-01';
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(version)) throw new Error('Invalid Cashfree API version.');
  return { mode, environment: mode === 'production' ? 'live' : 'test', version,
    base: mode === 'production' ? 'https://api.cashfree.com/pg/' : 'https://sandbox.cashfree.com/pg/',
    configured: Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY && isSupabaseAdminConfigured()),
  };
}
export class CashfreeError extends Error {
  constructor(public status: number, public code = '') { super('Cashfree request could not be completed.'); }
}
/** Only trusted relative API paths and fixed provider hosts may receive our secrets. */
export async function cashfreeRequest(endpoint: string, body?: unknown, options: RequestInit = {}) {
  if (!/^[A-Za-z0-9_/-]+$/.test(endpoint) || endpoint.includes('..') || endpoint.startsWith('/')) throw new Error('Invalid Cashfree endpoint');
  const config = cashfreeConfig();
  if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) throw new Error('Cashfree is not configured.');
  const headers = new Headers(options.headers);
  headers.set('x-client-id', process.env.CASHFREE_APP_ID);
  headers.set('x-client-secret', process.env.CASHFREE_SECRET_KEY);
  headers.set('x-api-version', config.version);
  headers.set('accept', 'application/json');
  let requestBody = options.body;
  if (body !== undefined) { requestBody = JSON.stringify(body); headers.set('content-type', 'application/json'); }
  const response = await fetch(`${config.base}${endpoint}`, { ...options, redirect: 'error',
    method: options.method || (body === undefined ? 'GET' : 'POST'), headers,
    ...(requestBody === undefined ? {} : { body: requestBody }), signal: options.signal || AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new CashfreeError(response.status, typeof data.code === 'string' ? data.code.slice(0,100) : '');
  }
  return response.json();
}
export function cashfreeIdempotencyKey(value: string): string {
  const bytes = crypto.createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function moneyPaise(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const amount = Number(value), paise = Math.round(amount * 100);
  return Number.isFinite(amount) && Number.isSafeInteger(paise) && paise >= 0 && Math.abs(amount * 100 - paise) < 0.00001 ? paise : null;
}
export function verifyCashfreeSignature(raw: Buffer, signature: unknown, timestamp: unknown): boolean {
  const secret = process.env.CASHFREE_SECRET_KEY;
  if (!secret || !Buffer.isBuffer(raw) || typeof signature !== 'string' || typeof timestamp !== 'string' ||
      !/^\d{10,16}$/.test(timestamp) || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  // Delivery retries may retain the original timestamp. Durable event/payment uniqueness
  // handles replay, and monotonic SQL transitions prevent restoring refunded access.
  if (Number(timestamp) > Date.now() + 300000) return false;
  const expected = crypto.createHmac('sha256', secret).update(timestamp).update(raw).digest();
  const actual = Buffer.from(signature, 'base64');
  return actual.length === expected.length && crypto.timingSafeEqual(expected, actual);
}
export function matchesCashfreeOrder(remote: any, order: any): boolean {
  return Boolean(remote && order && remote.order_id === (order.cashfreeOrderId || order.id) &&
    remote.order_currency === 'INR' && moneyPaise(remote.order_amount) === moneyPaise(order.total) &&
    moneyPaise(order.total)! > 0 && (!order.cfOrderId || String(remote.cf_order_id) === String(order.cfOrderId)));
}
export function matchesCashfreePayment(payment: any, order: any): boolean {
  return Boolean(order?.cashfreeOrderId && String(order.paymentProvider).toLowerCase() === 'cashfree' &&
    order.paymentEnvironment === cashfreeConfig().environment && providerId.test(String(payment?.cf_payment_id || '')) &&
    payment.order_id === order.cashfreeOrderId && payment.payment_currency === 'INR' &&
    moneyPaise(payment.payment_amount) === moneyPaise(order.total) && paymentStates.has(payment.payment_status));
}
export async function syncCashfreeOrder(original: any) {
  if (!original?.cashfreeOrderId || String(original.paymentProvider).toLowerCase() !== 'cashfree' ||
      original.paymentEnvironment !== cashfreeConfig().environment) throw new Error('Cashfree order environment mismatch');
  const remote = await cashfreeRequest(`orders/${original.cashfreeOrderId}`);
  if (!matchesCashfreeOrder(remote, original)) throw new Error('Cashfree order mismatch');
  const payments = await cashfreeRequest(`orders/${original.cashfreeOrderId}/payments`);
  if (!Array.isArray(payments)) throw new Error('Invalid Cashfree payment response');
  const current = await Store.getGlobalOrder(original.id);
  const verifiedPayments: any[] = [];
  payments.sort((a:any,b:any) => (Date.parse(a.payment_completion_time || a.payment_time || '') || 0) - (Date.parse(b.payment_completion_time || b.payment_time || '') || 0));
  for (const payment of payments) {
    if (!matchesCashfreePayment(payment, current)) continue;
    verifiedPayments.push({
      id: String(payment.cf_payment_id), order_id: payment.order_id, amount: moneyPaise(payment.payment_amount),
      currency: payment.payment_currency, status: payment.payment_status, environment: cashfreeConfig().environment,
      providerCreatedAt: payment.payment_completion_time || payment.payment_time || null,
    });
  }
  // Fetch and validate the complete snapshot before any entitlement mutation.
  const refunds = await cashfreeRequest(`orders/${original.cashfreeOrderId}/refunds`);
  if (!Array.isArray(refunds)) throw new Error('Invalid Cashfree refund response');
  const knownSuccessfulPayments = new Set([
    ...Object.values(current?.payments || {}).filter((payment:any)=>payment.status==='SUCCESS').map((payment:any)=>String(payment.id)),
    ...verifiedPayments.filter(payment=>payment.status==='SUCCESS').map(payment=>payment.id),
  ]);
  const verifiedRefunds: any[] = [];
  for (const refund of refunds) {
    const id = String(refund.refund_id || '');
    const paymentId = String(refund.cf_payment_id || '');
    if (refund.refund_status !== 'SUCCESS') continue;
    if (!providerId.test(id) || refund.order_id !== original.cashfreeOrderId || refund.refund_currency !== 'INR' ||
        !knownSuccessfulPayments.has(paymentId) || moneyPaise(refund.refund_amount) === null || moneyPaise(refund.refund_amount)! <= 0) throw new Error('Cashfree refund mismatch');
    verifiedRefunds.push({
      id, payment_id: paymentId, order_id: original.cashfreeOrderId, amount: moneyPaise(refund.refund_amount),
      currency: 'INR', environment: cashfreeConfig().environment,
    });
  }
  // One SQL transaction: never expose a freshly paid entitlement between payment
  // confirmation and a known full refund, and roll back the snapshot on mismatch.
  const saved = await Store.rpc('sync_cashfree_snapshot', `orders/${original.id}`, {payments:verifiedPayments,refunds:verifiedRefunds});
  if (saved.marketplace) await fulfillCreatorOrder(saved);
  // Email transport is independent of financial acceptance; durable retry handles failures.
  try {
    if (saved.refundedAmount > 0) await sendRefundEmail(saved);
    if (['PAID','PARTIALLY_REFUNDED'].includes(saved.paymentStatus) && saved.deliveryStatus !== 'REVOKED') await sendOrderEmail(saved);
  } catch { /* A stored purchase remains valid when email delivery is unavailable. */ }
  return saved;
}
export function cashfreeResult(order: any) {
  const revoked = order.deliveryStatus === 'REVOKED' || order.paymentStatus === 'REFUNDED';
  const paid = ['PAID', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus) && !revoked;
  return { success: paid, status: revoked ? 'REVOKED' : paid ? order.paymentStatus : order.latestPaymentStatus === 'FAILED' || order.latestPaymentStatus === 'USER_DROPPED' ? 'FAILED' : 'PENDING', orderId: order.id };
}
export function registerCashfreeRoutes(app: Express, auth: RequestHandler, limiter: RequestHandler) {
  app.post('/api/payments/cashfree/initiate', auth, limiter, async (req: any, res) => {
    const input = z.object({ orderId: z.string().regex(merchantOrderId), agreeTerms: z.literal(true) }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ success:false, message:'Accept the purchase policies and provide a valid order.' });
    if (!cashfreeConfig().configured) return res.status(503).json({ success:false, message:'Online checkout is not configured yet.' });
    let order = await Store.getUserOrderById(req.userId, input.data.orderId);
    if (!order) return res.status(404).json({ success:false, message:'Order not found.' });
    try { await assertGatewayForNewOrder('cashfree', order); } catch (error) { return res.status(409).json({ success: false, message: error instanceof Error ? error.message : 'Checkout unavailable.' }); }
    if (!['PENDING','FAILED'].includes(order.paymentStatus) || order.transactionId || order.razorpayOrderId ||
        (order.paymentProvider && String(order.paymentProvider).toLowerCase() !== 'cashfree') ||
        (order.cashfreeOrderId && order.paymentEnvironment !== cashfreeConfig().environment)) return res.status(409).json({ success:false,message:'This order is not payable in the current environment. Check it in your account.' });
    const phone = String(order.customer?.phone || '').replace(/\D/g,'').slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ success:false,message:'Enter a valid 10-digit Indian contact number. No mobile OTP is required.' });
    const totalPaise = moneyPaise(order.total);
    if (totalPaise === null || totalPaise < 100) return res.status(400).json({ success:false,message:'Online checkout requires an order total of at least ₹1. Please contact support.' });
    for (const item of order.items || []) {
      const {data,error} = await supabaseAdmin().storage.from('products').info(`${item.productId}.zip`);
      if (error || !data) return res.status(503).json({ success:false,message:'A product file is temporarily unavailable. Contact support before paying.' });
    }
    await Store.set(`policyDocuments/${policyVersion}`, policyDocuments);
    let remote: any;
    if (order.cashfreeOrderId) remote = await cashfreeRequest(`orders/${order.cashfreeOrderId}`);
    else {
      const split = await marketplaceSplitForOrder(order, 'cashfree');
      try {
        remote = await cashfreeRequest('orders', {
          order_id: order.id, order_amount: Number(order.total.toFixed(2)), order_currency:'INR',
          customer_details:{ customer_id:order.userId, customer_name:String(order.customerName || order.customer?.fullName || 'Customer').slice(0,100), customer_email:order.customerEmail, customer_phone:phone },
          order_meta:{ return_url:`${appOrigin()}/checkout?status=pending&orderId=${encodeURIComponent(order.id)}`, notify_url:`${appOrigin()}/api/payments/cashfree/webhook` },
          order_note:`${BUSINESS.name} digital products`,
          ...split,
        }, { headers:{'x-idempotency-key':cashfreeIdempotencyKey(`order:${cashfreeConfig().environment}:${order.id}`)} });
      } catch (error) {
        if (!(error instanceof CashfreeError) || ![400,409].includes(error.status) || !/order.*(exist|already)|idempotency/.test(error.code)) throw error;
        remote = await cashfreeRequest(`orders/${order.id}`);
      }
    }
    if (!matchesCashfreeOrder(remote, order) || !providerId.test(String(remote.cf_order_id || ''))) throw new Error('Cashfree created an unexpected order');
    order = await Store.rpc('bind_cashfree', `orders/${order.id}`, { cashfreeOrderId:remote.order_id, cfOrderId:String(remote.cf_order_id), paymentProvider:'Cashfree', paymentEnvironment:cashfreeConfig().environment, policyAcceptedAt:new Date().toISOString(), policyVersion });
    if (remote.order_status === 'PAID' || order.transactionId || !['PENDING','FAILED'].includes(order.paymentStatus)) return res.json({...cashfreeResult(await syncCashfreeOrder(order)),alreadyPaid:true});
    if (remote.order_status !== 'ACTIVE' || typeof remote.payment_session_id !== 'string' || !remote.payment_session_id) return res.status(409).json({success:false,message:'This checkout has expired. Check the order before starting another purchase.'});
    res.json({success:true,orderId:order.id,paymentSessionId:remote.payment_session_id,environment:order.paymentEnvironment,mode:cashfreeConfig().mode});
  });
  app.post('/api/payments/cashfree/reconcile/:orderId', auth, limiter, async (req:any,res) => {
    const order = await Store.getGlobalOrder(req.params.orderId);
    const profile = await Store.getUserProfile(req.userId);
    if (!order || (order.userId !== req.userId && profile?.role !== 'admin')) return res.status(404).json({success:false,message:'Order not found.'});
    if (!order.cashfreeOrderId || order.paymentEnvironment !== cashfreeConfig().environment) return res.status(409).json({success:false,status:'PENDING',message:'Cashfree payment has not been initiated in this environment.'});
    res.json(cashfreeResult(await syncCashfreeOrder(order)));
  });
  app.post('/api/payments/cashfree/webhook', async(req:any,res) => {
    if (!verifyCashfreeSignature(req.rawBody,req.get('x-webhook-signature'),req.get('x-webhook-timestamp'))) return res.status(400).json({success:false});
    if (!['PAYMENT_SUCCESS_WEBHOOK','PAYMENT_FAILED_WEBHOOK','PAYMENT_USER_DROPPED_WEBHOOK','REFUND_STATUS_WEBHOOK'].includes(req.body?.type)) return res.json({success:true});
    const orderId = req.body?.data?.order?.order_id || req.body?.data?.refund?.order_id;
    if (typeof orderId !== 'string' || !merchantOrderId.test(orderId)) return res.status(400).json({success:false});
    const localId = await Store.get<string>(`cashfreeOrderIndex/${orderId}`);
    const order = localId ? await Store.getGlobalOrder(localId) : null;
    if (!order) return res.status(503).json({success:false}); // Provider retries an event racing order binding.
    await syncCashfreeOrder(order);
    const eventId = crypto.createHash('sha256').update(req.rawBody).digest('hex');
    await Store.rpc('record_event',`paymentEvents/cashfree_${eventId}`,{orderId:order.id,event:req.body.type,source:'Cashfree'});
    res.json({success:true});
  });
}
