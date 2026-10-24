import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store';
import { seal } from './privateData';
import { marketplaceSplitForOrder } from './gatewaySplits';
import { razorpayRequest } from './razorpay';

test('creator splits require actual provider activation, exact bank/reference/environment and immutable paise; company orders never split', async t => {
  const env = { ...process.env }, originalGet = Store.get, originalFetch = globalThis.fetch;
  Object.assign(process.env, { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', CASHFREE_APP_ID: 'synthetic-app', CASHFREE_SECRET_KEY: 'synthetic-cashfree', CASHFREE_ENV: 'production', RAZORPAY_KEY_ID: 'rzp_live_synthetic', RAZORPAY_KEY_SECRET: 'synthetic-razorpay', RAZORPAY_WEBHOOK_SECRET: 'synthetic-webhook', EASEBUZZ_KEY: 'synthetic-easebuzz', EASEBUZZ_SALT: 'synthetic-salt', EASEBUZZ_ENV: 'prod', MARKETPLACE_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') });
  delete process.env.CASHFREE_EASYSPLIT_APPROVED;
  let account: any = { reference: 'vendor_creator', status: 'verified', environment: 'live' }, bankMatches = true, calls = 0;
  const kyc = { legalName: 'Original Creator', bankAccount: '123456781234', ifsc: 'SYNTH000001', pan: 'AAAAA1234A' };
  const record: any = { id: 'creator_original', displayName: 'Original Creator', status: 'approved', encryptedKyc: seal(kyc, 'creator-kyc:creator_original'), providerAccounts: {} };
  Store.get = async (key: string) => key === 'marketplace/creators/creator_original' ? { ...record, providerAccounts: { cashfree: account, razorpay: account, easebuzz: account } } : null;
  globalThis.fetch = async (input: any) => {
    calls++; const url = String(input);
    if (url.endsWith('/easy-split/vendors/vendor_creator')) return Response.json({ vendor_id: 'vendor_creator', status: 'ACTIVE', bank: { account_number: bankMatches ? kyc.bankAccount : '000000000000', ifsc: kyc.ifsc } });
    if (url.endsWith('/v2/accounts/acc_creator/products/acc_prd_creator')) return Response.json({ id: 'acc_prd_creator', account_id: 'acc_creator', product_name: 'route', activation_status: 'activated', active_configuration: { settlements: { account_number: bankMatches ? kyc.bankAccount : '000000000000', ifsc_code: kyc.ifsc } } });
    throw new Error('Unexpected provider lookup');
  };
  t.after(() => { Store.get = originalGet; globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
  const order = { id: 'creator_order', total: 299, marketplace: { sellerId: 'creator_original', provider: 'cashfree', providerAccountId: 'vendor_creator', grossPaise: 29900, commissionPaise: 2990, sellerPaise: 26910 } };
  assert.deepEqual(await marketplaceSplitForOrder({ id: 'company_order', total: 299 }, 'cashfree'), {}); assert.equal(calls, 0);
  await assert.rejects(marketplaceSplitForOrder(order, 'cashfree')); assert.equal(calls, 0);
  process.env.CASHFREE_EASYSPLIT_APPROVED = 'true';
  assert.deepEqual(await marketplaceSplitForOrder(order, 'cashfree'), { order_splits: [{ vendor_id: 'vendor_creator', amount: 269.1 }] });
  bankMatches = false; await assert.rejects(marketplaceSplitForOrder(order, 'cashfree')); bankMatches = true;
  await assert.rejects(marketplaceSplitForOrder({ ...order, marketplace: { ...order.marketplace, grossPaise: 100 } }, 'cashfree'));
  account = { ...account, environment: 'test' }; await assert.rejects(marketplaceSplitForOrder(order, 'cashfree'));
  process.env.RAZORPAY_ROUTE_APPROVED = 'true'; account = { reference: 'acc_creator', environment: 'live', status: 'verified', providerStatus: 'activated:acc_prd_creator' };
  const rzpOrder = { ...order, marketplace: { ...order.marketplace, provider: 'razorpay', providerAccountId: 'acc_creator' } };
  const split: any = await marketplaceSplitForOrder(rzpOrder, 'razorpay'); assert.equal(split.transfers[0].account, 'acc_creator'); assert.equal(split.transfers[0].amount, 26910);
  process.env.EASEBUZZ_MARKETPLACE_APPROVED = 'true'; account = { reference: 'provider_bank_label', environment: 'live', status: 'verified' };
  const easeOrder = { ...order, marketplace: { ...order.marketplace, provider: 'easebuzz', providerAccountId: account.reference } };
  await assert.rejects(marketplaceSplitForOrder(easeOrder, 'easebuzz'));
  process.env.EASEBUZZ_APPROVED_SPLIT_LABELS_JSON = JSON.stringify({ creator_original: { label: account.reference, environment: 'live', accountLast4: '1234', providerConfirmedAt: '2026-10-23T00:00:00.000Z' } });
  assert.deepEqual(await marketplaceSplitForOrder(easeOrder, 'easebuzz'), { splitPayments: { provider_bank_label: 269.1 } });
});

test('Razorpay dispute discovery pagination accepts only bounded structured parameters on the fixed provider host', async t => {
  const original = globalThis.fetch, key = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_ID = 'rzp_live_synthetic'; process.env.RAZORPAY_KEY_SECRET = 'synthetic-private';
  let calls = 0;
  globalThis.fetch = async (input: any, init?: any) => {
    calls++; assert.equal(String(input), 'https://api.razorpay.com/v1/disputes?count=25&skip=50'); assert.equal(init.redirect, 'error'); return Response.json({ items: [] });
  };
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = key; if (secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = secret; });
  await razorpayRequest('disputes', undefined, 'v1', { count: 25, skip: 50 });
  for (const query of [{ count: 101 }, { count: 0 }, { skip: -1 }, { skip: 1.5 }, { skip: 1000001 }, { redirect: 'https://attacker.invalid' }, new URLSearchParams('count=25&count=100')]) await assert.rejects(razorpayRequest('disputes', undefined, 'v1', query as any));
  await assert.rejects(razorpayRequest('payments/pay_other', undefined, 'v1', { count: 25 }));
  assert.equal(calls, 1, 'invalid pagination must fail before any authenticated provider request');
});
