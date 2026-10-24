import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { getGatewayCapabilities, gatewayReadiness, type GatewayProvider } from './gatewayControl';
import { cashfreeRequest } from './cashfree';
import { razorpayRequest } from './razorpay';
import { getCreatorProviderDetails, updateCreatorProviderAccount } from './creatorMarketplace';

/** Easebuzz supplies approved bank labels out of band. They cannot be invented or activated in the admin UI. */
function approvedEasebuzzLabel(creatorId: string, environment: string) {
  let entries: any;
  try { entries = JSON.parse(process.env.EASEBUZZ_APPROVED_SPLIT_LABELS_JSON || '{}'); } catch { throw new Error('Easebuzz approved bank labels are not configured.'); }
  const entry = entries[creatorId];
  if (!entry || entry.environment !== environment || typeof entry.label !== 'string' || !/^[A-Za-z0-9 _-]{1,100}$/.test(entry.label) || !/^\d{4}$/.test(entry.accountLast4 || '') || !Number.isFinite(Date.parse(entry.providerConfirmedAt || ''))) throw new Error('This creator needs an Easebuzz-issued bank label and provider confirmation.');
  return entry;
}

/** Recheck the actual provider account before accepting new money; never trust an admin status toggle. */
export async function verifyCreatorGatewayAccount(creatorId: string, provider: GatewayProvider, reference: string, productId?: string, persist = true) {
  if (!getGatewayCapabilities(provider).marketplace) throw new Error('Marketplace settlement is not activated for this payment provider.');
  const details = await getCreatorProviderDetails(creatorId, provider);
  if (!details?.kyc) throw new Error('The creator must submit payout details first.');
  const environment = gatewayReadiness(provider).environment as 'live' | 'test';
  const kyc = details.kyc;
  let providerStatus = '';
  if (provider === 'cashfree') {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(reference)) throw new Error('Invalid Cashfree vendor reference.');
    const vendor = await cashfreeRequest(`easy-split/vendors/${reference}`);
    if (vendor.vendor_id !== reference || vendor.status !== 'ACTIVE' || String(vendor.bank?.account_number) !== kyc.bankAccount || String(vendor.bank?.ifsc).toUpperCase() !== kyc.ifsc.toUpperCase()) throw new Error('Cashfree vendor is not active or does not match this creator’s bank account.');
    providerStatus = vendor.status;
  } else if (provider === 'razorpay') {
    const existing: any = details.account;
    const routeProductId = productId || existing?.productId || /^activated:(acc_prd_[A-Za-z0-9]+)$/.exec(existing?.providerStatus || '')?.[1];
    if (!/^acc_[A-Za-z0-9]+$/.test(reference) || !/^acc_prd_[A-Za-z0-9]+$/.test(routeProductId || '')) throw new Error('Provide the Razorpay linked account and Route product reference.');
    const product = await razorpayRequest(`accounts/${reference}/products/${routeProductId}`, undefined, 'v2');
    const bank = product.active_configuration?.settlements;
    if (product.account_id !== reference || product.id !== routeProductId || product.product_name !== 'route' || product.activation_status !== 'activated' || String(bank?.account_number) !== kyc.bankAccount || String(bank?.ifsc_code).toUpperCase() !== kyc.ifsc.toUpperCase()) throw new Error('Razorpay Route is not activated for this creator’s bank account.');
    providerStatus = `activated:${routeProductId}`;
  } else {
    const entry = approvedEasebuzzLabel(creatorId, environment);
    if (entry.label !== reference || !kyc.bankAccount.endsWith(entry.accountLast4)) throw new Error('Easebuzz approved bank label does not match this creator.');
    providerStatus = `provider_confirmed_label:${entry.providerConfirmedAt}`;
  }
  if (persist) await updateCreatorProviderAccount(creatorId, provider, { reference, status: 'verified', environment, providerVerifiedAt: new Date().toISOString(), providerStatus });
  return { verified: true, environment, providerStatus };
}

export async function marketplaceSplitForOrder(order: any, provider: GatewayProvider) {
  const snapshot = order?.marketplace;
  if (!snapshot) return {};
  if (!getGatewayCapabilities(provider).marketplace || snapshot.provider !== provider || !Number.isSafeInteger(snapshot.grossPaise) || snapshot.grossPaise !== Math.round(order.total * 100) || !Number.isSafeInteger(snapshot.sellerPaise) || !Number.isSafeInteger(snapshot.commissionPaise) || snapshot.sellerPaise <= 0 || snapshot.sellerPaise + snapshot.commissionPaise !== snapshot.grossPaise) throw new Error('The creator settlement snapshot does not match this checkout.');
  const details = await getCreatorProviderDetails(snapshot.sellerId, provider);
  const account: any = details?.account;
  if (account?.status !== 'verified' || account.reference !== snapshot.providerAccountId || account.environment !== gatewayReadiness(provider).environment) throw new Error('This creator is not verified for this payment provider and environment.');
  const productId = account.productId || (/^activated:(acc_prd_[A-Za-z0-9]+)$/.exec(account.providerStatus || '')?.[1]);
  await verifyCreatorGatewayAccount(snapshot.sellerId, provider, account.reference, productId, false);
  if (provider === 'cashfree') return { order_splits: [{ vendor_id: account.reference, amount: snapshot.sellerPaise / 100 }] };
  if (provider === 'razorpay') return { transfers: [{ account: account.reference, amount: snapshot.sellerPaise, currency: 'INR', notes: { store_order_id: order.id, seller_id: snapshot.sellerId } }] };
  return { splitPayments: { [account.reference]: snapshot.sellerPaise / 100 } };
}

export function registerCreatorGatewayRoutes(app: Express, auth: RequestHandler, admin: RequestHandler, limiter: RequestHandler) {
  app.post('/api/marketplace/admin/creators/:id/providers/:provider/verify', auth, admin, limiter, async (req, res) => {
    const input = z.object({ reference: z.string().min(1).max(100), productId: z.string().max(100).optional() }).strict().safeParse(req.body);
    const provider = z.enum(['cashfree', 'razorpay', 'easebuzz']).safeParse(req.params.provider);
    if (!input.success || !provider.success || !/^[A-Za-z0-9_-]{1,100}$/.test(String(req.params.id))) return res.status(400).json({ success: false, message: 'Provide a valid creator and provider reference.' });
    try { res.json({ success: true, ...await verifyCreatorGatewayAccount(String(req.params.id), provider.data, input.data.reference, input.data.productId) }); }
    catch (error) { res.status(409).json({ success: false, message: error instanceof Error ? error.message : 'Provider verification could not be completed.' }); }
  });
}
