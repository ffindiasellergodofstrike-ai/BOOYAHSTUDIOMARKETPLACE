import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { FRESH_SETUP_FILES, UPGRADE_SETUP_FILES, renderMarketplaceSql } from './sqlPreparation';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
test('SQL preparation has an explicit current order and excludes legacy definitions from upgrades', () => {
  assert.equal(FRESH_SETUP_FILES.length, 10); assert.equal(UPGRADE_SETUP_FILES.length, 6);
  assert.equal(FRESH_SETUP_FILES[0], 'supabase/schema.sql');
  const fresh = renderMarketplaceSql('fresh', projectRoot), upgrade = renderMarketplaceSql('upgrade', projectRoot);
  let previous = -1;
  for (const file of FRESH_SETUP_FILES) { const index = fresh.indexOf(`-- BEGIN FILE: ${file}`); assert.ok(index > previous, file); previous = index; }
  for (const file of UPGRADE_SETUP_FILES) assert.ok(upgrade.includes(`-- BEGIN FILE: ${file}`));
  for (const historical of ['202610030001_marketplace_store.sql','20261005_payment_security.sql','202610220001_cashfree.sql']) assert.ok(!fresh.includes(historical) && !upgrade.includes(historical));
  assert.ok(!upgrade.includes('-- BEGIN FILE: supabase/schema.sql'));
  assert.match(fresh, /create or replace function public\.marketplace_setup_status/);
  assert.match(upgrade, /marketplace_claim_listing_quota/);
  assert.match(upgrade, /fixed_per_item/);
  assert.ok(fresh.indexOf('202610240002_plans.sql') < fresh.indexOf('202610240011_creator_marketplace.sql'));
});

test('prepared fresh SQL and upgrade execute atomically without rewriting historical paid snapshots', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key,name text,public boolean); create table storage.objects(id text,bucket_id text); alter table storage.objects enable row level security;');
    await db.exec(renderMarketplaceSql('fresh', projectRoot));
    const ready = (await db.query<{ result: Record<string, boolean> }>('select public.marketplace_setup_status() as result')).rows[0].result;
    assert.ok(Object.values(ready).every(flag => flag === true), JSON.stringify(ready));
    const oldOrder = { id: 'old-order', userId: 'buyer', paymentProvider: 'Cashfree', cashfreeOrderId: 'old-provider-reference', paymentEnvironment: 'live', paymentStatus: 'PAID', marketplace: { commissionBps: 1000, grossPaise: 10000, commissionPaise: 1000, sellerPaise: 9000 } };
    const oldSubscription = { id: 'old-subscription', userId: 'creator', providerRef: 'old-mandate', plan: { id: 'creator', amount: 1499, productLimit: 25 }, acceptedPolicyVersion: 'historical', payments: { paid: { amountPaise: 149900, verified: true } } };
    await db.query("update public.store_state set data=jsonb_build_object('orders',jsonb_build_object('old-order',$1::jsonb)) where id=true", [JSON.stringify(oldOrder)]);
    await db.query("update public.marketplace_billing_state set data=jsonb_set(data,'{subscriptions}',jsonb_build_object('old-subscription',$1::jsonb)) where id=true", [JSON.stringify(oldSubscription)]);
    await db.exec(renderMarketplaceSql('upgrade', projectRoot));
    assert.deepEqual((await db.query<{ item: any }>("select data #> '{orders,old-order}' as item from public.store_state where id=true")).rows[0].item, oldOrder);
    assert.deepEqual((await db.query<{ item: any }>("select data #> '{subscriptions,old-subscription}' as item from public.marketplace_billing_state where id=true")).rows[0].item, oldSubscription);
    await db.exec('set role anon');
    await assert.rejects(db.query("select public.marketplace_setup_status()"), /permission denied/);
  } finally { await db.close(); }
});
