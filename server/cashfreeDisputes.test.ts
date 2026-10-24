import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import 'express-async-errors';
import { once } from 'node:events';
import { Store } from './store';
import { normalizeCashfreeDispute, evidenceWindow, disputeMetrics, registerCashfreeDisputeRoutes } from './cashfreeDisputes';

const providerDispute = () => ({
  dispute_id: '901', dispute_type: 'DISPUTE', dispute_status: 'DISPUTE_CREATED', dispute_amount: 100,
  dispute_amount_currency: 'INR', reason_code: '1402', reason_description: 'Duplicate processing',
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), respond_by: new Date(Date.now() + 86400000).toISOString(),
  order_details: { order_id: 'CF_audit', cf_payment_id: '510', order_currency: 'INR', payment_currency: 'INR', order_amount: 100 },
  preferred_evidence: [{ document_type: 'Delivery/Service Proof', document_description: 'Explain delivery' }], dispute_evidence: [],
  secret: 'must-not-store', customer_details: { card_number: 'must-not-store' },
});
test('Cashfree dispute normalization validates references and stores only necessary fields', () => {
  const row = normalizeCashfreeDispute(providerDispute(), '901');
  assert.equal(row.payment_id, '510'); assert.equal(row.amount, 10000);
  assert.equal((row as any).secret, undefined); assert.equal((row as any).customer_details, undefined);
  assert.throws(() => normalizeCashfreeDispute(providerDispute(), '902'));
  assert.throws(() => normalizeCashfreeDispute({ ...providerDispute(), dispute_amount: 100.001 }, '901'));
  assert.throws(() => normalizeCashfreeDispute({ ...providerDispute(), dispute_amount_currency: 'USD' }, '901'));
});
test('evidence deadlines and stages require current actionable cases; arbitration never uploads new files', () => {
  const row = normalizeCashfreeDispute(providerDispute(), '901');
  assert.equal(evidenceWindow(row).canSubmit, true);
  assert.equal(evidenceWindow({ ...row, respond_by: new Date(Date.now() - 1).toISOString() }).canSubmit, false);
  assert.equal(evidenceWindow({ ...row, type: 'ARBITRATION', status: 'ARBITRATION_CREATED' }).canSubmit, false);
  assert.equal(evidenceWindow({ ...row, status: 'DISPUTE_MERCHANT_WON' }).canSubmit, false);
  assert.equal(evidenceWindow({ ...row, respond_by: '' }).canSubmit, false);
});
test('operational ratios expose denominators and deduplicate a payment across dispute stages', () => {
  const paid = { id: 'one', paymentProvider: 'Cashfree', paymentEnvironment: 'live', transactionId: '510', total: 100, paymentVerifiedAt: new Date().toISOString() };
  const metrics = disputeMetrics([{ orderId: 'one', payment_id: '510', amount: 2000 }, { orderId: 'one', payment_id: '510', amount: 3000 }], [paid, { ...paid, id: 'test', paymentEnvironment: 'test' }]);
  assert.equal(metrics.paidOrderCount, 1); assert.equal(metrics.disputedOrderCount, 1); assert.equal(metrics.disputedPaise, 3000); assert.equal(metrics.amountRatio, .3);
  assert.match(metrics.definition, /not Cashfree/);
});
test('signed dispute lifecycle binds known payments and human-reviewed evidence submission is authenticated and idempotent', async context => {
  const previous = Object.fromEntries(['CASHFREE_ENV', 'CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY'].map(key => [key, process.env[key]]));
  process.env.CASHFREE_ENV = 'sandbox'; process.env.CASHFREE_APP_ID = 'synthetic'; process.env.CASHFREE_SECRET_KEY = 'synthetic-secret';
  const state: Record<string, any> = {}, order = { id: 'CF_audit', userId: 'buyer', cashfreeOrderId: 'CF_audit', paymentProvider: 'Cashfree', paymentEnvironment: 'test', transactionId: '510', total: 100, customerEmail: 'buyer@example.test', createdAt: new Date().toISOString(), items: [{ productId: 'one', productTitle: 'Owned Product', price: 100 }], payments: { '510': { status: 'SUCCESS' } } };
  state['orders/CF_audit'] = order; state['cashfreeOrderIndex/CF_audit'] = 'CF_audit';
  context.mock.method(Store, 'rpc', async (operation: string, key: string, value: any) => {
    if (operation === 'get') { if (state[key]) return state[key]; const children = Object.entries(state).filter(([path]) => path.startsWith(key + '/') && !path.slice(key.length + 1).includes('/')); return children.length ? Object.fromEntries(children.map(([path, row]) => [path.slice(key.length + 1), row])) : null; }
    if (operation === 'set') return state[key] = structuredClone(value);
    if (operation === 'update') return state[key] = { ...state[key], ...structuredClone(value) };
    if (operation === 'record_cashfree_dispute') { state['cashfreeDisputes/' + value.id] = { ...state['cashfreeDisputes/' + value.id], ...value, orderId: state[key].id, userId: state[key].userId, verifiedAt: new Date().toISOString() }; return { ...state[key], cashfreeDisputes: { [value.id]: value } }; }
    if (operation === 'claim_email') { if (['sending', 'sent'].includes(state[key]?.status)) return false; state[key] = { ...state[key], status: 'sending' }; return true; }
    throw new Error(`Unexpected operation ${operation}`);
  });
  context.mock.method(Store, 'getAllGlobalOrders', async () => [order]);
  let remote: any = providerDispute(), uploads = 0;
  const realFetch = globalThis.fetch;
  context.mock.method(globalThis, 'fetch', async (input: any, options: RequestInit = {}) => {
    const url = String(input);
    if (url.startsWith('https://sandbox.cashfree.com/pg/')) {
      if (url.endsWith('/documents')) {
        uploads++; const body = options.body as FormData, file = body.get('file') as File;
        assert.equal(options.method, 'POST'); assert.match(String(new Headers(options.headers).get('x-idempotency-key')), /^[\da-f-]{36}$/);
        assert.equal(new Headers(options.headers).get('content-type'), null);
        remote = { ...remote, dispute_status: 'DISPUTE_DOCS_RECEIVED', dispute_evidence: [{ document_id: '41', document_type: 'Delivery/Service Proof', document_name: file.name }] };
      }
      return Response.json(remote);
    }
    return realFetch(input, options);
  });
  const app = express(); app.use(express.json({ verify: (req: any, _res, bytes) => req.rawBody = bytes }));
  const admin: any = (req: any, res: any, next: any) => req.get('x-test-admin') === 'yes' ? (req.userId = 'owner', next()) : res.status(403).json({ success: false });
  registerCashfreeDisputeRoutes(app, admin, admin, (_req, _res, next) => next());
  app.use((error: any, _req: any, res: any, _next: any) => res.status(503).json({ success: false }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (path: string, body: any, headers: Record<string, string> = {}) => realFetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const event = { type: 'DISPUTE_CREATED', data: { dispute: { dispute_id: '901' } } }, timestamp = String(Date.now());
    const sign = (event: any) => crypto.createHmac('sha256', 'synthetic-secret').update(timestamp + JSON.stringify(event)).digest('base64');
    assert.equal((await post('/api/payments/cashfree/disputes/webhook', event)).status, 400);
    assert.equal((await post('/api/payments/cashfree/disputes/webhook', event, { 'x-webhook-signature': sign(event), 'x-webhook-timestamp': timestamp })).status, 200);
    assert.equal(state['cashfreeDisputes/901'].amount, 10000); assert.equal(state['cashfreeDisputes/901'].secret, undefined);
    assert.equal((await realFetch(base + '/api/admin/cashfree/disputes')).status, 403);
    const list = await (await realFetch(base + '/api/admin/cashfree/disputes', { headers: { 'x-test-admin': 'yes' } })).json();
    assert.equal(list.disputes[0].canSubmit, true);
    const pdf = await realFetch(base + '/api/admin/cashfree/disputes/901/evidence', { headers: { 'x-test-admin': 'yes' } });
    assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await post('/api/admin/cashfree/disputes/901/evidence', { note: 'I reviewed the stored evidence.' }, { 'x-test-admin': 'yes' })).status, 400);
    const submission = { reviewed: true, note: 'I reviewed the stored evidence.', doc_type: 'Delivery/Service Proof' };
    assert.equal((await post('/api/admin/cashfree/disputes/901/evidence', submission, { 'x-test-admin': 'yes' })).status, 200);
    assert.equal((await post('/api/admin/cashfree/disputes/901/evidence', submission, { 'x-test-admin': 'yes' })).status, 200); assert.equal(uploads, 1);
    remote = { ...remote, order_details: { ...remote.order_details, cf_payment_id: '999' } };
    assert.equal((await post('/api/payments/cashfree/disputes/webhook', event, { 'x-webhook-signature': sign(event), 'x-webhook-timestamp': timestamp })).status, 503);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
