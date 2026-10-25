import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { CREATOR_PLANS, LEGACY_CREATOR_PLAN_IDS, creatorPlanFeatures, creatorPlanQuota } from './creatorPlans';

const plansSql = readFileSync(new URL('../supabase/migrations/202610240002_plans.sql', import.meta.url), 'utf8');
async function fixture() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key,name text,public boolean); create table storage.objects(id text,bucket_id text);');
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/202610230004_subscriptions.sql', import.meta.url), 'utf8'));
  return db;
}

test('authorised creator offers are 499/month for ten creations and 899/month for unlimited count with real feature differences', () => {
  const [creator, studio] = CREATOR_PLANS;
  assert.deepEqual([creator.amount, creator.interval, creator.productLimit, creator.productQuota, creator.published], [499, 'month', 10, 'billing_period_creations', true]);
  assert.deepEqual([studio.amount, studio.interval, studio.productLimit, studio.productQuota, studio.published], [899, 'month', null, 'billing_period_creations', true]);
  assert.equal(creatorPlanFeatures(creator).customerMemberships, false);
  assert.equal(creatorPlanFeatures(creator).advancedAnalytics, false);
  assert.equal(creatorPlanFeatures(studio).customerMemberships, true);
  assert.equal(creatorPlanFeatures(studio).advancedAnalytics, true);
  assert.ok(CREATOR_PLANS.every(plan => !LEGACY_CREATOR_PLAN_IDS.has(plan.id)));
});

test('previously accepted monthly contracts keep their real quota instead of treating the old null field as unlimited', () => {
  const oldBasic = { ...CREATOR_PLANS[0], id: 'creator', productLimit: null, monthlyProductLimit: 10, productQuota: undefined, featureAccess: undefined };
  assert.deepEqual(creatorPlanQuota(oldBasic), { productLimit: 10, productQuota: 'billing_period_creations' });
  assert.equal(creatorPlanFeatures(oldBasic).customerMemberships, false);
  const oldPro = { ...oldBasic, id: 'studio', amount: 899, monthlyProductLimit: null };
  assert.deepEqual(creatorPlanQuota(oldPro), { productLimit: null, productQuota: 'billing_period_creations' });
  assert.equal(creatorPlanFeatures(oldPro).customerMemberships, true);
  const olderContract = { ...CREATOR_PLANS[0], id: 'creator', productLimit: 25, productQuota: undefined, featureAccess: undefined };
  assert.deepEqual(creatorPlanQuota(olderContract), { productLimit: 25, productQuota: 'active_listings' });
});

test('plan migration retires old catalog offers without rewriting accepted contracts or overwriting later owner pricing', async () => {
  const db = await fixture();
  try {
    const old = { plans: { starter: { id: 'starter', audience: 'creator', published: true }, creator: { id: 'creator', audience: 'creator', published: true } }, subscriptions: { old: { plan: { id: 'creator', amount: 1499, productLimit: 25 }, payments: { paid: { verified: true, revoked: false } } } }, payments: {}, events: {} };
    await db.query('update public.marketplace_billing_state set data=$1::jsonb where id=true', [JSON.stringify(old)]);
    await db.exec(plansSql);
    let state: any = (await db.query<any>('select data from public.marketplace_billing_state')).rows[0].data;
    assert.equal(state.plans.starter.published, false);
    assert.equal(state.plans.creator.published, false);
    assert.deepEqual(state.subscriptions, old.subscriptions);
    assert.equal(state.plans.creator_monthly_499.amount, 499);
    assert.equal(state.plans.studio_monthly_899.productLimit, null);
    state.plans.creator_monthly_499.amount = 699;
    await db.query('update public.marketplace_billing_state set data=$1::jsonb where id=true', [JSON.stringify(state)]);
    await db.exec(plansSql);
    state = (await db.query<any>('select data from public.marketplace_billing_state')).rows[0].data;
    assert.equal(state.plans.creator_monthly_499.amount, 699, 'reapplying setup cannot undo an owner’s later accepted catalog change');
  } finally { await db.close(); }
});

test('durable monthly quota counts every creation, resists deletion/replay/forged limits, resets with verified period and supports unlimited count', async () => {
  const db = await fixture();
  try {
    await db.exec(plansSql);
    const start = new Date(Date.now() - 86400000).toISOString(), end = new Date(Date.now() + 29 * 86400000).toISOString();
    const plan = CREATOR_PLANS[0];
    const payment = { id: 'payment_one', subscriptionRef: 'provider_sub', currency: 'INR', amountPaise: 49900, periodStart: start, periodEnd: end, verified: true, revoked: false };
    const subscription = { id: 'paid_sub', userId: 'seller', environment: 'live', providerRef: 'provider_sub', plan, payments: { payment_one: payment } };
    const setBilling = async (s: any) => db.query("update public.marketplace_billing_state set data=jsonb_set(data,'{subscriptions}',$1::jsonb,true) where id=true", [JSON.stringify({ paid_sub: s })]);
    await setBilling(subscription);
    let doc: any = { marketplace: { creatorUsers: { seller: 'creator' }, listings: Object.fromEntries(Array.from({ length: 40 }, (_, n) => [`old_${n}`, { sellerId: 'creator', status: 'active' }])) } };
    const quota: any = { subscriptionId: 'paid_sub', paymentId: 'payment_one', quotaKey: 'paid_sub_payment_one', periodStart: start, periodEnd: end, productLimit: 10, unlimited: false };
    const claim = async (n: number, q = quota) => {
      const id = `mk_${n.toString(16).padStart(32, '0')}`;
      return (await db.query<any>('select public.marketplace_claim_listing_quota($1::jsonb,$2,$3,$4::jsonb) as data', [JSON.stringify(doc), 'seller', id, JSON.stringify(q)])).rows[0].data;
    };
    for (let n = 1; n <= 10; n++) doc = await claim(n);
    assert.equal(doc.marketplace.listingCreations.seller.paid_sub_payment_one.created, 10, 'existing active products do not consume this new monthly-creation quota');
    doc.marketplace.listings = {};
    await assert.rejects(claim(11), /monthly product creation limit/);
    const legacyMonthly = { ...subscription, plan: { ...plan, id: 'creator', productLimit: null, productQuota: undefined, monthlyProductLimit: 10 } };
    await setBilling(legacyMonthly);
    await assert.rejects(claim(11), /monthly product creation limit/, 'a historical null total-listing limit cannot erase its ten monthly creations');
    await assert.rejects(claim(11, { ...quota, productLimit: null, unlimited: true }), /quota mismatch/);
    await setBilling(subscription);
    doc = await claim(1); assert.equal(doc.marketplace.listingCreations.seller.paid_sub_payment_one.created, 10, 'idempotent retries cannot consume or reset quota');
    for (const patch of [{ unlimited: true, productLimit: null }, { productLimit: null }, { productLimit: 999 }, { paymentId: 'unpaid' }, { quotaKey: 'forged' }, { periodEnd: new Date(Date.now() + 365 * 86400000).toISOString() }]) await assert.rejects(claim(12, { ...quota, ...patch }));
    await setBilling({ ...subscription, plan: { ...plan, productLimit: undefined } }); await assert.rejects(claim(12), /Invalid creator product limit/);
    await setBilling({ ...subscription, environment: 'test' }); await assert.rejects(claim(12), /verified paid/);
    await setBilling({ ...subscription, payments: { payment_one: { ...payment, revoked: true } } }); await assert.rejects(claim(12), /current verified/);
    const renewal = { ...payment, id: 'payment_two' };
    await setBilling({ ...subscription, payments: { payment_one: { ...payment, periodEnd: new Date(Date.now() - 1000).toISOString() }, payment_two: renewal } });
    const nextQuota = { ...quota, paymentId: 'payment_two', quotaKey: 'paid_sub_payment_two' };
    doc = await claim(13, nextQuota); assert.equal(doc.marketplace.listingCreations.seller.paid_sub_payment_two.created, 1);
    await setBilling({ ...subscription, plan: CREATOR_PLANS[1], payments: { payment_one: { ...payment, amountPaise: 89900 } } });
    const unlimited = { ...quota, productLimit: null, unlimited: true };
    for (let n = 20; n <= 45; n++) doc = await claim(n, unlimited);
    assert.equal(doc.marketplace.listingCreations.seller.paid_sub_payment_one.created, 36);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(claim(99, unlimited), /permission denied/);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
