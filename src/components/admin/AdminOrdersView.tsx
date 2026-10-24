import React, { useRef, useState } from 'react';
import { Search, X, RefreshCw, Mail } from 'lucide-react';
import { AdminService } from '../../services/AdminService';
import { CashfreeDisputesPanel } from './CashfreeDisputesPanel';
import { adminPaymentStatus, adminAccessStatus, adminEmailStatus, filterAdminOrders, adminOrderSummary, adminOrderDate, adminOrderMoney, type AdminStatus } from '../../services/AdminOrderStatus';

interface AdminOrdersViewProps {
  orders: any[];
  onRefresh: () => void;
}

const RefundAllocationForm: React.FC<{ order: any; onUpdated: (order: any) => void }> = ({ order, onUpdated }) => {
  const [refundId, setRefundId] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refunds = Object.values(order.refunds || {}).filter((refund: any) => refund.status === 'SUCCESS' && refund.payment_id === order.transactionId && !refund.itemAllocations) as any[];
  const refund = refunds.find(item => item.id === refundId) || refunds[0];
  if (String(order.paymentProvider).toLowerCase() !== 'cashfree' || !order.refundReviewRequired || !refund) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reviewed || reason.trim().length < 10 || !refund) return;
    const allocations: { productId: string; amountPaise: number }[] = [];
    for (const item of order.items || []) {
      const raw = (amounts[item.productId] || '').trim();
      if (!raw || Number(raw) === 0) continue;
      if (!/^\d+(\.\d{1,2})?$/.test(raw)) { setMessage('Enter positive INR amounts with at most two decimal places.'); return; }
      const amountPaise = Math.round(Number(raw) * 100);
      const remaining = Number(item.paidAmountPaise || 0) - Number(item.refundedAmountPaise || 0);
      if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > remaining) { setMessage('An allocation exceeds the remaining paid amount for its product.'); return; }
      allocations.push({ productId: item.productId, amountPaise });
    }
    if (!allocations.length || allocations.reduce((sum, item) => sum + item.amountPaise, 0) !== Number(refund.amount)) { setMessage('Allocated amounts must exactly match the confirmed refund.'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/admin/cashfree/orders/${encodeURIComponent(order.id)}/refunds/${encodeURIComponent(refund.id)}/allocate`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewed: true, reason: reason.trim(), allocations }),
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.order) throw new Error(result.message || 'Could not record the refund allocation.');
      setAmounts({}); setReviewed(false); setReason(''); setRefundId('');
      onUpdated(result.order);
    } catch (error: any) { setMessage(error.message || 'Could not record the refund allocation.'); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
    <p className="font-semibold text-slate-900 dark:text-white">Review confirmed refund allocation</p>
    <p className="text-xs text-slate-500">This records which products a completed refund applies to. It does not issue another refund. A fully refunded product loses download access; unaffected products remain available.</p>
    <label className="block text-xs">Confirmed refund<select value={refund.id} onChange={event => { setRefundId(event.target.value); setAmounts({}); setReviewed(false); }} className="block w-full bg-transparent border rounded-xl p-2 mt-1">{refunds.map(item => <option key={item.id} value={item.id}>{item.id} · INR {(Number(item.amount) / 100).toFixed(2)}</option>)}</select></label>
    {(order.items || []).map((item: any) => <label key={item.productId} className="flex items-center justify-between gap-3 text-xs"><span>{item.productTitle || item.productId}<span className="block text-slate-500">Remaining paid: INR {((Number(item.paidAmountPaise || 0) - Number(item.refundedAmountPaise || 0)) / 100).toFixed(2)}</span></span><input aria-label={`Refund allocation for ${item.productTitle || item.productId}`} type="number" min="0" step="0.01" value={amounts[item.productId] || ''} onChange={event => setAmounts({ ...amounts, [item.productId]: event.target.value })} className="w-24 border rounded-xl p-2 bg-transparent" /></label>)}
    <label className="block text-xs">Review reason<textarea required minLength={10} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} className="block w-full border rounded-xl p-2 mt-1 bg-transparent" /></label>
    <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} className="mt-0.5" /><span>I verified the completed refund and the affected product amounts.</span></label>
    {message && <p role="status" className="text-xs text-rose-600">{message}</p>}
    <button disabled={busy || !reviewed || reason.trim().length < 10} className="border rounded-xl px-3 py-2 text-xs disabled:opacity-50">{busy ? 'Saving…' : 'Record reviewed allocation'}</button>
  </form>;
};

const StatusBadge: React.FC<{ status: AdminStatus }> = ({ status }) => {
  const tones = {
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
    red: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400',
  };
  return <span title={status.detail} className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${tones[status.tone]}`}>{status.label}</span>;
};

export const AdminOrdersView: React.FC<AdminOrdersViewProps> = ({ orders, onRefresh }) => {
  const [search, setSearch] = useState('');
  const [payment, setPayment] = useState('all');
  const [access, setAccess] = useState('all');
  const [email, setEmail] = useState('all');
  const [environment, setEnvironment] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [downloadLogs, setDownloadLogs] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const activeOrder = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const filtered = filterAdminOrders(orders, { search, payment, access, email, environment });
  const summary = adminOrderSummary(orders);

  async function loadDetails(orderId: string) {
    const sequence = ++requestSequence.current;
    setLoadingDetails(true); setDetailsError('');
    try {
      const detail = await AdminService.getOrderDeliveryDetails(orderId);
      if (activeOrder.current !== orderId || sequence !== requestSequence.current) return;
      if (detail.order) setSelectedOrder(detail.order);
      setTimeline(Array.isArray(detail.timeline) ? detail.timeline : []);
      setDownloadLogs(Array.isArray(detail.downloadLogs) ? detail.downloadLogs : []);
    } catch (error: any) {
      if (activeOrder.current === orderId && sequence === requestSequence.current) setDetailsError(error.message || 'Could not load delivery records. Retry below.');
    } finally {
      if (activeOrder.current === orderId && sequence === requestSequence.current) setLoadingDetails(false);
    }
  }
  function handleOpenDrawer(order: any) {
    activeOrder.current = order.id; setSelectedOrder(order); setTimeline([]); setDownloadLogs([]); setActionMessage('');
    void loadDetails(order.id);
  }
  function closeDrawer() { activeOrder.current = null; requestSequence.current++; setSelectedOrder(null); setBusy(false); }

  async function runAction(orderId: string, action: () => Promise<any>, message: string) {
    setBusy(true); setActionMessage('');
    try {
      const result = await action();
      onRefresh();
      if (activeOrder.current === orderId) {
        if (result.order) setSelectedOrder(result.order);
        setActionMessage(result.message || message);
        await loadDetails(orderId);
      }
    } catch (error: any) {
      if (activeOrder.current === orderId) setActionMessage(error.message || 'Could not complete the request.');
    } finally { setBusy(false); }
  }
  const selectClass = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500';
  const accountStatus = selectedOrder ? adminAccessStatus(selectedOrder) : null;
  const emailStatus = selectedOrder ? adminEmailStatus(selectedOrder) : null;
  const acceptedEmail = Boolean(selectedOrder?.emailDelivery?.emailId || selectedOrder?.emailDelivery?.status === 'sent');

  return <div className="space-y-6">
    <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
      {[
        ['All orders', summary.total], ['Paid live orders', summary.paid], ['Account access available', summary.available],
        ['Access not delivered / pending', summary.pending], ['Access revoked', summary.revoked], ['Email needs attention', summary.emailProblems],
      ].map(([label, value]) => <div key={label} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{value}</p></div>)}
    </div>
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:flex-1 sm:min-w-80">
          <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
          <input aria-label="Search orders" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Order, customer, phone, product or payment reference…" className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500" />
        </div>
        <button onClick={onRefresh} className="inline-flex items-center gap-2 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-700 dark:text-slate-200"><RefreshCw className="w-4 h-4" />Refresh orders</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Filter payment" value={payment} onChange={event => setPayment(event.target.value)} className={selectClass}><option value="all">All payments</option><option value="PAID">Paid</option><option value="PENDING">Pending</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option><option value="PARTIALLY_REFUNDED">Partially refunded</option><option value="REFUNDED">Refunded</option></select>
        <select aria-label="Filter account access" value={access} onChange={event => setAccess(event.target.value)} className={selectClass}><option value="all">All delivery / access</option><option value="available">Available in account</option><option value="partial">Some products available</option><option value="pending">Not delivered / pending</option><option value="revoked">Revoked / refunded</option><option value="unavailable">No product access</option><option value="test">Test only</option></select>
        <select aria-label="Filter order email" value={email} onChange={event => setEmail(event.target.value)} className={selectClass}><option value="all">All order emails</option><option value="delivered">Delivered to mail server</option><option value="accepted">Accepted by Resend</option><option value="pending">Not yet queued / pending</option><option value="delayed">Delayed</option><option value="failed">Failed / bounced / complaint</option><option value="not_configured">Not configured</option><option value="review">Needs review</option></select>
        <select aria-label="Filter payment environment" value={environment} onChange={event => setEnvironment(event.target.value)} className={selectClass}><option value="all">Live and test</option><option value="live">Live only</option><option value="test">Test only</option></select>
        {(search || payment !== 'all' || access !== 'all' || email !== 'all' || environment !== 'all') && <button onClick={() => { setSearch(''); setPayment('all'); setAccess('all'); setEmail('all'); setEnvironment('all'); }} className="text-xs text-blue-600 px-3">Clear filters</button>}
      </div>
      <p className="text-xs text-slate-500">Showing {filtered.length} of {orders.length} orders. Account access and email delivery are tracked separately; issuing a download link does not prove a completed download.</p>
    </div>

    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
      <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
        <thead><tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-500 uppercase">
          {['Order / date', 'Customer', 'Total', 'Payment', 'Account delivery', 'Order email', 'Action'].map(label => <th key={label} className="py-4 px-4 whitespace-nowrap">{label}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
          {filtered.map(order => {
            const paymentState = adminPaymentStatus(order); const accessState = adminAccessStatus(order); const mailState = adminEmailStatus(order);
            return <tr key={order.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition">
              <td className="py-4 px-4"><p className="font-mono font-semibold text-blue-600 dark:text-blue-400">{order.orderNumber || order.id}</p><p className="text-[10px] text-slate-500 mt-1">{adminOrderDate(order.createdAt || order.date)}</p><p className="text-[10px] text-slate-500 mt-1">{order.paymentEnvironment === 'live' ? 'Live' : order.paymentEnvironment === 'test' ? 'Test' : 'Environment not recorded'} · {order.paymentProvider || 'Not initiated'}</p></td>
              <td className="py-4 px-4 text-slate-800 dark:text-slate-200"><p>{order.customerName || order.customer?.fullName || 'Customer'}</p><p className="text-xs text-slate-500 break-all">{order.customerEmail || order.customer?.email || 'Email not recorded'}</p></td>
              <td className="py-4 px-4 font-bold text-slate-900 dark:text-white whitespace-nowrap">{adminOrderMoney(order.total)}</td>
              <td className="py-4 px-4"><StatusBadge status={paymentState} />{paymentState.detail && <p className="text-[10px] text-slate-500 mt-1">{paymentState.detail}</p>}</td>
              <td className="py-4 px-4"><StatusBadge status={accessState} />{['available', 'partial'].includes(accessState.key) && <p className="text-[10px] text-slate-500 mt-1">{accessState.availableItems}/{accessState.totalItems} products available</p>}</td>
              <td className="py-4 px-4"><StatusBadge status={mailState} /></td>
              <td className="py-4 px-4"><button onClick={() => handleOpenDrawer(order)} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-medium transition whitespace-nowrap">View Details</button></td>
            </tr>;
          })}
          {!filtered.length && <tr><td colSpan={7} className="p-8 text-center text-sm text-slate-500">{orders.length ? 'No orders match these filters.' : 'No orders have been recorded yet.'}</td></tr>}
        </tbody>
      </table></div>
    </div>

    <CashfreeDisputesPanel orders={orders} />

    {selectedOrder && <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/60 backdrop-blur-xs" role="dialog" aria-modal="true" aria-label={`Order ${selectedOrder.orderNumber || selectedOrder.id}`}>
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 h-full overflow-y-auto p-6 shadow-2xl border-l border-slate-200 dark:border-slate-800 space-y-5">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800"><div><h3 className="text-lg font-bold text-slate-900 dark:text-white">Order {selectedOrder.orderNumber || selectedOrder.id}</h3><p className="text-xs text-slate-400 font-mono break-all">ID: {selectedOrder.id}</p></div><button aria-label="Close order details" onClick={closeDrawer} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-5 h-5" /></button></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[['Payment', adminPaymentStatus(selectedOrder)], ['Account access', accountStatus!], ['Order email', emailStatus!]].map(([label, state]) => <div key={label as string} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2"><p className="text-xs text-slate-500">{label as string}</p><StatusBadge status={state as AdminStatus} /></div>)}
        </div>
        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-1.5 text-xs text-slate-600 dark:text-slate-300 break-words">
          <p className="font-semibold text-slate-900 dark:text-white">Customer and payment references</p>
          <p>Name: {selectedOrder.customerName || selectedOrder.customer?.fullName || 'Not recorded'}</p><p>Email: {selectedOrder.customerEmail || selectedOrder.customer?.email || 'Not recorded'}</p><p>Phone: {selectedOrder.customer?.phone || 'Not recorded'}</p>
          <p>Provider: {selectedOrder.paymentProvider || 'Not initiated'} · {selectedOrder.paymentEnvironment || 'Environment not recorded'}</p>
          <p>Payment ID: {selectedOrder.transactionId || selectedOrder.paymentId || selectedOrder.razorpayPaymentId || 'Not recorded'}</p><p>Gateway order: {selectedOrder.cashfreeOrderId || selectedOrder.razorpayOrderId || 'Not recorded'}</p>
          <p>Total: <strong className="text-slate-900 dark:text-white">{adminOrderMoney(selectedOrder.total)}</strong>{Number(selectedOrder.refundedAmount) > 0 && <> · Confirmed refund: {adminOrderMoney(selectedOrder.refundedAmount)}</>}</p>
          <p>Created: {adminOrderDate(selectedOrder.createdAt || selectedOrder.date)}</p><p>Payment verified: {adminOrderDate(selectedOrder.paymentVerifiedAt)}</p><p>Account access provided: {adminOrderDate(selectedOrder.deliveredAt || selectedOrder.fulfilledAt)}</p>
          {selectedOrder.refundReviewRequired && <p className="text-amber-700 dark:text-amber-400">Confirmed partial refund needs product allocation review.</p>}
        </div>
        <div className="space-y-3"><p className="font-semibold text-sm text-slate-900 dark:text-white">Product access</p>{(selectedOrder.items || []).map((item: any, index: number) => {
          const available = ['available', 'partial'].includes(accountStatus!.key) && item.refunded !== true && item.downloadStatus !== 'REVOKED';
          return <div key={item.productId || index} className="flex justify-between items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-xs"><div><p className="font-semibold text-slate-900 dark:text-white">{item.productTitle || item.title || item.productId || 'Digital product'}</p><p className="text-slate-500 mt-1">{item.productId} · Version {item.version || item.product?.version || 'not recorded'}</p><p className="text-slate-500 mt-1">{item.refunded ? 'Product fully refunded; access restricted.' : available ? 'Download access available in the customer account.' : 'Download access is not currently available.'}</p></div><div className="text-right shrink-0"><p className="font-semibold">{adminOrderMoney(Number(item.price) * Number(item.quantity || 1))}</p><p className={`mt-1 ${available ? 'text-emerald-600' : 'text-slate-500'}`}>{available ? 'Available' : item.refunded ? 'Refunded' : 'Unavailable'}</p></div></div>;
        })}</div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs">
          <p className="font-semibold text-sm text-slate-900 dark:text-white">Order email</p><StatusBadge status={emailStatus!} />{emailStatus?.detail && <p className="text-slate-500">{emailStatus.detail}</p>}
          <p className="text-slate-500 break-all">Email reference: {selectedOrder.emailDelivery?.emailId || 'Not recorded'}</p><p className="text-slate-500">Provider accepted: {adminOrderDate(selectedOrder.emailDelivery?.acceptedAt || selectedOrder.emailDelivery?.sentAt)}</p><p className="text-slate-500">Latest provider event: {adminOrderDate(selectedOrder.emailDelivery?.providerEventAt)}</p>
          <button disabled={busy || acceptedEmail || !['available', 'partial'].includes(accountStatus!.key)} onClick={() => { void runAction(selectedOrder.id, () => AdminService.retryOrderEmail(selectedOrder.id), 'Order email retry processed. Check its current status.'); }} className="inline-flex items-center gap-2 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs disabled:opacity-50"><Mail className="w-4 h-4" />{busy ? 'Please wait…' : 'Retry queued order email'}</button>
          {acceptedEmail && <p className="text-slate-500">This message was accepted for sending. Repeated order checks do not send a duplicate email.</p>}
        </div>
        <RefundAllocationForm key={selectedOrder.id} order={selectedOrder} onUpdated={order => { setSelectedOrder(order); onRefresh(); void loadDetails(order.id); }} />
        <div className="flex flex-wrap gap-2 text-xs">
          <button disabled={busy || !['cashfree', 'razorpay'].includes(String(selectedOrder.paymentProvider).toLowerCase())} onClick={() => { void runAction(selectedOrder.id, () => AdminService.reconcileOrderPayment(selectedOrder.id, selectedOrder.paymentProvider), 'Payment checked with the gateway.'); }} className="px-3 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold disabled:opacity-50">Verify with {selectedOrder.paymentProvider || 'gateway'}</button>
          <button disabled={busy || !['PAID', 'PARTIALLY_REFUNDED'].includes(selectedOrder.paymentStatus) || selectedOrder.deliveryStatus === 'REVOKED'} onClick={() => { if (window.confirm('Revoke download access? This does not issue a refund.')) void runAction(selectedOrder.id, () => AdminService.revokeOrderAccess(selectedOrder.id), 'Download access revoked.'); }} className="px-3 py-2.5 bg-rose-50 dark:bg-rose-950/50 text-rose-600 rounded-xl font-semibold disabled:opacity-50">Revoke access</button>
          {selectedOrder.deliveryStatus === 'REVOKED' && <button disabled={busy} className="border rounded-xl px-3 py-2" onClick={() => { const reason = window.prompt('Explain the resolution after verifying payment and disputes:'); if (!reason) return; void runAction(selectedOrder.id, async () => { const response = await fetch(`/api/admin/orders/${encodeURIComponent(selectedOrder.id)}/restore-access`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }); const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.message || 'Access could not be restored.'); return result; }, 'Access restored after review.'); }}>Restore access after review</button>}
          <a href={`/api/admin/orders/${encodeURIComponent(selectedOrder.id)}/evidence`} className="border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2">Download dispute evidence for review</a>
        </div>
        {actionMessage && <p role="status" className="text-xs text-blue-700 dark:text-blue-300 break-words">{actionMessage}</p>}
        <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
          <div className="flex justify-between items-center gap-3"><p className="font-semibold text-sm text-slate-900 dark:text-white">Delivery records and timeline</p><button disabled={loadingDetails} onClick={() => { void loadDetails(selectedOrder.id); }} className="text-xs text-blue-600">{loadingDetails ? 'Loading…' : 'Refresh records'}</button></div>
          {detailsError && <p role="alert" className="text-xs text-rose-600">{detailsError}</p>}
          {!loadingDetails && !detailsError && <>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-xs"><p className="font-semibold text-slate-900 dark:text-white">Download link authorizations: {downloadLogs.length}</p><p className="text-slate-500 mt-1">These records show a protected link was issued. They do not prove that the customer completed a download or opened the files.</p></div>
            {downloadLogs.map((log: any, index: number) => <div key={log.logId || log.id || index} className="text-xs border-l-2 border-slate-200 dark:border-slate-700 pl-3"><p className="font-semibold text-slate-900 dark:text-white">{log.productId || 'Product'} · Download link issued</p><p className="text-slate-500">{adminOrderDate(log.authorizedAt || log.timestamp || log.createdAt)}</p></div>)}
            <p className="font-semibold text-sm text-slate-900 dark:text-white pt-2">Order audit timeline</p>
            {!timeline.length && <p className="text-xs text-slate-500">No additional timeline events recorded.</p>}
            {timeline.map((log: any, index: number) => <div key={`${log.logId || log.eventType}-${index}`} className="flex items-start gap-3 text-xs"><div className="w-2 h-2 mt-1 rounded-full bg-blue-500 shrink-0" /><div><p className="font-semibold text-slate-900 dark:text-white">{String(log.eventType || 'Recorded event').replaceAll('_', ' ')} <span className="text-slate-400 font-normal">({log.source || 'Stored record'})</span></p><p className="text-slate-500">{adminOrderDate(log.timestamp)}</p></div></div>)}
          </>}
        </div>
      </div>
    </div>}
  </div>;
};
