import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { supabaseCredentials, isSupabaseAdminConfigured, isSupabaseAuthConfigured, supabaseAdmin, supabaseAuth } from './supabase';
import { cashfreeConfig } from './cashfree';
import { easebuzzConfig } from './easebuzz';
import { gatewayReadiness } from './gatewayControl';
import { updatePasswordWithBearer } from './supabaseRecovery';
import { offlineSetupChecks, onlineSetupChecks, setupChecksPass } from './setupChecks';

const names = ['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','POSTGRES_PASSWORD','CASHFREE_APP_ID','CASHFREE_SECRET_KEY','CASHFREE_ENV','EASEBUZZ_KEY','EASEBUZZ_SALT','EASEBUZZ_ENV','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET','APP_URL','VITE_SITE_URL','MARKETPLACE_ENCRYPTION_KEY','CRON_SECRET','RESEND_API_KEY','RESEND_FROM_EMAIL'];
function fixture(context: any) {
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  context.after(() => { for (const [name, value] of Object.entries(before)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
  Object.assign(process.env, { SUPABASE_URL: 'https://newkeys.synthetic.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_synthetic_private', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_public' });
}

test('modern integration keys authorize server SDK, recovery and gateway readiness without a PostgreSQL password', async context => {
  fixture(context);
  Object.assign(process.env, { CASHFREE_APP_ID: 'synthetic-app', CASHFREE_SECRET_KEY: 'synthetic-cf', CASHFREE_ENV: 'sandbox', EASEBUZZ_KEY: 'synthetic-eb', EASEBUZZ_SALT: 'synthetic-eb-salt', EASEBUZZ_ENV: 'test' });
  assert.equal(process.env.POSTGRES_PASSWORD, undefined);
  assert.equal(isSupabaseAdminConfigured(), true); assert.equal(isSupabaseAuthConfigured(), true);
  assert.equal(cashfreeConfig().configured, true); assert.equal(easebuzzConfig().configured, true); assert.equal(gatewayReadiness('cashfree').configured, true);
  const seen: { path: string; key: string | null; authorization: string | null }[] = [];
  context.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = new URL(String(input?.url || input)), headers = new Headers(init?.headers);
    assert.equal(url.origin, 'https://newkeys.synthetic.supabase.co');
    seen.push({ path: url.pathname, key: headers.get('apikey'), authorization: headers.get('authorization') });
    if (url.pathname.includes('/rest/')) return Response.json(null);
    return Response.json({ id: 'buyer', email: 'buyer@example.test' });
  });
  assert.equal((await supabaseAdmin().rpc('store_operation', { operation: 'get', key: 'settings', value: null })).error, null);
  assert.equal((await supabaseAuth().auth.getUser('synthetic-user-bearer')).error, null);
  await updatePasswordWithBearer('synthetic-recovery-bearer', 'synthetic-new-password');
  assert.equal(seen[0].key, 'sb_secret_synthetic_private');
  assert.equal(seen[1].key, 'sb_publishable_synthetic_public');
  assert.equal(seen[2].key, 'sb_publishable_synthetic_public');
  assert.equal(seen[2].authorization, 'Bearer synthetic-recovery-bearer');
});

test('legacy projects still work and missing server credentials cannot be replaced by a publishable key', context => {
  fixture(context);
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy-private'; process.env.SUPABASE_ANON_KEY = 'legacy-public';
  assert.equal(supabaseCredentials().secretKey, 'sb_secret_synthetic_private', 'current integration keys take precedence over stale legacy entries');
  delete process.env.SUPABASE_SECRET_KEY; delete process.env.SUPABASE_PUBLISHABLE_KEY;
  assert.equal(supabaseCredentials().secretKey, 'legacy-private'); assert.equal(supabaseCredentials().publishableKey, 'legacy-public');
  assert.equal(isSupabaseAdminConfigured(), true); assert.equal(isSupabaseAuthConfigured(), true);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal(isSupabaseAdminConfigured(), false); assert.equal(isSupabaseAuthConfigured(), true);
  assert.throws(supabaseAdmin, /not configured/);
});

test('setup reports redact malformed configuration and online probes never send email or contact a gateway', async context => {
  fixture(context);
  Object.assign(process.env, { APP_URL: 'https://user:private-url-secret@store.example.test', VITE_SITE_URL: 'invalid-private-url-secret', RESEND_API_KEY: 'private-resend-secret', CASHFREE_SECRET_KEY: 'private-cf-secret' });
  const offline = offlineSetupChecks();
  assert.equal(setupChecksPass(offline), false);
  assert.equal(offline.find(check => check.id === 'postgres_password')?.status, 'not_required');
  const paths: string[] = [];
  context.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = new URL(String(input?.url || input));
    assert.equal(url.origin, 'https://newkeys.synthetic.supabase.co'); paths.push(url.pathname);
    if (url.pathname.endsWith('/marketplace_setup_status')) return Response.json({ storeRpc: true, creatorRpc: true, subscriptionRpc: true, settlementRpc: false, monthlyQuotaRpc: true, monthlyQuotaEnforced: false, creatorCatalogV2: true, privateProductBucket: true, tenMbObjectLimit: true, ignoredPrivateField: 'should-not-leak' });
    if (url.pathname.endsWith('/store_operation')) { assert.equal(JSON.parse(String(init?.body)).operation, 'get'); return Response.json({ hiddenSetting: 'should-not-leak' }); }
    if (url.pathname.endsWith('/bucket/products')) return Response.json({ id: 'products', public: false });
    throw new Error('Unexpected network operation');
  });
  const online = await onlineSetupChecks();
  assert.equal(paths.length, 3);
  assert.equal(online.find(check => check.id === 'schema_settlementRpc')?.status, 'error');
  assert.equal(online.find(check => check.id === 'schema_monthlyQuotaEnforced')?.status, 'error');
  for (const secret of ['private-url-secret','private-resend-secret','private-cf-secret','sb_secret_synthetic_private','should-not-leak']) assert.ok(!JSON.stringify([...offline, ...online]).includes(secret));
});

test('setup readiness RPC is service-only and reveals boolean schema state without changing the ledger', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text,public boolean,file_size_limit bigint); insert into storage.buckets values('products',false,10485760); create table public.marketplace_billing_state(id boolean,data jsonb); insert into public.marketplace_billing_state values(true,'{\"creatorCatalogVersion\":\"2\",\"subscriptions\":{\"private\":\"not exposed\"}}');");
    await db.exec("create function public.store_operation(text,text,jsonb) returns jsonb language sql as 'select null::jsonb'; create function public.subscription_operation(text,text,jsonb) returns jsonb language sql as 'select null::jsonb'; create function public.settlement_operation(text,text,jsonb) returns jsonb language sql as 'select null::jsonb'; create function public.marketplace_claim_listing_quota(jsonb,text,text,jsonb) returns jsonb language sql as 'select null::jsonb'; create function public.marketplace_operation(text,text,jsonb) returns jsonb language plpgsql as $$begin perform public.marketplace_claim_listing_quota(null,null,null,null); return null; end$$;");
    await db.exec(readFileSync(new URL('../supabase/migrations/202610240004_setup_readiness.sql', import.meta.url), 'utf8'));
    const before = (await db.query('select data from public.marketplace_billing_state')).rows;
    const result = (await db.query<{ result: Record<string, boolean> }>('select public.marketplace_setup_status() as result')).rows[0].result;
    assert.ok(Object.values(result).every(value => value === true));
    assert.ok(!JSON.stringify(result).includes('not exposed'));
    assert.deepEqual((await db.query('select data from public.marketplace_billing_state')).rows, before);
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.marketplace_setup_status()'), /permission denied/);
    await db.exec('reset role; set role service_role');
    assert.ok((await db.query('select public.marketplace_setup_status()')).rows.length === 1);
  } finally { await db.close(); }
});
