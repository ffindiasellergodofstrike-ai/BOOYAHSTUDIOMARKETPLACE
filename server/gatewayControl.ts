import crypto from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { Store } from './store';

export const gatewayProviders = ['cashfree', 'razorpay', 'easebuzz'] as const;
export type GatewayProvider = typeof gatewayProviders[number];
const providerSchema = z.enum(gatewayProviders);
export interface GatewaySettings {
  version: 1;
  enabled: Record<GatewayProvider, boolean>;
  defaultProvider: GatewayProvider;
  commissionBps: number;
  updatedAt?: string;
  updatedBy?: string;
}
const settingsKey = 'marketplace/gateway-settings';
const defaults: GatewaySettings = { version: 1, enabled: { cashfree: false, razorpay: false, easebuzz: false }, defaultProvider: 'cashfree', commissionBps: 1000 };

/** Missing settings never silently activate a payment account. */
export async function getGatewaySettings(): Promise<GatewaySettings> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { ...defaults, enabled: { ...defaults.enabled } };
  const stored = await Store.get<GatewaySettings>(settingsKey);
  return { ...defaults, ...stored, version: 1, enabled: { ...defaults.enabled, ...stored?.enabled } };
}
export function getGatewayCapabilities(provider: GatewayProvider) {
  const configured = gatewayReadiness(provider).configured;
  const marketplace = configured && process.env[provider === 'cashfree' ? 'CASHFREE_EASYSPLIT_APPROVED' : provider === 'razorpay' ? 'RAZORPAY_ROUTE_APPROVED' : 'EASEBUZZ_MARKETPLACE_APPROVED'] === 'true';
  const subscriptions = configured && provider !== 'easebuzz' && process.env[provider === 'cashfree' ? 'CASHFREE_SUBSCRIPTIONS_APPROVED' : 'RAZORPAY_SUBSCRIPTIONS_APPROVED'] === 'true';
  return { marketplace, subscriptions, automaticRenewal: subscriptions };
}
export function gatewayReadiness(provider: GatewayProvider) {
  const database = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const credentials = provider === 'cashfree' ? Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY)
    : provider === 'razorpay' ? Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET)
      : Boolean(process.env.EASEBUZZ_KEY && process.env.EASEBUZZ_SALT);
  const validEnvironment = provider === 'cashfree' ? ['sandbox', 'production'].includes(process.env.CASHFREE_ENV || 'sandbox')
    : provider === 'easebuzz' ? ['test', 'prod'].includes(process.env.EASEBUZZ_ENV || 'test') : /^rzp_(test|live)_/.test(process.env.RAZORPAY_KEY_ID || '');
  const environment = provider === 'cashfree' ? (process.env.CASHFREE_ENV === 'production' ? 'live' : 'test')
    : provider === 'razorpay' ? (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_live_') ? 'live' : 'test') : process.env.EASEBUZZ_ENV === 'prod' ? 'live' : 'test';
  const readiness = [...(!database ? ['Database connection is required.'] : []), ...(!credentials ? ['Server credentials are missing.'] : []), ...(!validEnvironment ? ['Payment environment is invalid.'] : [])];
  return { configured: database && credentials && validEnvironment, environment, readiness };
}
export async function getPublicGatewayConfig() {
  const settings = await getGatewaySettings();
  const gateways = Object.fromEntries(gatewayProviders.map(provider => {
    const state = gatewayReadiness(provider);
    return [provider, { ...state, enabled: settings.enabled[provider], ready: state.configured && settings.enabled[provider], isDefault: settings.defaultProvider === provider, capabilities: getGatewayCapabilities(provider) }];
  })) as Record<GatewayProvider, ReturnType<typeof gatewayReadiness> & { enabled: boolean; ready: boolean; isDefault: boolean; capabilities: ReturnType<typeof getGatewayCapabilities> }>;
  const priority = [settings.defaultProvider, ...gatewayProviders.filter(provider => provider !== settings.defaultProvider)];
  return { gateways, activeProvider: priority.find(provider => gateways[provider].ready) || null };
}
export async function getActiveGateway(): Promise<GatewayProvider | null> { return (await getPublicGatewayConfig()).activeProvider; }

/** Applied only to creating/opening checkout, never to historical callbacks or refunds. */
export async function assertGatewayForNewOrder(provider: GatewayProvider, order?: any) {
  const parsed = providerSchema.safeParse(provider);
  if (!parsed.success) throw new Error('Choose an available payment provider.');
  const config = await getPublicGatewayConfig();
  if (!config.gateways[provider].ready) throw new Error('This payment provider is unavailable for new checkout.');
  if (order?.paymentProvider && String(order.paymentProvider).toLowerCase() !== provider) throw new Error('This order belongs to another payment provider.');
  if (order?.paymentEnvironment && order.paymentEnvironment !== config.gateways[provider].environment) throw new Error('This order belongs to another payment environment.');
  if (order?.marketplace && !getGatewayCapabilities(provider).marketplace) throw new Error('Creator checkout requires an activated marketplace payment account.');
  return config.gateways[provider];
}

export function registerGatewayControlRoutes(app: Express, auth: RequestHandler, admin: RequestHandler, limiter: RequestHandler) {
  app.get('/api/marketplace/admin/gateways', auth, admin, async (_req, res) => {
    res.json({ success: true, settings: await getGatewaySettings(), ...await getPublicGatewayConfig() });
  });
  app.patch('/api/marketplace/admin/gateways', auth, admin, limiter, async (req: any, res) => {
    const parsed = z.object({ enabled: z.object({ cashfree: z.boolean().optional(), razorpay: z.boolean().optional(), easebuzz: z.boolean().optional() }).strict().optional(), defaultProvider: providerSchema.optional(), commissionBps: z.number().int().min(0).max(5000).optional(), reason: z.string().trim().min(5).max(500) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Choose valid gateway settings and give a reason (5–500 characters).' });
    const previous = await getGatewaySettings();
    const { reason, ...input } = parsed.data;
    const settings: GatewaySettings = { ...previous, ...input, enabled: { ...previous.enabled, ...input.enabled }, version: 1, updatedAt: new Date().toISOString(), updatedBy: req.userId };
    for (const provider of gatewayProviders) if (settings.enabled[provider] && !gatewayReadiness(provider).configured) return res.status(409).json({ success: false, message: `${provider} needs valid server credentials and a database connection before it can be enabled.` });
    if (Object.values(settings.enabled).some(Boolean) && !settings.enabled[settings.defaultProvider]) return res.status(409).json({ success: false, message: 'Enable the default provider or choose another enabled default.' });
    const id = `gateway_${crypto.randomUUID()}`;
    // Settings and their audit entry commit together in the service-only store transaction.
    await Store.setMultiple({ [settingsKey]: settings, [`marketplace/audit/${id}`]: { id, actorId: req.userId, action: 'gateway_settings_changed', reason, previous, current: settings, createdAt: settings.updatedAt } });
    res.json({ success: true, settings, ...await getPublicGatewayConfig() });
  });
}
