import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { Store } from './store';
import { supabaseAdmin } from './supabase';
import { appOrigin } from './config';
import { policyDocuments, policyVersion } from './policies';
import { assertGatewayForNewOrder } from './gatewayControl';
import { marketplaceSplitForOrder } from './gatewaySplits';
import { fulfillCreatorOrder } from './creatorMarketplace';
import { sendOrderEmail, sendRefundEmail } from './orderEmail';
import { createEasebuzzHostedPayment, easebuzzConfig, formatEasebuzzAmount, retrieveEasebuzzPayment, sanitizePhoneNumber, verifyEasebuzzCallbackHash } from './easebuzz';

const identifier = /^[A-Za-z0-9_-]{3,45}$/;
const paise = (value: unknown) => { const parsed = formatEasebuzzAmount(value); return parsed.valid ? Math.round(parsed.value * 100) : null; };
export function matchesEasebuzzPayment(remote: any, order: any) {
  return Boolean(remote && order?.easebuzzTxnId && String(order.paymentProvider).toLowerCase() === 'easebuzz' &&
    order.paymentEnvironment === easebuzzConfig().environment && remote.txnid === order.easebuzzTxnId &&
    remote.key === process.env.EASEBUZZ_KEY && remote.udf1 === order.id &&
    remote.email === String(order.customerEmail).trim().toLowerCase() && sanitizePhoneNumber(remote.phone) === sanitizePhoneNumber(order.customer?.phone) &&
    remote.productinfo === 'Booyahstudio digital products' && (!remote.currency || remote.currency === 'INR') &&
    paise(remote.amount) === paise(order.total) && paise(order.total)! > 0 &&
    /^[A-Za-z0-9_-]{1,100}$/.test(String(remote.easepayid || '')) &&
    ['success', 'failure', 'pending', 'userCancelled', 'dropped', 'bounced', 'initiated', 'refunded', 'partially_refunded'].includes(remote.status));
}
async function easebuzzRpc(operation: 'bind' | 'confirm', orderId: string, value: any) {
  const { data, error } = await supabaseAdmin().rpc('easebuzz_order_operation', { operation, order_id: orderId, value });
  if (error) throw new Error('Payment record could not be verified. Please check your order before paying again.');
  return data;
}
export async function syncEasebuzzOrder(order: any) {
  if (!order?.easebuzzTxnId || String(order.paymentProvider).toLowerCase() !== 'easebuzz' || order.paymentEnvironment !== easebuzzConfig().environment) throw new Error('Easebuzz order does not match this environment.');
  const remote = await retrieveEasebuzzPayment(order.easebuzzTxnId);
  if (!matchesEasebuzzPayment(remote, order)) throw new Error('Easebuzz transaction does not match this order.');
  // A refund indicated in the lookup must not be ignored. Until its verified refund
  // reference is reconciled by the provider-specific workflow, fail closed.
  const refundAmounts = [remote.refund_amount, remote.refunded_amount].filter(value => value !== undefined && value !== null && value !== '');
  const refundIndicated = ['refunded', 'partially_refunded'].includes(remote.status) ||
    refundAmounts.some(value => !/^\d+(?:\.\d{1,2})?$/.test(String(value)) || Number(value) > 0) ||
    (remote.refund_status && !['no_refund', 'none', 'na'].includes(String(remote.refund_status).toLowerCase()));
  if (refundIndicated) {
    await Store.rpc('order_note', `orders/${order.id}`, { accessReview: 'required', providerRefundReviewRequired: true });
    const restricted = await Store.rpc('revoke_order', `orders/${order.id}`, {});
    if (restricted.marketplace) await fulfillCreatorOrder(restricted);
    return restricted;
  }
  const saved = await easebuzzRpc('confirm', order.id, { txnid: remote.txnid, id: String(remote.easepayid), amount: paise(remote.amount), currency: 'INR', status: remote.status === 'success' ? 'success' : ['failure', 'userCancelled', 'dropped', 'bounced'].includes(remote.status) ? 'failure' : 'pending', environment: easebuzzConfig().environment, refundedPaise: 0 });
  if (saved.marketplace) await fulfillCreatorOrder(saved);
  try {
    if (saved.refundedAmount > 0) await sendRefundEmail(saved);
    if (saved.paymentStatus === 'PAID' && saved.deliveryStatus !== 'REVOKED') await sendOrderEmail(saved);
  } catch { /* Durable email retries are independent of verified payment acceptance. */ }
  return saved;
}
function result(order: any) {
  const revoked = order.deliveryStatus === 'REVOKED' || order.paymentStatus === 'REFUNDED';
  return { success: order.paymentStatus === 'PAID' && !revoked, status: revoked ? 'REVOKED' : order.paymentStatus === 'PENDING' && order.latestPaymentStatus === 'failure' ? 'FAILED' : order.paymentStatus, orderId: order.id };
}

export function registerEasebuzzRoutes(app: Express, auth: RequestHandler, limiter: RequestHandler) {
  app.post('/api/payments/easebuzz/initiate', auth, limiter, async (req: any, res) => {
    const input = z.object({ orderId: z.string().regex(identifier), agreeTerms: z.literal(true) }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ success: false, message: 'Accept the purchase policies and provide a valid order.' });
    let order = await Store.getUserOrderById(req.userId, input.data.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    try { await assertGatewayForNewOrder('easebuzz', order); } catch (error) { return res.status(409).json({ success: false, message: error instanceof Error ? error.message : 'Checkout unavailable.' }); }
    if (!['PENDING', 'FAILED'].includes(order.paymentStatus) || order.transactionId || order.cashfreeOrderId || order.razorpayOrderId || (order.paymentProvider && String(order.paymentProvider).toLowerCase() !== 'easebuzz')) return res.status(409).json({ success: false, message: 'This order is not payable. Check it in your account.' });
    if (paise(order.total) === null || paise(order.total)! < 100 || !/^[6-9]\d{9}$/.test(sanitizePhoneNumber(order.customer?.phone))) return res.status(400).json({ success: false, message: 'A valid phone number and an order total of at least ₹1 are required.' });
    for (const item of order.items || []) {
      const { data, error } = await supabaseAdmin().storage.from('products').info(`${item.productId}.zip`);
      if (error || !data) return res.status(503).json({ success: false, message: 'A product file is temporarily unavailable. Contact support before paying.' });
    }
    const split = await marketplaceSplitForOrder(order, 'easebuzz');
    await Store.set(`policyDocuments/${policyVersion}`, policyDocuments);
    order = await easebuzzRpc('bind', order.id, { txnid: order.id, environment: easebuzzConfig().environment, amountPaise: paise(order.total), policyVersion, policyAcceptedAt: new Date().toISOString() });
    const existing = await Store.get<any>(`easebuzzSessions/${order.id}`);
    if (existing?.environment === order.paymentEnvironment && existing?.txnid === order.easebuzzTxnId && /^[a-f0-9]{64}$/i.test(existing?.accessKey || '')) return res.json({ success: true, url: `${easebuzzConfig().base}/pay/${existing.accessKey}`, environment: order.paymentEnvironment });
    const callback = `${appOrigin()}/api/payments/easebuzz/return`;
    const checkout = await createEasebuzzHostedPayment({ transactionId: order.easebuzzTxnId, amount: order.total, email: order.customerEmail, name: order.customerName || order.customer?.fullName || 'Customer', phone: order.customer?.phone, successUrl: callback, failureUrl: callback, udf1: order.id, ...split });
    await Store.set(`easebuzzSessions/${order.id}`, { txnid: order.easebuzzTxnId, accessKey: checkout.accessKey, environment: checkout.environment });
    res.json({ success: true, url: checkout.url, environment: checkout.environment });
  });
  const callback: RequestHandler = async (req: any, res) => {
    const payload = req.body;
    if (!verifyEasebuzzCallbackHash(payload, process.env.EASEBUZZ_SALT || '') || payload.key !== process.env.EASEBUZZ_KEY || !identifier.test(String(payload.txnid || ''))) return res.status(400).json({ success: false, message: 'Payment signature is invalid.' });
    const id = await Store.get<string>(`easebuzzTxnIndex/${payload.txnid}`);
    const order = id ? await Store.getGlobalOrder(id) : null;
    if (!order) return res.status(503).json({ success: false, message: 'Payment binding is not ready. Please retry.' });
    if (payload.udf1 !== order.id || paise(payload.amount) !== paise(order.total)) return res.status(409).json({ success: false, message: 'Payment does not match this order.' });
    await syncEasebuzzOrder(order);
    if (req.path.endsWith('/return')) return res.redirect(303, `${appOrigin()}/checkout?status=pending&orderId=${encodeURIComponent(order.id)}`);
    res.json({ success: true });
  };
  app.post('/api/payments/easebuzz/return', callback);
  app.post('/api/payments/easebuzz/webhook', callback);
  app.post('/api/payments/easebuzz/reconcile/:orderId', auth, limiter, async (req: any, res) => {
    const order = await Store.getGlobalOrder(req.params.orderId);
    const profile = await Store.getUserProfile(req.userId);
    if (!order || (order.userId !== req.userId && profile?.role !== 'admin')) return res.status(404).json({ success: false, message: 'Order not found.' });
    res.json(result(await syncEasebuzzOrder(order)));
  });
}
