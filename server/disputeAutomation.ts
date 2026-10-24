import crypto from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import { Store } from './store';
import { cashfreeConfig, cashfreeRequest } from './cashfree';
import { evidenceWindow, syncCashfreeDispute } from './cashfreeDisputes';
import { paymentEnvironment, razorpayRequest, syncDispute } from './razorpay';
import { gatewayReadiness } from './gatewayControl';

const safeId = /^[A-Za-z0-9_-]{1,100}$/;
const validAmount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function liveOrder(order: any, provider: string): boolean {
  const amount = Math.round(Number(order?.total) * 100);
  return Boolean(order && typeof order.id === 'string' && safeId.test(order.id) && order.paymentEnvironment === 'live' &&
    String(order.paymentProvider).toLowerCase() === provider && order.currency === 'INR' && validAmount(amount) &&
    Math.abs(Number(order.total) * 100 - amount) < 0.00001 && typeof order.transactionId === 'string' && order.transactionId &&
    Number.isFinite(Date.parse(order.paymentVerifiedAt)));
}
const terminal = (status: string) => /(?:^|_)(?:won|lost|closed|cancelled)$/i.test(status);
export function disputeDueAt(value: unknown): string | null {
  const ms = typeof value === 'number' && Number.isSafeInteger(value) ? value * 1000 : typeof value === 'string'
    ? Date.parse(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(value) ? `${value}+05:30` : value) : NaN;
  return Number.isFinite(ms) && ms > 0 && ms <= 8640000000000000 ? new Date(ms).toISOString() : null;
}
export function collectDisputeCases(orders: any[], cashfree: any[], now = Date.now()) {
  const cases = new Map<string, any>();
  const add = (provider: 'cashfree' | 'razorpay', row: any, order: any) => {
    if (!liveOrder(order, provider) || !row || typeof row !== 'object' || !safeId.test(String(row.id || ''))) return;
    if (provider === 'cashfree' && (!/^\d{1,30}$/.test(String(row.id)) || !order.cashfreeOrderId || row.cashfreeOrderId !== order.cashfreeOrderId)) return;
    if (provider === 'razorpay' && (!/^disp_[A-Za-z0-9]+$/.test(String(row.id)) || !order.razorpayOrderId)) return;
    const paymentId = String(row.payment_id || ''), amount = row.amount;
    if (!paymentId || !(order.transactionId === paymentId || order.payments?.[paymentId]) || !validAmount(amount) || amount > Math.round(Number(order.total) * 100) || row.currency !== 'INR') return;
    const status = String(row.status || '').slice(0, 80), dueAt = disputeDueAt(row.respond_by);
    const open = !terminal(status), remaining = dueAt ? Date.parse(dueAt) - now : null;
    cases.set(`${provider}:${row.id}`, { provider, id: String(row.id), orderId: order.id, paymentId, amountPaise: amount, currency: 'INR', status,
      reason: String(row.reason_description || row.reason_code || '').slice(0, 1000), dueAt, open, overdue: open && remaining !== null && remaining <= 0,
      dueSoon: open && remaining !== null && remaining > 0 && remaining <= 48 * 3600000,
      verifiedAt: row.verifiedAt || row.updated_at || null, sellerName: order.marketplace?.sellerName || 'Booyahstudio',
      evidenceUrl: provider === 'cashfree' ? `/api/admin/cashfree/disputes/${row.id}/evidence` : `/api/admin/orders/${order.id}/evidence`,
      canSubmit: provider === 'cashfree' && evidenceWindow(row, now).canSubmit,
      submissionMode: provider === 'cashfree' ? 'reviewed_api' : 'provider_dashboard' });
  };
  for (const row of cashfree) add('cashfree', row, orders.find(order => order.id === row.orderId));
  for (const order of orders) for (const row of Object.values(order.disputes || {})) add('razorpay', row, order);
  return [...cases.values()].sort((a, b) => Number(b.open) - Number(a.open) || String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999')));
}
export function disputeRiskMetrics(orders: any[], cases: any[], now = Date.now()) {
  const from = now - 30 * 86400000;
  return ['cashfree', 'razorpay', 'easebuzz'].map(provider => {
    const paid = [...new Map(orders.filter(order => liveOrder(order, provider) && Date.parse(order.paymentVerifiedAt) >= from && Date.parse(order.paymentVerifiedAt) <= now).map(order => [order.id, order])).values()];
    const relevant = cases.filter(row => row.provider === provider && validAmount(row.amountPaise) && paid.some(order => order.id === row.orderId && (order.transactionId === row.paymentId || order.payments?.[row.paymentId]) && row.amountPaise <= Math.round(Number(order.total) * 100)));
    const amounts = new Map<string, number>();
    for (const row of relevant) amounts.set(row.paymentId, Math.max(amounts.get(row.paymentId) || 0, row.amountPaise));
    const grossPaise = paid.reduce((sum, order) => sum + Math.round(Number(order.total) * 100), 0), disputedPaise = [...amounts.values()].reduce((sum, n) => sum + n, 0);
    return { provider, windowDays: 30, paidOrders: paid.length, disputedOrders: new Set(relevant.map(row => row.orderId)).size, grossPaise, disputedPaise,
      countRatio: paid.length ? new Set(relevant.map(row => row.orderId)).size / paid.length : null, valueRatio: grossPaise ? disputedPaise / grossPaise : null,
      coverage: provider === 'easebuzz' ? 'manual_provider_review' : 'verified_recorded_cases',
      definition: 'Operational indicator for live orders paid in the last 30 days; includes recorded pending/won/lost cases, deduplicates stages by maximum amount per payment. Not the provider’s contractual chargeback ratio or settlement guarantee.' };
  });
}
async function inbox() {
  const [orders, mirror] = await Promise.all([Store.getAllGlobalOrders(), Store.get<Record<string, any>>('cashfreeDisputes')]);
  const disputes = collectDisputeCases(orders, Object.values(mirror || {}));
  const readiness = Object.fromEntries((['cashfree', 'razorpay', 'easebuzz'] as const).map(provider => {
    const state = gatewayReadiness(provider);
    return [provider, { configured: state.configured, environment: state.environment, automaticTracking: provider !== 'easebuzz' && state.configured && state.environment === 'live', mode: provider === 'easebuzz' ? 'manual_provider_review' : state.configured && state.environment === 'live' ? 'automatic_tracking' : 'requires_live_configuration' }];
  }));
  return { disputes, metrics: disputeRiskMetrics(orders, disputes), readiness, capabilities: { cashfree: 'automatic_tracking_reviewed_submission', razorpay: 'automatic_tracking_dashboard_submission', easebuzz: 'manual_provider_review' } };
}

/** Bounded discovery and refreshed provider truth. Disabled checkout never disables historical monitoring.
 * Each allocated work unit performs at most one case refresh plus one list request. Failed cases
 * consume their allocation. The rotating task/page cursors prevent a busy provider or partial page
 * from permanently hiding older/newer cases. No automatic acceptance, refunds or bank settlement.
 */
export async function reconcileDisputes(limit = 3) {
  const budget = Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.trunc(limit))) : 3;
  const orders = await Store.getAllGlobalOrders();
  const checks = await Store.get<Record<string, string>>('operations/disputeChecks') || {};
  const caseChecks = await Store.get<Record<string, string>>('operations/disputeCaseChecks') || {};
  let checked = 0, failed = 0, discovered = 0, attempted = 0;
  let cashfreeReady = false;
  try { const config = cashfreeConfig(); cashfreeReady = config.configured && config.environment === 'live'; } catch { /* Admin readiness reports invalid configuration separately. */ }
  const razorpayReady = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && paymentEnvironment() === 'live');
  const cfOrders = cashfreeReady ? orders.filter(order => liveOrder(order, 'cashfree') && /^\d{1,30}$/.test(order.transactionId) && order.cashfreeOrderId)
    .sort((a, b) => String(checks[a.id] || '').localeCompare(String(checks[b.id] || '')) || a.id.localeCompare(b.id)) : [];
  const current = await inbox();
  const recorded = new Set(current.disputes.map(row => `${row.provider}:${row.id}`));
  const known = current.disputes.filter(row => row.open && (row.provider === 'cashfree' ? cashfreeReady : razorpayReady))
    .sort((a, b) => Number(b.overdue || b.dueSoon) - Number(a.overdue || a.dueSoon) ||
      String(caseChecks[`${a.provider}_${a.id}`] || '').localeCompare(String(caseChecks[`${b.provider}_${b.id}`] || '')) || String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999')));
  const tasks = [...(known.length ? ['known'] : []), ...(cfOrders.length ? ['cashfree'] : []), ...(razorpayReady ? ['razorpay'] : [])];
  const savedTurn = Number(await Store.get('operations/disputeTaskCursor') || 0);
  const turn = Number.isSafeInteger(savedTurn) && savedTurn >= 0 ? savedTurn : 0;
  const ordered = tasks.map((_, index) => tasks[(turn + index) % tasks.length]);
  const allocations = new Map<string, number>();
  for (let i = 0; i < budget && ordered.length; i++) allocations.set(ordered[i % ordered.length], (allocations.get(ordered[i % ordered.length]) || 0) + 1);
  if (tasks.length) await Store.set('operations/disputeTaskCursor', (turn + 1) % tasks.length);
  const markCase = async (provider: string, id: string) => Store.set(`operations/disputeCaseChecks/${provider}_${id}`, new Date().toISOString());
  for (const [task, allocation] of allocations) {
    if (task === 'known') {
      for (const row of known.slice(0, allocation)) {
        attempted++;
        try {
          if (row.provider === 'cashfree') await syncCashfreeDispute(row.id);
          else { const order = await Store.getGlobalOrder(row.orderId); if (!order) throw new Error('Order unavailable'); await syncDispute(order, row.id); }
          checked++;
        } catch { failed++; }
        await markCase(row.provider, row.id);
      }
    } else if (task === 'cashfree') {
      const order = cfOrders[0];
      // Mark even failed discovery so one unhealthy order cannot starve all other payments.
      await Store.set(`operations/disputeChecks/${order.id}`, new Date().toISOString());
      try {
        const response = await cashfreeRequest(`payments/${order.transactionId}/disputes`);
        const rows = Array.isArray(response) ? response : Array.isArray(response?.data) ? response.data : null;
        if (!rows) throw new Error('Invalid dispute collection');
        const offsetValue = Number(await Store.get(`operations/cashfreeDisputeOffsets/${order.id}`) || 0);
        const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 && offsetValue < rows.length ? offsetValue : 0;
        const selected = rows.slice(offset, offset + allocation);
        for (const row of selected) {
          attempted++;
          const id = String(row?.dispute_id || row?.cf_dispute_id || '');
          try {
            if (!/^\d{1,30}$/.test(id) || String(row?.order_details?.cf_payment_id) !== order.transactionId ||
                row?.order_details?.order_id !== order.cashfreeOrderId || row?.dispute_amount_currency !== 'INR') throw new Error('Dispute collection binding mismatch');
            await syncCashfreeDispute(id); checked++;
            if (!recorded.has(`cashfree:${id}`)) { discovered++; recorded.add(`cashfree:${id}`); }
          } catch { failed++; }
          if (/^\d{1,30}$/.test(id)) await markCase('cashfree', id);
        }
        await Store.set(`operations/cashfreeDisputeOffsets/${order.id}`, offset + selected.length >= rows.length ? 0 : offset + selected.length);
      } catch { failed++; }
    } else {
      const savedCursor = Number(await Store.get('operations/razorpayDisputeCursor') || 0);
      const skip = Number.isSafeInteger(savedCursor) && savedCursor >= 0 && savedCursor <= 1000000 ? savedCursor : 0;
      try {
        const response = await razorpayRequest('disputes', undefined, 'v1', { count: 25, skip });
        if (!Array.isArray(response?.items) || response.items.length > 25) throw new Error('Invalid dispute collection');
        let consumed = 0, used = 0;
        for (const row of response.items) {
          if (used >= allocation) break;
          consumed++;
          const order = orders.find(order => liveOrder(order, 'razorpay') && order.razorpayOrderId &&
            (order.transactionId === row?.payment_id || order.payments?.[row?.payment_id]));
          if (!order || !/^disp_[A-Za-z0-9]+$/.test(String(row?.id))) continue;
          used++; attempted++;
          try {
            await syncDispute(order, row.id); checked++;
            if (!recorded.has(`razorpay:${row.id}`)) { discovered++; recorded.add(`razorpay:${row.id}`); }
          } catch { failed++; }
          await markCase('razorpay', row.id);
        }
        const complete = consumed === response.items.length;
        const next = complete && response.items.length < 25 ? 0 : skip + consumed;
        await Store.set('operations/razorpayDisputeCursor', next > 1000000 ? 0 : next);
      } catch { failed++; }
    }
  }
  const fresh = await inbox(), generatedAt = new Date().toISOString();
  const actions = fresh.disputes.filter(row => row.open).map(row => ({ provider: row.provider, id: row.id, orderId: row.orderId, dueAt: row.dueAt, overdue: row.overdue, dueSoon: row.dueSoon, evidenceUrl: row.evidenceUrl, action: row.overdue ? 'contact_provider' : row.dueSoon ? 'review_evidence_urgent' : 'review_evidence' }));
  await Store.set('operations/disputeAutomation', { checked, attempted, failed, discovered, generatedAt, actions });
  return { checked, attempted, failed, discovered, open: actions.length, urgent: actions.filter(row => row.dueSoon || row.overdue).length };
}
export function registerDisputeAutomationRoutes(app: Express, auth: RequestHandler, admin: RequestHandler, limiter: RequestHandler) {
  app.get('/api/marketplace/admin/disputes', auth, admin, async (_req, res) => res.json({ success: true, ...await inbox(), automation: await Store.get('operations/disputeAutomation') }));
  app.post('/api/marketplace/admin/disputes/reconcile', auth, admin, limiter, async (req: any, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 10 || reason.length > 1000) return res.status(400).json({ success: false, message: 'Add a review reason of 10–1000 characters.' });
    const result = await reconcileDisputes(3), id = crypto.randomUUID();
    await Store.set(`marketplace/audit/${id}`, { id, actorId: req.userId, action: 'disputes_reconciled', reason, createdAt: new Date().toISOString(), result });
    res.json({ success: true, ...result });
  });
}
