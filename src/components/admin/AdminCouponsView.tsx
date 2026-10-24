import React, { useState, useEffect, useCallback } from 'react';
import { Edit3, Pause, Play, RefreshCw, Loader2, X } from 'lucide-react';
import { AdminService } from '../../services/AdminService';

export const AdminCouponsView: React.FC<{ refreshKey?: number }> = ({ refreshKey }) => {
  const [coupons, setCoupons] = useState<any[]>([]);
  const [code, setCode] = useState('');
  const [discountPercent, setDiscountPercent] = useState(10);
  const [minSpend, setMinSpend] = useState(0);
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [expiresAt, setExpiresAt] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');

  const fetchCoupons = useCallback(async () => {
    setLoading(true);
    try { setCoupons(await AdminService.getCoupons()); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Coupons could not be loaded. Please retry.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void fetchCoupons(); }, [fetchCoupons, refreshKey]);

  function resetForm() { setCode(''); setDiscountPercent(10); setMinSpend(0); setDescription(''); setActive(true); setExpiresAt(''); setEditingId(null); }
  function editCoupon(coupon: any) {
    setEditingId(coupon.id); setCode(coupon.code); setDiscountPercent(Number(coupon.discountPercent)); setMinSpend(Number(coupon.minSpend || 0)); setDescription(coupon.description || ''); setActive(coupon.active !== false);
    const date = coupon.expiresAt ? new Date(coupon.expiresAt) : null;
    setExpiresAt(date && Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
    setMessage(''); setError('');
  }
  async function saveCoupon(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setError(''); setMessage('');
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent >= 100 || !Number.isFinite(minSpend) || minSpend < 0) { setError('Use a discount above 0 and below 100, and a non-negative minimum spend.'); return; }
    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (expiry && !Number.isFinite(expiry.getTime())) { setError('Enter a valid expiry date.'); return; }
    setBusy(true);
    try {
      await AdminService.saveCoupon({ id: editingId || `coup_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`, code: code.trim().toUpperCase(), discountPercent, minSpend, description: description.trim(), active, ...(expiry ? { expiresAt: expiry.toISOString() } : {}) });
      const updated = Boolean(editingId); resetForm(); await fetchCoupons(); setMessage(updated ? 'Coupon updated.' : 'Coupon created.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Coupon could not be saved. Please retry.'); }
    finally { setBusy(false); }
  }
  async function toggleCoupon(coupon: any) {
    if (busy) return; setBusy(true); setError(''); setMessage('');
    try {
      await AdminService.saveCoupon({ ...coupon, active: coupon.active === false });
      await fetchCoupons(); setMessage(coupon.active === false ? 'Coupon enabled. Any expiry still applies.' : 'Coupon disabled.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Coupon status could not be changed.'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    {error && <div role="alert" className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm flex flex-wrap justify-between gap-3"><span>{error}</span><button disabled={loading || busy} onClick={() => void fetchCoupons()} className="font-bold inline-flex gap-1 items-center"><RefreshCw className="h-4 w-4" />Retry</button></div>}
    {message && <p role="status" className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm">{message}</p>}
    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
      <div className="flex justify-between items-center gap-3 mb-4"><h3 className="text-base font-semibold text-slate-900 dark:text-white">{editingId ? 'Edit Discount Coupon' : 'Create New Discount Coupon'}</h3>{editingId && <button type="button" disabled={busy} onClick={resetForm} className="text-xs font-semibold text-slate-500 inline-flex items-center gap-1"><X className="h-4 w-4" />Cancel edit</button>}</div>
      <form onSubmit={saveCoupon} className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div><label htmlFor="coupon-code" className="block text-xs font-semibold text-slate-500 mb-1">Coupon Code</label><input id="coupon-code" type="text" required minLength={2} maxLength={100} value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. SUMMER25" className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm uppercase" /></div>
        <div><label htmlFor="coupon-discount" className="block text-xs font-semibold text-slate-500 mb-1">Discount %</label><input id="coupon-discount" type="number" required min={0.01} max={99.99} step="0.01" value={discountPercent} onChange={e => setDiscountPercent(Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm" /></div>
        <div><label htmlFor="coupon-minimum" className="block text-xs font-semibold text-slate-500 mb-1">Min Spend (INR)</label><input id="coupon-minimum" type="number" min={0} step="0.01" value={minSpend} onChange={e => setMinSpend(Number(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm" /></div>
        <div><label htmlFor="coupon-expiry" className="block text-xs font-semibold text-slate-500 mb-1">Expires (local time, optional)</label><input id="coupon-expiry" type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm" /></div>
        <div className="sm:col-span-2"><label htmlFor="coupon-description" className="block text-xs font-semibold text-slate-500 mb-1">Description</label><input id="coupon-description" type="text" maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm" /></div>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Enabled</label>
        <div className="flex items-end"><button type="submit" disabled={busy} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition shadow-sm inline-flex justify-center items-center gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? 'Saving…' : editingId ? 'Save Coupon' : 'Add Coupon'}</button></div>
      </form>
    </div>
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
      <div className="overflow-x-auto"><table className="w-full text-left border-collapse"><thead><tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 uppercase"><th className="py-4 px-6">Code</th><th className="py-4 px-6">Discount</th><th className="py-4 px-6">Min Spend</th><th className="py-4 px-6">Status / Expiry</th><th className="py-4 px-6 text-right">Actions</th></tr></thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">{coupons.map(coupon => {
          const expired = Boolean(coupon.expiresAt && Date.parse(coupon.expiresAt) <= Date.now());
          const status = coupon.active === false ? 'Inactive' : expired ? 'Expired' : 'Active';
          return <tr key={coupon.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition"><td className="py-4 px-6"><p className="font-mono font-bold text-blue-600 dark:text-blue-400">{coupon.code}</p><p className="text-xs text-slate-500 mt-1">{coupon.description}</p></td><td className="py-4 px-6 font-semibold">{coupon.discountPercent}% OFF</td><td className="py-4 px-6">₹{coupon.minSpend || 0}</td><td className="py-4 px-6"><span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${status === 'Active' ? 'bg-emerald-100 text-emerald-700' : status === 'Expired' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{status}</span><p className="text-xs text-slate-500 mt-2">{coupon.expiresAt ? new Date(coupon.expiresAt).toLocaleString() : 'No expiry'}</p></td><td className="py-4 px-6 text-right"><div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => editCoupon(coupon)} className="px-3 py-1.5 rounded-xl text-xs bg-slate-100 dark:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-1"><Edit3 className="h-3.5 w-3.5" />Edit</button><button type="button" disabled={busy} onClick={() => void toggleCoupon(coupon)} className="px-3 py-1.5 rounded-xl text-xs border disabled:opacity-50 inline-flex items-center gap-1">{coupon.active === false ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}{coupon.active === false ? 'Enable' : 'Disable'}</button></div></td></tr>;
        })}{!coupons.length && <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">{loading ? 'Loading coupons…' : error ? 'Coupon list unavailable. Retry above.' : 'No coupons yet.'}</td></tr>}</tbody>
      </table></div>
      {loading && coupons.length > 0 && <p role="status" className="px-6 py-3 text-xs text-slate-500">Refreshing coupon statuses…</p>}
    </div>
  </div>;
};
