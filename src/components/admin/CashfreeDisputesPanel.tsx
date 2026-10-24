import React, { useState } from 'react';
import { PROXIED_UPLOAD_LIMIT_BYTES, PROXIED_UPLOAD_LIMIT_LABEL } from '../../config/uploadLimits';

interface Props { orders: any[]; }

const dateLabel = (value: unknown): string => {
  const date = new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Not supplied';
};

export const CashfreeDisputesPanel: React.FC<Props> = ({ orders }) => {
  const [disputes, setDisputes] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [reviewed, setReviewed] = useState(false);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/cashfree/disputes', { credentials: 'include', cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Could not load disputes.');
      setDisputes(Array.isArray(result.disputes) ? result.disputes : []);
      setLoaded(true);
    } catch (error: any) { setMessage(error.message || 'Could not load disputes.'); }
    finally { setBusy(false); }
  }

  async function refresh(dispute: any) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/admin/cashfree/disputes/${encodeURIComponent(dispute.id)}/refresh`, { method: 'POST', credentials: 'include' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Could not refresh the dispute.');
      setSelected(null); setReviewed(false);
      await load();
    } catch (error: any) { setMessage(error.message || 'Could not refresh the dispute.'); }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !reviewed || note.trim().length < 10 || !selected.canSubmit) return;
    if (file && (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || file.size > PROXIED_UPLOAD_LIMIT_BYTES)) {
      setMessage(`Choose a PDF, JPEG or PNG up to ${PROXIED_UPLOAD_LIMIT_LABEL}. Submit larger evidence in the Cashfree Dashboard.`); return;
    }
    setBusy(true); setMessage('');
    try {
      const form = new FormData();
      form.append('reviewed', 'true'); form.append('note', note.trim()); form.append('doc_type', 'Delivery/Service Proof');
      if (file) form.append('file', file);
      const response = await fetch(`/api/admin/cashfree/disputes/${encodeURIComponent(selected.id)}/evidence`, {
        method: 'POST', credentials: 'include',
        ...(file ? { body: form } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewed: true, note: note.trim(), doc_type: 'Delivery/Service Proof' }) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Submission could not be confirmed. Refresh the case before retrying.');
      setMessage(result.message || 'Evidence submission recorded. Check the refreshed case for the provider status.');
      setSelected(null); setReviewed(false); setNote(''); setFile(null);
      await load();
    } catch (error: any) { setMessage(error.message || 'Evidence submission could not be confirmed.'); }
    finally { setBusy(false); }
  }

  return <details className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs" onToggle={event => {
    if (event.currentTarget.open && !loaded && !busy) void load();
  }}>
    <summary className="p-5 cursor-pointer font-semibold text-sm text-slate-900 dark:text-white">Cashfree disputes and evidence</summary>
    <div className="px-5 pb-5 space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Review each case and its deadline before submitting evidence. Settlement decisions remain with the provider.</p>
        <button disabled={busy} onClick={() => { void load(); }} className="border rounded-xl px-3 py-2 text-xs disabled:opacity-50">Refresh list</button>
      </div>
      {message && <p role="status" className="text-xs text-blue-700 dark:text-blue-300 break-words">{message}</p>}
      {busy && <p className="text-xs text-slate-500">Please wait…</p>}
      {loaded && !disputes.length && <p className="text-xs text-slate-500">No recorded Cashfree disputes.</p>}
      {disputes.map(dispute => {
        const order = orders.find(item => item.id === dispute.orderId);
        return <div key={dispute.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold break-all">Case {dispute.id} · {order?.orderNumber || dispute.orderId}</p><span className="text-xs text-slate-500">{dispute.status}</span></div>
          <p className="text-xs text-slate-500">{dispute.reason_description || 'Reason not supplied'} · {dispute.currency || 'INR'} {(Number(dispute.amount || 0) / 100).toFixed(2)}</p>
          <p className={`text-xs ${dispute.overdue ? 'text-rose-600' : 'text-slate-500'}`}>Respond by: {dateLabel(dispute.respond_by || dispute.dueAt)}{dispute.overdue ? ' · Deadline passed' : ''}</p>
          {dispute.preferredEvidence?.length > 0 && <p className="text-xs text-slate-500">Requested evidence: {dispute.preferredEvidence.map((item: any) => typeof item === 'string' ? item : item.document_type || item.document_description).filter(Boolean).join(', ')}</p>}
          <div className="flex flex-wrap gap-3 text-xs">
            <button disabled={busy} onClick={() => { void refresh(dispute); }} className="border rounded-xl px-3 py-2 disabled:opacity-50">Verify with Cashfree</button>
            <a href={`/api/admin/cashfree/disputes/${encodeURIComponent(dispute.id)}/evidence`} className="underline px-1 py-2">Review evidence PDF</a>
            <button disabled={busy || !dispute.canSubmit} onClick={() => { setSelected(dispute); setReviewed(false); setNote(''); setFile(null); setMessage(''); }} className="border rounded-xl px-3 py-2 disabled:opacity-50">Prepare submission</button>
          </div>
          {!dispute.canSubmit && <p className="text-xs text-slate-500">{dispute.reason || 'Evidence submission is unavailable at this stage. Review the provider dashboard.'}</p>}
        </div>;
      })}
      {selected && <form onSubmit={submit} className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <p className="font-semibold">Evidence for case {selected.id}</p>
        <label className="block text-xs">Case explanation<textarea required minLength={10} maxLength={4000} value={note} onChange={event => setNote(event.target.value)} className="block w-full border border-slate-200 dark:border-slate-700 bg-transparent rounded-xl p-3 mt-2" /></label>
        <label className="block text-xs">Optional supporting PDF/image (up to {PROXIED_UPLOAD_LIMIT_LABEL})<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={event => setFile(event.target.files?.[0] || null)} className="block mt-2 w-full text-xs" /></label>
        <p className="text-xs text-slate-500">Without an attachment, the server-generated order and access evidence PDF will be submitted. Review it first.</p>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} className="mt-0.5" /><span>I reviewed the evidence and confirm that the explanation and records accurately address this dispute.</span></label>
        <div className="flex gap-3"><button disabled={busy || !reviewed || note.trim().length < 10} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs disabled:opacity-50">Submit reviewed evidence</button><button type="button" onClick={() => setSelected(null)} className="border rounded-xl px-3 py-2 text-xs">Cancel</button></div>
      </form>}
    </div>
  </details>;
};
