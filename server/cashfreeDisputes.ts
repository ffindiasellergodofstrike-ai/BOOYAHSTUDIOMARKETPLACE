import crypto from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import multer from 'multer';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Store } from './store';
import { BUSINESS } from '../src/config/business';
import { PROXIED_UPLOAD_LIMIT_BYTES, PROXIED_UPLOAD_LIMIT_LABEL } from '../src/config/uploadLimits';
import { cashfreeConfig, cashfreeRequest, verifyCashfreeSignature } from './cashfree';
import { fulfillCreatorOrder } from './creatorMarketplace';

const DISPUTE_EVENTS = new Set(['DISPUTE_CREATED', 'DISPUTE_UPDATED', 'DISPUTE_CLOSED']);
const documentTypes = new Set(['Delivery/Service Proof', 'Statement of Service', 'Proof of Service Used', 'Cancellation of Service Proof', 'Refund Proof', 'Business model explanation', 'Terms & Conditions', 'Customer Withdrawal Letter', 'Certificate of Authenticity', 'Reseller Agreement']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PROXIED_UPLOAD_LIMIT_BYTES, files: 1, fields: 6, fieldSize: 4000 } });
const id = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const safeText = (value: unknown, max = 1000) => typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, max) : '';
const validId = (value: unknown): boolean => /^\d{1,30}$/.test(id(value));
function unwrap(payload: any): any { const value = payload?.data ?? payload; return Array.isArray(value) ? value[0] : value; }
function dateMillis(value: unknown): number {
  if (typeof value !== 'string' || !value) return NaN;
  // Legacy PG responses omit an offset; use the earlier India-local deadline rather than extend it by treating it as UTC.
  const dated = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(value) ? `${value}+05:30` : value;
  return Date.parse(dated);
}
export function evidenceWindow(dispute: any, now = Date.now()): { canSubmit: boolean; reason: string; dueAt: string | null; overdue: boolean } {
  const deadline = dateMillis(dispute?.respond_by);
  const overdue = Number.isFinite(deadline) && deadline <= now;
  const status = String(dispute?.status || dispute?.dispute_status || '');
  const canSubmit = dispute?.type !== 'ARBITRATION' && dispute?.dispute_type !== 'ARBITRATION' &&
    /^(DISPUTE|CHARGEBACK|RETRIEVAL|PRE_ARBITRATION)_(CREATED|DOCS_RECEIVED|INSUFFICIENT_EVIDENCE)$/.test(status) && Number.isFinite(deadline) && !overdue;
  return { canSubmit, reason: overdue ? 'Evidence deadline has passed.' : !Number.isFinite(deadline) ? 'Refresh the case and confirm its evidence deadline with Cashfree.' : canSubmit ? '' : 'This stage is not open for evidence upload. Review the case in Cashfree.', dueAt: Number.isFinite(deadline) ? new Date(deadline).toISOString() : null, overdue };
}
export function normalizeCashfreeDispute(payload: any, requestedId: string) {
  const row = unwrap(payload), details = row?.order_details;
  const disputeId = id(row?.dispute_id ?? row?.cf_dispute_id), paymentId = id(details?.cf_payment_id);
  const orderId = id(details?.order_id);
  const rupees = Number(row?.dispute_amount), amount = Math.round(rupees * 100);
  const currency = row?.dispute_amount_currency || details?.payment_currency;
  const type = safeText(row?.dispute_type, 40), status = safeText(row?.dispute_status, 80);
  if (!validId(disputeId) || disputeId !== requestedId || !validId(paymentId) || !/^[A-Za-z0-9_-]{1,100}$/.test(orderId) ||
      !Number.isFinite(rupees) || !Number.isSafeInteger(amount) || Math.abs(rupees * 100 - amount) > 0.00001 || amount <= 0 || currency !== 'INR' || details?.order_currency !== 'INR' ||
      !['DISPUTE', 'CHARGEBACK', 'RETRIEVAL', 'PRE_ARBITRATION', 'ARBITRATION'].includes(type) ||
      !/^(DISPUTE|CHARGEBACK|RETRIEVAL|PRE_ARBITRATION|ARBITRATION)_[A-Z_]{1,60}$/.test(status)) throw new Error('Dispute does not match a supported Cashfree record.');
  return {
    id: disputeId, payment_id: paymentId, cashfreeOrderId: orderId, amount, currency, type, status,
    reason_code: safeText(row.reason_code, 100), reason_description: safeText(row.reason_description),
    respond_by: safeText(row.respond_by, 80), created_at: safeText(row.created_at, 80), updated_at: safeText(row.updated_at, 80),
    resolved_at: safeText(row.resolved_at, 80), providerRemarks: safeText(row.cf_dispute_remarks, 2000),
    preferredEvidence: (Array.isArray(row.preferred_evidence) ? row.preferred_evidence : []).slice(0, 20).map((entry: any) => ({ type: safeText(entry.document_type, 150), description: safeText(entry.document_description, 1000) })),
    evidence: (Array.isArray(row.dispute_evidence) ? row.dispute_evidence : []).slice(0, 100).map((entry: any) => ({ id: safeText(entry.document_id, 100), name: safeText(entry.document_name, 250), type: safeText(entry.document_type, 150) })),
  };
}
export async function syncCashfreeDispute(disputeId: string) {
  if (!validId(disputeId)) throw new Error('Invalid dispute reference.');
  const dispute = normalizeCashfreeDispute(await cashfreeRequest(`disputes/${disputeId}`), disputeId);
  const storeOrderId = await Store.get<string>(`cashfreeOrderIndex/${dispute.cashfreeOrderId}`) || dispute.cashfreeOrderId;
  const order = await Store.getGlobalOrder(storeOrderId);
  if (!order || String(order.paymentProvider).toLowerCase() !== 'cashfree' || order.cashfreeOrderId !== dispute.cashfreeOrderId || order.paymentEnvironment !== cashfreeConfig().environment ||
      !(id(order.transactionId) === dispute.payment_id || order.payments?.[dispute.payment_id]) ||
      dispute.amount > Math.round(Number(order.total) * 100)) throw new Error('Dispute payment is not yet bound to this store.');
  const saved = await Store.rpc('record_cashfree_dispute', `orders/${order.id}`, dispute);
  if (saved.marketplace) await fulfillCreatorOrder(saved);
  // The SQL transaction updates the order and sanitized global case mirror together,
  // rejecting stale snapshots. Never overwrite that mirror outside the transaction.
  const record = await Store.get<any>(`cashfreeDisputes/${dispute.id}`);
  if (!record || record.orderId !== order.id) throw new Error('Verified dispute could not be persisted.');
  return record;
}
export async function buildDisputeEvidence(dispute: any): Promise<Buffer> {
  const order = await Store.getGlobalOrder(dispute.orderId);
  if (!order || order.cashfreeOrderId !== dispute.cashfreeOrderId) throw new Error('Order unavailable.');
  const logs = Object.values(await Store.get<Record<string, any>>('downloadLogs') || {}).filter(row => row?.orderId === order.id).slice(-200);
  const policies = order.policyVersion ? await Store.get(`policyDocuments/${order.policyVersion}`) : null;
  const lines = [
    `${BUSINESS.name} - digital product evidence`, `Merchant: ${BUSINESS.owner}`, `Support: ${BUSINESS.email}`,
    `Case: ${dispute.id} | Stage: ${dispute.type} | Status: ${dispute.status}`,
    `Order: ${order.id} | Gateway order: ${order.cashfreeOrderId} | Payment: ${dispute.payment_id}`,
    `Reason: ${dispute.reason_code} ${dispute.reason_description}`,
    `Customer: ${order.customerName || order.customer?.fullName || ''} | ${order.customerEmail || ''}`,
    `Order created: ${order.createdAt || ''} | Verified payment: ${order.paymentVerifiedAt || ''}`,
    `Paid amount: INR ${Number(order.total).toFixed(2)} | Recorded refund: INR ${Number(order.refundedAmount || 0).toFixed(2)}`,
    `Access status: ${order.deliveryStatus || ''} / ${order.downloadStatus || ''} | Available since: ${order.deliveredAt || ''}`,
    `Policy version: ${order.policyVersion || ''} | Accepted: ${order.policyAcceptedAt || ''}`,
    'Listing snapshots recorded with the order:',
    ...(order.items || []).flatMap((item: any) => [
      `${item.productTitle || item.productId} | ID ${item.productId} | Quantity ${item.quantity || 1} | INR ${Number(item.price).toFixed(2)}`,
      `Version: ${item.version || item.product?.version || 'not recorded'} | File hash: ${item.fileHash || item.product?.fileHash || 'not recorded'}`,
      `Description: ${item.product?.description || item.product?.shortDescription || 'not recorded'}`,
      `Requirements: ${(item.product?.requirements || []).join('; ')}`,
      `Licence: ${item.product?.licenseTerms || 'See accepted store policy; product-specific terms not recorded.'}`,
    ]),
    `Order email: ${JSON.stringify(order.emailDelivery || { status: 'not recorded' })}`,
    'Download authorization records (these do not prove completed file transfer or reading):',
    ...logs.map(row => `${row.event || 'DOWNLOAD_AUTHORIZED'} | Product ${row.productId} | ${row.authorizedAt || row.timestamp || ''}`),
    `Accepted policy snapshot: ${policies ? JSON.stringify(policies) : 'not recorded'}`,
    'Limitations: This document reports stored merchant records. An issued link is not proof of completed download. Email provider acceptance is not proof of inbox delivery. This document does not establish who authorized a bank payment. Add necessary redacted customer/support correspondence after human review.',
  ];
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  const documentDate = Number.isFinite(Date.parse(order.createdAt)) ? new Date(order.createdAt) : new Date(0);
  pdf.setCreationDate(documentDate); pdf.setModificationDate(documentDate);
  let page = pdf.addPage(), y = 790;
  for (const original of lines) {
    const words = String(original).normalize('NFKD').replace(/[^\x20-\x7E]/g, ' ').split(/\s+/); let current = '';
    const draw = () => { if (y < 45) { page = pdf.addPage(); y = 790; } page.drawText(current, { x: 40, y, size: 9, font }); y -= 14; current = ''; };
    for (const word of words) { if (font.widthOfTextAtSize(`${current} ${word}`, 9) > 510 && current) draw(); current += `${current ? ' ' : ''}${word}`; } draw(); y -= 4;
  }
  return Buffer.from(await pdf.save());
}
export function disputeMetrics(disputes: any[], orders: any[], now = Date.now(), days = 30) {
  const from = now - days * 86400000;
  const paid = orders.filter(order => String(order.paymentProvider).toLowerCase() === 'cashfree' && order.paymentEnvironment === 'live' && order.transactionId && Number.isFinite(dateMillis(order.paymentVerifiedAt)) && dateMillis(order.paymentVerifiedAt) >= from && dateMillis(order.paymentVerifiedAt) <= now);
  const within = disputes.filter(row => paid.some(order => order.id === row.orderId));
  const disputedOrders = new Set(within.map(row => row.orderId));
  // Multiple stages/cases against one payment must not inflate the payment amount.
  const amountByPayment = new Map<string, number>();
  for (const row of within) amountByPayment.set(row.payment_id, Math.max(amountByPayment.get(row.payment_id) || 0, row.amount));
  const paidPaise = paid.reduce((sum, order) => sum + Math.round(Number(order.total) * 100), 0), disputedPaise = [...amountByPayment.values()].reduce((a, b) => a + b, 0);
  return { windowDays: days, paymentWindowFrom: new Date(from).toISOString(), paymentWindowTo: new Date(now).toISOString(), paidOrderCount: paid.length, disputedOrderCount: disputedOrders.size, paidPaise, disputedPaise, orderCountRatio: paid.length ? disputedOrders.size / paid.length : null, amountRatio: paidPaise ? disputedPaise / paidPaise : null, definition: 'Observed disputes attached to live Cashfree orders paid in this rolling window; includes won and pending cases, deduplicates payment stages using the largest recorded disputed amount. Operational indicator only, not Cashfree\'s contractual ratio or a guarantee of settlement.' };
}
function stableUuid(value: string): string { const hex = crypto.createHash('sha256').update(value).digest('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`; }
function safeFile(buffer: Buffer, mime: string): boolean {
  return (mime === 'application/pdf' && buffer.subarray(0, 5).toString() === '%PDF-') ||
    (mime === 'image/png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === 'image/jpeg' && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255);
}
export function registerCashfreeDisputeRoutes(app: Express, _auth: RequestHandler, admin: RequestHandler, limiter: RequestHandler) {
  app.post('/api/payments/cashfree/disputes/webhook', async (req: any, res) => {
    if (!Buffer.isBuffer(req.rawBody) || !verifyCashfreeSignature(req.rawBody, req.get('x-webhook-signature'), req.get('x-webhook-timestamp'))) return res.status(400).json({ success: false });
    if (!DISPUTE_EVENTS.has(req.body?.type)) return res.json({ success: true });
    const disputeId = id(req.body?.data?.dispute?.dispute_id ?? req.body?.data?.dispute?.cf_dispute_id);
    if (!validId(disputeId)) return res.status(400).json({ success: false });
    try { const dispute = await syncCashfreeDispute(disputeId); return res.json({ success: true, disputeId: dispute.id }); }
    catch { return res.status(503).json({ success: false, message: 'Dispute verification pending; retry notification.' }); }
  });
  app.get('/api/admin/cashfree/disputes', admin, async (_req, res) => {
    const disputes = Object.values(await Store.get<Record<string, any>>('cashfreeDisputes') || {}).sort((a, b) => String(b.verifiedAt).localeCompare(String(a.verifiedAt)));
    res.json({ success: true, disputes: disputes.map(row => ({ ...row, ...evidenceWindow(row) })), metrics: disputeMetrics(disputes, await Store.getAllGlobalOrders()) });
  });
  app.post('/api/admin/cashfree/disputes/:id/refresh', admin, limiter, async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ success: false });
    try { const dispute = await syncCashfreeDispute(req.params.id); res.json({ success: true, dispute: { ...dispute, ...evidenceWindow(dispute) } }); }
    catch { res.status(503).json({ success: false, message: 'Could not verify this case with Cashfree.' }); }
  });
  app.get('/api/admin/cashfree/disputes/:id/evidence', admin, async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ success: false });
    const dispute = await Store.get<any>(`cashfreeDisputes/${req.params.id}`);
    if (!dispute) return res.status(404).json({ success: false });
    const file = await buildDisputeEvidence(dispute);
    res.type('application/pdf').set('Content-Disposition', `attachment; filename="cashfree-evidence-${dispute.id}.pdf"`).set('Cache-Control', 'private, no-store').send(file);
  });
  app.post('/api/admin/cashfree/disputes/:id/evidence', admin, limiter, (req: any, res, next) => upload.single('file')(req, res, error => error ? res.status((error as any).code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: `Upload one PDF, PNG or JPEG up to ${PROXIED_UPLOAD_LIMIT_LABEL}. Larger evidence must be submitted in the Cashfree Dashboard.` }) : next()), async (req: any, res) => {
    const disputeId = req.params.id;
    if (!validId(disputeId) || ![true, 'true'].includes(req.body?.reviewed)) return res.status(400).json({ success: false, message: 'Review the evidence and explicitly confirm reviewed=true.' });
    const docType = req.body.doc_type || 'Delivery/Service Proof', note = safeText(req.body.note, 2000).trim();
    if (!documentTypes.has(docType) || note.length < 10) return res.status(400).json({ success: false, message: 'Choose an evidence type and include a review note of at least 10 characters.' });
    const dispute = await syncCashfreeDispute(disputeId), window = evidenceWindow(dispute);
    if (!window.canSubmit) return res.status(409).json({ success: false, message: window.reason });
    const generated = !req.file;
    const generatedKey = crypto.createHash('sha256').update(`${disputeId}|${docType}|${note}|generated-v1`).digest('hex');
    const snapshot = generated ? await Store.get<any>(`cashfreeEvidenceSnapshots/${generatedKey}`) : null;
    const bytes: Buffer = req.file?.buffer || (snapshot?.base64 ? Buffer.from(snapshot.base64, 'base64') : await buildDisputeEvidence(dispute));
    const mime = generated ? 'application/pdf' : req.file.mimetype;
    if (!bytes.length || bytes.length > PROXIED_UPLOAD_LIMIT_BYTES || !safeFile(bytes, mime)) return res.status(400).json({ success: false, message: `Use a valid PDF, PNG or JPEG up to ${PROXIED_UPLOAD_LIMIT_LABEL}. For larger evidence, use the Cashfree Dashboard.` });
    const fingerprint = generated ? generatedKey : crypto.createHash('sha256').update(disputeId).update(docType).update(note).update(bytes).digest('hex');
    const key = `cashfreeEvidenceClaims/${fingerprint}`, old = await Store.get<any>(key);
    if (old?.status === 'sent') return res.json({ success: true, duplicate: true, submission: old });
    // Reuse the existing atomic bounded action-claim primitive; it prevents simultaneous duplicate uploads.
    if (!await Store.rpc('claim_email', key, { now: Date.now() })) return res.status(409).json({ success: false, message: 'This submission is already sending or requires manual review. Refresh its status.' });
    const submission = { disputeId, orderId: dispute.orderId, documentType: docType, fingerprint, idempotencyKey: stableUuid(fingerprint), reviewedBy: req.userId, reviewedAt: new Date().toISOString(), generated, note };
    await Store.update(key, submission);
    // Freeze generated bytes so an uncertain retry sends the same document with the same provider key.
    // This server-only snapshot is never included in admin API responses or public catalogs.
    if (generated && !snapshot) {
      if (bytes.length > 2 * 1024 * 1024) { await Store.update(key, { status: 'failed' }); return res.status(413).json({ success: false, message: 'Generated evidence is too large; upload a reviewed document instead.' }); }
      await Store.set(`cashfreeEvidenceSnapshots/${generatedKey}`, { base64: bytes.toString('base64'), orderId: dispute.orderId, createdAt: new Date().toISOString() });
    }
    try {
      const filename = `evidence-${disputeId}-${fingerprint.slice(0, 16)}.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}`;
      const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), filename); form.append('doc_type', docType); form.append('note', note);
      const acknowledged = normalizeCashfreeDispute(await cashfreeRequest(`disputes/${disputeId}/documents`, undefined, { method: 'POST', body: form, headers: { 'x-idempotency-key': submission.idempotencyKey } }), disputeId);
      const current = await syncCashfreeDispute(disputeId);
      const documentConfirmed = [...acknowledged.evidence, ...current.evidence].some((entry: any) => entry.id && entry.name === filename);
      if (!documentConfirmed) throw new Error('Provider acknowledgment of this document is not yet visible.');
      const result = { ...submission, status: 'sent', providerStatus: current.status, acknowledgedAt: new Date().toISOString() };
      await Store.update(key, result); await Store.update(`cashfreeDisputes/${disputeId}`, { lastSubmission: result });
      res.json({ success: true, submission: result });
    } catch {
      await Store.update(key, { status: 'unknown', ...submission });
      res.status(503).json({ success: false, message: 'Submission outcome is not confirmed. Check Cashfree and retry the same file/note with the same idempotency key; do not assume it was accepted.', idempotencyKey: submission.idempotencyKey });
    }
  });
}
