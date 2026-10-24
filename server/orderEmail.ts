import crypto from 'node:crypto';
import { Store } from './store';
import { BUSINESS } from '../src/config/business';
import { appOrigin } from './config';
import { renderOrderEmailHtml } from './emailPresentation';
import { hasVerifiedEasebuzzFunding } from './paymentAccess';

type NotificationKind = 'emailDelivery' | 'refundEmailDelivery';
export type EmailSendResult = { status: 'sent' | 'queued' | 'not_configured' | 'review_required' | 'skipped' | 'unavailable'; notificationId?: string };
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const accepted = (record: any) => record?.status === 'sent' || Boolean(record?.emailId);

function notificationIdFor(order: any, refund: boolean): string {
  return `${refund ? `refund-${Math.round(Number(order.refundedAmount) * 100)}` : 'order'}-${order.id}`;
}
function isEligible(order: any, refund: boolean): boolean {
  if (!order || !SAFE_ID.test(String(order.id || '')) || order.paymentEnvironment !== 'live' || !order.transactionId ||
      !['cashfree', 'razorpay', 'easebuzz'].includes(String(order.paymentProvider || '').toLowerCase()) ||
      (String(order.paymentProvider).toLowerCase() === 'easebuzz' && !hasVerifiedEasebuzzFunding(order))) return false;
  if (refund) return Number(order.refundedAmount) > 0 && ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(String(order.paymentStatus));
  const purchasableState = order.paymentStatus === 'PAID' || (String(order.paymentProvider).toLowerCase() === 'cashfree' && order.paymentStatus === 'PARTIALLY_REFUNDED');
  return purchasableState && order.deliveryStatus === 'DELIVERED' && order.downloadStatus === 'AVAILABLE';
}
function emailPayload(order: any, refund: boolean) {
  const lines = [
    `${BUSINESS.name} | ${BUSINESS.owner}`,
    ...(BUSINESS.legalName ? [`Legal name: ${BUSINESS.legalName}`] : []),
    ...(BUSINESS.gstin ? [`GSTIN: ${BUSINESS.gstin}`] : []),
    BUSINESS.address, '',
    `Order: ${order.orderNumber || order.id}`,
    `Amount paid: ${order.currency || 'INR'} ${Number(order.total).toFixed(2)}`,
    `Payment reference: ${order.transactionId}`,
    `Payment provider: ${order.paymentProvider}`,
    ...(Number(order.refundedAmount) > 0 ? [`Confirmed refund recorded: INR ${Number(order.refundedAmount).toFixed(2)}`] : []), '',
    'Products:',
    ...(Array.isArray(order.items) ? order.items.map((item: any) => `- ${String(item.productTitle || item.product?.title || item.productId || 'Digital product').replace(/[\r\n]/g, ' ')} — By ${String(item.sellerName || item.product?.sellerName || BUSINESS.name).replace(/[\r\n]/g, ' ')}${item.refunded ? ' (refunded; further download access restricted)' : ''}`) : []), '',
    refund
      ? `Refund confirmed by the payment provider: INR ${Number(order.refundedAmount).toFixed(2)}. Bank credit timing depends on the provider and bank. Review your current product access and contact support if anything is unclear.`
      : 'Your purchased product access is available. Sign in using the email address used for this order.',
    `${refund ? 'Your orders' : 'Download your purchased files'}: ${appOrigin()}/account/${refund ? 'orders' : 'downloads'}`,
    'Sign in with the same email used at checkout. Download links are generated securely when you choose a file.', '',
    `Support: ${BUSINESS.email}`,
    `WhatsApp: ${BUSINESS.phone} (${BUSINESS.phoneHref})`,
    `Grievance contact: ${BUSINESS.owner}, at the same email and address.`,
    `Copyright ${new Date().getFullYear()} ${BUSINESS.owner} | ${BUSINESS.name}. Each publisher retains rights to their original work. Product use is subject to its supplied license.`,
  ];
  return {
    from: process.env.RESEND_FROM_EMAIL!,
    to: String(order.customerEmail || order.customer?.email || '').trim().toLowerCase(),
    reply_to: BUSINESS.email,
    subject: `${BUSINESS.name}: ${refund ? 'refund recorded' : 'order confirmed'} ${order.id}`,
    text: lines.join('\n'),
    html: renderOrderEmailHtml(order, refund, appOrigin()),
    tags: [{ name: 'store_notification', value: notificationIdFor(order, refund) }, { name: 'store_order', value: String(order.id) }],
  };
}

async function notify(orderInput: any, refund: boolean): Promise<EmailSendResult> {
  // Always re-read authoritative state; delayed verification callbacks must not send a new confirmation for revoked access.
  const order = orderInput?.id ? await Store.getGlobalOrder(orderInput.id) : null;
  if (!isEligible(order, refund)) return { status: 'skipped' };
  const notificationId = notificationIdFor(order, refund);
  const kind: NotificationKind = refund ? 'refundEmailDelivery' : 'emailDelivery';
  const path = `notifications/${notificationId}`;
  const current = await Store.get<any>(path);
  if (accepted(current) || (accepted(order[kind]) && (!refund || order[kind].notificationId === notificationId))) return { status: 'sent', notificationId };
  if (current?.status === 'review_required') return { status: 'review_required', notificationId };
  if (Number(current?.nextAttemptAt || 0) > Date.now()) return { status: 'queued', notificationId };
  const metadata = { orderId: order.id, kind, notificationId, createdAt: current?.createdAt || new Date().toISOString() };
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    const queued = await Store.rpc<any>('queue_email_state', path, { ...metadata, status: 'not_configured', nextAttemptAt: Date.now() + 60_000 });
    if (accepted(queued)) return { status: 'sent', notificationId };
    if (queued.status === 'review_required') return { status: 'review_required', notificationId };
    if (queued.status === 'sending') return { status: 'queued', notificationId };
    await Store.rpc('email_status', `orders/${order.id}`, { kind, status: 'not_configured', notificationId });
    return { status: 'not_configured', notificationId };
  }
  // PostgreSQL owns the lease. A stable key plus frozen payload covers crashes/timeouts between provider acceptance and persistence.
  if (!await Store.rpc('claim_email', path, { now: Date.now() })) {
    const record = await Store.get<any>(path);
    return { status: record?.status === 'review_required' ? 'review_required' : accepted(record) ? 'sent' : 'queued', notificationId };
  }
  await Store.update(path, metadata);
  const claimed = await Store.get<any>(path);
  const payload = claimed?.payload || emailPayload(order, refund);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.to)) {
    const invalid = await Store.rpc<any>('queue_email_state', path, { ...metadata, status: 'review_required', failureReason: 'invalid_order_email' });
    if (accepted(invalid)) return { status: 'sent', notificationId };
    await Store.rpc('email_status', `orders/${order.id}`, { kind, status: 'review_required', notificationId });
    return { status: 'review_required', notificationId };
  }
  const attempt = Number(claimed?.attempts || 0) + 1;
  const attemptRecord = await Store.update(path, { ...metadata, payload, attempts: attempt, lastAttemptAt: new Date().toISOString(), nextAttemptAt: null });
  if (accepted(attemptRecord)) return { status: 'sent', notificationId };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': notificationId },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    if (!response.ok || typeof result?.id !== 'string' || !SAFE_ID.test(result.id)) throw new Error('Email provider rejected the request');
    // "sent" is kept for compatibility with the atomic claim guard. providerStatus explicitly means API acceptance, not inbox receipt.
    const state = { ...metadata, status: 'sent', emailId: result.id, sentAt: new Date().toISOString(), acceptedAt: new Date().toISOString(), nextAttemptAt: null };
    await Store.update(path, state);
    await Store.set(`emailProviderIndex/${result.id}`, { notificationId, orderId: order.id, kind });
    await Store.rpc('email_provider_event', path, { notificationId, emailId: result.id, providerStatus: 'accepted', eventId: crypto.createHash('sha256').update(`accepted:${result.id}`).digest('hex'), eventCreatedAt: state.acceptedAt, receivedAt: state.acceptedAt });
    return { status: 'sent', notificationId };
  } catch {
    const latest = await Store.get<any>(path);
    if (accepted(latest)) {
      // Repair acceptance persistence atomically; a delayed callback must never downgrade delivered/bounced state.
      await Store.rpc('email_provider_event', path, { notificationId, emailId: latest.emailId, providerStatus: 'accepted', eventId: crypto.createHash('sha256').update(`accepted:${latest.emailId}`).digest('hex'), eventCreatedAt: latest.acceptedAt || new Date().toISOString(), receivedAt: new Date().toISOString() });
      return { status: 'sent', notificationId };
    }
    const nextAttemptAt = Date.now() + BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
    const failed = await Store.rpc<any>('queue_email_state', path, { ...metadata, status: 'failed', failureReason: 'provider_request_failed', nextAttemptAt });
    if (accepted(failed)) return { status: 'sent', notificationId };
    await Store.rpc('email_status', `orders/${order.id}`, { kind, status: 'failed', notificationId, nextAttemptAt });
    return { status: 'queued', notificationId };
  }
}

async function safelyNotify(order: any, refund: boolean): Promise<EmailSendResult> {
  try { return await notify(order, refund); }
  catch { return { status: 'unavailable' }; } // A notification outage cannot undo a committed purchase.
}
export async function sendOrderEmail(order: any) { return safelyNotify(order, false); }
export async function sendRefundEmail(order: any) { return safelyNotify(order, true); }

/** Run from an authenticated scheduler/admin action. Never expose this worker publicly. */
export async function retryOrderEmails(limit = 20) {
  const batchSize = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  const records = await Store.get<Record<string, any>>('notifications') || {};
  const result = { checked: 0, discovered: 0, attempted: 0, sent: 0, pending: 0, reviewRequired: 0, failed: 0 };
  // Recover the gap between committed payment/access and the first durable email write.
  // Discovery writes are bounded; persisted queue entries prevent repeatedly selecting the same oldest orders.
  const oldest = (order: any) => {
    const timestamp = Date.parse(order.paymentVerifiedAt || order.paidAt || order.createdAt || order.date || '');
    return Number.isFinite(timestamp) ? timestamp : 0;
  };
  const orders = (await Store.getAllGlobalOrders()).sort((a, b) => oldest(a) - oldest(b) || String(a.id).localeCompare(String(b.id)));
  let discoveryAttempts = 0;
  for (const order of orders) {
    if (discoveryAttempts >= batchSize) break;
    for (const refund of [false, true]) {
      if (discoveryAttempts >= batchSize) break;
      const kind: NotificationKind = refund ? 'refundEmailDelivery' : 'emailDelivery';
      if (!isEligible(order, refund)) continue;
      const notificationId = notificationIdFor(order, refund);
      // Never resend a historical accepted receipt just because an old outbox/index was absent.
      if (records[notificationId] || (accepted(order[kind]) && (!refund || order[kind].notificationId === notificationId))) continue;
      const createdAt = new Date(oldest(order) || Date.now()).toISOString();
      discoveryAttempts++;
      try {
        records[notificationId] = await Store.rpc<any>('queue_email_state', `notifications/${notificationId}`, {
          notificationId, orderId: order.id, kind, createdAt, discoveredAt: new Date().toISOString(),
        });
        result.discovered++;
      } catch { result.failed++; break; }
    }
  }
  const now = Date.now();
  const dueAt = (row: any) => Number(row.nextAttemptAt || 0) || Date.parse(row.lastAttemptAt || row.createdAt || '') || 0;
  const due = Object.values(records).filter((row: any) => {
    if (!row || !row.orderId || !['emailDelivery', 'refundEmailDelivery'].includes(row.kind) || accepted(row) || row.status === 'skipped') return false;
    if (row.status === 'review_required') { result.reviewRequired++; return false; }
    if (Number(row.nextAttemptAt || 0) > now || (row.status === 'sending' && Number(row.leaseUntil) > now)) { result.pending++; return false; }
    return true;
  }).sort((a: any, b: any) => dueAt(a) - dueAt(b) || String(a.notificationId).localeCompare(String(b.notificationId))).slice(0, batchSize);
  for (const row of due) {
    result.checked++; result.attempted++;
    const outcome = await safelyNotify({ id: row.orderId }, row.kind === 'refundEmailDelivery');
    if (outcome.status === 'sent') result.sent++;
    else if (outcome.status === 'review_required') result.reviewRequired++;
    else if (outcome.status === 'unavailable') result.failed++;
    else if (outcome.status === 'skipped') {
      // An order refunded/revoked while queued must not monopolize every future worker batch.
      try {
        await Store.rpc('queue_email_state', `notifications/${row.notificationId}`, {
          orderId: row.orderId, kind: row.kind, notificationId: row.notificationId,
          createdAt: row.createdAt || new Date().toISOString(), status: 'skipped', nextAttemptAt: null,
        });
      } catch { result.failed++; }
    } else result.pending++;
  }
  return result;
}
