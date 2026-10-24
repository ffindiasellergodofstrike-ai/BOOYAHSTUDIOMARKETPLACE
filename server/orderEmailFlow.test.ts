import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { Store } from './store';
import { sendOrderEmail, sendRefundEmail, retryOrderEmails } from './orderEmail';
import { registerEmailWebhookRoutes, verifyResendEvent } from './emailWebhook';

const acceptedRecord = (value: any) => value?.status === 'sent' || Boolean(value?.emailId);
const paidOrder = () => ({ id: 'BS-email-test', orderNumber: 'BS-email-test', transactionId: '1234567890', paymentProvider: 'Cashfree', paymentStatus: 'PAID', deliveryStatus: 'DELIVERED', downloadStatus: 'AVAILABLE', paymentEnvironment: 'live', currency: 'INR', total: 1000, customerEmail: 'buyer@example.test', items: [{ productId: 'first', productTitle: 'First template' }, { productId: 'second', productTitle: 'Second template' }] });
function setup(t: any, order = paidOrder()) {
  const values = new Map<string, any>([[`orders/${order.id}`, order]]);
  const clone = (value: any) => value === undefined ? null : structuredClone(value);
  const read = (key: string) => {
    if (values.has(key)) return clone(values.get(key));
    const prefix = `${key}/`;
    const rows = [...values].filter(([path]) => path.startsWith(prefix));
    return rows.length ? Object.fromEntries(rows.map(([path, value]) => [path.slice(prefix.length), clone(value)])) : null;
  };
  t.mock.method(Store, 'getAllGlobalOrders', async () => Object.values(read('orders') || {}));
  t.mock.method(Store, 'getGlobalOrder', async (id: string) => read(`orders/${id}`));
  t.mock.method(Store, 'get', async (key: string) => read(key));
  t.mock.method(Store, 'set', async (key: string, value: any) => { values.set(key, clone(value)); return clone(value); });
  t.mock.method(Store, 'update', async (key: string, value: any) => { const merged = { ...read(key), ...clone(value) }; values.set(key, merged); return clone(merged); });
  t.mock.method(Store, 'rpc', async (operation: string, key: string, value: any) => {
    const current = read(key);
    if (operation === 'queue_email_state') {
      if (acceptedRecord(current) || current?.status === 'review_required' || (current?.status === 'sending' && current.leaseUntil > Date.now() && [undefined, 'pending', 'not_configured'].includes(value.status))) return current;
      const queued = { ...current, ...value, status: value.status || current?.status || 'pending' };
      values.set(key, queued); return clone(queued);
    }
    if (operation === 'claim_email') {
      if (current?.status === 'sent' || current?.status === 'review_required' || (current?.status === 'sending' && current.leaseUntil > value.now)) return false;
      if (current?.firstAttemptAt !== undefined && value.now - current.firstAttemptAt > 82_800_000) { values.set(key, { ...current, status: 'review_required' }); return false; }
      values.set(key, { ...current, status: 'sending', firstAttemptAt: current?.firstAttemptAt ?? value.now, leaseUntil: value.now + 300_000 }); return true;
    }
    if (operation === 'email_status') {
      const existing = current?.[value.kind];
      if (existing?.status === 'sent' && value.status !== 'sent') return current;
      values.set(key, { ...current, [value.kind]: clone(value) }); return read(key);
    }
    if (operation === 'email_provider_event') {
      if (!current || current.emailId !== value.emailId) throw new Error('Email mapping mismatch');
      if (current.events?.[value.eventId]) return current;
      const rank: any = { accepted: 0, delayed: 1, delivered: 2, failed: 3, suppressed: 3, bounced: 4, complained: 5 };
      const status = rank[value.providerStatus] >= (rank[current.providerStatus] ?? -1) ? value.providerStatus : current.providerStatus;
      const record = { ...current, status: 'sent', providerStatus: status, events: { ...current.events, [value.eventId]: value } };
      values.set(key, record);
      const orderKey = `orders/${current.orderId}`;
      values.set(orderKey, { ...read(orderKey), [current.kind]: { status: 'sent', providerStatus: status, notificationId: current.notificationId, emailId: current.emailId } });
      return record;
    }
    throw new Error(`Unexpected RPC ${operation}`);
  });
  const names = ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_WEBHOOK_SECRET', 'APP_URL', 'NODE_ENV'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.RESEND_API_KEY = 're_synthetic'; process.env.RESEND_FROM_EMAIL = 'Store <orders@example.test>'; process.env.APP_URL = 'https://store.example.test'; process.env.NODE_ENV = 'production';
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from('synthetic-webhook-secret-for-tests').toString('base64')}`;
  t.after(() => { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } });
  return { values, read, order };
}

function signed(event: any, id: string, timestamp = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(event);
  const secret = Buffer.from(process.env.RESEND_WEBHOOK_SECRET!.slice(6), 'base64');
  return { raw, headers: { id, timestamp: String(timestamp), signature: `v1,${crypto.createHmac('sha256', secret).update(`${id}.${timestamp}.${raw}`).digest('base64')}` } };
}
async function webhookServer(t: any) {
  const app = express();
  app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  registerEmailWebhookRoutes(app);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const originalFetch = globalThis.fetch;
  return async (event: any, id: string, tamper = false) => {
    const signature = signed(event, id);
    return originalFetch(`http://127.0.0.1:${(server.address() as any).port}/api/emails/resend/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'svix-id': signature.headers.id, 'svix-timestamp': signature.headers.timestamp, 'svix-signature': tamper ? 'v1,forged' : signature.headers.signature }, body: signature.raw });
  };
}

test('Resend sends one idempotent live order confirmation with correct products and no private file link', async t => {
  const { order, read } = setup(t);
  const calls: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => { calls.push(options); return Response.json({ id: 'email_one' }); });
  await Promise.all(Array.from({ length: 8 }, () => sendOrderEmail(order)));
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].body);
  assert.match(payload.text, /First template/); assert.match(payload.text, /Second template/); assert.match(payload.text, /1234567890/);
  assert.match(payload.text, /https:\/\/store.example.test\/account\/downloads/); assert.match(payload.html, /href="https:\/\/store.example.test\/account\/downloads"/); assert.doesNotMatch(payload.text, /signedUrl|\.zip|token=/);
  assert.match(payload.text, /Grievance contact: MANISH KUMAR SONKAR/); assert.match(payload.text, /https:\/\/wa.me\/917393845435/);
  assert.equal(calls[0].headers['Idempotency-Key'], 'order-BS-email-test');
  assert.equal(read(`orders/${order.id}`).emailDelivery.providerStatus, 'accepted');
  await sendOrderEmail(order); assert.equal(calls.length, 1);
});

test('failed sends remain durable, back off and reuse identical payload and idempotency key', async t => {
  const { order, read, values } = setup(t);
  let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
  const calls: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => { calls.push(options); return calls.length === 1 ? Response.json({ message: 'temporary' }, { status: 503 }) : Response.json({ id: 'email_retry' }); });
  assert.equal((await sendOrderEmail(order)).status, 'queued');
  assert.equal(read(`orders/${order.id}`).paymentStatus, 'PAID');
  await sendOrderEmail(order); assert.equal(calls.length, 1);
  values.set(`orders/${order.id}`, { ...order, items: [{ productTitle: 'Changed listing after purchase' }] });
  clock += 61_000;
  const retry = await retryOrderEmails(); assert.equal(retry.sent, 1);
  assert.equal(calls[0].body, calls[1].body); assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.equal(read(`notifications/order-${order.id}`).providerStatus, 'accepted');
});

test('missing email configuration queues work; test/unpaid orders never send a real purchase email', async t => {
  const { order, read, values } = setup(t);
  delete process.env.RESEND_FROM_EMAIL;
  assert.equal((await sendOrderEmail(order)).status, 'not_configured');
  assert.equal(read(`notifications/order-${order.id}`).orderId, order.id);
  values.set(`orders/${order.id}`, { ...order, paymentEnvironment: 'test', deliveryStatus: 'TEST_ONLY' });
  const fetcher = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not call provider'); });
  assert.equal((await sendOrderEmail(order)).status, 'skipped');
  assert.equal(fetcher.mock.callCount(), 0);
  values.set(`orders/${order.id}`, { ...order, paymentStatus: 'PENDING' });
  assert.equal((await sendOrderEmail(order)).status, 'skipped');
});

test('refund email handles partial refunds without claiming all downloads were revoked', async t => {
  const order = { ...paidOrder(), paymentStatus: 'PARTIALLY_REFUNDED', refundedAmount: 1 };
  setup(t, order);
  let payload: any;
  t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => { payload = JSON.parse(options.body); return Response.json({ id: 'email_refund' }); });
  assert.equal((await sendRefundEmail(order)).status, 'sent');
  assert.match(payload.text, /INR 1\.00/); assert.doesNotMatch(payload.text, /Further downloads are restricted/);
});

test('signed Resend events distinguish delivery and bounce, reject forgery/replay and do not resend accepted mail', async t => {
  const { order, read } = setup(t);
  const post = await webhookServer(t);
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async () => { sends++; return Response.json({ id: 'email_events' }); });
  await sendOrderEmail(order);
  const event = (type: string) => ({ type, created_at: new Date().toISOString(), data: { email_id: 'email_events', to: [order.customerEmail] } });
  assert.equal((await post(event('email.delivered'), 'msg_delivered', true)).status, 400);
  assert.equal(read(`orders/${order.id}`).emailDelivery.providerStatus, 'accepted');
  assert.equal((await post(event('email.delivered'), 'msg_delivered')).status, 200);
  assert.equal(read(`orders/${order.id}`).emailDelivery.providerStatus, 'delivered');
  assert.equal((await post(event('email.bounced'), 'msg_bounced')).status, 200);
  assert.equal((await post(event('email.sent'), 'msg_late_sent')).status, 200);
  assert.equal(read(`orders/${order.id}`).emailDelivery.providerStatus, 'bounced');
  await sendOrderEmail(order); assert.equal(sends, 1);
  const stale = signed(event('email.delivered'), 'msg_old', Math.floor(Date.now() / 1000) - 1000);
  assert.equal(verifyResendEvent(Buffer.from(stale.raw), stale.headers), null);
  assert.equal(read(`orders/${order.id}`).paymentStatus, 'PAID');
});

test('a delivered callback arriving before the send response commits is recovered from signed outbound tags', async t => {
  const { order, read } = setup(t);
  const post = await webhookServer(t);
  t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => {
    const outbound = JSON.parse(options.body);
    const tags = Object.fromEntries(outbound.tags.map((tag: any) => [tag.name, tag.value]));
    const response = await post({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'email_race', to: [order.customerEmail], tags } }, 'msg_race');
    assert.equal(response.status, 200);
    return Response.json({ id: 'email_race' });
  });
  assert.equal((await sendOrderEmail(order)).status, 'sent');
  assert.equal(read(`orders/${order.id}`).emailDelivery.providerStatus, 'delivered');
});


test('a delayed initial order confirmation still sends for a Cashfree partial refund with available purchased access', async t => {
  const order = { ...paidOrder(), paymentStatus: 'PARTIALLY_REFUNDED', refundedAmount: 1 };
  setup(t, order);
  let payload: any;
  t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => { payload = JSON.parse(options.body); return Response.json({ id: 'email_partial_order' }); });
  assert.equal((await sendOrderEmail(order)).status, 'sent');
  assert.match(payload.text, /Confirmed refund recorded: INR 1\.00/);
  assert.match(payload.text, /order confirmed|purchased product access/i);
});


test('the email worker rediscovers committed paid orders missing an outbox and advances oldest-first with bounded work', async t => {
  const { order, values, read } = setup(t);
  values.set(`orders/${order.id}`, { ...order, createdAt: '2026-01-01T00:00:00Z' });
  values.set('orders/newer', { ...order, id: 'newer', createdAt: '2026-02-01T00:00:00Z' });
  values.set('orders/latest', { ...order, id: 'latest', createdAt: '2026-03-01T00:00:00Z' });
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: `email_recovered_${++sends}` }));
  const first = await retryOrderEmails(1);
  assert.equal(first.discovered, 1); assert.equal(first.attempted, 1); assert.equal(first.sent, 1);
  assert.equal(read(`notifications/order-${order.id}`).status, 'sent');
  assert.equal(read('notifications/order-newer'), null);
  const second = await retryOrderEmails(1);
  assert.equal(second.discovered, 1); assert.equal(second.sent, 1);
  assert.equal(read('notifications/order-newer').status, 'sent');
  assert.equal(read('notifications/order-latest'), null);
  assert.equal(sends, 2);
});

test('a stale no-config request cannot overwrite a concurrently accepted email callback', async t => {
  const { order, values, read } = setup(t);
  delete process.env.RESEND_FROM_EMAIL;
  const original = Store.rpc;
  t.mock.method(Store, 'rpc', async (operation: string, key: string, value: any) => {
    if (operation === 'queue_email_state') {
      values.set(key, { ...value, status: 'sent', emailId: 'email_concurrent', providerStatus: 'delivered' });
      values.set(`orders/${order.id}`, { ...order, emailDelivery: { status: 'sent', providerStatus: 'delivered' } });
    }
    return original(operation, key, value);
  });
  assert.equal((await sendOrderEmail(order)).status, 'sent');
  assert.equal(read(`orders/${order.id}`).emailDelivery.providerStatus, 'delivered');
  assert.equal(read(`notifications/order-${order.id}`).status, 'sent');
});


test('an accepted historical order receipt is not resent if its outbox record is missing', async t => {
  const { order, values } = setup(t);
  values.set(`orders/${order.id}`, { ...order, emailDelivery: { status: 'sent', emailId: 'historical_email' } });
  const fetcher = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not send duplicate'); });
  assert.equal((await sendOrderEmail(order)).status, 'sent');
  const worker = await retryOrderEmails(1);
  assert.equal(worker.discovered, 0); assert.equal(worker.attempted, 0);
  assert.equal(fetcher.mock.callCount(), 0);
});


test('the legacy live email entry point uses the stored verified order and ignores supplied private URLs', async t => {
 const { sendPurchaseConfirmationEmail } = await import('./purchaseEmail');
 const { order, values } = setup(t);
 const calls: any[] = [];
 t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => { calls.push(JSON.parse(init.body)); return Response.json({ id: 'email_legacy_live' }); });
 const callerSnapshot = { ...order, customerEmail: 'wrong@example.test', items: [{ productTitle: '<script>changed</script>' }] };
 assert.equal((await sendPurchaseConfirmationEmail(callerSnapshot, [{ downloadUrl: 'https://private.invalid/file.zip?token=secret' }], { invoiceUrl: 'https://private.invalid/invoice' })).status, 'sent');
 assert.equal(calls[0].to, order.customerEmail);
 assert.match(calls[0].text, /First template/);
 assert.doesNotMatch(JSON.stringify(calls[0]), /private.invalid|token=secret|wrong@example.test|<script>/);
 values.set(`orders/${order.id}`, { ...order, id: order.id, paymentStatus: 'PENDING' });
 assert.equal((await sendPurchaseConfirmationEmail(order)).status, 'skipped');
 assert.equal(calls.length, 1);
});
