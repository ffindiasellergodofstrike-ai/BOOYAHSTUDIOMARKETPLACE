import { FirebaseRtdb as DB } from './firebaseRtdb';
import { supabaseRpc, usesSupabase } from './supabaseStore';
const queues = new Map<string, Promise<unknown>>();
/** Pure callback: can run more than once under optimistic concurrency. */
export async function atomicDocument<T>(collection: string, id: string, change: (value: T | null) => T): Promise<T> {
  if (!/^[a-zA-Z0-9_-]+$/.test(collection) || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid record identifier');
  if (usesSupabase()) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const snapshot = await supabaseRpc<{ data: T | null; version: number }>('store_snapshot', { p_collection: collection, p_id: id });
      const next = change(snapshot.data);
      if (await supabaseRpc<boolean>('store_compare_set', { p_collection: collection, p_id: id, p_version: snapshot.version, p_data: next })) return next;
    }
    throw new Error('Record is busy. Please retry.');
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Marketplace requires Supabase transactional storage.');
  const path = `${collection}/${id}`;
  const previous = queues.get(path) || Promise.resolve();
  const result = previous.catch(() => {}).then(async () => {
    const next = change(structuredClone(await DB.get<T>(path)));
    await DB.set(path, next); return next;
  });
  queues.set(path, result);
  try { return await result; } finally { if (queues.get(path) === result) queues.delete(path); }
}
