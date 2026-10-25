import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { registerCreatorMarketplaceRoutes, getCreatorProviderDetails, updateCreatorProviderAccount, prepareCreatorOrder, fulfillCreatorOrder, annotatePlatformProducts, CREATOR_AGREEMENT } from './creatorMarketplace';
import { unseal } from './privateData';
import { Store } from './store';

async function database() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key,name text,public boolean); create table storage.objects(id text,bucket_id text);');
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/202610230001_creator_marketplace.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/202610230004_subscriptions.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/202610240002_plans.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/202610240011_creator_marketplace.sql', import.meta.url), 'utf8'));
  const call = async (fn: 'store_operation' | 'marketplace_operation' | 'subscription_operation' | 'easebuzz_order_operation', operation: string, key = '', value: any = null) => (await db.query<{ result: any }>(`select public.${fn}($1,$2,$3::jsonb) as result`, [operation, key, JSON.stringify(value)])).rows[0].result;
  return { db, store: (operation: string, key = '', value: any = null) => call('store_operation', operation, key, value), market: (operation: string, key = '', value: any = null) => call('marketplace_operation', operation, key, value), call };
}

test('marketplace database serializes slug ownership, creator quotas, listing moderation and live commission/refund ledgers', async () => {
  const { db, store, market } = await database();
  try {
    for (const role of ['anon', 'authenticated']) { await db.exec(`set role ${role}`); await assert.rejects(market('ledger_sync', 'order'), /permission denied/); await db.exec('reset role'); }
    const creatorId = `cr_${'a'.repeat(32)}`, listingId = `mk_${'b'.repeat(32)}`;
    const creator = { id: creatorId, userId: 'creator-owner', slug: 'real-creator', displayName: 'Real Creator', status: 'pending', providerAccounts: { cashfree: { reference: 'vendor_A', environment: 'live', status: 'verified' } } };
    await market('creator_create', 'creator-owner', { record: creator });
    await assert.rejects(market('creator_create', 'creator-owner', { record: { ...creator, id: `cr_${'c'.repeat(32)}`, slug: 'another-creator' } }), /already registered/);
    await assert.rejects(market('creator_create', 'other-user', { record: { ...creator, userId: 'other-user', id: `cr_${'c'.repeat(32)}` } }), /already taken/);
    const approved = { ...creator, status: 'approved' };
    await market('creator_write', creatorId, { expected: creator, record: approved });
    await assert.rejects(market('creator_write', creatorId, { expected: creator, record: { ...approved, userId: 'attacker' } }), /record changed/);
    const listing = { id: listingId, title: 'Actual digital work', sellerId: creatorId, status: 'draft', file: { uploaded: false } };
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => { const next = { ...listing, id: index === 0 ? listingId : `mk_${String(index).repeat(32)}` }; return market('listing_write', next.id, { expected: null, record: next, owner: creator.userId, limit: 1, product: next }); }));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1, 'concurrent creations cannot exceed the verified product limit');
    const actualListing = Object.values(await store('get', 'marketplace/listings'))[0] as any;
    await assert.rejects(market('listing_write', actualListing.id, { expected: actualListing, record: { ...actualListing, status: 'active' }, owner: 'attacker', limit: 1 }), /Invalid listing owner/);
    await assert.rejects(market('listing_write', actualListing.id, { expected: actualListing, record: { ...actualListing, status: 'active' }, owner: creator.userId, limit: 1 }), /not ready/);
    const activeListing = { ...actualListing, status: 'active', file: { uploaded: true, published: true } };
    await market('listing_write', actualListing.id, { expected: actualListing, record: activeListing, owner: creator.userId, limit: 1, product: { ...activeListing, file: undefined } });
    const snapshot = { sellerId: creatorId, sellerName: creator.displayName, creatorSlug: creator.slug, commissionBps: 1000, grossPaise: 10000, commissionPaise: 1000, sellerPaise: 9000, provider: 'cashfree', providerAccountId: 'vendor_A', agreementVersion: '2026-10-23' };
    const order = { id: 'sale_one', userId: 'buyer', total: 100, paymentStatus: 'PENDING', status: 'PENDING', marketplace: snapshot, items: [{ productId: actualListing.id, productTitle: 'Actual digital work', price: 100, quantity: 1 }] };
    await store('set', 'orders/sale_one', order);
    await store('bind_cashfree', 'orders/sale_one', { cashfreeOrderId: 'sale_one', cfOrderId: 'cf_sale_one', paymentProvider: 'Cashfree', paymentEnvironment: 'live' });
    await assert.rejects(market('ledger_sync', 'sale_one'), /Verified live/);
    await store('confirm_cashfree', 'orders/sale_one', { id: 'cf_payment_one', order_id: 'sale_one', amount: 10000, currency: 'INR', status: 'SUCCESS', environment: 'live' });
    await Promise.all(Array.from({ length: 10 }, () => market('ledger_sync', 'sale_one')));
    let ledger = await store('get', 'marketplace/ledger/sale_one');
    assert.equal(Object.keys(await store('get', 'marketplace/ledger')).length, 1, 'repeated webhook/reconciliation creates one sale ledger');
    assert.equal(ledger.grossPaise, 10000); assert.equal(ledger.commissionPaise, 1000); assert.equal(ledger.sellerPaise, 9000); assert.equal(ledger.payablePaise, 9000); assert.equal(ledger.settlementStatus, 'pending_provider');
    await store('record_cashfree_refund', 'orders/sale_one', { id: 'refund_one', payment_id: 'cf_payment_one', order_id: 'sale_one', amount: 2500, currency: 'INR', environment: 'live' });
    await Promise.all(Array.from({ length: 6 }, () => market('ledger_sync', 'sale_one')));
    ledger = await store('get', 'marketplace/ledger/sale_one'); assert.equal(ledger.refundedPaise, 2500); assert.equal(ledger.refundSellerPaise, 2250); assert.equal(ledger.payablePaise, 6750);
    await store('update', 'orders/sale_one', { refundedAmount: 0 }); await market('ledger_sync', 'sale_one'); assert.equal((await store('get', 'marketplace/ledger/sale_one')).refundedPaise, 2500, 'late stale refund snapshots cannot restore seller funds');
    const verified = await store('get', 'orders/sale_one');
    await store('set', 'orders/duplicate_credit', { ...verified, id: 'duplicate_credit' });
    await assert.rejects(market('ledger_sync', 'duplicate_credit'), /already credited/);
    await store('update', 'orders/sale_one', { disputes: { open: { status: 'OPEN' } } }); await market('ledger_sync', 'sale_one'); ledger = await store('get', 'marketplace/ledger/sale_one'); assert.equal(ledger.settlementStatus, 'review_required'); assert.equal(ledger.payablePaise, 0);
    await store('update', 'orders/sale_one', { marketplace: { ...snapshot, commissionPaise: 2, sellerPaise: 9998 } }); await assert.rejects(market('ledger_sync', 'sale_one'), /snapshot mismatch/);
    await store('update', 'orders/sale_one', { marketplace: { ...snapshot, grossPaise: undefined } }); await assert.rejects(market('ledger_sync', 'sale_one'), /snapshot mismatch/);
    await store('set', 'orders/test_sale', { ...verified, id: 'test_sale', paymentEnvironment: 'test' }); assert.equal(await market('ledger_sync', 'test_sale'), null);
    await market('creator_write', creatorId, { expected: approved, record: { ...approved, status: 'suspended' } }); assert.equal(await store('get', `products/${actualListing.id}`), null, 'suspension withdraws new public offers');
    assert.equal((await store('get', `marketplace/listings/${actualListing.id}`)).file.published, true, 'suspension retains private-file entitlement metadata');
    await market('creator_write', creatorId, { expected: { ...approved, status: 'suspended' }, record: approved }); assert.ok(await store('get', `products/${actualListing.id}`), 'approved unsuspension restores reviewed listings');
  } finally { await db.close(); }
});

test('creator routes enforce sessions, ownership and moderation while keeping KYC and private files out of every safe DTO', async t => {
  const { db, call, store } = await database();
  await db.exec(readFileSync(new URL('../supabase/migrations/202610230004_subscriptions.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, encryption: process.env.MARKETPLACE_ENCRYPTION_KEY };
  process.env.SUPABASE_URL = 'https://market.synthetic.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-role'; process.env.MARKETPLACE_ENCRYPTION_KEY = Buffer.alloc(32, 71).toString('base64');
  t.after(() => { for (const [name, value] of [['SUPABASE_URL', previous.url], ['SUPABASE_SERVICE_ROLE_KEY', previous.key], ['MARKETPLACE_ENCRYPTION_KEY', previous.encryption]]) { if (value === undefined) delete process.env[name!]; else process.env[name!] = value; } });
  const reserveKeys = ['RAZORPAY_ROUTE_APPROVED','RAZORPAY_RESERVES_APPROVED','RAZORPAY_RESERVE_CONTRACT_REFERENCE'];
  const reservesBefore = Object.fromEntries(reserveKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { RAZORPAY_ROUTE_APPROVED: 'true', RAZORPAY_RESERVES_APPROVED: 'true', RAZORPAY_RESERVE_CONTRACT_REFERENCE: 'provider-contract-fixture' });
  t.after(() => { for (const [key,value] of Object.entries(reservesBefore)) if(value===undefined)delete process.env[key];else process.env[key]=value; });
  const nativeFetch = globalThis.fetch, files = new Map<string, Uint8Array>(); let storageCalls = 0;
  globalThis.fetch = async (input: any, init?: any) => {
    const url = new URL(String(input?.url || input));
    if (url.origin !== 'https://market.synthetic.supabase.co') return nativeFetch(input, init);
    const fn = url.pathname.split('/rpc/')[1];
    if (fn) { const body = JSON.parse(init.body); try { return Response.json(await call(fn as any, body.operation, body.key, body.value)); } catch (error) { return Response.json({ message: (error as Error).message }, { status: 400 }); } }
    storageCalls++;
    const path = decodeURIComponent(url.pathname.split('/products/')[1] || '');
    if (url.pathname.startsWith('/storage/v1/object/upload/sign/products/')) {
      if (init?.method === 'POST') return Response.json({ url: url.pathname.replace('/storage/v1', '') + '?token=synthetic-upload-token' });
      if (init?.method === 'PUT') { files.set(path, new Uint8Array(await new Response(init.body).arrayBuffer())); return Response.json({ Key: path }); }
    }
    if (url.pathname === '/storage/v1/object/products' && init?.method === 'DELETE') { const body = JSON.parse(init.body); for (const prefix of body.prefixes) files.delete(prefix); return Response.json([]); }
    if (url.pathname.startsWith('/storage/v1/object/products/') && init?.method !== 'POST') return files.has(path) ? new Response(new Uint8Array(files.get(path)!)) : Response.json({ message: 'Not found' }, { status: 404 });
    if (url.pathname.startsWith('/storage/v1/object/info/products/')) return files.has(path) ? Response.json({ name: path, size: files.get(path)!.byteLength }) : Response.json({ message: 'Not found' }, { status: 404 });
    if (url.pathname.startsWith('/storage/v1/object/sign/products/') && init?.method === 'POST') return Response.json({ signedURL: url.pathname.replace('/storage/v1', '') + '?token=private-synthetic-token' });
    if (url.pathname.startsWith('/storage/v1/object/sign/products/')) return new Response(files.has(path) ? new Uint8Array(files.get(path)!).buffer : null, { status: files.has(path) ? 206 : 404 });
    if (url.pathname === '/storage/v1/object/copy') { const body = JSON.parse(init.body); if (!files.has(body.sourceKey) || files.has(body.destinationKey)) return Response.json({ message: 'Conflict' }, { status: 409 }); files.set(body.destinationKey, files.get(body.sourceKey)!); return Response.json({ Key: body.destinationKey }); }
    if (url.pathname.startsWith('/storage/v1/object/products/')) { const body = init.body instanceof Blob ? new Uint8Array(await init.body.arrayBuffer()) : new Uint8Array(init.body); files.set(path, body); return Response.json({ Key: path }); }
    throw new Error(`Unexpected synthetic storage request: ${url.pathname}`);
  };
  t.after(() => { globalThis.fetch = nativeFetch; });
  const app = express(); app.use(express.json());
  const auth: any = (req: any, res: any, next: any) => { if (!req.get('x-user')) return res.status(401).json({ success: false }); req.userId = req.get('x-user'); next(); };
  const admin: any = (req: any, res: any, next: any) => req.userId === 'admin' ? next() : res.status(403).json({ success: false });
  registerCreatorMarketplaceRoutes(app, auth, admin, (_req, _res, next) => next());
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/marketplace`;
  const request = async (path: string, user = 'owner', method = 'GET', body?: any) => nativeFetch(base + path, { method, headers: { ...(user ? { 'x-user': user } : {}), ...(body === undefined || body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
  assert.equal((await request('/me', '')).status, 401); assert.equal((await request('/admin/creators', 'owner')).status, 403);
  const publicBusiness = { businessName: 'Creator Trading Name', businessAddress: 'Public business address, Varanasi, Uttar Pradesh, 221003', supportEmail: 'support@creator.example.com', supportPhone: '9876543210', grievanceName: 'Creator Grievance Contact', publishConsent: true };
  const onboarding = { displayName: 'Real Creator', slug: 'real-creator', headline: 'Original digital work', bio: 'Templates designed by an independent creator.', legalName: 'Private Legal Name', pan: 'ABCDE1234F', kycConsent: true, phone: '9876543210', adult: true, ownsRights: true, acceptAgreement: true, agreementVersion: CREATOR_AGREEMENT.version, publicBusiness };
  assert.equal((await request('/me', 'owner', 'POST', { ...onboarding, agreementVersion: 'stale-version' })).status, 400, 'a stale form cannot silently accept changed terms');
  assert.equal((await request('/me', 'owner', 'POST', { ...onboarding, status: 'approved' })).status, 400);
  const createdResponse = await request('/me', 'owner', 'POST', onboarding); assert.equal(createdResponse.status, 201); const creator = (await createdResponse.json()).creator;
  const acceptance = (await store('get', `marketplace/creators/${creator.id}`)).agreementAcceptance;
  assert.equal(acceptance.userId, 'owner'); assert.equal(acceptance.hash, CREATOR_AGREEMENT.hash); assert.ok(acceptance.acceptedAt); assert.ok(await store('get', `marketplace/agreementSnapshots/${creator.agreementVersion}`));
  const acceptedCreator = await store('get', `marketplace/creators/${creator.id}`);
  await assert.rejects(call('marketplace_operation', 'creator_write', creator.id, { expected: acceptedCreator, record: { ...acceptedCreator, agreementAcceptance: { ...acceptance, hash: '0'.repeat(64) } } }), /agreement acceptance immutable/);
  assert.equal((await request(`/admin/creators/${creator.id}/agreement`, 'owner')).status, 403);
  const agreementExport = await (await request(`/admin/creators/${creator.id}/agreement`, 'admin')).json(); assert.equal(agreementExport.verifiedRecord, true); assert.equal(agreementExport.acceptance.hash, acceptance.hash);
  assert.equal((await request('/me/agreement', 'owner', 'POST', { agreementVersion: 'stale', acceptAgreement: true })).status, 400);
  const repeatedAcceptance = await request('/me/agreement', 'owner', 'POST', { agreementVersion: CREATOR_AGREEMENT.version, acceptAgreement: true });
  assert.equal(repeatedAcceptance.status, 200); assert.equal((await repeatedAcceptance.json()).creator.agreementAcceptedAt, acceptance.acceptedAt, 'retrying assent preserves the original acceptance record');
  const kyc = { legalName: 'Private Legal Name', pan: 'ABCDE1234F', accountHolder: 'Private Legal Name', bankAccount: '123456789012', ifsc: 'SBIN0001234', address: { line1: 'Private address line', city: 'Varanasi', state: 'Uttar Pradesh', postalCode: '221003', country: 'IN' }, consent: true };
  const kycResponse = await request('/me/kyc', 'owner', 'POST', kyc); assert.equal(kycResponse.status, 200); const kycText = await kycResponse.text(); assert.ok(!kycText.includes(kyc.pan)); assert.ok(!kycText.includes(kyc.bankAccount)); assert.ok(!kycText.includes(kyc.address.line1));
  const stored = await store('get', `marketplace/creators/${creator.id}`); assert.ok(!JSON.stringify(stored).includes(kyc.bankAccount)); assert.equal(unseal<any>(stored.encryptedKyc, `creator-kyc:${creator.id}`).pan, kyc.pan);
  const moderation = await request(`/admin/creators/${creator.id}`, 'admin', 'PATCH', { action: 'approve', reason: 'Reviewed the creator ownership profile' }); assert.equal(moderation.status, 200); assert.deepEqual((await moderation.json()).creator.providerAccounts, {}, 'moderation is not payment-provider KYC');
  await updateCreatorProviderAccount(creator.id, 'razorpay', { reference: 'acc_test1', status: 'verified', environment: 'live', providerVerifiedAt: new Date().toISOString(), providerStatus: 'activated:acc_prd_1234' });
  assert.equal((await getCreatorProviderDetails(creator.id, 'razorpay'))?.account?.providerStatus, 'activated:acc_prd_1234');
  const safeText = await (await request('/me')).text(); assert.ok(!safeText.includes('acc_test1')); assert.ok(!safeText.includes('acc_prd_')); assert.ok(!safeText.includes('encryptedKyc')); assert.ok(!safeText.includes('agreementAcceptance'));
  assert.equal((await request('/me/kyc', 'owner', 'POST', kyc)).status, 409, 'bank identity bound to real provider cannot silently change');
  // A server-verified live period is required; a free profile is not a paid publishing plan.
  const periodStart = new Date(Date.now() - 60_000).toISOString(), periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  const creatorPlan = { id: 'creator_monthly_499', name: 'Creator', audience: 'creator', amount: 499, currency: 'INR', interval: 'month', billingMode: 'manual', productLimit: 10, productQuota: 'billing_period_creations' };
  const paidSubscription = { id: 'sub_creator_fixture', userId: 'owner', plan: creatorPlan, provider: 'razorpay', environment: 'live', providerRef: 'order_creator_fixture', lastCheckedAt: new Date().toISOString(), payments: { pay_creator_fixture: { id: 'pay_creator_fixture', verified: true, revoked: false, subscriptionRef: 'order_creator_fixture', currency: 'INR', amountPaise: 49900, periodStart, periodEnd } } };
  await db.query("update public.marketplace_billing_state set data=jsonb_set(data,'{subscriptions}', $1::jsonb) where id=true", [JSON.stringify({ sub_creator_fixture: paidSubscription })]);
  const product = { title: 'Original Portfolio', shortDescription: 'A useful original portfolio template.', description: 'An original portfolio template with clear setup instructions and source files included.', category: 'Website templates', price: 99, image: 'https://images.example.com/portfolio.webp', features: ['Responsive'], whatsIncluded: ['Source ZIP'], tags: ['portfolio'], version: '1.0', requirements: 'Node 22\nA code editor', licenseTerms: 'Use for one project. Redistribution is prohibited.', membershipEligible: false, ownsRights: true };
  const createListing = await request('/me/listings', 'owner', 'POST', product); assert.equal(createListing.status, 201); let listing = (await createListing.json()).listing; assert.deepEqual(listing.requirements, ['Node 22', 'A code editor']);
  await store('update', `marketplace/listings/${listing.id}`, { gallery: ['https://images.example.com/keep.webp'], tags: ['keep-tag'], version: '7.0', membershipEligible: true });
  const titleOnly = await request(`/me/listings/${listing.id}`, 'owner', 'PATCH', { title: 'Updated original portfolio' });
  assert.equal(titleOnly.status, 200);
  const patched = (await titleOnly.json()).listing;
  assert.deepEqual(patched.gallery, ['https://images.example.com/keep.webp']); assert.deepEqual(patched.tags, ['keep-tag']);
  assert.equal(patched.version, '7.0'); assert.equal(patched.membershipEligible, true); assert.deepEqual(patched.requirements, ['Node 22', 'A code editor']);
  await store('update', `marketplace/listings/${listing.id}`, { membershipEligible: false });
  assert.equal((await request(`/me/listings/${listing.id}`, 'attacker', 'PATCH', { title: 'Stolen product' })).status, 403);
  assert.equal((await request(`/me/listings/${listing.id}/submit`, 'owner', 'POST', {})).status, 409);
  const archive = await request(`/me/listings/${listing.id}/archive`, 'owner', 'POST', {}); assert.equal(archive.status, 200); assert.equal((await archive.json()).listing.status, 'archived');
  const unarchive = await request(`/me/listings/${listing.id}`, 'owner', 'PATCH', { title: product.title }); assert.equal(unarchive.status, 200);
  assert.equal((await request(`/me/listings/${listing.id}/upload-intent`, 'attacker', 'POST', { fileName: 'direct.zip', size: 5 * 1024 * 1024 })).status, 403);
  assert.equal((await request(`/me/listings/${listing.id}/upload-intent`, 'owner', 'POST', { fileName: 'direct.zip', size: 10 * 1024 * 1024 + 1 })).status, 400);
  const directIntent = await request(`/me/listings/${listing.id}/upload-intent`, 'owner', 'POST', { fileName: 'direct.zip', size: 5 * 1024 * 1024 });
  assert.equal(directIntent.status, 200); const ticket = await directIntent.json();
  assert.ok(ticket.uploadUrl.startsWith('https://market.synthetic.supabase.co/storage/v1/object/upload/sign/products/_creators/'));
  assert.equal((await request(`/me/listings/${listing.id}/upload-complete`, 'owner', 'POST', { uploadId: ticket.uploadId })).status, 409, 'finalization cannot grant a missing object');
  const directBytes = new Uint8Array(5 * 1024 * 1024); directBytes.set([0x50, 0x4b, 3, 4]);
  await globalThis.fetch(ticket.uploadUrl, { method: 'PUT', body: directBytes });
  const directComplete = await request(`/me/listings/${listing.id}/upload-complete`, 'owner', 'POST', { uploadId: ticket.uploadId });
  assert.equal(directComplete.status, 200); const directListing = (await directComplete.json()).listing;
  assert.equal(directListing.file.size, directBytes.length); assert.equal(directListing.file.uploaded, true); assert.equal(directListing.file.published, false);
  assert.ok(!JSON.stringify(directListing).includes('_creators/')); assert.ok(!JSON.stringify(directListing).includes('sha256'));
  const directRetry = await request(`/me/listings/${listing.id}/upload-complete`, 'owner', 'POST', { uploadId: ticket.uploadId });
  assert.equal(directRetry.status, 200); assert.equal((await directRetry.json()).duplicate, true);
  const bytes = new Uint8Array(22); bytes.set([0x50, 0x4b, 3, 4]);
  const zip = new FormData(); zip.append('file', new Blob([bytes], { type: 'application/zip' }), 'original.zip');
  const uploaded = await request(`/me/listings/${listing.id}/upload`, 'owner', 'POST', zip); assert.equal(uploaded.status, 200); const uploadedText = await uploaded.text(); assert.ok(!uploadedText.includes('_creators/')); assert.ok(!uploadedText.includes('sha256'));
  assert.equal((await request(`/me/listings/${listing.id}/submit`, 'owner', 'POST', {})).status, 200);
  assert.equal((await request(`/admin/listings/${listing.id}/review-file`, 'owner')).status, 403);
  assert.equal((await request(`/admin/listings/${listing.id}/review-file`, 'admin')).status, 200);
  assert.equal((await request(`/admin/listings/${listing.id}`, 'admin', 'PATCH', { action: 'approve', reason: 'Reviewed the complete original archive' })).status, 409, 'approval requires explicit archive review');
  const published = await request(`/admin/listings/${listing.id}`, 'admin', 'PATCH', { action: 'approve', reason: 'Reviewed the complete original archive', reviewed: true }); assert.equal(published.status, 200); listing = (await published.json()).listing; assert.equal(listing.status, 'active'); assert.equal(listing.file.published, true); assert.ok(files.has(`${listing.id}.zip`), 'reviewed ZIP is physically copied to the private paid path');
  const replacement = new FormData(); replacement.append('file', new Blob([bytes]), 'replacement.zip'); assert.equal((await request(`/me/listings/${listing.id}/upload`, 'owner', 'POST', replacement)).status, 409, 'published buyer files remain immutable');
  const snapshot = await prepareCreatorOrder([{ productId: listing.id, quantity: 1 }], 'razorpay', 9900); assert.equal(snapshot?.sellerId, creator.id); assert.equal(snapshot?.grossPaise, 9900); assert.equal(snapshot?.commissionPaise, 2000); assert.equal(snapshot?.sellerPaise, 7900);
  const storefront = await (await request('/creators/real-creator', '')).text(); assert.ok(storefront.includes(product.title)); assert.ok(storefront.includes(publicBusiness.businessName)); assert.ok(storefront.includes(publicBusiness.supportEmail)); assert.ok(!storefront.includes('_creators/')); assert.ok(!storefront.includes('providerAccountId')); assert.ok(!storefront.includes('sha256')); assert.ok(!storefront.includes('publishConsent'));
  await store('set', 'orders/owner_sale', { id: 'owner_sale', total: 99, paymentStatus: 'PENDING', marketplace: snapshot, customerEmail: 'private-buyer@example.com', customerName: 'Private Buyer', items: [{ productId: listing.id, productTitle: product.title, price: 99 }] });
  await store('set', 'orders/other_sale', { id: 'other_sale', total: 55, marketplace: { sellerId: 'another_creator' }, customerEmail: 'other-buyer@example.com', items: [] });
  const ownerDashboard = await (await request('/me')).json(); assert.equal(ownerDashboard.orders.length, 1); assert.equal(ownerDashboard.orders[0].id, 'owner_sale'); assert.ok(!JSON.stringify(ownerDashboard.orders).includes('private-buyer@example.com')); assert.ok(!JSON.stringify(ownerDashboard.orders).includes('providerAccountId'));
  const company = annotatePlatformProducts([{ id: 'first', status: 'active' } as any])[0]; assert.equal(company.sellerId, 'booyahstudio');
  const text = await (await request('/creators', '')).text(); assert.ok(!text.includes('userId')); assert.ok(!text.includes('panLast4')); assert.ok(!text.includes('bankLast4'));
  const withoutDisclosure = await request('/me', 'another-owner', 'POST', { ...onboarding, slug: 'missing-disclosures', publicBusiness: undefined });
  assert.equal(withoutDisclosure.status, 201); const otherCreator = (await withoutDisclosure.json()).creator;
  assert.equal((await request(`/admin/creators/${otherCreator.id}`, 'admin', 'PATCH', { action: 'approve', reason: 'Creator has not provided public business contact details' })).status, 409, 'profile approval requires explicit public seller disclosures');
  const businessUpdate = await request('/me', 'owner', 'PATCH', { publicBusiness: { ...publicBusiness, supportEmail: 'updated@creator.example.com' } });
  assert.equal(businessUpdate.status, 200); assert.equal((await businessUpdate.json()).creator.status, 'pending', 'changed seller disclosures require renewed moderator review');
  assert.equal((await request('/creators/real-creator', '')).status, 404);
  assert.ok(await store('get', 'orders/owner_sale'), 'public disclosure review never deletes an existing buyer order');
  assert.ok(files.has(`${listing.id}.zip`), 'new-sales review never removes the valid purchased ZIP');
  await assert.rejects(prepareCreatorOrder([{ productId: listing.id }], 'razorpay', 9900), /no longer available|not currently accepting/);
  assert.equal(await fulfillCreatorOrder({ id: 'company_order' }), null); assert.ok(storageCalls > 0, 'reviewed publication performed actual private storage operations');
});

test('public company marketplace browsing works without database credentials and does not fabricate creator records', async t => {
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  t.after(() => { for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; });
  t.mock.method(Store, 'get', async () => { throw new Error('Public no-database browsing must not access a private store'); });
  const app = express();
  registerCreatorMarketplaceRoutes(app, (_req, res) => { res.status(401).json({ success: false }); }, (_req, res) => { res.status(403).json({ success: false }); }, (_req, _res, next) => next());
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/marketplace`;
  const config = await fetch(base + '/config'); assert.equal(config.status, 200); assert.equal((await config.json()).settings.acceptingCreators, false);
  const directory = await (await fetch(base + '/creators')).json(); assert.equal(directory.creators.length, 1); assert.equal(directory.creators[0].id, 'booyahstudio');
  const company = await (await fetch(base + '/creators/booyahstudio')).json(); assert.equal(company.products.length, 25); assert.ok(company.products.every((product: any) => product.sellerId === 'booyahstudio'));
  assert.equal((await fetch(base + '/creators/nonexistent-creator')).status, 404);
});

test('creator ledgers accept exact Razorpay and Easebuzz canonical proofs and preserve dispute/refund restrictions', async () => {
  const { db, store, market, call } = await database();
  try {
    await db.exec(readFileSync(new URL('../supabase/migrations/202610230003_easebuzz.sql', import.meta.url), 'utf8'));
    const creatorId = `cr_${'d'.repeat(32)}`, listingId = `mk_${'e'.repeat(32)}`;
    const creator = { id: creatorId, userId: 'publisher', slug: 'another-publisher', displayName: 'Publisher', status: 'pending', providerAccounts: { razorpay: { reference: 'acc_seller', environment: 'live', status: 'verified' }, easebuzz: { reference: 'provider_label', environment: 'live', status: 'verified' } } };
    await market('creator_create', creator.userId, { record: creator });
    await market('creator_write', creatorId, { expected: creator, record: { ...creator, status: 'approved' } });
    const listing = { id: listingId, title: 'Original archive', sellerId: creatorId, status: 'active', file: { uploaded: true, published: true } };
    await market('listing_write', listingId, { expected: null, record: listing, owner: creator.userId, limit: 5, product: { ...listing, file: undefined } });
    const sale = (provider: string, reference: string) => ({ id: `sale_${provider}`, userId: 'buyer', total: 100, paymentStatus: 'PENDING', status: 'PENDING', items: [{ productId: listingId, productTitle: listing.title, price: 100, quantity: 1 }], marketplace: { sellerId: creatorId, sellerName: creator.displayName, creatorSlug: creator.slug, commissionBps: 1000, grossPaise: 10000, commissionPaise: 1000, sellerPaise: 9000, provider, providerAccountId: reference, agreementVersion: 'test' } });
    await store('set', 'orders/sale_razorpay', sale('razorpay', 'acc_seller'));
    await store('bind_payment', 'orders/sale_razorpay', { razorpayOrderId: 'order_sale', paymentProvider: 'Razorpay', paymentEnvironment: 'live' });
    await store('confirm_payment', 'orders/sale_razorpay', { id: 'pay_sale', order_id: 'order_sale', amount: 10000, currency: 'INR', status: 'captured', amount_refunded: 0, environment: 'live' });
    assert.equal((await market('ledger_sync', 'sale_razorpay')).payablePaise, 9000);
    const flat = { ...sale('razorpay', 'acc_seller'), id: 'historical_flat', marketplace: { ...sale('razorpay', 'acc_seller').marketplace, commissionModel: 'flat_per_item', commissionPerItemPaise: 2000, itemCount: 1, commissionBps: 0, commissionPaise: 2000, sellerPaise: 8000 } };
    await store('set', 'orders/historical_flat', flat);
    await store('bind_payment', 'orders/historical_flat', { razorpayOrderId: 'order_flat', paymentProvider: 'Razorpay', paymentEnvironment: 'live' });
    await store('confirm_payment', 'orders/historical_flat', { id: 'pay_flat', order_id: 'order_flat', amount: 10000, currency: 'INR', status: 'captured', amount_refunded: 0, environment: 'live' });
    assert.equal((await market('ledger_sync', 'historical_flat')).payablePaise, 8000, 'the published flat_per_item contract remains valid after upgrade');
    assert.equal((await store('get', 'orders/historical_flat')).marketplace.commissionModel, 'flat_per_item', 'historical snapshots are never rewritten');
    await store('record_dispute', 'orders/sale_razorpay', { id: 'disp_sale', payment_id: 'pay_sale', amount: 10000, currency: 'INR', status: 'open' });
    assert.equal((await market('ledger_sync', 'sale_razorpay')).payablePaise, 0, 'open provider disputes block payable earnings without claiming a bank hold');
    await store('record_dispute', 'orders/sale_razorpay', { id: 'disp_sale', payment_id: 'pay_sale', amount: 10000, currency: 'INR', status: 'won' });
    assert.equal((await market('ledger_sync', 'sale_razorpay')).payablePaise, 9000);
    await store('confirm_payment', 'orders/sale_razorpay', { id: 'pay_sale', order_id: 'order_sale', amount: 10000, currency: 'INR', status: 'refunded', amount_refunded: 10000, environment: 'live' });
    assert.equal((await market('ledger_sync', 'sale_razorpay')).payablePaise, 0, 'a confirmed full refund removes the seller allocation');
    await store('set', 'orders/sale_easebuzz', sale('easebuzz', 'provider_label'));
    await call('easebuzz_order_operation', 'bind', 'sale_easebuzz', { txnid: 'sale_easebuzz', environment: 'live', amountPaise: 10000, policyVersion: 'test', policyAcceptedAt: new Date().toISOString() });
    await call('easebuzz_order_operation', 'confirm', 'sale_easebuzz', { txnid: 'sale_easebuzz', id: 'eb_sale', amount: 10000, currency: 'INR', status: 'success', environment: 'live', refundedPaise: 0 });
    assert.equal((await market('ledger_sync', 'sale_easebuzz')).payablePaise, 9000, 'Easebuzz uses its exact txnid proof rather than a Razorpay order_id');
    await store('update', 'orders/sale_easebuzz', { providerRefundReviewRequired: true, deliveryStatus: 'REVOKED' });
    assert.equal((await market('ledger_sync', 'sale_easebuzz')).payablePaise, 0, 'uncertain provider refund state remains restricted');
  } finally { await db.close(); }
});
