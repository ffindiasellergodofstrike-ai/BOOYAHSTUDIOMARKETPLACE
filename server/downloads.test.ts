import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import 'express-async-errors';
import { registerDownloadRoutes } from './downloads';
import { Store } from './store';

// Exercise the real route and signing SDK against a synthetic storage response.
// There are no real accounts, purchases or storage objects in this fixture.
test('downloads reject malformed order selection before lookup and issue short-lived links only for the verified owner', async context => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://download-fixture.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role';
  const originalFetch = globalThis.fetch;
  let lookups = 0, listings = 0, limited = false;
  const signing: { url: string; body: any }[] = [];
  const logs: any[] = [];
  const order = {
    id: 'order-owner', userId: 'buyer', total: 100, transactionId: '10001',
    cashfreeOrderId: 'cf-owner', paymentProvider: 'Cashfree', paymentEnvironment: 'live',
    paymentStatus: 'PAID', status: 'PAID', deliveryStatus: 'DELIVERED', downloadStatus: 'AVAILABLE',
    payments: { '10001': { status: 'SUCCESS', order_id: 'cf-owner', environment: 'live', currency: 'INR', amount: 10000 } },
    items: [{ productId: 'template' }],
  };
  context.mock.method(Store, 'getGlobalOrder', async () => { lookups++; return order; });
  context.mock.method(Store, 'getUserOrders', async () => { listings++; return [order]; });
  context.mock.method(Store, 'rpc', async () => !limited);
  context.mock.method(Store, 'saveDownloadLog', async (_id: string, log: any) => { logs.push(log); });
  context.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input?.url || input);
    assert.ok(url.startsWith('https://download-fixture.supabase.co/storage/v1/object/sign/products/'));
    signing.push({ url, body: JSON.parse(String(init?.body)) });
    return Response.json({ signedURL: '/object/sign/products/template.zip?token=synthetic-only' });
  });
  const app = express();
  app.use(express.json({ strict: false }));
  registerDownloadRoutes(app, (req: any, res, next) => {
    if (!req.get('authorization')) return res.status(401).json({ success: false });
    req.userId = req.get('x-test-user') || 'buyer'; next();
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  context.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  });
  const request = (body?: any, headers: Record<string, string> = {}) => originalFetch(`${base}/api/downloads/template/token`, {
    method: 'POST', headers: { authorization: 'Bearer synthetic', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const body of [undefined, null, [], 'wrong', 5, true, { orderId: null }, { orderId: [] }, { orderId: {} }, { orderId: '' }, { orderId: '../orders/owner' }, { orderId: 'x'.repeat(101) }]) {
    const response = await request(body);
    assert.equal(response.status, 400, `malformed body ${JSON.stringify(body)} must fail cleanly`);
    assert.equal((await response.json()).success, false);
  }
  assert.equal(lookups + listings, 0, 'invalid selection must not fall back to all purchases');
  assert.equal(signing.length, 0);
  assert.equal((await request({ orderId: 'order-owner' }, { 'x-test-user': 'another-buyer' })).status, 403);
  assert.equal((await request({ orderId: 'order-owner' }, { authorization: '' })).status, 401);
  assert.equal(signing.length, 0, 'denied users must never receive a signed URL');
  const before = Date.now();
  const response = await request({ orderId: 'order-owner' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.match(result.downloadUrl, /storage\/v1\/object\/sign\/products\/template\.zip\?token=synthetic-only/);
  assert.ok(result.expiresAt >= before + 60_000 && result.expiresAt <= Date.now() + 60_000);
  assert.equal(signing[0].body.expiresIn, 60);
  assert.equal(logs[0].event, 'DOWNLOAD_AUTHORIZED');
  assert.equal(logs[0].userId, 'buyer'); assert.equal(logs[0].orderId, 'order-owner');
  assert.equal(logs[0].downloadUrl, undefined, 'audit stores authorization metadata, not the bearer link');
  assert.equal((await request({})).status, 200, 'optional order selection keeps valid existing callers working');
  assert.equal(listings, 1);
  limited = true;
  assert.equal((await request({ orderId: 'order-owner' })).status, 429);
  assert.equal(signing.length, 2, 'rate limiting occurs before signing another URL');
});
