/**
 * Retired PayU/Paddle and legacy Easebuzz records cannot bypass the new gateway registry.
 * Current Easebuzz signature, binding and fulfillment paths have separate integration tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Store } from './store';
import { AuthServiceServer } from './auth';
import { isPaidOrderForProduct } from './paymentAccess';

const staleKeys: Record<string, string> = {
  PAYU_KEY: 'synthetic-payu', PAYU_SALT: 'synthetic-payu-salt', PAYU_ENV: 'prod',
  PADDLE_API_KEY: 'synthetic-paddle', PADDLE_CLIENT_TOKEN: 'synthetic-paddle-client',
  PADDLE_ENVIRONMENT: 'production', PADDLE_WEBHOOK_SECRET: 'synthetic-paddle-secret',
  PADDLE_PRICE_LINKNEST_PRO: 'pri_synthetic', EASEBUZZ_KEY: 'synthetic-easebuzz',
  EASEBUZZ_SALT: 'synthetic-easebuzz-salt', EASEBUZZ_ENV: 'prod',
  RESEND_API_KEY: 'synthetic-resend', RESEND_FROM_EMAIL: 'Store <orders@example.test>',
  APP_URL: 'https://store.example.test', CASHFREE_ENV: 'sandbox', CRON_SECRET: 'synthetic-cron-only',
};
async function fixture(context: any) {
  const before = Object.fromEntries(Object.keys(staleKeys).map(key => [key, process.env[key]]));
  Object.assign(process.env, staleKeys);
  const databaseCalls: string[] = [], providerCalls: string[] = [];
  context.mock.method(AuthServiceServer, 'verifyOpaqueSession', async () => null);
  context.mock.method(Store, 'rpc', async (operation: string) => { databaseCalls.push(operation); throw new Error('Retired gateway must not touch the database.'); });
  const originalFetch = globalThis.fetch;
  const { app } = await import('./app');
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  context.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input?.url || input);
    if (url.startsWith(base + '/')) return originalFetch(input, init);
    providerCalls.push(url); throw new Error('Retired gateway must not call a provider, storage, Auth or email service.');
  });
  context.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const request = (path: string, body: any = {}, headers: Record<string, string> = {}) => originalFetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', Cookie: 'sid=synthetic-buyer', ...headers }, body: JSON.stringify(body), redirect: 'manual' });
  return { base, request, originalFetch, databaseCalls, providerCalls };
}

test('stale live and sandbox PayU/Paddle keys cannot reactivate retired checkout routes', async context => {
  const f = await fixture(context);
  for (const mode of ['test', 'prod']) {
    process.env.PAYU_ENV = mode; process.env.PADDLE_ENVIRONMENT = mode === 'test' ? 'sandbox' : 'production';
    for (const provider of ['payu', 'paddle']) {
      for (const action of ['initiate', 'reconcile/legacy-order']) {
        const response = await f.request(`/api/payments/${provider}/${action}`, { orderId: 'legacy-order', agreeTerms: true });
        assert.equal(response.status, 410); assert.equal((await response.json()).success, false);
      }
    }
  }
  const config = await f.originalFetch(f.base + '/api/config/paddle'); assert.equal(config.status, 410);
  const active = await (await f.originalFetch(f.base + '/api/config/payments')).json();
  assert.equal(active.gateways.payu, undefined); assert.equal(active.gateways.paddle, undefined); assert.equal(active.gateways.easebuzz.enabled, false); assert.equal(active.activeProvider, null);
  assert.deepEqual(f.databaseCalls, []); assert.deepEqual(f.providerCalls, []);
});

test('even correctly signed retired-provider callbacks cannot save payments, grant downloads or send emails', async context => {
  const f = await fixture(context);
  const payu: any = { key: staleKeys.PAYU_KEY, txnid: 'old-order', amount: '550.00', productinfo: 'Owned template', firstname: 'Buyer', email: 'buyer@example.test', status: 'success', udf1: 'old-order', udf2: 'buyer', udf3: 'live' };
  payu.hash = crypto.createHash('sha512').update([staleKeys.PAYU_SALT, payu.status, '', '', '', '', '', ...['udf5','udf4','udf3','udf2','udf1'].map(key => payu[key] || ''), payu.email, payu.firstname, payu.productinfo, payu.amount, payu.txnid, payu.key].join('|')).digest('hex');
  for (const action of ['callback', 'webhook']) assert.equal((await f.request(`/api/payments/payu/${action}`, payu)).status, 410);
  const paddle = { event_id: 'evt_old', event_type: 'transaction.completed', data: { id: 'txn_old', custom_data: { orderId: 'old-order' }, details: { totals: { total: '55000' } } } };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', staleKeys.PADDLE_WEBHOOK_SECRET).update(`${timestamp}:${JSON.stringify(paddle)}`).digest('hex');
  assert.equal((await f.request('/api/payments/paddle/webhook', paddle, { 'paddle-signature': `ts=${timestamp};h1=${signature}` })).status, 410);
  assert.deepEqual(f.databaseCalls, []); assert.deepEqual(f.providerCalls, []);
});

test('cross-site browser callbacks for retired providers are rejected before database or provider access', async context => {
  const f = await fixture(context);
  for (const provider of ['payu', 'paddle', 'easebuzz']) {
    assert.equal((await f.request(`/api/payments/${provider}/callback`, { status: 'success', orderId: 'old-order' }, { Origin: 'https://untrusted.example', 'sec-fetch-site': 'cross-site' })).status, 403);
  }
  assert.deepEqual(f.databaseCalls, []); assert.deepEqual(f.providerCalls, []);
});

test('current Easebuzz checkout requires authentication while obsolete callbacks stay absent', async context => {
  const f = await fixture(context);
  for (const path of ['/api/payments/easebuzz/initiate', '/api/payments/easebuzz/reconcile/old-order']) assert.equal((await f.request(path, { orderId: 'old-order', agreeTerms: true })).status, 401);
  for (const path of ['/api/payments/easebuzz/callback', '/api/payments/easebuzz/checkout-closed']) assert.equal((await f.request(path, { orderId: 'old-order', agreeTerms: true })).status, 404);
  assert.equal((await f.originalFetch(f.base + '/api/payments/easebuzz/reconcile-cron')).status, 403);
  assert.deepEqual(f.databaseCalls, []); assert.deepEqual(f.providerCalls, []);
});

test('retired-provider entitlement remains unauthorized even when an old record is manually marked paid', () => {
  const order = { userId: 'buyer', paymentEnvironment: 'live', paymentStatus: 'PAID', status: 'PAID', transactionId: 'legacy-paid', deliveryStatus: 'DELIVERED', downloadStatus: 'AVAILABLE', items: [{ productId: 'linknest-pro' }] };
  for (const provider of ['Easebuzz', 'PayU', 'Paddle']) assert.equal(isPaidOrderForProduct({ ...order, paymentProvider: provider }, 'buyer', 'linknest-pro'), false);
});

test('authenticated customers cannot use legacy paid records to issue signed downloads or invoices', async context => {
  const f = await fixture(context);
  context.mock.method(AuthServiceServer, 'verifyOpaqueSession', async () => ({ userId: 'buyer', email: 'buyer@example.test' }));
  const legacy = { id: 'old-order', userId: 'buyer', total: 550, paymentEnvironment: 'live', paymentStatus: 'PAID', status: 'PAID', transactionId: 'legacy-paid', deliveryStatus: 'DELIVERED', downloadStatus: 'AVAILABLE', items: [{ productId: 'linknest-pro' }] };
  let oldOrder: any;
  context.mock.method(Store, 'getUserOrderById', async () => oldOrder);
  for (const provider of ['Easebuzz', 'PayU', 'Paddle']) {
    oldOrder = { ...legacy, paymentProvider: provider };
    assert.equal((await f.request('/api/downloads/linknest-pro/token', { orderId: 'old-order' })).status, 403);
    assert.equal((await f.originalFetch(f.base + '/api/orders/old-order/invoice', { headers: { Cookie: 'sid=synthetic-buyer' } })).status, 403);
  }
  assert.deepEqual(f.databaseCalls, []); assert.deepEqual(f.providerCalls, []);
});
