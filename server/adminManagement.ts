import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { Store } from './store';
import { AuditLogger, generateRequestId } from './audit';
import { supabaseAdmin } from './supabase';

/** Mount only behind the application's requireAdmin middleware. */
export const adminManagementRouter = Router();
export const MAX_PRIVATE_ZIP_BYTES = 10 * 1024 * 1024;
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const reason = z.string().trim().min(10).max(1000);
const short = (value: unknown, max = 1000) => typeof value === 'string' ? value.slice(0, max) : '';
function rows(value: any): [string, any][] { return value && typeof value === 'object' ? Object.entries(value).filter(([, row]) => row && typeof row === 'object' && !Array.isArray(row)) : []; }
async function audit(req: any, action: string, metadata: Record<string, unknown>, productId?: string) {
  await AuditLogger.log({ requestId: generateRequestId(), userId: req.userId, productId, eventType: 'ORDER_UPDATED', eventStatus: 'SUCCESS', source: 'ADMIN_PANEL', metadata: { action, ...metadata } });
}
function supportRow(id: string, row: any) {
  return { id, reference: short(row.reference || id, 100), name: short(row.name, 100), email: short(row.email, 254), message: short(row.message, 4000), status: ['open', 'in_progress', 'resolved'].includes(row.status) ? row.status : 'open', adminNotes: short(row.adminNotes, 4000), createdAt: short(row.createdAt, 80), updatedAt: short(row.updatedAt, 80), resolvedAt: short(row.resolvedAt, 80) };
}
adminManagementRouter.get('/support', async (_req, res) => {
  const requests = rows(await Store.get('supportRequests')).map(([id, row]) => supportRow(id, row)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ success: true, requests: requests.slice(0, 1000), total: requests.length });
});
adminManagementRouter.patch('/support/:id', async (req: any, res) => {
  const key = identifier.safeParse(req.params.id);
  const input = z.object({ status: z.enum(['open', 'in_progress', 'resolved']).optional(), adminNotes: z.string().trim().max(4000).optional() }).strict().refine(v => Object.keys(v).length > 0).safeParse(req.body);
  if (!key.success || !input.success) return res.status(400).json({ success: false, message: 'Provide a valid support reference, status or notes.' });
  const current = await Store.get<any>(`supportRequests/${key.data}`);
  if (!current) return res.status(404).json({ success: false, message: 'Support request not found.' });
  const now = new Date().toISOString(), patch: any = { ...input.data, updatedAt: now, updatedBy: req.userId };
  if (input.data.status) patch.resolvedAt = input.data.status === 'resolved' ? now : null;
  const saved = await Store.update(`supportRequests/${key.data}`, patch);
  await audit(req, 'SUPPORT_REQUEST_UPDATED', { reference: key.data, status: saved.status });
  res.json({ success: true, request: supportRow(key.data, saved) });
});
function subscriberRow(id: string, row: any) {
  const subscribed = row.status === 'subscribed' && row.active !== false && row.subscribed !== false;
  return { id, email: short(row.email, 254), status: subscribed ? 'subscribed' : 'unsubscribed', subscribed, subscribedAt: short(row.subscribedAt, 80), lastConsentAt: short(row.lastConsentAt, 80), updatedAt: short(row.updatedAt, 80), unsubscribedAt: short(row.unsubscribedAt, 80) };
}
adminManagementRouter.get('/subscribers', async (_req, res) => {
  const subscribers = rows(await Store.get('newsletterSubscribers')).map(([id, row]) => subscriberRow(id, row)).sort((a, b) => b.subscribedAt.localeCompare(a.subscribedAt));
  res.json({ success: true, subscribers: subscribers.slice(0, 1000), total: subscribers.length });
});
adminManagementRouter.patch('/subscribers/:id', async (req: any, res) => {
  const key = identifier.safeParse(req.params.id);
  const input = z.object({ subscribed: z.boolean().optional(), active: z.boolean().optional() }).strict().refine(v => typeof v.subscribed === 'boolean' || typeof v.active === 'boolean').refine(v => v.subscribed === undefined || v.active === undefined || v.subscribed === v.active).safeParse(req.body);
  if (!key.success || !input.success) return res.status(400).json({ success: false, message: 'Provide the subscription status.' });
  const current = await Store.get<any>(`newsletterSubscribers/${key.data}`);
  if (!current) return res.status(404).json({ success: false, message: 'Subscriber not found.' });
  const subscribed = input.data.subscribed ?? input.data.active!;
  if (subscribed && !current.lastConsentAt && !current.subscribedAt) return res.status(409).json({ success: false, message: 'No original subscription consent is recorded. Ask the customer to subscribe again.' });
  const patch: any = { status: subscribed ? 'subscribed' : 'unsubscribed', updatedAt: new Date().toISOString(), updatedBy: req.userId, unsubscribedAt: subscribed ? null : new Date().toISOString() };
  if ('active' in current) patch.active = subscribed;
  if ('subscribed' in current) patch.subscribed = subscribed;
  const saved = await Store.update(`newsletterSubscribers/${key.data}`, patch);
  await audit(req, 'SUBSCRIBER_STATUS_UPDATED', { subscriberId: key.data, subscribed });
  res.json({ success: true, subscriber: subscriberRow(key.data, saved) });
});
export function safeDownloadRows(logs: any, tokens: any) {
  const downloads = [
    ...rows(logs).map(([id, row]) => ({ id, source: 'authorization', row })),
    ...rows(tokens).map(([key, row]) => ({ id: `legacy-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 20)}`, source: 'legacy_token', row })),
  ].map(({ id, source, row }) => ({
    id, source, userId: short(row.userId, 100), orderId: short(row.orderId, 100), productId: short(row.productId, 100), productTitle: short(row.productTitle, 200), purchaseId: short(row.purchaseId, 250),
    event: short(row.event || (source === 'legacy_token' ? 'LEGACY_TOKEN_ISSUED' : 'DOWNLOAD_AUTHORIZED'), 100),
    authorizedAt: short(row.authorizedAt || row.createdAt || row.timestamp, 80), expiresAt: Number.isFinite(Number(row.expiresAt)) ? Number(row.expiresAt) : null,
    used: typeof row.used === 'boolean' ? row.used : null,
  })).sort((a, b) => b.authorizedAt.localeCompare(a.authorizedAt));
  return downloads;
}
adminManagementRouter.get('/downloads', async (_req, res) => {
  const [logs, tokens] = await Promise.all([Store.get('downloadLogs'), Store.get('downloadTokens')]);
  const downloads = safeDownloadRows(logs, tokens);
  res.json({ success: true, downloads: downloads.slice(0, 1000), total: downloads.length, limitations: 'These are recorded download authorizations and any retained legacy token records. They do not prove a completed file transfer. Raw tokens and signed URLs are never returned.' });
});

class FileManagementError extends Error { constructor(public status: number, message: string) { super(message); } }
function publicFile(data: any, productId: string) {
  if (!data) return { exists: false, path: `${productId}.zip`, size: null, updatedAt: null };
  const rawSize = data.size ?? data.metadata?.size ?? data.metadata?.contentLength;
  return { exists: true, path: `${productId}.zip`, size: Number.isFinite(Number(rawSize)) ? Number(rawSize) : null, updatedAt: data.lastModified || data.last_modified || data.updatedAt || data.updated_at || data.createdAt || data.created_at || null };
}
function version(data: any): string | null {
  if (!data) return null;
  const values = [data.id, data.version, data.etag || data.eTag || data.metadata?.eTag, data.lastModified || data.last_modified || data.updatedAt || data.updated_at, data.size ?? data.metadata?.size];
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
async function fileInfo(bucket: any, path: string) {
  const { data, error } = await bucket.info(path);
  if (error) {
    const status = Number(error.status || error.statusCode);
    if (status === 404 || (status === 400 && /^object not found\.?$/i.test(String(error.message || ''))) || ['not_found', 'NoSuchKey', 'ObjectNotFound'].includes(error.code)) return null;
    throw new FileManagementError(503, 'Private storage is unavailable. Check the Supabase configuration.');
  }
  return data;
}
async function product(id: unknown) {
  const parsed = identifier.safeParse(id);
  if (!parsed.success) throw new FileManagementError(400, 'Invalid product ID.');
  if (!await Store.getProductById(parsed.data)) throw new FileManagementError(404, 'Product not found.');
  return parsed.data;
}
function storageError(res: any, error: unknown) {
  const known = error instanceof FileManagementError;
  return res.status(known ? error.status : 503).json({ success: false, message: known ? error.message : 'Private file management is temporarily unavailable.' });
}
export async function verifyStagedZipHeader(signedUrl: string): Promise<void> {
  const base = new URL(process.env.SUPABASE_URL || ''), url = new URL(signedUrl);
  const localDevelopment = process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((!localDevelopment && url.protocol !== 'https:') || url.origin !== base.origin || !url.pathname.startsWith('/storage/v1/object/sign/products/')) throw new FileManagementError(503, 'Unexpected private storage URL.');
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-3' }, redirect: 'error', signal: controller.signal });
    if (![200, 206].includes(response.status) || !response.body) throw new FileManagementError(503, 'Could not verify the uploaded file.');
    reader = response.body.getReader();
    const first = new Uint8Array(4); let offset = 0;
    while (offset < first.length) {
      const chunk = await reader.read(); if (chunk.done) break;
      const count = Math.min(4 - offset, chunk.value.byteLength); first.set(chunk.value.subarray(0, count), offset); offset += count;
    }
    if (offset < 4 || first[0] !== 0x50 || first[1] !== 0x4b || first[2] !== 0x03 || first[3] !== 0x04) throw new FileManagementError(400, 'The upload is not a non-empty ZIP archive. The existing product file was not changed.');
  } finally { controller.abort(); if (reader) await reader.cancel().catch(() => undefined); clearTimeout(timeout); }
}
adminManagementRouter.get('/products/:id/file', async (req, res) => {
  try { const id = await product(req.params.id); res.json({ success: true, file: publicFile(await fileInfo(supabaseAdmin().storage.from('products'), `${id}.zip`), id), maxSizeBytes: MAX_PRIVATE_ZIP_BYTES }); }
  catch (error) { storageError(res, error); }
});
adminManagementRouter.post('/products/:id/file-upload', async (req: any, res) => {
  const input = z.object({ fileName: z.string().trim().min(5).max(200).refine(v => !/[\\/\r\n]/.test(v) && /\.zip$/i.test(v)), size: z.number().int().min(22).max(MAX_PRIVATE_ZIP_BYTES), reviewed: z.literal(true), replaceExisting: z.boolean().default(false), reason }).strict().safeParse(req.body);
  if (!input.success) return res.status(400).json({ success: false, message: 'Select a ZIP up to 50 MiB, confirm review and give a reason of at least 10 characters.' });
  try {
    const id = await product(req.params.id), bucket = supabaseAdmin().storage.from('products');
    const existing = await fileInfo(bucket, `${id}.zip`);
    if (existing && !input.data.replaceExisting) return res.status(409).json({ success: false, message: 'A paid product file already exists. Explicitly review and confirm replacement.' });
    const uploadId = crypto.randomUUID(), stagingPath = `_staging/${id}/${uploadId}.zip`, now = Date.now();
    const { data, error } = await bucket.createSignedUploadUrl(stagingPath, { upsert: false });
    if (error || !data?.signedUrl || !data.token) throw new FileManagementError(503, 'Could not prepare a private upload.');
    await Store.set(`adminFileUploads/${uploadId}`, { uploadId, productId: id, adminUserId: req.userId, stagingPath, expectedSize: input.data.size, originalName: input.data.fileName, priorVersion: version(existing), replaceExisting: input.data.replaceExisting, reason: input.data.reason, createdAt: new Date(now).toISOString(), expiresAt: now + 2 * 3600000, status: 'pending' });
    await audit(req, 'PRIVATE_PRODUCT_UPLOAD_PREPARED', { uploadId, size: input.data.size, replacement: Boolean(existing), reason: input.data.reason }, id);
    res.json({ success: true, upload: { uploadId, signedUrl: data.signedUrl, path: data.path, token: data.token, method: 'PUT', expiresAt: now + 2 * 3600000 }, message: 'Upload directly to private storage, then complete verification before this file becomes available to customers.' });
  } catch (error) { storageError(res, error); }
});
adminManagementRouter.post('/products/:id/file-upload/complete', async (req: any, res) => {
  const input = z.object({ uploadId: z.string().uuid(), reviewed: z.literal(true), reason }).strict().safeParse(req.body);
  if (!input.success) return res.status(400).json({ success: false, message: 'Confirm the reviewed upload and provide its reference and reason.' });
  let lockKey: string | undefined;
  try {
    const id = await product(req.params.id), upload = await Store.get<any>(`adminFileUploads/${input.data.uploadId}`), bucket = supabaseAdmin().storage.from('products');
    if (!upload || upload.productId !== id || upload.adminUserId !== req.userId) throw new FileManagementError(404, 'Upload not found for this administrator and product.');
    if (upload.status === 'completed') return res.json({ success: true, file: publicFile(await fileInfo(bucket, `${id}.zip`), id), message: 'This file upload was already published.' });
    if (upload.expiresAt < Date.now()) throw new FileManagementError(410, 'Upload expired. Prepare a new upload.');
    lockKey = `adminFilePublishLocks/${id}`;
    const acquired = await Store.rpc('rate', lockKey, { now: Date.now(), windowMs: 120000, maxAttempts: 1 });
    if (!acquired) { lockKey = undefined; throw new FileManagementError(409, 'Another file publication is in progress. Retry shortly.'); }
    const latestUpload = await Store.get<any>(`adminFileUploads/${upload.uploadId}`);
    if (latestUpload?.status === 'completed') return res.json({ success: true, file: publicFile(await fileInfo(bucket, `${id}.zip`), id), message: 'This file upload was already published.' });
    const staged = await fileInfo(bucket, upload.stagingPath), stagedFile = publicFile(staged, id);
    if (!staged || stagedFile.size !== upload.expectedSize || !stagedFile.size || stagedFile.size > MAX_PRIVATE_ZIP_BYTES) throw new FileManagementError(400, 'Uploaded ZIP size does not match the reviewed file.');
    const signed = await bucket.createSignedUrl(upload.stagingPath, 30);
    if (signed.error || !signed.data?.signedUrl) throw new FileManagementError(503, 'Could not verify the staged ZIP.');
    await verifyStagedZipHeader(signed.data.signedUrl);
    const current = await fileInfo(bucket, `${id}.zip`);
    if (version(current) !== upload.priorVersion || (current && !upload.replaceExisting)) throw new FileManagementError(409, 'The existing file changed after upload preparation. Review it and prepare a new upload.');
    const backupPath = current ? `_backups/${id}/${upload.uploadId}.zip` : null;
    await Store.update(`adminFileUploads/${upload.uploadId}`, { status: 'publishing', publicationStartedAt: new Date().toISOString(), backupPath, validatedSize: stagedFile.size });
    if (backupPath) {
      const backup = await bucket.move(`${id}.zip`, backupPath);
      if (backup.error) throw new FileManagementError(503, 'Could not preserve the existing file. Nothing was replaced.');
    }
    const published = await bucket.move(upload.stagingPath, `${id}.zip`);
    if (published.error) {
      const restore = backupPath ? await bucket.move(backupPath, `${id}.zip`) : null;
      await Store.update(`adminFileUploads/${upload.uploadId}`, { status: 'failed', failedAt: new Date().toISOString(), backupPath, restoreRequired: Boolean(restore?.error) });
      throw new FileManagementError(503, restore?.error ? 'Publication failed. Review the preserved private backup in Supabase before further changes.' : 'Publication failed. The previous product file was preserved.');
    }
    const now = new Date().toISOString();
    await Store.update(`adminFileUploads/${upload.uploadId}`, { status: 'completed', completedAt: now, reviewedBy: req.userId, reviewReason: input.data.reason, backupPath, validatedSize: stagedFile.size, validation: 'ZIP header and storage metadata; not malware or full archive verification' });
    await audit(req, 'PRIVATE_PRODUCT_FILE_PUBLISHED', { uploadId: upload.uploadId, size: stagedFile.size, replaced: Boolean(current), reason: input.data.reason, validation: 'zip_header_and_metadata' }, id);
    res.json({ success: true, file: { ...stagedFile, path: `${id}.zip`, updatedAt: now }, message: 'Private ZIP published after signature and size verification. Archive contents and malware screening remain the owner’s responsibility.' });
  } catch (error) { storageError(res, error); }
  finally { if (lockKey) await Store.delete(lockKey).catch(() => undefined); }
});
