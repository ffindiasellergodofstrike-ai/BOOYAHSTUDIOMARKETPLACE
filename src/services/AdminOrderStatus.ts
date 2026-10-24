export type AdminStatusTone = 'green' | 'amber' | 'red' | 'slate' | 'blue';
export type AdminStatus = { key: string; label: string; tone: AdminStatusTone; detail?: string };
const upper = (value: unknown) => String(value || '').toUpperCase();

export function adminPaymentStatus(order: any): AdminStatus {
  const status = upper(order?.paymentStatus);
  if (status === 'PAID') return { key: status, label: 'Paid', tone: 'green' };
  if (status === 'PARTIALLY_REFUNDED') return { key: status, label: 'Partially refunded', tone: 'amber' };
  if (status === 'REFUNDED') return { key: status, label: 'Refunded', tone: 'slate' };
  if (['FAILED', 'CANCELLED'].includes(status)) return { key: status, label: status === 'FAILED' ? 'Failed' : 'Cancelled', tone: 'red' };
  const latest = upper(order?.latestPaymentStatus);
  return { key: 'PENDING', label: 'Pending', tone: 'amber', detail: ['FAILED', 'USER_DROPPED', 'CANCELLED'].includes(latest) ? `Latest attempt: ${latest.toLowerCase().replaceAll('_', ' ')}` : undefined };
}

export function adminAccessStatus(order: any): AdminStatus & { availableItems: number; totalItems: number } {
  const items = Array.isArray(order?.items) ? order.items : [];
  const totalItems = items.length;
  if (order?.paymentEnvironment === 'test' || upper(order?.deliveryStatus) === 'TEST_ONLY') return { key: 'test', label: 'Test · no paid access', tone: 'slate', availableItems: 0, totalItems };
  if (upper(order?.deliveryStatus) === 'REVOKED' || upper(order?.downloadStatus) === 'REVOKED' || upper(order?.paymentStatus) === 'REFUNDED' || ['REVOKED', 'CANCELLED'].includes(upper(order?.status))) return { key: 'revoked', label: 'Access revoked', tone: 'red', availableItems: 0, totalItems };
  const recordedPaid = ['PAID', 'PARTIALLY_REFUNDED'].includes(upper(order?.paymentStatus));
  const provider = String(order?.paymentProvider || '').toLowerCase();
  const cashfree = provider === 'cashfree';
  const payment = cashfree && order?.payments?.[order?.transactionId];
  const providerVerified = cashfree
    ? Boolean(order.cashfreeOrderId && payment?.status === 'SUCCESS' && payment.order_id === order.cashfreeOrderId &&
        payment.environment === 'live' && payment.currency === 'INR' && payment.amount === Math.round(Number(order.total) * 100))
    : provider === 'razorpay';
  const paid = recordedPaid && Boolean(order?.transactionId) && providerVerified &&
    (upper(order?.paymentStatus) === 'PAID' || cashfree);
  if (recordedPaid && (!providerVerified || (upper(order?.paymentStatus) === 'PARTIALLY_REFUNDED' && !cashfree))) return { key: 'unavailable', label: 'Payment verification incomplete', tone: 'red', availableItems: 0, totalItems };
  if (paid && ['FAILED', 'REFUNDED', ...(cashfree ? [] : ['PARTIALLY_REFUNDED'])].includes(upper(order?.status))) return { key: 'unavailable', label: 'Access unavailable · review status', tone: 'red', availableItems: 0, totalItems };
  if (paid && order?.paymentEnvironment === 'live' && order?.deliveryStatus === 'DELIVERED' && order?.downloadStatus === 'AVAILABLE') {
    const availableItems = items.filter((item: any) => item.refunded !== true && item.downloadStatus !== 'REVOKED').length;
    if (!availableItems) return { key: 'unavailable', label: 'No product access', tone: 'red', availableItems, totalItems };
    if (availableItems < totalItems) return { key: 'partial', label: 'Some products available', tone: 'amber', availableItems, totalItems };
    return { key: 'available', label: 'Available in account', tone: 'green', availableItems, totalItems };
  }
  return { key: 'pending', label: paid ? 'Access pending' : 'Not delivered · unpaid', tone: 'amber', availableItems: 0, totalItems };
}

export function adminEmailStatus(order: any): AdminStatus {
  const email = order?.emailDelivery;
  const providerStatus = String(email?.providerStatus || '').toLowerCase();
  const statuses: Record<string, AdminStatus> = {
    delivered: { key: 'delivered', label: 'Email delivered', tone: 'green', detail: 'Recipient mail server accepted the email.' },
    accepted: { key: 'accepted', label: 'Accepted by Resend', tone: 'blue', detail: 'Inbox delivery is not yet confirmed.' },
    delayed: { key: 'delayed', label: 'Email delayed', tone: 'amber' },
    bounced: { key: 'failed', label: 'Email bounced', tone: 'red' },
    failed: { key: 'failed', label: 'Email delivery failed', tone: 'red' },
    complained: { key: 'failed', label: 'Email complaint', tone: 'red' },
    suppressed: { key: 'failed', label: 'Email suppressed', tone: 'red' },
  };
  if (statuses[providerStatus]) return statuses[providerStatus];
  if (email?.status === 'sent' || email?.emailId) return { ...statuses.accepted, detail: 'Sending recorded; inbox delivery is not confirmed.' };
  if (email?.status === 'not_configured') return { key: 'not_configured', label: 'Email not configured', tone: 'red' };
  if (email?.status === 'failed') return { key: 'failed', label: 'Send failed · retry queued', tone: 'red' };
  if (email?.status === 'review_required') return { key: 'review', label: 'Email needs review', tone: 'amber' };
  return { key: 'pending', label: email?.status === 'sending' ? 'Sending email' : email?.status ? 'Email queued' : 'Not yet queued', tone: 'slate' };
}

export interface AdminOrderFilters { search?: string; payment?: string; access?: string; email?: string; environment?: string; }
export function filterAdminOrders(orders: any[], filters: AdminOrderFilters): any[] {
  const terms = String(filters.search || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return orders.filter(order => {
    if (filters.payment && filters.payment !== 'all' && adminPaymentStatus(order).key !== filters.payment) return false;
    if (filters.access && filters.access !== 'all' && adminAccessStatus(order).key !== filters.access) return false;
    if (filters.email && filters.email !== 'all' && adminEmailStatus(order).key !== filters.email) return false;
    if (filters.environment && filters.environment !== 'all' && order.paymentEnvironment !== filters.environment) return false;
    const text = [order.id, order.orderNumber, order.userId, order.customerEmail, order.customerName, order.customer?.email, order.customer?.fullName, order.customer?.phone, order.paymentProvider, order.transactionId, order.paymentId, order.cashfreeOrderId, order.razorpayOrderId, ...(order.items || []).map((item: any) => `${item.productId || ''} ${item.productTitle || item.title || ''}`)].join(' ').toLowerCase();
    return terms.every(term => text.includes(term));
  });
}

export function adminOrderSummary(orders: any[]) {
  const states = orders.map(order => ({ payment: adminPaymentStatus(order), access: adminAccessStatus(order), email: adminEmailStatus(order) }));
  return {
    total: orders.length,
    paid: orders.filter((order, index) => order.paymentEnvironment === 'live' && ['PAID', 'PARTIALLY_REFUNDED'].includes(states[index].payment.key)).length,
    available: states.filter(state => ['available', 'partial'].includes(state.access.key)).length,
    pending: states.filter(state => ['pending', 'unavailable'].includes(state.access.key)).length,
    revoked: states.filter(state => state.access.key === 'revoked').length,
    emailProblems: states.filter(state => ['failed', 'not_configured', 'review'].includes(state.email.key)).length,
  };
}

export function adminOrderDate(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return 'Not recorded';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Not recorded';
}
export function adminOrderMoney(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  return Number.isFinite(amount) ? `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}
