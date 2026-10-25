import { createClient } from '@supabase/supabase-js';

/** Supabase's Vercel integration supplies modern names; older projects use JWT key names. */
export function supabaseCredentials() {
  return {
    url: process.env.SUPABASE_URL || '',
    secretKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  };
}
export const isSupabaseAdminConfigured = () => { const config = supabaseCredentials(); return Boolean(config.url && config.secretKey); };
export const isSupabaseAuthConfigured = () => { const config = supabaseCredentials(); return Boolean(config.url && config.publishableKey); };

export const SUPABASE_REQUEST_TIMEOUT_MS = 10000;
/** Bound SDK calls without discarding the SDK's headers, body or caller abort. */
export const supabaseFetch: typeof fetch = (input, init) => {
  const inheritedSignal = init?.signal || (input instanceof Request ? input.signal : undefined);
  const timeout = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
  const signal = inheritedSignal ? AbortSignal.any([inheritedSignal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};
export function supabaseAdmin() {
  const config = supabaseCredentials();
  if (!isSupabaseAdminConfigured()) throw new Error('Supabase is not configured.');
  return createClient(config.url, config.secretKey, { global: { fetch: supabaseFetch }, auth: { persistSession: false, autoRefreshToken: false } });
}
export function supabaseAuth() {
  const config = supabaseCredentials();
  if (!isSupabaseAuthConfigured()) throw new Error('Supabase Auth is not configured.');
  return createClient(config.url, config.publishableKey, { global: { fetch: supabaseFetch }, auth: { persistSession: false, autoRefreshToken: false } });
}
