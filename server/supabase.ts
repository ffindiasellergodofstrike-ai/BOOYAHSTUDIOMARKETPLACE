import { createClient } from '@supabase/supabase-js';

export const SUPABASE_REQUEST_TIMEOUT_MS = 10000;
/** Bound SDK calls without discarding the SDK's headers, body or caller abort. */
export const supabaseFetch: typeof fetch = (input, init) => {
  const inheritedSignal = init?.signal || (input instanceof Request ? input.signal : undefined);
  const timeout = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
  const signal = inheritedSignal ? AbortSignal.any([inheritedSignal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};
export function supabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase is not configured.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { global: { fetch: supabaseFetch }, auth: { persistSession: false, autoRefreshToken: false } });
}
export function supabaseAuth() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw new Error('Supabase Auth is not configured.');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { global: { fetch: supabaseFetch }, auth: { persistSession: false, autoRefreshToken: false } });
}
