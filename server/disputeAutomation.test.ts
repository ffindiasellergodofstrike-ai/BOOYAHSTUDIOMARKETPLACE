import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import 'express-async-errors';
import { Store } from './store';
import { collectDisputeCases, disputeDueAt, disputeRiskMetrics, reconcileDisputes, registerDisputeAutomationRoutes } from './disputeAutomation';

const now = Date.now();
const paidAt = new Date(now - 86400000).toISOString();
const cfOrder = (id = 'cf_order', paymentId = '510') => ({ id, userId: 'buyer', currency: 'INR', total: 100, paymentProvider: 'Cashfree', paymentEnvironment: 'live', transactionId: paymentId, cashfreeOrderId: `CF_${id}`, paymentVerifiedAt: paidAt, payments: { [paymentId]: { status: 'SUCCESS', environment: 'live', amount: 10000, currency: 'INR' } } });
const rzOrder = (id = 'rz_order', paymentIds = ['pay_one']) => ({ id, userId: 'buyer', currency: 'INR', total: 100, paymentProvider: 'Razorpay', paymentEnvironment: 'live', transactionId: paymentIds[0], razorpayOrderId: `order_${id}`, paymentVerifiedAt: paidAt, payments: Object.fromEntries(paymentIds.map(id => [id, { status: 'captured', environment: 'live', amount: 10000, currency: 'INR' }])), disputes: {} as Record<string, any> });
const cfCase = (id = '901', order = cfOrder()) => ({ id, orderId: order.id, payment_id: order.transactionId, cashfreeOrderId: order.cashfreeOrderId, amount: 2000, currency: 'INR', status: 'DISPUTE_CREATED', type: 'DISPUTE', respond_by: new Date(now + 86400000).toISOString() });
const rzCase = (id = 'disp_one', paymentId = 'pay_one') => ({ id, payment_id: paymentId, amount: 5000, currency: 'INR', status: 'open', respond_by: Math.floor((now + 86400000) / 1000), reason_code: 'not_received', created_at: Math.floor(now / 1000) });
const remoteCfCase = (id: string, order: ReturnType<typeof cfOrder>, status = 'DISPUTE_MERCHANT_WON') => ({ dispute_id: id, dispute_type: 'DISPUTE', dispute_status: status, dispute_amount: 20, dispute_amount_currency: 'INR', reason_code: '1401', reason_description: 'Not received', respond_by: new Date(now + 86400000).toISOString(), updated_at: new Date(now).toISOString(), created_at: paidAt, order_details: { order_id: order.cashfreeOrderId, cf_payment_id: order.transactionId, order_currency: 'INR', payment_currency: 'INR' } });

function fixture(context: any, orders: any[], options: { cashfree?: boolean; razorpay?: boolean } = {}) {
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CASHFREE_ENV', 'CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'EASEBUZZ_ENV', 'EASEBUZZ_KEY', 'EASEBUZZ_SALT'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { SUPABASE_URL: 'https://synthetic.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only' });
  if (options.cashfree) Object.assign(process.env, { CASHFREE_ENV: 'production', CASHFREE_APP_ID: 'synthetic-app', CASHFREE_SECRET_KEY: 'synthetic-private' });
  if (options.razorpay !== false) Object.assign(process.env, { RAZORPAY_KEY_ID: 'rzp_live_synthetic', RAZORPAY_KEY_SECRET: 'synthetic-private', RAZORPAY_WEBHOOK_SECRET: 'synthetic-webhook' });
  context.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const state: any = { orders: Object.fromEntries(orders.map(order => [order.id, structuredClone(order)])), cashfreeOrderIndex: Object.fromEntries(orders.filter(order => order.cashfreeOrderId).map(order => [order.cashfreeOrderId, order.id])), cashfreeDisputes: {}, operations: {} };
  const get = (path: string) => path.split('/').filter(Boolean).reduce((value: any, part) => value?.[part], state);
  const set = (path: string, value: any) => { const parts = path.split('/'); let parent = state; for (const part of parts.slice(0, -1)) parent = parent[part] ||= {}; parent[parts.at(-1)!] = structuredClone(value); return structuredClone(value); };
  let reads = 0;
  context.mock.method(Store, 'get', async (path: string) => { reads++; return structuredClone(get(path) ?? null); });
  context.mock.method(Store, 'set', async (path: string, value: any) => set(path, value));
  context.mock.method(Store, 'getAllGlobalOrders', async () => { reads++; return structuredClone(Object.values(state.orders)); });
  context.mock.method(Store, 'getGlobalOrder', async (id: string) => structuredClone(state.orders[id] || null));
  context.mock.method(Store, 'rpc', async (operation: string, path: string, value: any) => {
    const order = get(path);
    if (operation === 'record_dispute') { order.disputes ||= {}; order.disputes[value.id] = structuredClone(value); return structuredClone(order); }
    if (operation === 'record_cashfree_dispute') { state.cashfreeDisputes[value.id] = { ...structuredClone(value), orderId: order.id, userId: order.userId, verifiedAt: new Date().toISOString() }; return structuredClone(order); }
    throw new Error(`Unexpected financial mutation ${operation}`);
  });
  const api = { detailOverrides: {} as Record<string, any>, razorpayRows: [] as any[], cashfreeByPayment: {} as Record<string, any[]>, failedCases: new Set<string>(), failedPayments: new Set<string>(), calls: [] as string[] };
  const realFetch = globalThis.fetch;
  context.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = new URL(String(input?.url || input));
    if (url.hostname === '127.0.0.1') return realFetch(input, init);
    api.calls.push(url.toString());
    assert.equal(init?.method || 'GET', 'GET', 'automatic dispute tracking must never accept, refund or submit evidence');
    if (url.hostname === 'api.razorpay.com') {
      if (url.pathname === '/v1/disputes') return Response.json({ items: api.razorpayRows.slice(Number(url.searchParams.get('skip') || 0), Number(url.searchParams.get('skip') || 0) + 25) });
      const id = url.pathname.split('/').at(-1)!;
      if (api.failedCases.has(id)) return Response.json({ error: 'synthetic failure' }, { status: 503 });
      return Response.json(api.detailOverrides[id] || api.razorpayRows.find(row => row.id === id));
    }
    if (url.hostname === 'api.cashfree.com') {
      const list = url.pathname.match(/^\/pg\/payments\/(\d+)\/disputes$/);
      if (list) return api.failedPayments.has(list[1]) ? Response.json({}, { status: 503 }) : Response.json(api.cashfreeByPayment[list[1]] || []);
      const id = url.pathname.split('/').at(-1)!;
      if (api.failedCases.has(id)) return Response.json({}, { status: 503 });
      return Response.json(Object.values(api.cashfreeByPayment).flat().find(row => String(row.dispute_id) === id));
    }
    throw new Error(`Unexpected network host ${url.hostname}`);
  });
  return { state, api, get, set, reads: () => reads };
}

test('dispute deadlines interpret Cashfree local time in India, Razorpay Unix time and reject invalid/out-of-range values', () => {
  assert.equal(disputeDueAt('2026-10-23T12:00:00'), '2026-10-23T06:30:00.000Z');
  assert.equal(disputeDueAt('2026-10-23T12:00:00+05:30'), '2026-10-23T06:30:00.000Z');
  assert.equal(disputeDueAt(1792737000), new Date(1792737000 * 1000).toISOString());
  for (const invalid of ['', 'not-a-date', undefined, null, 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER, {}]) assert.equal(disputeDueAt(invalid), null);
});

test('unified inbox binds live provider/order/payment/currency/amount and never renders a mismatched Cashfree mirror', () => {
  const cf = cfOrder(), rz = rzOrder(); rz.disputes.disp_one = rzCase();
  const rows = collectDisputeCases([cf, rz], [cfCase()], now);
  assert.equal(rows.length, 2); assert.equal(rows[0].dueSoon, true);
  assert.equal(rows.find(row => row.provider === 'cashfree')?.canSubmit, true);
  assert.equal(rows.find(row => row.provider === 'razorpay')?.submissionMode, 'provider_dashboard');
  for (const patch of [{ cashfreeOrderId: 'CF_other' }, { payment_id: 'other' }, { currency: 'USD' }, { amount: 10001 }, { amount: -1 }, { amount: '2000' }, { id: '../bad' }]) assert.equal(collectDisputeCases([cf], [{ ...cfCase(), ...patch }], now).length, 0, JSON.stringify(patch));
  for (const patch of [{ paymentEnvironment: 'test' }, { paymentProvider: 'Razorpay' }, { currency: 'USD' }, { total: NaN }, { total: -1 }, { paymentVerifiedAt: '' }]) assert.equal(collectDisputeCases([{ ...cf, ...patch }], [cfCase()], now).length, 0, JSON.stringify(patch));
  const closed = collectDisputeCases([cf], [{ ...cfCase(), status: 'DISPUTE_MERCHANT_WON', respond_by: new Date(now - 86400000).toISOString() }], now)[0];
  assert.equal(closed.open, false); assert.equal(closed.overdue, false);
});

test('operational count and value ratios use a live paid cohort and deduplicate stages per payment', () => {
  const order = cfOrder();
  const orders = [order, order, { ...cfOrder('second', '511'), total: 900 }, { ...cfOrder('test'), paymentEnvironment: 'test' }, { ...cfOrder('invalid'), total: NaN }];
  const cases = [{ provider: 'cashfree', orderId: order.id, paymentId: '510', amountPaise: 1000 }, { provider: 'cashfree', orderId: order.id, paymentId: '510', amountPaise: 3000 }, { provider: 'cashfree', orderId: order.id, paymentId: 'wrong', amountPaise: 9999 }];
  const metric = disputeRiskMetrics(orders, cases, now)[0];
  assert.equal(metric.paidOrders, 2); assert.equal(metric.disputedOrders, 1); assert.equal(metric.grossPaise, 100000); assert.equal(metric.disputedPaise, 3000);
  assert.equal(metric.countRatio, .5); assert.equal(metric.valueRatio, .03); assert.match(metric.definition, /Not the provider/);
  const easebuzz = disputeRiskMetrics([], [], now)[2]; assert.equal(easebuzz.coverage, 'manual_provider_review'); assert.equal(easebuzz.valueRatio, null);
});

test('Razorpay partial discovery pages advance the durable cursor and eventually include older cases', async context => {
  const ids = Array.from({ length: 30 }, (_, i) => `pay_case${i}`), env = fixture(context, [rzOrder('many', ids)]);
  env.api.razorpayRows = ids.map((id, i) => ({ ...rzCase(`disp_case${i}`, id), status: 'closed' }));
  for (let i = 0; i < 15; i++) { const result = await reconcileDisputes(2); assert.equal(result.checked, 2); assert.ok(result.attempted <= 2); }
  const listCalls = env.api.calls.filter(url => new URL(url).pathname === '/v1/disputes');
  assert.deepEqual(listCalls.slice(0, 3).map(url => new URL(url).searchParams.get('skip')), ['0', '2', '4']);
  assert.equal(Object.keys(env.state.orders.many.disputes).length, 30);
  assert.equal(env.get('operations/razorpayDisputeCursor'), 0, 'short final page wraps back to discover newly created cases');
});

test('failed case lookups consume their budget and cannot trap discovery on one partial page', async context => {
  const ids = Array.from({ length: 25 }, (_, i) => `pay_fail${i}`), env = fixture(context, [rzOrder('failures', ids)]);
  env.api.razorpayRows = ids.map((id, i) => rzCase(`disp_fail${i}`, id));
  env.api.failedCases = new Set(env.api.razorpayRows.map(row => row.id));
  const result = await reconcileDisputes(3);
  assert.equal(result.checked, 0); assert.equal(result.attempted, 3); assert.equal(result.failed, 3);
  assert.equal(env.api.calls.filter(url => /\/disputes\/disp_/.test(url)).length, 3);
  assert.equal(env.get('operations/razorpayDisputeCursor'), 3);
});

test('Cashfree discovery rotates failed payments, advances per-payment offsets and rejects another payment binding', async context => {
  const first = cfOrder('first', '510'), second = cfOrder('second', '511'), env = fixture(context, [first, second], { cashfree: true, razorpay: false });
  env.api.failedPayments.add('510');
  env.api.cashfreeByPayment['511'] = [remoteCfCase('901', second), remoteCfCase('902', second), { ...remoteCfCase('903', second), order_details: { ...remoteCfCase('903', second).order_details, cf_payment_id: '999' } }, remoteCfCase('904', second)];
  for (let i = 0; i < 8; i++) await reconcileDisputes(1);
  const successful = Object.keys(env.state.cashfreeDisputes).sort();
  assert.deepEqual(successful, ['901', '902', '904']);
  const listCalls = env.api.calls.filter(url => /\/payments\//.test(url));
  assert.equal(listCalls.length, 8); assert.ok(listCalls.filter(url => url.includes('/511/')).length >= 4, 'a failed first payment cannot starve the second one');
  assert.equal(env.get('operations/cashfreeDisputeOffsets/second'), 0);
});

test('small budgets rotate providers and continue historical monitoring while new checkout stays disabled', async context => {
  const cf = cfOrder(), rz = rzOrder(), env = fixture(context, [cf, rz], { cashfree: true });
  env.api.cashfreeByPayment['510'] = [remoteCfCase('901', cf)];
  env.api.razorpayRows = [{ ...rzCase(), status: 'closed' }];
  env.set('marketplace/gateway-settings', { enabled: { cashfree: false, razorpay: false, easebuzz: false } });
  await reconcileDisputes(1); await reconcileDisputes(1);
  assert.equal(Object.keys(env.state.cashfreeDisputes).length, 1); assert.equal(Object.keys(env.state.orders.rz_order.disputes).length, 1);
  assert.equal(env.api.calls.length, 4, 'each unit uses only a list and one verified case lookup');
});

test('admin inbox enforces both session and admin gates, reports manual Easebuzz and validates reconciliation reasons', async context => {
  const env = fixture(context, [], { razorpay: false });
  const app = express(); app.use(express.json());
  const auth: any = (req: any, res: any, next: any) => req.get('x-user') ? (req.userId = 'owner', next()) : res.status(401).json({ success: false });
  const admin: any = (req: any, res: any, next: any) => req.get('x-admin') === 'yes' ? next() : res.status(403).json({ success: false });
  registerDisputeAutomationRoutes(app, auth, admin, (_req, _res, next) => next());
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  context.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/marketplace/admin/disputes`;
  assert.equal((await fetch(base)).status, 401); assert.equal((await fetch(base, { headers: { 'x-user': 'buyer' } })).status, 403); assert.equal(env.reads(), 0);
  const response = await fetch(base, { headers: { 'x-user': 'owner', 'x-admin': 'yes' } }); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.capabilities.easebuzz, 'manual_provider_review'); assert.equal(result.readiness.easebuzz.automaticTracking, false); assert.equal(result.readiness.cashfree.configured, false);
  assert.equal((await fetch(base + '/reconcile', { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'owner', 'x-admin': 'yes' }, body: JSON.stringify({ reason: 'short' }) })).status, 400);
  assert.equal(env.api.calls.length, 0);
});


test('fresh provider lookup mismatches never enter the durable dispute inbox', async context => {
  const env = fixture(context, [rzOrder()]);
  const remote = rzCase(); env.api.razorpayRows = [remote];
  for (const patch of [{ payment_id: 'pay_another' }, { amount: 10001 }, { amount: 1.5 }, { currency: 'USD' }, { status: 'invented' }, { id: 'disp_wrong' }]) {
    env.api.detailOverrides[remote.id] = { ...remote, ...patch };
    const result = await reconcileDisputes(1);
    assert.equal(result.checked, 0, JSON.stringify(patch)); assert.equal(result.failed, 1);
    assert.deepEqual(env.state.orders.rz_order.disputes, {});
  }
});

test('known urgent cases and new discovery both receive work under a small repeated budget', async context => {
  const cf = cfOrder(), rz = rzOrder('urgent', ['pay_one', 'pay_two']);
  rz.disputes = { disp_one: rzCase(), disp_two: rzCase('disp_two', 'pay_two') };
  const env = fixture(context, [cf, rz], { cashfree: true });
  env.api.razorpayRows = Object.values(rz.disputes);
  env.api.cashfreeByPayment['510'] = [remoteCfCase('901', cf)];
  for (let i = 0; i < 3; i++) { const result = await reconcileDisputes(2); assert.ok(result.attempted <= 2); }
  assert.ok(env.api.calls.some(url => url.endsWith('/disputes/disp_one')));
  assert.ok(env.api.calls.some(url => url.endsWith('/disputes/disp_two')), 'an urgent second case must not starve behind repeated discovery of the first');
  assert.ok(env.state.cashfreeDisputes['901'], 'a known urgent queue must not permanently block another provider’s newly discovered case');
});
