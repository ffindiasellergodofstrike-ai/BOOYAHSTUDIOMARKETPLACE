import { appOrigin } from './config';
import { isSupabaseAdminConfigured, isSupabaseAuthConfigured, supabaseAdmin } from './supabase';

export interface SetupCheck { id: string; status: 'ready' | 'missing' | 'invalid' | 'manual' | 'error' | 'not_required'; required: boolean; message: string; }
const presence = (id: string, ready: boolean, message: string, required = true): SetupCheck => ({ id, status: ready ? 'ready' : 'missing', required, message });

/** Presence and shape only: this report must never serialize environment values. */
export function offlineSetupChecks(): SetupCheck[] {
  let originValid = false, publicOriginMatches = false;
  try {
    const origin = appOrigin(); originValid = true;
    const visible = new URL(process.env.VITE_SITE_URL || '');
    publicOriginMatches = visible.origin === origin && visible.pathname === '/' && !visible.username && !visible.password && !visible.search && !visible.hash;
  } catch { /* Invalid values are deliberately not included in the report. */ }
  const encryptionReady = Buffer.from(process.env.MARKETPLACE_ENCRYPTION_KEY || '', 'base64').length === 32;
  const provider = Boolean((process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY) ||
    (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET) ||
    (process.env.EASEBUZZ_KEY && process.env.EASEBUZZ_SALT));
  return [
    presence('trusted_origin', originValid, 'Set APP_URL to the final trusted HTTPS origin; localhost is allowed only during development.'),
    presence('public_origin', publicOriginMatches, 'Set public VITE_SITE_URL to the same origin as APP_URL before building.'),
    presence('supabase_database', isSupabaseAdminConfigured(), 'Use SUPABASE_URL with SUPABASE_SECRET_KEY or legacy SUPABASE_SERVICE_ROLE_KEY, on the server only.'),
    presence('supabase_auth', isSupabaseAuthConfigured(), 'Use SUPABASE_PUBLISHABLE_KEY or legacy SUPABASE_ANON_KEY with the same project URL.'),
    presence('seller_encryption', encryptionReady, 'MARKETPLACE_ENCRYPTION_KEY must decode to 32 bytes. Back it up before collecting seller KYC.'),
    presence('email_configuration', Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL), 'Configure Resend API key and a sender on the verified domain; actual inbox delivery still requires testing.'),
    presence('scheduler_secret', Boolean(process.env.CRON_SECRET), 'Configure CRON_SECRET and a scheduled job; verify actual last-run status after deployment.'),
    { id: 'payment_provider', status: provider ? 'manual' : 'missing', required: true, message: provider ? 'Credentials are present. Provider activation, marketplace/recurring permissions, admin enablement and sandbox verification remain separate checks.' : 'Configure at least one payment provider before accepting paid orders.' },
    { id: 'postgres_password', status: 'not_required', required: false, message: 'The app uses Supabase HTTPS APIs. POSTGRES_PASSWORD is not required by this runtime; CLI/direct SQL connections may need separate database credentials.' },
  ];
}

const schemaMessages: Record<string, string> = {
  storeRpc: 'Apply supabase/schema.sql.',
  creatorRpc: 'Apply the creator marketplace migrations.',
  subscriptionRpc: 'Apply 202610230004_subscriptions.sql.',
  settlementRpc: 'Apply 202610240003_settlements.sql.',
  monthlyQuotaRpc: 'Apply 202610240002_plans.sql.',
  monthlyQuotaEnforced: 'Apply 202610240011_creator_marketplace.sql after the plan migration.',
  creatorCatalogV2: 'Apply the versioned creator plan migration; existing paid snapshots are preserved.',
  privateProductBucket: 'Create the products bucket and keep it private.',
  tenMbObjectLimit: 'Apply 202610240010_uploads.sql to enforce the 10 MB object cap in Storage.',
};

/** Only read-only calls: no auth signup, migration, file upload, email or gateway request. */
export async function onlineSetupChecks(): Promise<SetupCheck[]> {
  if (!isSupabaseAdminConfigured()) return [{ id: 'online_connection', status: 'missing', required: true, message: 'Server Supabase credentials are required before online checks.' }];
  const client = supabaseAdmin();
  const results = await Promise.allSettled([
    client.rpc('store_operation', { operation: 'get', key: 'settings', value: null }),
    client.rpc('marketplace_setup_status'),
    client.storage.getBucket('products'),
  ]);
  const database = results[0].status === 'fulfilled' && !results[0].value.error;
  const schema = results[1].status === 'fulfilled' && !results[1].value.error ? results[1].value.data : null;
  const bucket = results[2].status === 'fulfilled' && !results[2].value.error ? results[2].value.data : null;
  const checks: SetupCheck[] = [
    { id: 'online_database', status: database ? 'ready' : 'error', required: true, message: database ? 'The service-only store responded over HTTPS.' : 'Database access failed. Check the project URL/server key, project status and baseline schema.' },
    { id: 'online_readiness_rpc', status: schema && typeof schema === 'object' && !Array.isArray(schema) ? 'ready' : 'error', required: true, message: schema ? 'Read-only deployment checks responded.' : 'Apply 202610240004_setup_readiness.sql and all required migrations; online errors are not echoed because they may contain private details.' },
    { id: 'online_private_storage', status: bucket?.public === false ? 'ready' : 'error', required: true, message: bucket?.public === false ? 'The products bucket is reachable and private.' : 'Product Storage is unavailable or public. Configure the private products bucket.' },
  ];
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) for (const [id, message] of Object.entries(schemaMessages)) checks.push({ id: `schema_${id}`, status: schema[id] === true ? 'ready' : 'error', required: true, message: schema[id] === true ? 'Verified.' : message });
  return checks;
}

export const setupChecksPass = (checks: SetupCheck[]) => checks.every(check => !check.required || ['ready', 'manual'].includes(check.status));
