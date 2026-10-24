import React, { useState } from 'react';
import { AdminService } from '../../services/AdminService';
import { adminButton, adminDate, adminInput, adminPanel, AdminLoadState, AdminRefresh, useAdminCollection } from './AdminManagementShared';

const getRequests = () => AdminService.getSupportRequests();
export function AdminSupportView({ refreshKey }: { refreshKey?: number }) {
  const { rows, loading, error, load } = useAdminCollection<any>(getRequests, refreshKey);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<any>(null);
  const [status, setStatus] = useState<'open' | 'in_progress' | 'resolved'>('open');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const filtered = rows.filter(row => (filter === 'all' || (row.status || 'open') === filter) && `${row.reference} ${row.name} ${row.email} ${row.message}`.toLowerCase().includes(search.toLowerCase()));
  const open = (row: any) => { setSelected(row); setStatus(['open', 'in_progress', 'resolved'].includes(row.status) ? row.status : 'open'); setNotes(row.adminNotes || ''); setMessage(''); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage('');
    try {
      await AdminService.updateSupportRequest(selected.id || selected.reference, { status, adminNotes: notes });
      setMessage('Support record updated. No message has been sent to the customer.');
      await load();
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : 'Could not update this request.'); }
    finally { setSaving(false); }
  };
  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Support inbox</h2><p className="text-sm text-slate-500">Track customer enquiries and record their resolution.</p></div><AdminRefresh loading={loading} onClick={load} /></div>
    <AdminLoadState loading={loading} error={error} onRetry={load} />
    <div className="flex flex-col sm:flex-row gap-3"><input aria-label="Search support requests" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, reference or message" className={adminInput} /><select aria-label="Support status filter" value={filter} onChange={e => setFilter(e.target.value)} className={`${adminInput} sm:max-w-48`}><option value="all">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select></div>
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-3">{!loading && !error && !filtered.length && <p className={adminPanel}>No support requests match this view.</p>}{filtered.map(row => <button type="button" key={row.id || row.reference} onClick={() => open(row)} className={`${adminPanel} text-left w-full hover:border-blue-400 ${selected && (selected.id || selected.reference) === (row.id || row.reference) ? 'ring-2 ring-blue-500' : ''}`}><div className="flex justify-between gap-2 text-sm"><strong>{row.name || 'Customer'}</strong><span className="capitalize text-blue-600">{String(row.status || 'open').replaceAll('_', ' ')}</span></div><p className="text-xs text-slate-500 break-all">{row.email} · {row.reference || row.id}</p><p className="text-sm mt-2 line-clamp-2 whitespace-pre-wrap">{row.message}</p><p className="text-xs text-slate-400 mt-2">{adminDate(row.createdAt)}</p></button>)}</div>
      {selected && <form onSubmit={save} className={`${adminPanel} space-y-4 h-fit`}><h3 className="font-bold">{selected.reference || selected.id}</h3><p className="text-sm break-all">{selected.name} · {selected.email}</p><p className="text-sm whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">{selected.message}</p><label className="block text-sm">Status<select value={status} onChange={e => setStatus(e.target.value as 'open' | 'in_progress' | 'resolved')} className={`${adminInput} mt-1`}><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select></label><label className="block text-sm">Private admin notes<textarea maxLength={4000} rows={5} value={notes} onChange={e => setNotes(e.target.value)} className={`${adminInput} mt-1`} /></label><p className="text-xs text-slate-500">Notes are internal. Contact the customer using your support mailbox when a reply is needed.</p>{message && <p role="status" className="text-sm">{message}</p>}<button disabled={saving} className={adminButton}>{saving ? 'Saving…' : 'Save resolution'}</button></form>}
    </div>
  </div>;
}
