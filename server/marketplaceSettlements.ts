import crypto from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { Store } from './store';
import { supabaseAdmin } from './supabase';
import { cashfreeRequest, cashfreeConfig, moneyPaise } from './cashfree';
import { razorpayRequest, paymentEnvironment } from './razorpay';
import { marketplaceReserveCapability, MARKETPLACE_RESERVE_POLICY_VERSION } from './settlementPolicy';

const identifier = /^[A-Za-z0-9_-]{1,100}$/;
type Provider = 'cashfree' | 'razorpay' | 'easebuzz';
type State = { settlements: Record<string, any>; riskCases: Record<string, any>; ledger?: Record<string, any> };
const providers: Provider[] = ['cashfree', 'razorpay', 'easebuzz'];
const auditId = () => crypto.randomBytes(16).toString('hex');
export async function settlementOperation<T = any>(operation: string, key = '', value: unknown = null): Promise<T> {
  const { data, error } = await supabaseAdmin().rpc('settlement_operation', { operation, key, value });
  if (error) throw new Error('Settlement records are unavailable. Apply the settlement migration and retry.');
  return data as T;
}
function safeRow(row: any) {
  const fields = ['orderId', 'kind', 'subscriptionId', 'sellerId', 'provider', 'paymentId', 'grossPaise', 'sellerPaise', 'payablePaise', 'paymentVerifiedAt', 'eligibleAt', 'status', 'createdAt', 'updatedAt', 'providerReference', 'providerSettlementId', 'lastCheckedAt', 'lastError', 'providerStatus'];
  return Object.fromEntries(fields.filter(field => row?.[field] !== undefined).map(field => [field, row[field]]));
}
function safeRisk(row: any) {
  return Object.fromEntries(['creatorId', 'status', 'category', 'reason', 'evidenceReference', 'openedAt', 'reviewAt', 'updatedAt', 'resolvedAt', 'resolvedReason', 'providerHold'].filter(field => row?.[field] !== undefined).map(field => [field, row[field]]));
}
async function billingState() {
  const { data, error } = await supabaseAdmin().rpc('subscription_operation', { operation: 'state', key: '', value: null });
  if (error) throw new Error('Membership financial records are unavailable.');
  return data as { subscriptions: Record<string, any> };
}
const membershipOrderId = (subscriptionId: string, paymentId: string) => `MS_${crypto.createHash('sha256').update(`${subscriptionId}|${paymentId}`).digest('hex').slice(0, 60)}`;
async function sources() {
  const orders = (await Store.getAllGlobalOrders()).filter(order => order?.marketplace && order.paymentEnvironment === 'live');
  const billing = await billingState();
  for (const subscription of Object.values(billing.subscriptions || {})) {
    if (subscription?.environment !== 'live' || subscription.plan?.audience !== 'customer' || !subscription.plan.creatorId || !subscription.split?.accountId) continue;
    for (const payment of Object.values(subscription.payments || {}) as any[]) {
      if (!payment?.verified || !payment.id || payment.subscriptionRef !== subscription.providerRef || payment.currency !== 'INR') continue;
      orders.push({ id: membershipOrderId(subscription.id, payment.id), _membership: { subscriptionId: subscription.id, paymentId: payment.id }, paymentProvider: subscription.provider, paymentEnvironment: 'live', transactionId: payment.id, total: payment.amountPaise / 100,
        _membershipRevoked: payment.revoked === true, marketplace: { sellerId: subscription.plan.creatorId, providerAccountId: subscription.split.accountId, reservePolicyVersion: subscription.split.reservePolicyVersion }, providerOrderId: payment.orderRef, paymentVerifiedAt: payment.verifiedAt || payment.paidAt });
    }
  }
  return orders;
}
async function ensure(order: any) {
  return settlementOperation(order._membership ? 'ensure_membership' : 'ensure', order.id, order._membership || {});
}
function proof(order: any, row: any, status: string, extra: Record<string, any> = {}) {
  return { provider: row.provider, orderId: row.orderId, sellerId: row.sellerId, paymentId: row.paymentId, status, ...extra };
}
/** A processed transfer to a linked account is not itself a bank settlement. */
export function matchingRouteTransfer(remote: any, order: any, row: any): boolean {
  const account = order.marketplace?.providerAccountId;
  const sourceMatches = remote?.source === order.transactionId || remote?.source === order.razorpayOrderId || remote?.source === order.providerOrderId;
  return Boolean(/^trf_[A-Za-z0-9]+$/.test(remote?.id || '') && /^acc_[A-Za-z0-9]+$/.test(account || '') && remote.recipient === account && sourceMatches && remote.currency === 'INR' &&
    Number.isSafeInteger(remote.amount) && remote.amount === row.sellerPaise && Number.isSafeInteger(remote.amount_reversed) && remote.amount_reversed >= 0 && remote.amount_reversed <= remote.amount);
}
export async function patchRouteHold(transferId: string, onHold: boolean) {
  if (!/^trf_[A-Za-z0-9]+$/.test(transferId) || typeof onHold !== 'boolean' || !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) throw new Error('Route hold configuration is unavailable.');
  const response = await fetch(`https://api.razorpay.com/v1/transfers/${transferId}`, { method: 'PATCH', redirect: 'error', headers: { Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ on_hold: onHold }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('The provider did not confirm the transfer hold request.');
  return response.json();
}
async function routeProof(order: any, row: any, token: string) {
  if (paymentEnvironment() !== 'live') throw new Error('Use the original live Razorpay credentials.');
  const collection = await razorpayRequest(`payments/${order.transactionId}/transfers`);
  const matches = (Array.isArray(collection?.items) ? collection.items : []).filter((remote: any) => matchingRouteTransfer(remote, order, row));
  if (matches.length !== 1) return proof(order, row, 'provider_action_required', { lastError: 'A unique matching provider transfer is not visible. Review the original provider; no transfer was invented.' });
  let transfer = matches[0];
  if (transfer.amount - transfer.amount_reversed !== row.payablePaise) return proof(order, row, 'review_required', { providerReference: transfer.id, lastError: 'The provider transfer and refund-adjusted seller ledger differ. Reconcile reversals before release.' });
  if (transfer.settlement_status === 'settled') {
    if (!/^setl_[A-Za-z0-9]+$/.test(transfer.recipient_settlement_id || '')) return proof(order, row, 'provider_action_required', { providerReference: transfer.id, lastError: 'Provider settlement reference is missing.' });
    return proof(order, row, 'provider_settled', { providerReference: transfer.id, providerSettlementId: transfer.recipient_settlement_id, providerStatus: transfer.settlement_status, amountPaise: row.payablePaise, lastError: null });
  }
  if (transfer.on_hold === true || transfer.on_hold === 1) {
    const authorization = await settlementOperation('authorize_release', order.id, { token });
    if (!authorization.allowed) return proof(order, row, 'reserved', { providerReference: transfer.id, providerStatus: 'on_hold', lastError: null });
    if (!marketplaceReserveCapability('razorpay').ready) return proof(order, row, 'provider_action_required', { providerReference: transfer.id, lastError: 'Written Route reserve activation must be configured before automatic release.' });
    await patchRouteHold(transfer.id, false);
    transfer = await razorpayRequest(`transfers/${transfer.id}`);
    if (!matchingRouteTransfer(transfer, order, row)) throw new Error('Transfer changed during release verification.');
    if (transfer.on_hold === true || transfer.on_hold === 1) return proof(order, row, 'reserved', { providerReference: transfer.id, providerStatus: 'on_hold', lastError: 'The provider still reports the hold. A later reconciliation will check it again.' });
    if (transfer.settlement_status === 'settled' && /^setl_[A-Za-z0-9]+$/.test(transfer.recipient_settlement_id || '')) return proof(order, row, 'provider_settled', { providerReference: transfer.id, providerSettlementId: transfer.recipient_settlement_id, providerStatus: 'settled', amountPaise: row.payablePaise, lastError: null });
    return proof(order, row, 'provider_pending', { providerReference: transfer.id, providerStatus: String(transfer.settlement_status || transfer.status || 'pending'), lastError: null });
  }
  const current = await settlementOperation('authorize_release', order.id, { token });
  if (order.marketplace?.reservePolicyVersion === MARKETPLACE_RESERVE_POLICY_VERSION && !current.allowed) return proof(order, row, 'review_required', { providerReference: transfer.id, lastError: 'The provider hold is not active while this payment is in reserve or risk review. Contact the provider immediately.' });
  return proof(order, row, 'provider_pending', { providerReference: transfer.id, providerStatus: String(transfer.settlement_status || transfer.status || 'pending'), lastError: null });
}
async function cashfreeProof(order: any, row: any, token: string) {
  if (cashfreeConfig().environment !== 'live') throw new Error('Use the original live Cashfree credentials.');
  const reference = order.marketplace.providerAccountId;
  if (!identifier.test(reference)) throw new Error('The original vendor reference is unavailable.');
  const vendor = await cashfreeRequest(`easy-split/vendors/${reference}`);
  if (vendor.vendor_id !== reference) throw new Error('Vendor response mismatch.');
  const authorization = await settlementOperation('authorize_release', order.id, { token });
  // The documented vendor update API supports ACTIVE, but does not establish who
  // imposed a block or authorize overriding a provider/legal hold. Never reactivate
  // a blocked vendor automatically from a local case-resolution flag.
  if (vendor.status !== 'ACTIVE') return proof(order, row, 'provider_action_required', { providerStatus: String(vendor.status || 'unknown'), lastError: 'The provider vendor is blocked or inactive. Provider review is required; no vendor status was changed.' });
  const response = await cashfreeRequest(`easy-split/orders/${order.cashfreeOrderId || order.providerOrderId || order.id}`);
  const settlement = response?.settlement;
  if (settlement?.order_id !== (order.cashfreeOrderId || order.providerOrderId || order.id) || String(settlement.cf_payment_id) !== order.transactionId || settlement.order_currency !== 'INR') throw new Error('Cashfree order settlement does not match this payment.');
  const matches = (Array.isArray(response.vendors) ? response.vendors : []).filter((entry: any) => entry.vendor_id === reference);
  if (matches.length !== 1) throw new Error('A unique vendor allocation is not visible.');
  const allocation = matches[0];
  if (moneyPaise(allocation.settlement_amount) !== row.payablePaise) return proof(order, row, 'review_required', { lastError: 'Vendor allocation and refund-adjusted ledger differ. Review provider charges, refunds and reversals.' });
  // This endpoint supplies a vendor settlement ID but not its bank UTR/status.
  // The merchant settlement UTR belongs to another beneficiary and is never reused as vendor proof.
  return proof(order, row, authorization.allowed ? 'provider_pending' : 'reserved', { providerReference: allocation.settlement_id ? String(allocation.settlement_id) : undefined, providerStatus: vendor.status,
    lastError: allocation.settlement_id ? 'Vendor settlement reference is reported; confirm vendor bank credit in the provider dashboard. Merchant-bank UTR is not vendor proof.' : null });
}
async function reconcileOne(order: any) {
  const row = await ensure(order), token = auditId();
  const claim = await settlementOperation('claim', order.id, { token });
  if (!claim) return false;
  try {
    const result = row.provider === 'razorpay' ? await routeProof(order, row, token) : row.provider === 'cashfree' ? await cashfreeProof(order, row, token)
      : proof(order, row, 'provider_action_required', { lastError: marketplaceReserveCapability('easebuzz').message });
    await settlementOperation('finish', order.id, { token, proof: result });
    return true;
  } catch {
    await settlementOperation('note', order.id, { token, message: 'Original provider verification is pending. No bank settlement was assumed; review the provider and retry.' }).catch(() => undefined);
    throw new Error('Provider verification pending.');
  }
}
export async function reconcileMarketplaceSettlements(limit = 3) {
  const state = await settlementOperation<State>('state');
  const orders = (await sources()).sort((a, b) => String(state.settlements[a.id]?.lastAttemptAt || '').localeCompare(String(state.settlements[b.id]?.lastAttemptAt || '')))
    .filter(order => state.settlements[order.id]?.status !== 'provider_settled' || order._membershipRevoked === true ||
      (state.ledger?.[order.id] && (state.ledger[order.id].payablePaise !== state.settlements[order.id]?.payablePaise || state.ledger[order.id].settlementStatus === 'review_required'))).slice(0, Math.max(1, Math.min(10, Math.trunc(limit))));
  const results = await Promise.allSettled(orders.map(reconcileOne));
  return { checked: results.filter(result => result.status === 'fulfilled' && result.value).length, failed: results.filter(result => result.status === 'rejected').length, skipped: results.filter(result => result.status === 'fulfilled' && !result.value).length };
}
async function requestProviderRiskHolds(creatorId: string) {
  const outcomes: Record<string, string> = {};
  const orders = (await Store.getAllGlobalOrders()).filter(order => order.marketplace?.sellerId === creatorId && order.paymentEnvironment === 'live');
  for (const provider of providers) {
    // A risk action has already suspended the creator. Read its previously verified
    // provider reference directly; new-checkout KYC lookup deliberately rejects suspended sellers.
    const creator = await Store.get<any>(`marketplace/creators/${creatorId}`);
    const details = creator ? { account: creator.providerAccounts?.[provider] } : null;
    if (!details?.account?.reference || !marketplaceReserveCapability(provider).ready) { outcomes[provider] = 'provider_action_required'; continue; }
    try {
      if (provider === 'cashfree') {
        // No publicly verified BLOCKED-update operation is available in this
        // adapter. Record the action required instead of inventing a bank hold.
        outcomes[provider] = 'provider_action_required_contact_cashfree';
      } else if (provider === 'razorpay') {
        let held = 0;
        for (const order of orders.filter(order => String(order.paymentProvider).toLowerCase() === provider).slice(0, 3)) {
          const collection = await razorpayRequest(`payments/${order.transactionId}/transfers`);
          const ledger = await Store.get<any>(`marketplace/ledger/${order.id}`);
          for (const transfer of (collection.items || []).slice(0, 10)) if (ledger?.providerPaymentId === order.transactionId && ledger.sellerId === creatorId && matchingRouteTransfer(transfer, order, ledger) && transfer.settlement_status !== 'settled') {
            await patchRouteHold(transfer.id, true); const verified = await razorpayRequest(`transfers/${transfer.id}`);
            if (verified.id === transfer.id && verified.recipient === details.account.reference && (verified.on_hold === true || verified.on_hold === 1)) held++;
          }
        }
        outcomes[provider] = held ? 'verified_transfer_holds_partial_coverage' : 'provider_action_required';
      }
    } catch { outcomes[provider] = 'unconfirmed_contact_provider'; }
  }
  await Store.update(`marketplace/riskCases/${creatorId}`, { providerHold: outcomes, providerHoldCheckedAt: new Date().toISOString() });
  return outcomes;
}
export function registerSettlementRoutes(app: Express, auth: RequestHandler, admin: RequestHandler, limiter: RequestHandler) {
  app.get('/api/marketplace/admin/settlements', auth, admin, async (_req, res) => {
    const state = await settlementOperation<State>('state');
    res.json({ success: true, settlements: Object.values(state.settlements || {}).map(safeRow), riskCases: Object.values(state.riskCases || {}).map(safeRisk), capabilities: Object.fromEntries(providers.map(provider => [provider, marketplaceReserveCapability(provider)])) });
  });
  app.get('/api/marketplace/me/settlements', auth, async (req: any, res) => {
    const creatorId = await Store.get<string>(`marketplace/creatorUsers/${req.userId}`);
    if (!creatorId) return res.json({ success: true, settlements: [], riskReview: null });
    const state = await settlementOperation<State>('state');
    res.json({ success: true, settlements: Object.values(state.settlements || {}).filter(row => row.sellerId === creatorId).map(safeRow), riskReview: state.riskCases[creatorId] ? safeRisk(state.riskCases[creatorId]) : null });
  });
  app.post('/api/marketplace/admin/settlements/reconcile', auth, admin, limiter, async (req: any, res) => {
    const input = z.object({ reason: z.string().trim().min(10).max(1000) }).strict().safeParse(req.body);
    if (!input.success) return res.status(400).json({ success: false, message: 'A review reason of 10–1000 characters is required.' });
    const result = await reconcileMarketplaceSettlements(3), id = auditId();
    await Store.set(`marketplace/audit/${id}`, { id, actorId: req.userId, action: 'settlement_reconciled', reason: input.data.reason, createdAt: new Date().toISOString(), result });
    res.json({ success: true, ...result });
  });
  app.post('/api/marketplace/admin/creators/:id/risk', auth, admin, limiter, async (req: any, res) => {
    const input = z.object({ action: z.enum(['suspend', 'resolve']), category: z.enum(['chargeback', 'legal_complaint', 'prohibited_item', 'fraud', 'other']), reason: z.string().trim().min(10).max(1000), evidenceReference: z.string().trim().min(3).max(300), reviewed: z.literal(true) }).strict().safeParse(req.body);
    if (!identifier.test(req.params.id) || !input.success) return res.status(400).json({ success: false, message: 'Review the case, choose a category, and provide a reason and evidence reference.' });
    const risk = await settlementOperation(input.data.action === 'suspend' ? 'risk_open' : 'risk_resolve', req.params.id, { ...input.data, actorId: req.userId, auditId: auditId() });
    const providerHold = input.data.action === 'suspend' ? await requestProviderRiskHolds(req.params.id) : undefined;
    res.json({ success: true, riskReview: safeRisk({ ...risk, ...(providerHold ? { providerHold } : {}) }), message: input.data.action === 'suspend' ? 'New sales are suspended. Provider hold requests and their verified limits are recorded; already-settled funds cannot be assumed frozen.' : 'The case is resolved. The original 120-day review date remains; provider release still requires eligibility and verification.' });
  });
}
