import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import 'express-async-errors';
import { matchingRouteTransfer, reconcileMarketplaceSettlements, registerSettlementRoutes } from './marketplaceSettlements';
import { marketplaceReserveCapability } from './settlementPolicy';

async function fixture() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key,name text,public boolean); create table storage.objects(id text,bucket_id text); alter table storage.objects enable row level security;');
  for (const file of ['schema.sql', 'migrations/202610230004_subscriptions.sql', 'migrations/202610240003_settlements.sql']) await db.exec(readFileSync(new URL(`../supabase/${file}`, import.meta.url), 'utf8'));
  const call = async (operation: string, key = '', value: any = null) => (await db.query<{ result: any }>('select public.settlement_operation($1,$2,$3::jsonb) as result', [operation, key, JSON.stringify(value)])).rows[0].result;
  const store = async (operation: string, key = '', value: any = null) => (await db.query<{ result: any }>('select public.store_operation($1,$2,$3::jsonb) as result', [operation, key, JSON.stringify(value)])).rows[0].result;
  const before = new Date(Date.now() - 100 * 3600000).toISOString();
  const order = { id: 'sale', userId: 'buyer', paymentProvider: 'Razorpay', paymentEnvironment: 'live', transactionId: 'pay_original', razorpayOrderId: 'order_original', total: 100, paymentVerifiedAt: before, deliveredAt: before, paymentStatus: 'PAID', deliveryStatus: 'DELIVERED', marketplace: { sellerId: 'creator', providerAccountId: 'acc_original', reservePolicyVersion: '72h-120d-v1' } };
  const ledger = { orderId: 'sale', sellerId: 'creator', provider: 'razorpay', providerPaymentId: 'pay_original', grossPaise: 10000, sellerPaise: 8000, payablePaise: 8000, settlementStatus: 'pending_provider' };
  await store('set', 'orders/sale', order); await store('set', 'marketplace/ledger/sale', ledger);
  await store('set', 'marketplace/creators/creator', { id: 'creator', userId: 'seller_user', status: 'approved' });
  await store('set', 'marketplace/creatorUsers/seller_user', 'creator');
  return { db, call, store, order, ledger };
}
const claim = 'a'.repeat(32);
test('settlement SQL enforces canonical live identity, a 72-hour reserve, exclusive claims and provider settlement proof', async context => {
  const { db, call, store, order, ledger } = await fixture(); context.after(() => db.close());
  await store('set', 'orders/test', { ...order, id: 'test', paymentEnvironment: 'test' }); await store('set', 'marketplace/ledger/test', { ...ledger, orderId: 'test' });
  await assert.rejects(call('ensure', 'test', {}), /Canonical live/);
  await store('set', 'orders/missing', { ...order, id: 'missing', paymentEnvironment: null }); await store('set', 'marketplace/ledger/missing', { ...ledger, orderId: 'missing' });
  await assert.rejects(call('ensure', 'missing', {}), /Canonical live/);
  await store('set', 'orders/new', { ...order, id: 'new', paymentVerifiedAt: new Date().toISOString(), deliveredAt: new Date().toISOString() }); await store('set', 'marketplace/ledger/new', { ...ledger, orderId: 'new' });
  const recent = await call('ensure', 'new', {}); assert.equal(recent.status, 'reserved');
  await call('claim', 'new', { token: claim }); assert.equal((await call('authorize_release', 'new', { token: claim })).allowed, false);
  const row = await call('ensure', 'sale', {}); assert.equal(row.status, 'eligible');
  assert.ok(await call('claim', 'sale', { token: claim }), 'an unrelated order has its own independent lease');
  assert.equal(await call('claim', 'sale', { token: 'b'.repeat(32) }), null);
});

test('atomic settlement claims and 120-day reviews cannot be bypassed by a browser status, stale actor or a resolved-before-due case', async context => {
  const { db, call, store, ledger } = await fixture(); context.after(() => db.close());
  await call('ensure', 'sale', {}); assert.ok(await call('claim', 'sale', { token: claim }));
  assert.equal(await call('claim', 'sale', { token: 'b'.repeat(32) }), null);
  assert.equal((await call('authorize_release', 'sale', { token: claim })).allowed, true);
  await assert.rejects(call('finish', 'sale', { token: claim, proof: { status: 'provider_settled', provider: 'razorpay', orderId: 'sale', sellerId: 'creator', paymentId: 'pay_original' } }), /confirmation/);
  await assert.rejects(call('finish', 'sale', { token: claim, proof: {} }), /proof mismatch/);
  await assert.rejects(call('note', 'sale', { token: 'b'.repeat(32), message: 'stale worker' }), /claim expired/);
  const action = { actorId: 'admin', reason: 'Review a documented legal complaint', category: 'legal_complaint', evidenceReference: 'support-case-123', reviewed: true };
  const opened = await call('risk_open', 'creator', action); assert.equal((await store('get', 'marketplace/creators/creator')).status, 'suspended');
  assert.equal((await call('authorize_release', 'sale', { token: claim })).allowed, false);
  const repeated = await call('risk_open', 'creator', { ...action, reason: 'Additional evidence on the same case' }); assert.equal(repeated.reviewAt, opened.reviewAt, 'repeated notices cannot reset the reserve clock');
  await call('risk_resolve', 'creator', { ...action, reason: 'Evidence reviewed and the case has been resolved' });
  assert.equal((await call('authorize_release', 'sale', { token: claim })).allowed, false, 'resolution alone cannot erase the original reserve review date');
  const risk = await store('get', 'marketplace/riskCases/creator'); await store('set', 'marketplace/riskCases/creator', { ...risk, reviewAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await call('authorize_release', 'sale', { token: claim })).allowed, true, 'elapsed resolved case may release funds without reopening seller sales');
  await store('set', 'marketplace/ledger/sale', { ...ledger, payablePaise: 0, settlementStatus: 'review_required' });
  assert.equal((await call('authorize_release', 'sale', { token: claim })).allowed, false, 'refund/dispute exposure overrides reserve expiry');
});

test('Route proof requires original source, recipient, amount, currency and reversal bounds', () => {
  const order = { transactionId: 'pay_original', razorpayOrderId: 'order_original', marketplace: { providerAccountId: 'acc_original' } }, row = { sellerPaise: 8000 };
  const transfer = { id: 'trf_original', source: 'pay_original', recipient: 'acc_original', amount: 8000, amount_reversed: 0, currency: 'INR' };
  assert.equal(matchingRouteTransfer(transfer, order, row), true);
  for (const patch of [{ source: 'pay_wrong' }, { recipient: 'acc_wrong' }, { amount: 8001 }, { amount_reversed: -1 }, { amount_reversed: 9000 }, { currency: 'USD' }, { id: 'not_transfer' }]) assert.equal(matchingRouteTransfer({ ...transfer, ...patch }, order, row), false);
});

test('scheduled Route release is idempotent and only provider-confirmed bank settlement gets a settled record', async context => {
  const { db, call, store } = await fixture(); context.after(() => db.close());
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_ROUTE_APPROVED', 'RAZORPAY_RESERVES_APPROVED', 'RAZORPAY_RESERVE_CONTRACT_REFERENCE'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { SUPABASE_URL: 'https://settlement.synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-private', RAZORPAY_KEY_ID: 'rzp_live_synthetic', RAZORPAY_KEY_SECRET: 'synthetic-private', RAZORPAY_ROUTE_APPROVED: 'true', RAZORPAY_RESERVES_APPROVED: 'true', RAZORPAY_RESERVE_CONTRACT_REFERENCE: 'contract-fixture' });
  const nativeFetch = globalThis.fetch; let patches = 0;
  let transfer: any = { id: 'trf_original', source: 'pay_original', recipient: 'acc_original', amount: 8000, amount_reversed: 0, currency: 'INR', on_hold: true, settlement_status: 'on_hold', recipient_settlement_id: null };
  globalThis.fetch = async (input: any, init?: any) => {
    const url = String(input?.url || input);
    if (url.startsWith('https://settlement.synthetic.supabase.co/rest/v1/rpc/')) {
      const fn = url.split('/').at(-1), body = JSON.parse(init.body);
      try { const result = fn === 'settlement_operation' ? await call(body.operation, body.key, body.value) : fn === 'store_operation' ? await store(body.operation, body.key, body.value) : fn === 'subscription_operation' ? { plans: {}, subscriptions: {}, payments: {}, events: {} } : null; return Response.json(result); }
      catch (error) { return Response.json({ message: (error as Error).message }, { status: 400 }); }
    }
    if (url === 'https://api.razorpay.com/v1/payments/pay_original/transfers') return Response.json({ items: [{ ...transfer }] });
    if (url === 'https://api.razorpay.com/v1/transfers/trf_original') {
      if (init?.method === 'PATCH') { assert.deepEqual(JSON.parse(init.body), { on_hold: false }); patches++; transfer = { ...transfer, on_hold: false, settlement_status: 'pending' }; }
      return Response.json({ ...transfer });
    }
    return nativeFetch(input, init);
  };
  context.after(() => { globalThis.fetch = nativeFetch; for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  assert.deepEqual(await reconcileMarketplaceSettlements(1), { checked: 1, failed: 0, skipped: 0 });
  assert.equal(patches, 1); assert.equal((await call('state')).settlements.sale.status, 'provider_pending');
  await reconcileMarketplaceSettlements(1); assert.equal(patches, 1, 'a replay observes the released transfer instead of issuing a second release');
  transfer = { ...transfer, settlement_status: 'settled', recipient_settlement_id: 'setl_confirmed' };
  await reconcileMarketplaceSettlements(1);
  const settled = (await call('state')).settlements.sale; assert.equal(settled.status, 'provider_settled'); assert.equal(settled.providerSettlementId, 'setl_confirmed');
  await reconcileMarketplaceSettlements(1); assert.equal(patches, 1);
  const refundedLedger = await store('get', 'marketplace/ledger/sale');
  await store('set', 'marketplace/ledger/sale', { ...refundedLedger, payablePaise: 0, settlementStatus: 'review_required' });
  await reconcileMarketplaceSettlements(1);
  assert.equal((await call('state')).settlements.sale.status, 'review_required', 'a refund after bank settlement must still surface review rather than being skipped forever');
  assert.equal(patches, 1, 'reviewing refunded settled funds must not send a new release');
});

test('admin settlement actions require session, role and an explicit reviewed reason; unsupported Easebuzz/UPI are honest', async context => {
  const { db, call, store } = await fixture(); context.after(() => db.close());
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.SUPABASE_URL = 'https://route.synthetic.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-role';
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const url = String(input?.url || input); if (!url.startsWith('https://route.synthetic.supabase.co/')) return nativeFetch(input, init);
    const body = JSON.parse(init.body); return Response.json(url.endsWith('/settlement_operation') ? await call(body.operation, body.key, body.value) : await store(body.operation, body.key, body.value));
  };
  context.after(() => { globalThis.fetch = nativeFetch; if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl; if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey; });
  const app = express(); app.use(express.json()); const auth: any = (req: any, res: any, next: any) => req.get('x-user') ? (req.userId = req.get('x-user'), next()) : res.status(401).json({ success: false }); const admin: any = (req: any, res: any, next: any) => req.userId === 'admin' ? next() : res.status(403).json({ success: false });
  registerSettlementRoutes(app, auth, admin, (_req, _res, next) => next()); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); context.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  assert.equal((await nativeFetch(`${base}/api/marketplace/admin/settlements`)).status, 401);
  assert.equal((await nativeFetch(`${base}/api/marketplace/admin/settlements`, { headers: { 'x-user': 'seller_user' } })).status, 403);
  const inbox = await (await nativeFetch(`${base}/api/marketplace/admin/settlements`, { headers: { 'x-user': 'admin' } })).json(); assert.equal(inbox.capabilities.easebuzz.ready, false); assert.equal(inbox.capabilities.razorpay.upiPayoutReady, false);
  const denied = await nativeFetch(`${base}/api/marketplace/admin/creators/creator/risk`, { method: 'POST', headers: { 'x-user': 'admin', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'suspend', reason: 'A complaint without review', category: 'legal_complaint', evidenceReference: 'case' }) }); assert.equal(denied.status, 400);
  assert.equal(marketplaceReserveCapability('easebuzz').ready, false);
});

test('a suspended seller keeps verified Route hold access; foreign transfers and unsupported Cashfree blocks are never mutated', async context => {
  const { db, call, store } = await fixture(); context.after(() => db.close());
  await store('update', 'marketplace/creators/creator', { providerAccounts: { razorpay: { reference: 'acc_original', status: 'verified', environment: 'live' }, cashfree: { reference: 'vendor_original', status: 'verified', environment: 'live' } } });
  const names = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_ROUTE_APPROVED','RAZORPAY_RESERVES_APPROVED','RAZORPAY_RESERVE_CONTRACT_REFERENCE','CASHFREE_EASYSPLIT_APPROVED','CASHFREE_RESERVES_APPROVED','CASHFREE_RESERVE_CONTRACT_REFERENCE','CASHFREE_RESERVE_SCHEDULE_ID','CASHFREE_RESERVE_MIN_HOURS'];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { SUPABASE_URL:'https://risk.synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'synthetic-private', RAZORPAY_KEY_ID:'rzp_live_synthetic', RAZORPAY_KEY_SECRET:'synthetic-private', RAZORPAY_ROUTE_APPROVED:'true', RAZORPAY_RESERVES_APPROVED:'true', RAZORPAY_RESERVE_CONTRACT_REFERENCE:'contract-fixture', CASHFREE_EASYSPLIT_APPROVED:'true', CASHFREE_RESERVES_APPROVED:'true', CASHFREE_RESERVE_CONTRACT_REFERENCE:'contract-fixture', CASHFREE_RESERVE_SCHEDULE_ID:'3', CASHFREE_RESERVE_MIN_HOURS:'72' });
  const originalFetch = globalThis.fetch, patched: string[] = [];
  const transfer: any = { id:'trf_original', source:'pay_original', recipient:'acc_original', amount:8000, amount_reversed:0, currency:'INR', settlement_status:'pending', on_hold:false };
  globalThis.fetch = async (input: any, init?: any) => {
    const url = String(input?.url || input);
    if (url.startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    if (url.startsWith('https://risk.synthetic.supabase.co/')) { const body = JSON.parse(init.body); return Response.json(url.endsWith('/settlement_operation') ? await call(body.operation, body.key, body.value) : await store(body.operation, body.key, body.value)); }
    if (url.endsWith('/payments/pay_original/transfers')) return Response.json({ items:[{...transfer,id:'trf_foreign',source:'pay_another'},transfer] });
    if (url.endsWith('/transfers/trf_original')) { if (init?.method === 'PATCH') { patched.push(url); assert.deepEqual(JSON.parse(init.body), {on_hold:true}); transfer.on_hold=true; } return Response.json(transfer); }
    throw new Error('An unsupported provider operation must never be attempted.');
  };
  context.after(() => { globalThis.fetch=originalFetch; for (const [name,value] of Object.entries(before)) if(value===undefined) delete process.env[name]; else process.env[name]=value; });
  const app=express(); app.use(express.json()); const pass:any=(_req:any,_res:any,next:any)=>next();
  registerSettlementRoutes(app,(req:any,_res,next)=>{req.userId='admin';next();},pass,pass);
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening'); context.after(()=>server.close());
  const response=await originalFetch(`http://127.0.0.1:${(server.address() as any).port}/api/marketplace/admin/creators/creator/risk`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'suspend',category:'legal_complaint',reason:'Review the documented legal complaint',evidenceReference:'case-verified',reviewed:true})});
  assert.equal(response.status,200); const result=await response.json(); assert.equal((await store('get','marketplace/creators/creator')).status,'suspended');
  assert.equal(result.riskReview.providerHold.razorpay,'verified_transfer_holds_partial_coverage');
  assert.equal(result.riskReview.providerHold.cashfree,'provider_action_required_contact_cashfree'); assert.equal(patched.length,1);
});
