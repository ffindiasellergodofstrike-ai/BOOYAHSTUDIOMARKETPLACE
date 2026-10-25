import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

test('both scheduled routes require a bearer secret, reconcile durable modules and fail closed on a database outage', async t => {
  const keys = ['CRON_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'CASHFREE_ENV'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { CRON_SECRET: 'synthetic-cron-only', SUPABASE_URL: 'https://cron.synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role', CASHFREE_ENV: 'sandbox' });
  delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
  const originalFetch = globalThis.fetch;
  const store: Record<string, any> = { orders: { legacy: { id: 'legacy', userId: 'buyer', paymentProvider: 'Easebuzz', paymentEnvironment: 'live', paymentStatus: 'PAID', status: 'PAID', total: 100, transactionId: 'legacy-manual', items: [{ productId: 'product' }] } } };
  const billing: any = { plans: {}, subscriptions: {}, payments: {}, events: {} };
  const calls: { endpoint: string; operation: string; key: string }[] = [];
  let unavailable = false, providerCalls = 0;
  globalThis.fetch = async (input: any, init?: any) => {
    const url = String(input?.url || input);
    if (!url.startsWith('https://cron.synthetic.supabase.co/')) {
      if (url.startsWith('http://127.0.0.1:')) return originalFetch(input, init);
      providerCalls++; throw new Error('This empty reconciliation fixture must not contact providers or send emails.');
    }
    const body = JSON.parse(String(init?.body));
    const endpoint = new URL(url).pathname.split('/').at(-1)!;
    calls.push({ endpoint, operation: body.operation, key: body.key });
    if (unavailable) return Response.json({ message: 'Synthetic database outage' }, { status: 503 });
    if (endpoint === 'store_operation') {
      if (body.operation === 'get') return Response.json(store[body.key] ?? null);
      if (body.operation === 'set') { store[body.key] = body.value; return Response.json(body.value); }
      throw new Error(`Unexpected financial mutation ${body.operation}`);
    }
    if (endpoint === 'subscription_operation') {
      if (body.operation === 'state') return Response.json(billing);
      if (body.operation === 'seed_plan') { billing.plans[body.key] = body.value; return Response.json(body.value); }
    }
    if (endpoint === 'settlement_operation' && body.operation === 'state') return Response.json({ settlements: {}, riskCases: {}, ledger: {}, audit: {} });
    throw new Error('Unexpected persistence request');
  };
  const { app } = await import('./app');
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve())); globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const paths = ['/api/jobs/reconcile', '/api/payments/easebuzz/reconcile-cron'];
  for (const path of paths) {
    assert.equal((await originalFetch(base + path)).status, 403);
    assert.equal((await originalFetch(base + path, { headers: { authorization: 'Bearer wrong-secret' } })).status, 403);
  }
  assert.equal(calls.length, 0, 'authorization must precede all persistence/provider work');
  for (const path of paths) {
    const response = await originalFetch(base + path, { headers: { authorization: 'Bearer synthetic-cron-only' } });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true); assert.equal(result.status, 'completed', JSON.stringify({result,calls})); assert.equal(result.reconciled, 0); assert.equal(result.reviewRequired, 0);
    assert.deepEqual(result.subscriptions, { checked: 0, failed: 0 });
    assert.deepEqual(result.disputes, { checked: 0, attempted: 0, failed: 0, discovered: 0, open: 0, urgent: 0 });
    assert.equal(result.emails.sent, 0); assert.equal(result.emails.attempted, 0);
    assert.ok(Number.isFinite(Date.parse(result.completedAt)));
    const { success: _success, ...outcome } = result;
    assert.deepEqual(store['operations/reconciliationLastRun'], outcome, 'the displayed outcome must be durably persisted');
  }
  assert.equal(providerCalls, 0); assert.equal(store.purchases, undefined, 'a legacy manually marked paid order must not create an entitlement');
  assert.ok(calls.some(call => call.endpoint === 'subscription_operation' && call.operation === 'state'));
  assert.ok(calls.every(call => call.endpoint !== 'store_operation' || ['get', 'set'].includes(call.operation)), 'no payment binding/confirmation operation occurs');
  const persisted = store['operations/reconciliationLastRun']; unavailable = true;
  for (const path of paths) {
    const response = await originalFetch(base + path, { headers: { authorization: 'Bearer synthetic-cron-only' } });
    assert.equal(response.status, 503); assert.equal((await response.json()).success, false);
  }
  assert.deepEqual(store['operations/reconciliationLastRun'], persisted, 'an unavailable database must not fabricate a successful run');
});
