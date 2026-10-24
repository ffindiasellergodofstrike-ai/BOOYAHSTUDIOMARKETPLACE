import test from 'node:test';
import 'express-async-errors';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { Store } from './store';
import { registerEasebuzzRoutes, matchesEasebuzzPayment } from './easebuzzGateway';
import { retrieveEasebuzzPayment, createEasebuzzHostedPayment } from './easebuzz';

test('Easebuzz callback requires signature plus exact server lookup and disabled historical callbacks still work', async t => {
  const env = { ...process.env }, originalRpc = Store.rpc, originalFetch = globalThis.fetch;
  Object.assign(process.env, { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', EASEBUZZ_KEY: 'synthetic-key', EASEBUZZ_SALT: 'synthetic-salt', EASEBUZZ_ENV: 'prod', APP_URL: 'https://booyahstudio.shop' }); delete process.env.RESEND_API_KEY;
  const db = new PGlite(); await db.exec('create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key,name text,public boolean); create table storage.objects(id text,bucket_id text);');
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/202610230003_easebuzz.sql', import.meta.url), 'utf8'));
  Store.rpc = async (operation: string, key = '', value: any = null) => (await db.query<{ result: any }>('select public.store_operation($1,$2,$3::jsonb) as result', [operation, key, JSON.stringify(value)])).rows[0].result;
  let returnedAmount = '299.00', lookupCalls = 0, initiateCalls = 0, databaseError = '', refundAmount = '';
  const remote = (txnid: string) => ({ key: 'synthetic-key', txnid, amount: returnedAmount, productinfo: 'Booyahstudio digital products', firstname: 'Alice', email: 'alice@example.com', phone: '9876543210', udf1: txnid, status: 'success', easepayid: `payment_${txnid}`, ...(refundAmount ? { refund_amount: refundAmount } : {}) });
  const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: false }));
  const auth: any = (req: any, _res: any, next: any) => { req.userId = req.get('x-user') || 'alice'; next(); };
  registerEasebuzzRoutes(app, auth, (_req, _res, next) => next());
  app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ success: false, message: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  globalThis.fetch = async (input: any, init?: any) => {
    const url = String(input?.url || input);
    if (url.startsWith(base)) return originalFetch(input, init);
    if (url.includes('/rest/v1/rpc/easebuzz_order_operation')) {
      const body = JSON.parse(init.body);
      try { const result = await db.query<{ result: any }>('select public.easebuzz_order_operation($1,$2,$3::jsonb) as result', [body.operation, body.order_id, JSON.stringify(body.value)]); return Response.json(result.rows[0].result); }
      catch (error) { databaseError = String(error); throw error; }
    }
    if (url.includes('/storage/v1/object/info/')) return Response.json({ id: 'private-file', metadata: { size: 100 } });
    if (url === 'https://pay.easebuzz.in/payment/initiateLink') { initiateCalls++; return Response.json({ status: 1, data: 'a'.repeat(64) }); }
    if (url.endsWith('/transaction/v2/retrieve')) { lookupCalls++; const body = new URLSearchParams(init.body); assert.match(body.get('hash') || '', /^[a-f0-9]{128}$/); return Response.json({ status: 1, msg: [remote(body.get('txnid')!)] }); }
    throw new Error('Unexpected external request');
  };
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); Store.rpc = originalRpc; globalThis.fetch = originalFetch; await db.close(); for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
  await Store.set('marketplace/gateway-settings', { version: 1, enabled: { easebuzz: true, cashfree: false, razorpay: false }, defaultProvider: 'easebuzz', commissionBps: 1000 });
  const order = { id: 'ease_order_live', userId: 'alice', customerName: 'Alice', customerEmail: 'alice@example.com', customer: { phone: '9876543210' }, total: 299, paymentProvider: 'Easebuzz', paymentEnvironment: 'live', paymentStatus: 'PENDING', status: 'PENDING', items: [{ productId: 'product_one', productTitle: 'Owned product', price: 299, quantity: 1 }] };
  await Store.saveGlobalOrder(order);
  const binding = { txnid: order.id, environment: 'live', amountPaise: 29900, policyVersion: 'synthetic-policy', policyAcceptedAt: '2026-10-23T12:00:00Z' };
  const direct = (operation: string, value: any) => db.query<{ result: any }>('select public.easebuzz_order_operation($1,$2,$3::jsonb) as result', [operation, order.id, JSON.stringify(value)]);
  await assert.rejects(direct('bind', { ...binding, environment: 'test' }), /another payment environment/);
  await assert.rejects(direct('bind', { ...binding, amountPaise: 100 }), /binding mismatch/);
  const post = (path: string, body: any, headers = {}) => originalFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), redirect: 'manual' });
  assert.equal((await post('/api/payments/easebuzz/initiate', { orderId: order.id, agreeTerms: true }, { 'x-user': 'bob' })).status, 404);
  const initiated = await post('/api/payments/easebuzz/initiate', { orderId: order.id, agreeTerms: true }); const initiation = await initiated.json(); assert.equal(initiated.status, 200, `${initiation.message} ${databaseError}`); assert.match(initiation.url, /^https:\/\/pay\.easebuzz\.in\/pay\/[a-f0-9]{64}$/); assert.equal(initiateCalls, 1);
  const bound = await Store.getGlobalOrder(order.id);
  assert.equal(matchesEasebuzzPayment(remote(order.id), bound), true);
  for (const patch of [{ amount: '1.00' }, { txnid: 'other_order' }, { key: 'other-key' }, { email: 'other@example.com' }, { udf1: 'other_order' }, { phone: '9876543211' }, { currency: 'USD' }]) assert.equal(matchesEasebuzzPayment({ ...remote(order.id), ...patch }, bound), false);
  const callback = remote(order.id) as any;
  callback.hash = crypto.createHash('sha512').update(['synthetic-salt', callback.status, ...Array(9).fill(''), callback.udf1, callback.email, callback.firstname, callback.productinfo, callback.amount, callback.txnid, callback.key].join('|')).digest('hex');
  assert.equal((await post('/api/payments/easebuzz/webhook', { ...callback, hash: 'bad' })).status, 400); assert.equal(lookupCalls, 0);
  returnedAmount = '1.00'; assert.equal((await post('/api/payments/easebuzz/webhook', callback)).status, 500);
  assert.equal(Object.keys(await Store.get('purchases') || {}).length, 0);
  returnedAmount = '299.00'; await Store.set('marketplace/gateway-settings', { version: 1, enabled: { easebuzz: false, cashfree: false, razorpay: false }, defaultProvider: 'easebuzz', commissionBps: 1000 });
  assert.equal((await post('/api/payments/easebuzz/initiate', { orderId: order.id, agreeTerms: true })).status, 409);
  const outcomes = await Promise.all([post('/api/payments/easebuzz/webhook', callback), post('/api/payments/easebuzz/webhook', callback), post(`/api/payments/easebuzz/reconcile/${order.id}`, {})]); outcomes.forEach(response => assert.equal(response.status, 200));
  const saved = await Store.getGlobalOrder(order.id); assert.equal(saved.paymentStatus, 'PAID'); assert.equal(saved.deliveryStatus, 'DELIVERED'); assert.equal(Object.keys(await Store.get('purchases') || {}).length, 1);
  refundAmount = '1.00'; assert.equal((await post('/api/payments/easebuzz/webhook', callback)).status, 200);
  const restricted = await Store.getGlobalOrder(order.id); assert.equal(restricted.deliveryStatus, 'REVOKED'); assert.equal(restricted.providerRefundReviewRequired, true); assert.equal(restricted.paymentStatus, 'PAID', 'unknown refund references must not be represented as a confirmed monetary refund');
  refundAmount = ''; assert.equal((await post('/api/payments/easebuzz/webhook', callback)).status, 200); assert.equal((await Store.getGlobalOrder(order.id)).deliveryStatus, 'REVOKED');
  const verified = { txnid: order.id, id: `payment_${order.id}`, amount: 29900, currency: 'INR', environment: 'live', status: 'success', refundedPaise: 100 };
  const refunded = (await direct('confirm', verified)).rows[0].result;
  assert.equal(refunded.paymentStatus, 'PARTIALLY_REFUNDED'); assert.equal(refunded.refundedAmount, 1);
  const stale = (await direct('confirm', { ...verified, refundedPaise: 0 })).rows[0].result;
  assert.equal(stale.refundedAmount, 1, 'late snapshots cannot reduce verified refund amounts or restore access');
  assert.equal(stale.deliveryStatus, 'REVOKED');
  // Hosted redirects must be assembled from an access key, never an arbitrary provider-returned URL.
  await assert.rejects(createEasebuzzHostedPayment({ transactionId: 'bad/order', amount: 299, email: 'alice@example.com', name: 'Alice', phone: '9876543210', successUrl: 'https://booyahstudio.shop/return', failureUrl: 'https://booyahstudio.shop/return' }));
  await assert.rejects(retrieveEasebuzzPayment('../other'));
});
