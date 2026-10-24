import React, { useState } from 'react';
import { AdminService } from '../../services/AdminService';
import { adminDate, adminInput, adminPanel, AdminLoadState, AdminRefresh, useAdminCollection } from './AdminManagementShared';

const getSubscribers = () => AdminService.getSubscribers();
export function AdminSubscribersView({ refreshKey }: { refreshKey?: number }) {
  const { rows, loading, error, load } = useAdminCollection<any>(getSubscribers, refreshKey);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const update = async (row: any) => {
    if (!confirm(`Unsubscribe ${row.email}? This updates the website record; also remove them from any external mailing list you use.`)) return;
    setBusy(row.id); setMessage('');
    try { await AdminService.updateSubscriber(row.id, { subscribed: false }); await load(); setMessage('Subscriber opted out in the website record.'); }
    catch (failure) { setMessage(failure instanceof Error ? failure.message : 'Could not update the subscriber.'); }
    finally { setBusy(''); }
  };
  const filtered = rows.filter(row => String(row.email || '').toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-5"><div className="flex justify-between gap-3 items-center"><div><h2 className="text-lg font-bold">Newsletter subscribers</h2><p className="text-sm text-slate-500">Review recorded consent and process opt-outs.</p></div><AdminRefresh loading={loading} onClick={load} /></div><AdminLoadState loading={loading} error={error} onRetry={load} />{message && <p role="status" className={`${adminPanel} text-sm`}>{message}</p>}<input aria-label="Search subscribers" value={search} onChange={e => setSearch(e.target.value)} className={adminInput} placeholder="Search email" /><div className={`${adminPanel} overflow-x-auto`}><table className="w-full text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="py-3 pr-4">Email</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Consent recorded</th><th className="py-3">Action</th></tr></thead><tbody>{filtered.map(row => <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800"><td className="py-3 pr-4 break-all">{row.email}</td><td className="py-3 pr-4 capitalize">{row.status || (row.subscribed === false ? 'unsubscribed' : 'subscribed')}</td><td className="py-3 pr-4">{adminDate(row.lastConsentAt || row.subscribedAt)}</td><td className="py-3">{row.status !== 'unsubscribed' && row.subscribed !== false ? <button type="button" disabled={!!busy} onClick={() => update(row)} className="text-rose-600 underline disabled:opacity-50">{busy === row.id ? 'Saving…' : 'Unsubscribe'}</button> : <span className="text-xs text-slate-500">New customer consent required to subscribe again</span>}</td></tr>)}</tbody></table>{!loading && !error && !filtered.length && <p className="text-sm py-4 text-slate-500">No subscribers match this view.</p>}</div><p className="text-xs text-slate-500">This panel does not send campaigns or change an external email provider's audience.</p></div>;
}
