import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { MarketplaceAdminService } from '../../services/MarketplaceAdminService';

export const marketplaceProviders = ['cashfree', 'razorpay', 'easebuzz'] as const;
export type MarketplaceProvider = typeof marketplaceProviders[number];
export const providerName = (provider: string) => ({ cashfree: 'Cashfree', razorpay: 'Razorpay', easebuzz: 'Easebuzz' }[provider] || provider || '—');
export const marketplaceMoney = (value: unknown, paise = false) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount / (paise ? 100 : 1)) : '—';
};
export const marketplaceDate = (value: unknown) => {
  if (!value) return '—';
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
};
export function safeReviewUrl(value: unknown) {
  if (typeof value !== 'string' || !value) return undefined;
  try { const url = new URL(value, window.location.origin); return url.protocol === 'https:' || url.origin === window.location.origin ? url.href : undefined; }
  catch { return undefined; }
}
export function StatusBadge({ value, label }: { value?: string | boolean; label?: string }) {
  const status = String(value ?? 'unknown').toLowerCase();
  const tone = ['approved', 'active', 'verified', 'paid', 'delivered', 'available', 'enabled', 'live', 'sent', 'succeeded'].includes(status) ? 'good'
    : ['failed', 'rejected', 'suspended', 'revoked', 'refunded', 'cancelled', 'canceled', 'unavailable'].includes(status) ? 'bad' : 'neutral';
  return <span className={`mpa-badge mpa-badge-${tone}`}>{label || status.replaceAll('_', ' ')}</span>;
}

export function useMarketplaceAdminData<T>(section: string, refreshKey = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const attempt = ++sequence.current;
    setLoading(true);
    try {
      const response = await MarketplaceAdminService.getSection<T>(section);
      if (attempt === sequence.current) { setData(response); setError(''); setUpdatedAt(new Date().toISOString()); }
    } catch (failure) {
      if (attempt === sequence.current) {
        setError(failure instanceof Error ? failure.message : 'This section could not be loaded. Please retry.');
        if ([401, 403].includes(Number((failure as { httpStatus?: number })?.httpStatus))) setData(null);
      }
    } finally { if (attempt === sequence.current) setLoading(false); }
  }, [section]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load, refreshKey]);
  return { data, loading, error, updatedAt, load };
}

export function MarketplaceSectionHeading({ title, description, state, children }: {
  title: string; description: string; state: { loading: boolean; error: string; updatedAt: string | null; load: () => Promise<void> }; children?: React.ReactNode;
}) {
  return <>
    <div className="mpa-section-heading"><div><h3>{title}</h3><p>{description}</p></div><div className="mpa-actions">{children}<button type="button" className="mpa-button mpa-button-secondary" disabled={state.loading} onClick={() => void state.load()}><RefreshCw size={15} className={state.loading ? 'animate-spin' : ''} />Refresh</button></div></div>
    {state.loading && <p className="mpa-loading" role="status"><Loader2 size={16} className="animate-spin" />{state.updatedAt ? 'Refreshing current records…' : 'Loading records…'}</p>}
    {state.error && <div className="mpa-alert mpa-alert-error" role="alert"><AlertCircle size={17} /><div>{state.error}{state.updatedAt && <small>Previously loaded records are shown. Refresh successfully before making changes.</small>}<button type="button" className="mpa-text-button" disabled={state.loading} onClick={() => void state.load()}>Retry</button></div></div>}
    {!state.loading && !state.error && state.updatedAt && <p className="mpa-updated">Updated {marketplaceDate(state.updatedAt)}</p>}
  </>;
}
export function MarketplaceEmpty({ children }: { children: React.ReactNode }) {
  return <div className="mpa-empty"><Inbox size={28} /><p>{children}</p></div>;
}
export function MarketplaceSearch({ value, onChange, label = 'Search records' }: { value: string; onChange: (value: string) => void; label?: string }) {
  return <label className="mpa-search"><span className="sr-only">{label}</span><input type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={label} /></label>;
}
