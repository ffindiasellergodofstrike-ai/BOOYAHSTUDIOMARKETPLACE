import crypto from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { Store } from './store';
import { supabaseAdmin } from './supabase';
import { seal, unseal } from './privateData';
import { verifyStagedZipHeader } from './adminManagement';
import type { Product } from '../src/types';
import type { CreatorProfile, CreatorListing, CreatorOrderSnapshot, CreatorSummary, MarketplaceGateway, PublicCreator } from '../src/types/marketplace';
import { policyDocuments, policyVersion } from './policies';
import { BUSINESS } from '../src/config/business';
import { PRODUCTS } from '../src/data/products';

const creatorAgreementContent = {
  title: `${BUSINESS.name} Creator Agreement`, terms: [
    'You must be at least 18 and provide accurate identity, ownership, bank and tax information. Publishing approval does not constitute payment-provider KYC or settlement approval.',
    `Publish only original digital work you own or have permission to distribute. You retain ownership; you grant ${BUSINESS.name} permission to display, sell and privately deliver the listed work to entitled customers.`,
    'You may upload one ZIP archive of up to 10 MB to the private Supabase Storage products bucket, or provide a direct HTTPS download link that you control. External links must be accessible to buyers after purchase, free of passwords or misleading redirects, and must not contain personal or confidential information. External hosts may expose or revoke their links; do not use them for files requiring private access.',
    'Do not list illegal goods or services, stolen or counterfeit goods, pirated or infringing files, malware, credential theft tools, personal data, deceptive schemes, unauthorized financial or investment products, gambling, weapons, controlled substances, explicit sexual exploitation, or content restricted by law or a payment provider. Provider-specific prohibited-business rules also apply and may change; review current Cashfree, Razorpay and Easebuzz requirements before listing.',
    'The platform fee for creator product sales is a flat ₹20 per product item, deducted from the verified order proceeds and recorded per order. Paid plan fees are separate. Provider charges, applicable taxes and verified refunds may affect final proceeds.',
    'Our target is to release eligible seller proceeds on T+3 after the payment is received and cleared, with a three-day dispute and complaint review hold. This is subject to the provider settlement schedule, account verification, reserves, legal requirements and open disputes; the earnings ledger is not proof of bank settlement.',
    'If an account is suspended for excessive chargebacks, fraud, legal complaints or serious policy violations, funds may be reserved for up to 120 days, where legally permitted, while disputes and liabilities are reviewed. After resolution, any verified remaining balance is released to the registered bank account, subject to provider processing and lawful deductions.',
    'Customers retain access to completed purchases according to the product licence. Routine change-of-mind refunds are unavailable after digital delivery; duplicate charges, failed delivery, materially incorrect products and legal rights are reviewed by support.',
    'Paid creator plans and customer memberships have separate prices, paid periods and cancellation terms. A plan purchase does not guarantee sales or provider approval.',
    'Accounts may be suspended and offers removed for violations, fraud or provider risk requirements. Valid buyer access and legally required records may be retained after withdrawal.'
  ]
};
const fullCreatorAgreement = policyDocuments.find(document => document.slug === 'creator-agreement');
const agreementSnapshot = { displayed: creatorAgreementContent, document: fullCreatorAgreement, policyVersion };
const agreementHash = crypto.createHash('sha256').update(JSON.stringify(agreementSnapshot)).digest('hex');
export const CREATOR_AGREEMENT = { ...creatorAgreementContent, version: `2026-10-23-${agreementHash.slice(0, 16)}`, url: '/policies/creator-agreement', hash: agreementHash };
export const MARKETPLACE_CATEGORIES = ['Website templates', 'Source code', 'Scripts', 'UI kits', 'Design assets', 'Documentation'];
export const CREATOR_COMMISSION_PER_ITEM_PAISE = 2000;
export const CREATOR_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
export const COMPANY_CREATOR: PublicCreator = { id: 'booyahstudio', slug: 'booyahstudio', displayName: BUSINESS.name, headline: `Original digital products, made by ${BUSINESS.name}.`, bio: `Explore the original ${BUSINESS.name} collection of templates, code and digital resources.`, isPlatform: true, publicBusiness: { businessName: BUSINESS.owner, businessAddress: BUSINESS.address, supportEmail: BUSINESS.email, supportPhone: BUSINESS.phone, grievanceName: BUSINESS.owner } };

type InternalCreator = Omit<CreatorProfile, 'providerAccounts' | 'publicBusiness'> & { publicBusiness?: CreatorProfile['publicBusiness'] & { publishConsent: true }; encryptedIdentity?: string; encryptedKyc?: string; suspendedAt?: string; agreementAcceptance?: { userId: string; acceptedAt: string; version: string; hash: string; policyVersion: string; ip: string; userAgent: string }; providerAccounts: Partial<Record<MarketplaceGateway, NonNullable<CreatorProfile['providerAccounts'][MarketplaceGateway]> & { providerStatus?: string }>> };
type InternalListing = CreatorListing & { externalFileUrl?: string | null; file: CreatorListing['file'] & { stagingPath?: string; published?: boolean; sha256?: string }; revision: number };
class MarketplaceError extends Error { constructor(public status: number, message: string) { super(message); this.name = 'MarketplaceError'; } }
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID().replaceAll('-', '');
const gateways: MarketplaceGateway[] = ['cashfree', 'razorpay', 'easebuzz'];
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const reason = z.string().trim().min(10).max(1000);
const plain = (min: number, max: number) => z.string().trim().min(min).max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v));
const publicUrl = z.string().trim().url().max(2000).refine(v => new URL(v).protocol === 'https:' && !new URL(v).username && !new URL(v).password, 'Use a public HTTPS URL.');
const publicBusinessSchema = z.object({ businessName: plain(2, 120), businessAddress: plain(10, 600), supportEmail: z.string().trim().email().max(254), supportPhone: z.string().trim().regex(/^\+?91[6-9]\d{9}$|^[6-9]\d{9}$/), grievanceName: plain(2, 120), publishConsent: z.literal(true) }).strict();
const slugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,49}$/).refine(v => !['booyahstudio', 'admin', 'api', 'creator', 'creators', 'login', 'signup', 'support', 'checkout'].includes(v));
const profileSchema = z.object({ displayName: plain(2, 80), slug: slugSchema, headline: plain(0, 160).default(''), bio: plain(0, 3000).default(''), avatarUrl: publicUrl.optional(), publicBusiness: publicBusinessSchema.optional() });
const onboardingSchema = profileSchema.extend({ legalName: plain(2, 120), phone: z.string().regex(/^\+?91[6-9]\d{9}$|^[6-9]\d{9}$/), adult: z.literal(true), ownsRights: z.literal(true), acceptAgreement: z.literal(true), agreementVersion: z.literal(CREATOR_AGREEMENT.version) }).strict();
const kycSchema = z.object({ legalName: plain(2, 120), pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/), accountHolder: plain(2, 120), bankAccount: z.string().trim().regex(/^\d{9,18}$/), ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), address: z.object({ line1: plain(5, 300), city: plain(2, 100), state: plain(2, 100), postalCode: z.string().regex(/^[1-9]\d{5}$/), country: z.literal('IN') }).strict(), consent: z.literal(true) }).strict();
const listingSchema = z.object({ title: plain(3, 140), shortDescription: plain(20, 400), description: plain(50, 15000), category: z.enum(MARKETPLACE_CATEGORIES as [string, ...string[]]), price: z.number().finite().min(1).max(100000).refine(v => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 0.00001), image: publicUrl, gallery: z.array(publicUrl).max(6).default([]), features: z.array(plain(1, 200)).min(1).max(20), whatsIncluded: z.array(plain(1, 200)).min(1).max(30), tags: z.array(plain(1, 40)).max(12).default([]), version: plain(1, 40).default('1.0'), requirements: plain(0, 2000).default(''), licenseTerms: plain(10, 4000), previewUrl: publicUrl.optional(), externalFileUrl: z.union([publicUrl, z.literal(''), z.null()]).optional(), membershipEligible: z.boolean().default(false), ownsRights: z.literal(true) }).strict();

async function rpc<T = any>(operation: string, key: string, value: unknown): Promise<T> {
  const result = await supabaseAdmin().rpc('marketplace_operation', { operation, key, value });
  if (result.error) {
    const message = result.error.message || '';
    if (/already registered|already taken|record changed|limit reached/.test(message)) throw new MarketplaceError(409, message.replace(/^.*?(Creator |Marketplace )/, '$1').slice(0, 140));
    throw new MarketplaceError(503, 'Marketplace changes could not be saved. Please retry.');
  }
  return result.data as T;
}
const audit = (actorId: string, action: string, targetId: string, reviewReason?: string) => ({ id: id(), actorId, action, targetId, ...(reviewReason ? { reason: reviewReason } : {}) });
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) throw new MarketplaceError(400, parsed.error.issues[0]?.message || 'Check the form and try again.'); return parsed.data; }
function handle(handler: (req: any, res: any) => Promise<unknown>): RequestHandler { return (req, res) => { void handler(req, res).catch(error => { res.status(error instanceof MarketplaceError ? error.status : 503).json({ success: false, message: error instanceof MarketplaceError ? error.message : 'Marketplace is temporarily unavailable. Please try again.' }); }); }; }
function publicBusiness(record: InternalCreator | CreatorProfile) {
  if (!record.publicBusiness) return undefined;
  const { businessName, businessAddress, supportEmail, supportPhone, grievanceName } = record.publicBusiness;
  return { businessName, businessAddress, supportEmail, supportPhone, grievanceName };
}
function safeCreator(record: InternalCreator): CreatorProfile {
  const providerAccounts = Object.fromEntries(Object.entries(record.providerAccounts || {}).map(([provider, account]) => [provider, { status: account.status, environment: account.environment, updatedAt: account.updatedAt, ...(account.verifiedAt ? { verifiedAt: account.verifiedAt } : {}) }]));
  return { id: record.id, userId: record.userId, slug: record.slug, displayName: record.displayName, headline: record.headline, bio: record.bio, avatarUrl: record.avatarUrl, publicBusiness: publicBusiness(record), status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt, reviewReason: record.reviewReason, agreementVersion: record.agreementVersion, agreementAcceptedAt: record.agreementAcceptance?.acceptedAt, kyc: { status: record.kyc?.status || 'not_submitted', panLast4: record.kyc?.panLast4, bankLast4: record.kyc?.bankLast4, submittedAt: record.kyc?.submittedAt }, providerAccounts };
}
function publicCreator(record: InternalCreator | CreatorProfile): PublicCreator { return { id: record.id, slug: record.slug, displayName: record.displayName, headline: record.headline, bio: record.bio, avatarUrl: record.avatarUrl, publicBusiness: publicBusiness(record) }; }
function safeListing(record: InternalListing): CreatorListing { const { revision: _revision, file, ...listing } = record; return { ...listing, file: { uploaded: Boolean(file?.uploaded), published: Boolean(file?.published), fileName: file?.fileName, size: file?.size, uploadedAt: file?.uploadedAt } }; }
function asProduct(listing: InternalListing): Product {
  const { file: _file, externalFileUrl: _externalFileUrl, revision: _revision, reviewReason: _reviewReason, createdAt: _createdAt, ...product } = listing;
  if (listing.externalFileUrl) { product.fileFormat = 'External download'; product.fileSize = 'External link'; }
  return { ...product, status: listing.status === 'active' ? 'active' : 'archived', isPlatformProduct: false };
}
async function creatorRecordByUser(userId: string): Promise<InternalCreator | null> { const cid = await Store.get<string>(`marketplace/creatorUsers/${userId}`); return cid ? Store.get<InternalCreator>(`marketplace/creators/${cid}`) : null; }
export async function getCreatorByUserId(userId: string): Promise<CreatorProfile | null> { const record = await creatorRecordByUser(userId); return record ? safeCreator(record) : null; }
export async function getCreatorById(creatorId: string): Promise<CreatorProfile | null> { if (!identifier.safeParse(creatorId).success) return null; const record = await Store.get<InternalCreator>(`marketplace/creators/${creatorId}`); return record ? safeCreator(record) : null; }
async function requireCreator(userId: string, allowSuspended = false): Promise<InternalCreator> { const creator = await creatorRecordByUser(userId); if (!creator) throw new MarketplaceError(403, 'Create your creator profile first.'); if (!allowSuspended && ['suspended', 'rejected'].includes(creator.status)) throw new MarketplaceError(403, 'Your creator account requires a support review.'); return creator; }
async function listingRecord(listingId: string, creatorId?: string): Promise<InternalListing> { if (!identifier.safeParse(listingId).success) throw new MarketplaceError(400, 'Invalid product reference.'); const listing = await Store.get<InternalListing>(`marketplace/listings/${listingId}`); if (!listing || (creatorId && listing.sellerId !== creatorId)) throw new MarketplaceError(404, 'Listing not found.'); return listing; }
async function creatorLimits(userId: string): Promise<{ productLimit: number | null; monthlyProductLimit: number | null }> { const { getCreatorEntitlements } = await import('./subscriptions'); const entitlement = await getCreatorEntitlements(userId); if (entitlement.productLimit !== null && (!Number.isInteger(entitlement.productLimit) || entitlement.productLimit < 0 || entitlement.productLimit > 10000) || entitlement.monthlyProductLimit !== null && (!Number.isInteger(entitlement.monthlyProductLimit) || entitlement.monthlyProductLimit < 1 || entitlement.monthlyProductLimit > 10000)) throw new MarketplaceError(503, 'Creator plan could not be verified.'); return { productLimit: entitlement.productLimit, monthlyProductLimit: entitlement.monthlyProductLimit }; }
async function creatorLimit(userId: string): Promise<number | null> { return (await creatorLimits(userId)).productLimit; }
function hasCurrentAgreement(creator: InternalCreator): boolean { return creator.agreementVersion === CREATOR_AGREEMENT.version && creator.agreementAcceptance?.version === CREATOR_AGREEMENT.version && creator.agreementAcceptance?.hash === agreementHash && creator.agreementAcceptance?.userId === creator.userId; }
export async function creatorHasCurrentAgreement(creatorId: string): Promise<boolean> { const creator = await Store.get<InternalCreator>(`marketplace/creators/${creatorId}`); return Boolean(creator && hasCurrentAgreement(creator)); }
async function writeCreator(previous: InternalCreator, next: InternalCreator, event: ReturnType<typeof audit>) { return rpc<InternalCreator>('creator_write', previous.id, { expected: previous, record: next, audit: event }); }
async function writeListing(previous: InternalListing | null, next: InternalListing, creator: InternalCreator, actorId: string, action: string, reviewReason?: string) { if (!['LISTING_ARCHIVED', 'LISTING_REJECTED'].includes(action) && !hasCurrentAgreement(creator)) throw new MarketplaceError(409, 'Review and accept the current creator agreement before publishing or updating offers.'); const limits = await creatorLimits(creator.userId); return rpc<InternalListing>('listing_write', next.id, { expected: previous, record: next, owner: creator.userId, limit: limits.productLimit, monthlyLimit: limits.monthlyProductLimit, product: asProduct(next), audit: audit(actorId, action, next.id, reviewReason) }); }

/** Never returns encrypted KYC, private file locations or provider account references. */
export function annotatePlatformProducts<T extends Product>(products: T[]): T[] { return products.map(product => product.sellerId ? product : { ...product, sellerId: 'booyahstudio', sellerName: BUSINESS.name, creatorSlug: 'booyahstudio', isPlatformProduct: true, membershipEligible: false }); }
export async function filterMarketplaceCatalog<T extends Product>(products: T[]): Promise<T[]> {
  const annotated = annotatePlatformProducts(products), thirdParty = annotated.filter(p => p.sellerId !== 'booyahstudio');
  if (!thirdParty.length) return annotated;
  const [creators, listings] = await Promise.all([Store.get<Record<string, InternalCreator>>('marketplace/creators'), Store.get<Record<string, InternalListing>>('marketplace/listings')]);
  return annotated.filter(p => p.sellerId === 'booyahstudio' || Boolean(creators?.[p.sellerId!]?.status === 'approved' && listings?.[p.id]?.status === 'active' && listings[p.id].file.published));
}
export async function prepareCreatorOrder(items: any[], provider: MarketplaceGateway, totalPaise?: number): Promise<CreatorOrderSnapshot | undefined> {
  if (!gateways.includes(provider) || !Array.isArray(items) || !items.length) throw new MarketplaceError(400, 'Select products and a valid payment method.');
  const products = await Promise.all(items.map(item => Store.getProductById(item.productId || item.product?.id)));
  if (products.some(product => !product || product.status !== 'active')) throw new MarketplaceError(409, 'One of these products is no longer available.');
  const sellerIds = new Set(products.map(product => product.sellerId || 'booyahstudio'));
  if (sellerIds.size !== 1) throw new MarketplaceError(409, 'Please check out separately for each creator.');
  const sellerId = [...sellerIds][0]; if (sellerId === 'booyahstudio') return undefined;
  const creator = await Store.get<InternalCreator>(`marketplace/creators/${sellerId}`);
  if (!creator || creator.status !== 'approved') throw new MarketplaceError(409, 'This creator is not currently accepting purchases.');
  if (!hasCurrentAgreement(creator)) throw new MarketplaceError(409, 'This creator is reviewing the current marketplace agreement. Please try again later.');
  if (!publicBusinessSchema.safeParse(creator.publicBusiness).success) throw new MarketplaceError(409, 'This creator is completing the required seller and support disclosures.');
  const details = await getCreatorProviderDetails(sellerId, provider);
  if (!details?.account || details.account.status !== 'verified' || !details.account.reference || !details.kyc) throw new MarketplaceError(409, 'This creator is completing payment onboarding. Please try again later.');
  const listings = await Promise.all(products.map(product => listingRecord(product.id, creator.id)));
  if (listings.some(listing => listing.status !== 'active' || !listing.file.published)) throw new MarketplaceError(409, 'One of these products is no longer available.');
  const amount = totalPaise ?? items.reduce((sum, item, index) => sum + (Number.isSafeInteger(item.paidAmountPaise) ? item.paidAmountPaise : Math.round(products[index].price * 100) * (item.quantity || 1)), 0);
  const itemCount = items.reduce((count, item) => { const quantity = Number(item.quantity ?? 1); if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw new MarketplaceError(400, 'Invalid product quantity.'); return count + quantity; }, 0);
  if (!Number.isSafeInteger(amount) || amount <= 0 || itemCount < 1 || itemCount > 1000) throw new MarketplaceError(400, 'Invalid checkout amount.');
  const commissionPaise = Math.min(amount, itemCount * CREATOR_COMMISSION_PER_ITEM_PAISE);
  return { sellerId: creator.id, sellerName: creator.displayName, creatorSlug: creator.slug, commissionModel: 'flat_per_item', commissionPerItemPaise: CREATOR_COMMISSION_PER_ITEM_PAISE, itemCount, commissionBps: 0, grossPaise: amount, commissionPaise, sellerPaise: amount - commissionPaise, provider, providerAccountId: details.account.reference, agreementVersion: creator.agreementVersion };
}
export async function fulfillCreatorOrder(order: { id: string; marketplace?: unknown }): Promise<any> { if (!identifier.safeParse(order?.id).success) throw new MarketplaceError(400, 'Invalid order.'); if (!order.marketplace) return null; return rpc('ledger_sync', order.id, null); }
/** Internal only: caller must not serialize or log the decrypted KYC/provider refs. */
export async function getCreatorProviderDetails(creatorId: string, provider: MarketplaceGateway) {
  if (!identifier.safeParse(creatorId).success || !gateways.includes(provider)) return null;
  const creator = await Store.get<InternalCreator>(`marketplace/creators/${creatorId}`);
  if (!creator || !creator.encryptedKyc || creator.status !== 'approved') return null;
  const kyc = unseal<Record<string, any>>(creator.encryptedKyc, `creator-kyc:${creator.id}`);
  return { creatorId, creatorName: creator.displayName, account: creator.providerAccounts?.[provider] || null, kyc, agreementVersion: creator.agreementVersion };
}
/** Call exclusively after an authenticated provider API lookup/webhook reconciliation.
 * Platform moderation is deliberately unable to call this through an admin flag. */
export async function updateCreatorProviderAccount(creatorId: string, provider: MarketplaceGateway, proof: { reference: string; status: 'pending' | 'verified' | 'rejected'; environment: 'live' | 'test'; providerVerifiedAt: string; providerStatus: string }) {
  if (!identifier.safeParse(creatorId).success || !gateways.includes(provider)) throw new MarketplaceError(400, 'Invalid creator provider binding.');
  const input = parse(z.object({ reference: z.string().regex(/^[A-Za-z0-9 _-]{1,100}$/), status: z.enum(['pending', 'verified', 'rejected']), environment: z.enum(['live', 'test']), providerVerifiedAt: z.string().datetime(), providerStatus: plain(1, 100) }).strict(), proof);
  const previous = await Store.get<InternalCreator>(`marketplace/creators/${creatorId}`); if (!previous?.encryptedKyc) throw new MarketplaceError(409, 'Creator KYC must be submitted first.');
  const existing = previous.providerAccounts?.[provider];
  if (existing?.reference && (existing.reference !== input.reference || existing.environment !== input.environment)) throw new MarketplaceError(409, 'An existing provider binding cannot be replaced. Contact support.');
  return safeCreator(await writeCreator(previous, { ...previous, updatedAt: now(), providerAccounts: { ...previous.providerAccounts, [provider]: { reference: input.reference, status: input.status, environment: input.environment, providerStatus: input.providerStatus, ...(input.status === 'verified' ? { verifiedAt: input.providerVerifiedAt } : {}), updatedAt: now() } } }, audit('provider-reconciliation', 'CREATOR_PROVIDER_STATUS_VERIFIED', creatorId)));
}

function safeOrder(order: any, ledger?: any) {
  const { providerAccountId: _providerAccountId, ...snapshot } = order.marketplace || {};
  return { id: order.id, createdAt: order.createdAt || order.date, total: order.total, status: order.status, paymentStatus: order.paymentStatus, paymentEnvironment: order.paymentEnvironment, deliveryStatus: order.deliveryStatus, downloadStatus: order.downloadStatus, emailDelivery: { status: order.emailDelivery?.status || 'not_queued' }, items: (order.items || []).map((item: any) => ({ productId: item.productId, productTitle: item.productTitle, price: item.price, quantity: item.quantity || 1 })), marketplace: snapshot, settlementStatus: ledger?.settlementStatus || 'pending_provider', ...(ledger ? { ledger } : {}) };
}
function summarize(orders: any[], ledger: any[], listings: InternalListing[], productLimit: number | null): CreatorSummary {
  const sum = (field: string) => ledger.reduce((total, entry) => total + Number(entry[field] || 0), 0);
  return { orders: orders.length, paidOrders: ledger.length, grossPaise: sum('grossPaise'), commissionPaise: sum('commissionPaise'), sellerPaise: sum('sellerPaise'), refundPaise: sum('refundedPaise'), payablePaise: sum('payablePaise'), activeProducts: listings.filter(p => p.status !== 'archived').length, productLimit };
}
async function allMarketplace() { const [creators, listings, orders, ledger] = await Promise.all([Store.get<Record<string, InternalCreator>>('marketplace/creators'), Store.get<Record<string, InternalListing>>('marketplace/listings'), Store.getAllGlobalOrders(), Store.get<Record<string, any>>('marketplace/ledger')]); return { creators: Object.values(creators || {}), listings: Object.values(listings || {}), orders: orders.filter(order => order.marketplace?.sellerId), ledger: Object.values(ledger || {}) }; }
async function privateFile(listing: InternalListing, staging: boolean) {
  const path = staging && !listing.file.published ? listing.file.stagingPath : `${listing.id}.zip`;
  if (!path || !listing.file.uploaded) throw new MarketplaceError(409, 'Upload a private ZIP first.');
  const bucket = supabaseAdmin().storage.from('products');
  const info = await bucket.info(path);
  if (info.error || !info.data || Number(info.data.size) !== listing.file.size) throw new MarketplaceError(409, 'The private ZIP is missing or its size changed. Upload it again.');
  const signed = await bucket.createSignedUrl(path, 60, { download: `${listing.slug}.zip` });
  if (signed.error || !signed.data?.signedUrl) throw new MarketplaceError(503, 'Could not open the private ZIP for review.');
  await verifyStagedZipHeader(signed.data.signedUrl);
  return { bucket, path, signedUrl: signed.data.signedUrl };
}

export function registerCreatorMarketplaceRoutes(app: Express, auth: RequestHandler, admin: RequestHandler, limiter: RequestHandler) {
  const publicRouter = Router(), creatorRouter = Router(), adminRouter = Router();
  const hasDatabase = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  publicRouter.get('/config', handle(async (_req, res) => {
    if (!hasDatabase()) return res.json({ success: true, settings: { acceptingCreators: false, commissionPaisePerItem: CREATOR_COMMISSION_PER_ITEM_PAISE, maxUploadBytes: CREATOR_UPLOAD_LIMIT_BYTES }, companyCreator: { ...COMPANY_CREATOR, productCount: PRODUCTS.filter(p => p.status === 'active').length }, creatorPlans: [], agreement: CREATOR_AGREEMENT, categories: MARKETPLACE_CATEGORIES });
    const { getCreatorPlanSummaries } = await import('./subscriptions');
    const platformProducts = annotatePlatformProducts(await Store.getAllProducts()).filter(p => p.sellerId === 'booyahstudio' && p.status === 'active');
    res.json({ success: true, settings: { acceptingCreators: true, commissionPaisePerItem: CREATOR_COMMISSION_PER_ITEM_PAISE, maxUploadBytes: CREATOR_UPLOAD_LIMIT_BYTES }, companyCreator: { ...COMPANY_CREATOR, productCount: platformProducts.length }, creatorPlans: await getCreatorPlanSummaries(), agreement: CREATOR_AGREEMENT, categories: MARKETPLACE_CATEGORIES });
  }));
  publicRouter.get('/creators', handle(async (_req, res) => {
    if (!hasDatabase()) return res.json({ success: true, creators: [{ ...COMPANY_CREATOR, productCount: PRODUCTS.filter(p => p.status === 'active').length }] });
    const [creatorRecords, listingRecords] = await Promise.all([Store.get<Record<string, InternalCreator>>('marketplace/creators'), Store.get<Record<string, InternalListing>>('marketplace/listings')]);
    const creators = Object.values(creatorRecords || {}), listings = Object.values(listingRecords || {});
    const companyProductCount = annotatePlatformProducts(await Store.getAllProducts()).filter(p => p.sellerId === 'booyahstudio' && p.status === 'active').length;
    res.json({ success: true, creators: [{ ...COMPANY_CREATOR, productCount: companyProductCount }, ...creators.filter(c => c.status === 'approved').map(c => ({ ...publicCreator(c), productCount: listings.filter(l => l.sellerId === c.id && l.status === 'active' && l.file.published).length }))] });
  }));
  publicRouter.get('/creators/:slug', handle(async (req, res) => {
    const slug = String(req.params.slug);
    if (slug === 'booyahstudio') return res.json({ success: true, creator: COMPANY_CREATOR, products: annotatePlatformProducts(hasDatabase() ? await Store.getAllProducts() : PRODUCTS).filter(p => p.sellerId === 'booyahstudio' && p.status === 'active') });
    if (!hasDatabase()) throw new MarketplaceError(404, 'Creator not found.');
    if (!slugSchema.safeParse(slug).success) throw new MarketplaceError(404, 'Creator not found.');
    const creatorId = await Store.get<string>(`marketplace/creatorSlugs/${slug}`), creator = creatorId ? await Store.get<InternalCreator>(`marketplace/creators/${creatorId}`) : null;
    if (!creator || creator.status !== 'approved') throw new MarketplaceError(404, 'Creator not found.');
    const listings = Object.values(await Store.get<Record<string, InternalListing>>('marketplace/listings') || {});
    res.json({ success: true, creator: publicCreator(creator), products: listings.filter(l => l.sellerId === creator.id && l.status === 'active' && l.file.published).map(asProduct) });
  }));

  creatorRouter.use(auth, limiter);
  creatorRouter.get('/', handle(async (req, res) => {
    const creator = await creatorRecordByUser(req.userId);
    if (!creator) return res.json({ success: true, creator: null, products: [], orders: [], summary: summarize([], [], [], await creatorLimit(req.userId)) });
    const state = await allMarketplace(), products = state.listings.filter(p => p.sellerId === creator.id), orders = state.orders.filter(o => o.marketplace.sellerId === creator.id), ledger = state.ledger.filter(l => l.sellerId === creator.id);
    const membershipEarnings = await (await import('./subscriptions')).getCreatorMembershipEarnings(creator.id);
    res.json({ success: true, creator: safeCreator(creator), products: products.map(safeListing), orders: orders.map(o => safeOrder(o, ledger.find(l => l.orderId === o.id))), membershipEarnings, summary: { ...summarize(orders, ledger, products, await creatorLimit(req.userId)), membershipGrossPaise: membershipEarnings.grossPaise, membershipCommissionPaise: membershipEarnings.commissionPaise, membershipPayablePaise: membershipEarnings.payablePaise, membershipRefundPaise: membershipEarnings.refundPaise } });
  }));
  creatorRouter.post('/', handle(async (req, res) => {
    const input = parse(onboardingSchema, req.body), createdAt = now(), creatorId = `cr_${id()}`;
    const { legalName, phone, adult: _adult, ownsRights: _rights, acceptAgreement: _accept, agreementVersion: _version, ...profile } = input;
    const agreementAcceptance = { userId: req.userId, acceptedAt: createdAt, version: CREATOR_AGREEMENT.version, hash: agreementHash, policyVersion, ip: String(req.ip || '').slice(0, 80), userAgent: String(req.get('user-agent') || '').slice(0, 500) };
    const record: InternalCreator = { ...profile, id: creatorId, userId: req.userId, status: 'pending', createdAt, updatedAt: createdAt, agreementVersion: CREATOR_AGREEMENT.version, agreementAcceptance, kyc: { status: 'not_submitted' }, providerAccounts: {}, encryptedIdentity: seal({ legalName, phone }, `creator-identity:${creatorId}`) };
    const creator = await rpc<InternalCreator>('creator_create', req.userId, { record, agreementSnapshot, audit: audit(req.userId, 'CREATOR_REGISTERED', creatorId) });
    res.status(201).json({ success: true, creator: safeCreator(creator), message: 'Your creator profile is ready for review.' });
  }));
  creatorRouter.patch('/', handle(async (req, res) => {
    const input = parse(profileSchema.partial().strict(), req.body); if (!Object.keys(input).length) throw new MarketplaceError(400, 'Choose a profile field to update.');
    const previous = await requireCreator(req.userId), businessChanged = input.publicBusiness && JSON.stringify(input.publicBusiness) !== JSON.stringify(previous.publicBusiness), next = { ...previous, ...input, ...(businessChanged && previous.status === 'approved' ? { status: 'pending' as const, reviewReason: 'Public seller details changed and require review.' } : {}), updatedAt: now() };
    if (input.slug && input.slug !== previous.slug) throw new MarketplaceError(409, 'Your creator address is permanent. Contact support to change it.');
    res.json({ success: true, creator: safeCreator(await writeCreator(previous, next, audit(req.userId, 'CREATOR_PROFILE_UPDATED', previous.id))) });
  }));
  creatorRouter.post('/agreement', handle(async (req, res) => {
    parse(z.object({ agreementVersion: z.literal(CREATOR_AGREEMENT.version), acceptAgreement: z.literal(true) }).strict(), req.body);
    const previous = await requireCreator(req.userId, true);
    if (previous.agreementAcceptance?.hash === agreementHash && previous.agreementVersion === CREATOR_AGREEMENT.version) return res.json({ success: true, creator: safeCreator(previous) });
    const acceptance = { userId: req.userId, acceptedAt: now(), version: CREATOR_AGREEMENT.version, hash: agreementHash, policyVersion, ip: String(req.ip || '').slice(0, 80), userAgent: String(req.get('user-agent') || '').slice(0, 500) };
    const creator = await rpc<InternalCreator>('creator_agreement', previous.id, { expected: previous, acceptance, agreementSnapshot, audit: audit(req.userId, 'CREATOR_AGREEMENT_ACCEPTED', previous.id) });
    res.json({ success: true, creator: safeCreator(creator) });
  }));
  creatorRouter.post('/kyc', handle(async (req, res) => {
    const input = parse(kycSchema, req.body), previous = await requireCreator(req.userId);
    if (Object.values(previous.providerAccounts || {}).some(account => account.reference)) throw new MarketplaceError(409, 'Your payout identity is bound to a provider account. Contact support for a verified change.');
    const identity = previous.encryptedIdentity ? unseal<{ phone: string }>(previous.encryptedIdentity, `creator-identity:${previous.id}`) : { phone: '' };
    const { consent: _consent, ...kyc } = input;
    const next = { ...previous, updatedAt: now(), encryptedKyc: seal({ ...kyc, phone: identity.phone }, `creator-kyc:${previous.id}`), kyc: { status: 'submitted' as const, panLast4: input.pan.slice(-4), bankLast4: input.bankAccount.slice(-4), submittedAt: now() } };
    res.json({ success: true, creator: safeCreator(await writeCreator(previous, next, audit(req.userId, 'CREATOR_KYC_SUBMITTED', previous.id))), message: 'Details saved securely. The payment provider must separately verify and activate your seller account.' });
  }));
  creatorRouter.get('/listings', handle(async (req, res) => { const creator = await requireCreator(req.userId, true); const listings = Object.values(await Store.get<Record<string, InternalListing>>('marketplace/listings') || {}).filter(l => l.sellerId === creator.id); res.json({ success: true, listings: listings.map(safeListing) }); }));
  creatorRouter.post('/listings', handle(async (req, res) => {
    const creator = await requireCreator(req.userId), input = parse(listingSchema, req.body), listingId = `mk_${id()}`, timestamp = now();
    const { ownsRights: _rights, requirements, externalFileUrl, ...fields } = input;
    const record: InternalListing = { ...fields, ...(externalFileUrl ? { externalFileUrl } : {}), requirements: requirements.split(/\r?\n/).map(v => v.trim()).filter(Boolean), id: listingId, slug: `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'digital-product'}-${listingId.slice(-8)}`, sellerId: creator.id, sellerName: creator.displayName, creatorSlug: creator.slug, categoryLabel: input.category, productType: 'DOWNLOAD', fileFormat: 'ZIP', status: 'draft', isPlatformProduct: false, file: { uploaded: false }, createdAt: timestamp, updatedAt: timestamp, revision: 1 };
    res.status(201).json({ success: true, listing: safeListing(await writeListing(null, record, creator, req.userId, 'LISTING_CREATED')) });
  }));
  creatorRouter.patch('/listings/:id', handle(async (req, res) => {
    const creator = await requireCreator(req.userId), previous = await listingRecord(req.params.id, creator.id);
    const input = parse(listingSchema.partial().strict(), req.body), { ownsRights: _rights, requirements, externalFileUrl, ...fields } = input;
    if (!Object.keys(fields).length && requirements === undefined) throw new MarketplaceError(400, 'Choose a listing field to update.');
    if (previous.status === 'pending') throw new MarketplaceError(409, 'This listing is under review. Please wait for the review result.');
    if (externalFileUrl && previous.file.uploaded) throw new MarketplaceError(409, 'This listing already has a private ZIP. Create a new draft to use an external delivery link instead.');
    const next = { ...previous, ...fields, ...(externalFileUrl === undefined ? {} : { externalFileUrl: externalFileUrl || null }), ...(requirements === undefined ? {} : { requirements: requirements.split(/\r?\n/).map(v => v.trim()).filter(Boolean) }), categoryLabel: fields.category || previous.categoryLabel, status: 'draft' as const, reviewReason: undefined, updatedAt: now(), revision: previous.revision + 1 };
    res.json({ success: true, listing: safeListing(await writeListing(previous, next, creator, req.userId, 'LISTING_UPDATED')) });
  }));
  creatorRouter.post('/listings/:id/upload', handle(async (req, res) => {
    const creator = await requireCreator(req.userId), previous = await listingRecord(req.params.id, creator.id);
    const input = parse(z.object({ fileName: z.string().trim().min(5).max(200).regex(/^[^\\/\r\n]+\.zip$/i), size: z.number().int().min(22).max(CREATOR_UPLOAD_LIMIT_BYTES) }).strict(), req.body);
    if (previous.status === 'pending' || previous.file.published) throw new MarketplaceError(409, 'A reviewed or published ZIP cannot be replaced here. Create a new listing for a different archive.');
    if (previous.externalFileUrl) throw new MarketplaceError(409, 'Remove the external delivery link from this draft before uploading a private ZIP.');
    const uploadId = id(), stagingPath = `_creators/${creator.id}/${previous.id}/${uploadId}.zip`, bucket = supabaseAdmin().storage.from('products');
    const { data, error } = await bucket.createSignedUploadUrl(stagingPath, { upsert: false });
    if (error || !data?.signedUrl) throw new MarketplaceError(503, 'A private upload could not be prepared. Please retry.');
    const expiresAt = Date.now() + 30 * 60_000;
    await Store.set(`marketplace/creatorUploads/${uploadId}`, { uploadId, creatorId: creator.id, listingId: previous.id, stagingPath, fileName: input.fileName, expectedSize: input.size, expiresAt, status: 'pending' });
    res.set('Cache-Control', 'private, no-store').json({ success: true, upload: { uploadId, signedUrl: data.signedUrl, method: 'PUT', expiresAt } });
  }));
  creatorRouter.post('/listings/:id/upload/complete', handle(async (req, res) => {
    const creator = await requireCreator(req.userId), previous = await listingRecord(req.params.id, creator.id);
    const input = parse(z.object({ uploadId: z.string().regex(/^[a-f0-9]{32}$/) }).strict(), req.body);
    const uploadKey = `marketplace/creatorUploads/${input.uploadId}`, ticket = await Store.get<any>(uploadKey);
    if (!ticket || ticket.creatorId !== creator.id || ticket.listingId !== previous.id || ticket.status !== 'pending') throw new MarketplaceError(404, 'Private upload not found. Please prepare it again.');
    const bucket = supabaseAdmin().storage.from('products');
    if (ticket.expiresAt < Date.now()) { await bucket.remove([ticket.stagingPath]).catch(() => undefined); throw new MarketplaceError(410, 'The private upload expired. Please prepare it again.'); }
    if (previous.status === 'pending' || previous.file.published) throw new MarketplaceError(409, 'A reviewed or published ZIP cannot be replaced here.');
    const info = await bucket.info(ticket.stagingPath);
    if (info.error || !info.data || Number(info.data.size) !== ticket.expectedSize || Number(info.data.size) > CREATOR_UPLOAD_LIMIT_BYTES) throw new MarketplaceError(400, 'The uploaded file is missing or does not match the selected file size.');
    const download = await bucket.download(ticket.stagingPath);
    if (download.error || !download.data) throw new MarketplaceError(503, 'The uploaded file could not be verified. Please retry.');
    const bytes = Buffer.from(await download.data.arrayBuffer());
    if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) { await bucket.remove([ticket.stagingPath]).catch(() => undefined); throw new MarketplaceError(400, 'Upload a non-empty ZIP archive.'); }
    try {
      const next = { ...previous, file: { uploaded: true, fileName: ticket.fileName, size: bytes.length, uploadedAt: now(), stagingPath: ticket.stagingPath, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), published: false }, fileSize: `${(bytes.length / (1024 * 1024)).toFixed(2)} MB`, updatedAt: now(), revision: previous.revision + 1 };
      const saved = await writeListing(previous, next, creator, req.userId, 'LISTING_ZIP_UPLOADED');
      await Store.set(uploadKey, { ...ticket, status: 'completed', completedAt: now() });
      if (previous.file.stagingPath) await bucket.remove([previous.file.stagingPath]).catch(() => undefined);
      res.set('Cache-Control', 'private, no-store').json({ success: true, listing: safeListing(saved), message: 'Private ZIP uploaded. Submit the listing for review when it is ready.' });
    } catch (error) { await bucket.remove([ticket.stagingPath]).catch(() => undefined); throw error; }
  }));
  creatorRouter.post('/listings/:id/submit', handle(async (req, res) => {
    const creator = await requireCreator(req.userId), previous = await listingRecord(req.params.id, creator.id);
    if (!['draft', 'rejected'].includes(previous.status) || Boolean(previous.file.uploaded) === Boolean(previous.externalFileUrl)) throw new MarketplaceError(409, 'Choose either one private ZIP upload or one direct HTTPS file link before submitting.');
    if (previous.file.uploaded) await privateFile(previous, true);
    const next = { ...previous, status: 'pending' as const, reviewReason: undefined, updatedAt: now(), revision: previous.revision + 1 };
    res.json({ success: true, listing: safeListing(await writeListing(previous, next, creator, req.userId, 'LISTING_SUBMITTED')), message: 'Your listing has been submitted for review.' });
  }));
  creatorRouter.post('/listings/:id/archive', handle(async (req, res) => {
    parse(z.object({}).strict(), req.body);
    const creator = await requireCreator(req.userId, true), previous = await listingRecord(req.params.id, creator.id);
    if (previous.status === 'archived') return res.json({ success: true, listing: safeListing(previous) });
    const next = { ...previous, status: 'archived' as const, updatedAt: now(), revision: previous.revision + 1 };
    res.json({ success: true, listing: safeListing(await writeListing(previous, next, creator, req.userId, 'LISTING_ARCHIVED')), message: 'Product archived. Completed paid purchases retain access to their private files.' });
  }));

  adminRouter.use(auth, admin, limiter);
  adminRouter.get('/summary', handle(async (_req, res) => { const state = await allMarketplace(); res.json({ success: true, companyCreator: COMPANY_CREATOR, summary: { ...summarize(state.orders, state.ledger, state.listings, 0), creators: state.creators.length, pendingCreators: state.creators.filter(c => c.status === 'pending').length, listings: state.listings.length, pendingListings: state.listings.filter(l => l.status === 'pending').length } }); }));
  adminRouter.get('/creators', handle(async (_req, res) => { res.json({ success: true, creators: Object.values(await Store.get<Record<string, InternalCreator>>('marketplace/creators') || {}).map(safeCreator) }); }));
  adminRouter.get('/creators/:id/agreement', handle(async (req, res) => {
    const creatorId = parse(identifier, req.params.id), creator = await Store.get<InternalCreator>(`marketplace/creators/${creatorId}`);
    if (!creator) throw new MarketplaceError(404, 'Creator not found.');
    const snapshot = await Store.get(`marketplace/agreementSnapshots/${creator.agreementVersion}`);
    res.set('Cache-Control', 'private, no-store').json({ success: true, creatorId, agreementVersion: creator.agreementVersion, acceptance: creator.agreementAcceptance || null, snapshot: snapshot || null, verifiedRecord: Boolean(creator.agreementAcceptance && snapshot) });
  }));
  adminRouter.get('/listings', handle(async (_req, res) => { res.json({ success: true, listings: Object.values(await Store.get<Record<string, InternalListing>>('marketplace/listings') || {}).map(safeListing) }); }));
  adminRouter.get('/orders', handle(async (_req, res) => { const state = await allMarketplace(); res.json({ success: true, orders: state.orders.map(o => safeOrder(o, state.ledger.find(l => l.orderId === o.id))) }); }));
  adminRouter.get('/audit', handle(async (_req, res) => { const events = Object.values(await Store.get<Record<string, any>>('marketplace/audit') || {}); res.json({ success: true, audit: events.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 500) }); }));
  adminRouter.patch('/creators/:id', handle(async (req, res) => {
    const input = parse(z.object({ action: z.enum(['approve', 'suspend', 'reject']), reason }).strict(), req.body);
    const creatorId = parse(identifier, req.params.id), previous = await Store.get<InternalCreator>(`marketplace/creators/${creatorId}`);
    if (!previous) throw new MarketplaceError(404, 'Creator not found.');
    const status = ({ approve: 'approved', suspend: 'suspended', reject: 'rejected' } as const)[input.action];
    if (status === 'approved' && !publicBusinessSchema.safeParse(previous.publicBusiness).success) throw new MarketplaceError(409, 'Complete and review the public business identity, address, support and grievance details before approving this creator.');
    if (status === 'approved' && (!hasCurrentAgreement(previous) || !await Store.get(`marketplace/agreementSnapshots/${previous.agreementVersion}`))) throw new MarketplaceError(409, 'The creator must accept the current creator agreement before approval.');
    const next = { ...previous, status, ...(status === 'suspended' ? { suspendedAt: now() } : status === 'approved' ? { suspendedAt: undefined } : {}), reviewReason: input.reason, updatedAt: now() };
    const updated = await writeCreator(previous, next, audit(req.userId, `CREATOR_${status.toUpperCase()}`, creatorId, input.reason));
    if (status === 'suspended' || status === 'approved') {
      const state = await allMarketplace();
      for (const entry of state.ledger.filter(item => item.sellerId === creatorId)) await fulfillCreatorOrder({ id: entry.orderId, marketplace: true });
    }
    res.json({ success: true, creator: safeCreator(updated), message: 'Profile moderation updated. Payment-provider verification and bank settlement are separate requirements.' });
  }));
  adminRouter.get('/listings/:id/review-file', handle(async (req, res) => {
    const listing = await listingRecord(req.params.id);
    if (listing.externalFileUrl) return res.json({ success: true, downloadUrl: listing.externalFileUrl, validation: 'External link. Review the destination, file, licence and malware before approval.' });
    const file = await privateFile(listing, true);
    res.json({ success: true, downloadUrl: file.signedUrl, expiresAt: Date.now() + 60000, validation: 'ZIP header and size only. Review the archive contents, licence and malware before approval.' });
  }));
  adminRouter.patch('/listings/:id', handle(async (req, res) => {
    const input = parse(z.object({ action: z.enum(['approve', 'reject', 'archive']), reason, reviewed: z.boolean().optional() }).strict(), req.body), previous = await listingRecord(req.params.id);
    const creator = await Store.get<InternalCreator>(`marketplace/creators/${previous.sellerId}`); if (!creator) throw new MarketplaceError(404, 'Creator not found.');
    if (input.action === 'approve' && (previous.status !== 'pending' || creator.status !== 'approved' || input.reviewed !== true)) throw new MarketplaceError(409, 'Approve the creator profile and review the submitted archive before approving this listing.');
    let published = Boolean(previous.file.published);
    if (input.action === 'approve' && previous.externalFileUrl) {
      published = true;
    } else if (input.action === 'approve') {
      const file = await privateFile(previous, true);
      if (!published) {
        const copy = await file.bucket.copy(file.path, `${previous.id}.zip`);
        if (copy.error) {
          // A previous RPC response may have been lost after copying. Reconcile the
          // exact reviewed bytes; never delete a possibly-live paid file on timeout.
          const existing = await file.bucket.download(`${previous.id}.zip`);
          if (existing.error || !existing.data || existing.data.size !== previous.file.size || existing.data.size > CREATOR_UPLOAD_LIMIT_BYTES || crypto.createHash('sha256').update(Buffer.from(await existing.data.arrayBuffer())).digest('hex') !== previous.file.sha256) throw new MarketplaceError(503, 'Could not reconcile the reviewed ZIP. Contact support before publishing this file.');
        }
        published = true;
      }
    }
    const status = ({ approve: 'active', reject: 'rejected', archive: 'archived' } as const)[input.action];
    const next = { ...previous, status, file: { ...previous.file, ...(input.action === 'approve' && previous.externalFileUrl ? { uploaded: true, fileName: 'External direct link', size: 0, uploadedAt: previous.updatedAt } : {}), published }, reviewReason: input.reason, updatedAt: now(), revision: previous.revision + 1 };
    res.json({ success: true, listing: safeListing(await writeListing(previous, next, creator, req.userId, `LISTING_${status.toUpperCase()}`, input.reason)) });
  }));
  app.use('/api/marketplace', publicRouter);
  app.use('/api/marketplace/me', creatorRouter);
  app.use('/api/marketplace/admin', adminRouter);
}
