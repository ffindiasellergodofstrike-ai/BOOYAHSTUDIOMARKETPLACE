/** Server-only Postgres document adapter. Never import this module into the browser. */
export const usesSupabase = () => process.env.DATABASE_PROVIDER === 'supabase';
export async function supabaseRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const base = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !secret) throw new Error('Supabase server credentials are required.');
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Supabase requires HTTPS.');
  const response = await fetch(`${url.origin}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Database operation failed (HTTP ${response.status}).`);
  return await response.json() as T;
}
export const SupabaseStore = {
  get: <T>(path: string) => supabaseRpc<T | null>('store_read', { p_path: path }),
  set: <T>(path: string, data: T) => supabaseRpc<T>('store_write', { p_path: path, p_data: data, p_mode: 'set' }),
  update: <T>(path: string, data: T) => supabaseRpc<T>('store_write', { p_path: path, p_data: data, p_mode: 'patch' }),
  delete: (path: string) => supabaseRpc('store_write', { p_path: path, p_data: null, p_mode: 'delete' }),
  multiple: (updates: Record<string, unknown>) => supabaseRpc('store_multiple', { p_updates: updates }),
};
