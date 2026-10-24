import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

export const adminPanel = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5';
export const adminInput = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm';
export const adminButton = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50';
export function adminDate(value: unknown) {
  const date = new Date(typeof value === 'number' ? value : String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '—';
}
export function useAdminCollection<T>(fetcher: () => Promise<T[]>, refreshKey?: number) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const attempt = ++sequence.current;
    setLoading(true);
    try {
      const next = await fetcher();
      if (attempt === sequence.current) { setRows(next); setError(''); }
    } catch (failure) {
      if (attempt === sequence.current) setError(failure instanceof Error ? failure.message : 'This section could not be loaded. Please retry.');
    } finally { if (attempt === sequence.current) setLoading(false); }
  }, [fetcher]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load, refreshKey]);
  return { rows, setRows, loading, error, load };
}
export function AdminLoadState({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  return <>
    {loading && <p className="text-sm text-slate-500 flex items-center gap-2" role="status"><Loader2 className="w-4 h-4 animate-spin" />Refreshing records…</p>}
    {error && <div className="p-3 rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300 text-sm" role="alert">{error} <button type="button" onClick={onRetry} className="underline font-semibold ml-2">Retry</button></div>}
  </>;
}
export function AdminRefresh({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return <button type="button" disabled={loading} onClick={onClick} className="inline-flex gap-2 items-center border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>;
}
