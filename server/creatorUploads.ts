import crypto from 'node:crypto';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Store } from './store';
import { supabaseAdmin } from './supabase';

export const CREATOR_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
export const CREATOR_UPLOAD_LIMIT_LABEL = '10 MB';
const ticketLifetimeMs = 10 * 60 * 1000;
export class CreatorUploadError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = 'CreatorUploadError'; }
}
export interface CreatorUploadTicket {
  id: string; userId: string; creatorId: string; listingId: string; revision: number;
  path: string; fileName: string; size: number; expiresAt: number; purgeAt: number; createdAt: string;
}
export function validateCreatorFileName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200 || !/\.zip$/i.test(value) || /[\\/\r\n\u0000-\u001f]/.test(value)) throw new CreatorUploadError('Choose a ZIP filename without folders or control characters.');
  return value;
}
export function validateCreatorZip(bytes: Buffer): { size: number; sha256: string } {
  if (bytes.length > CREATOR_UPLOAD_LIMIT_BYTES) throw new CreatorUploadError('Files must be 10 MB or smaller.', 413);
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw new CreatorUploadError('The file must be a non-empty ZIP archive. Share links and HTML pages are not ZIP files.');
  return { size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
export async function createCreatorUploadTicket(input: Omit<CreatorUploadTicket, 'id' | 'path' | 'expiresAt' | 'purgeAt' | 'createdAt'>) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.userId) || !/^cr_[a-f0-9]{32}$/.test(input.creatorId) || !/^mk_[a-f0-9]{32}$/.test(input.listingId) || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new CreatorUploadError('Invalid private upload owner or product reference.');
  validateCreatorFileName(input.fileName);
  if (!Number.isSafeInteger(input.size) || input.size < 22 || input.size > CREATOR_UPLOAD_LIMIT_BYTES) throw new CreatorUploadError('Choose one ZIP archive no larger than 10 MB.', input.size > CREATOR_UPLOAD_LIMIT_BYTES ? 413 : 400);
  if (!await Store.rpc('rate', `creatorUploadRates/${input.creatorId}`, { now: Date.now(), windowMs: 3600000, maxAttempts: 12 })) throw new CreatorUploadError('Upload requests are temporarily limited. Try again later or contact support.', 429);
  const id = crypto.randomUUID().replaceAll('-', ''), timestamp = Date.now();
  const ticket: CreatorUploadTicket = { ...input, id, path: `_creators/${input.creatorId}/${input.listingId}/${id}.zip`, createdAt: new Date(timestamp).toISOString(), expiresAt: timestamp + ticketLifetimeMs, purgeAt: timestamp + 135 * 60 * 1000 };
  await Store.set(`marketplace/uploadTickets/${id}`, ticket);
  const result = await supabaseAdmin().storage.from('products').createSignedUploadUrl(ticket.path, { upsert: false });
  if (result.error || !result.data?.signedUrl) throw new CreatorUploadError('Private Storage could not prepare the upload. Please try again.', 503);
  return { ticket, signedUrl: result.data.signedUrl };
}
export async function getCreatorUploadTicket(id: string, userId: string, creatorId: string, listingId: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new CreatorUploadError('Invalid upload reference.');
  const ticket = await Store.get<CreatorUploadTicket>(`marketplace/uploadTickets/${id}`);
  if (!ticket || ticket.id !== id || ticket.userId !== userId || ticket.creatorId !== creatorId || ticket.listingId !== listingId || ticket.path !== `_creators/${creatorId}/${listingId}/${id}.zip`) throw new CreatorUploadError('Upload not found.', 404);
  if (Date.now() > ticket.expiresAt) throw new CreatorUploadError('This upload has expired. Choose the file again to create a new upload.', 409);
  return ticket;
}
export async function verifyCreatorStagedFile(ticket: CreatorUploadTicket) {
  const bucket = supabaseAdmin().storage.from('products');
  const info = await bucket.info(ticket.path);
  const size = Number(info.data?.size);
  if (info.error || !info.data || !Number.isSafeInteger(size) || size !== ticket.size || size < 22 || size > CREATOR_UPLOAD_LIMIT_BYTES) {
    if (info.data) await bucket.remove([ticket.path]).catch(() => undefined);
    throw new CreatorUploadError('The stored ZIP is missing, changed or larger than 10 MB. Upload it again.', size > CREATOR_UPLOAD_LIMIT_BYTES ? 413 : 409);
  }
  // The bucket enforces 10 MB too. Validate actual stored bytes, not the browser's filename/size.
  const downloaded = await bucket.download(ticket.path);
  if (downloaded.error || !downloaded.data || downloaded.data.size !== size || downloaded.data.size > CREATOR_UPLOAD_LIMIT_BYTES) throw new CreatorUploadError('The private ZIP could not be verified. Please try again.', 409);
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  return { ...validateCreatorZip(bytes), path: ticket.path };
}

/** Reject all non-public destination ranges, including IPv4-mapped IPv6. */
export function isPublicImportAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:')) {
    const suffix = normalized.slice(7);
    if (suffix.includes('.')) return isPublicImportAddress(suffix);
    const parts = suffix.split(':');
    if (parts.length !== 2 || parts.some(v => !/^[a-f0-9]{1,4}$/.test(v))) return false;
    const value = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16);
    return isPublicImportAddress(`${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`);
  }
  if (isIP(normalized) === 4) {
    const [a, b, c] = normalized.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  // Only currently assigned global-unicast space; block special-purpose/documentation prefixes.
  if (isIP(normalized) !== 6 || !/^[23]/.test(normalized) || normalized.startsWith('2002:') || normalized.startsWith('2001:db8:')) return false;
  const second = parseInt(normalized.split(':')[1] || '0', 16);
  return !(normalized.startsWith('2001:') && second < 0x200);
}
export function validateCreatorImportUrl(input: unknown): URL {
  if (typeof input !== 'string' || input.length > 4000) throw new CreatorUploadError('Enter a direct HTTPS ZIP link.');
  let url: URL;
  try { url = new URL(input); } catch { throw new CreatorUploadError('Enter a valid direct HTTPS ZIP link.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443' || isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) throw new CreatorUploadError('Use a public HTTPS download link on port 443. Local addresses, credentials and share-page links are not accepted.');
  return url;
}
/** Resolve once and pin the HTTPS connection to a verified public address to prevent DNS rebinding. */
export async function importCreatorZip(input: unknown): Promise<Buffer> {
  const url = validateCreatorImportUrl(input);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => { throw new CreatorUploadError('The download host could not be resolved. Upload the ZIP directly instead.'); });
  if (!addresses.length || addresses.some(row => !isPublicImportAddress(row.address))) throw new CreatorUploadError('The download host must resolve only to public internet addresses. Upload the ZIP directly instead.');
  const target = addresses[0];
  return new Promise<Buffer>((resolve, reject) => {
    let finished = false;
    const done = (error?: Error, bytes?: Buffer) => { if (finished) return; finished = true; clearTimeout(deadline); error ? reject(error) : resolve(bytes!); };
    const request = https.request(url, { method: 'GET', agent: false, family: target.family, servername: url.hostname, headers: { Accept: 'application/zip, application/octet-stream', 'Accept-Encoding': 'identity', 'User-Agent': 'Booyahstudio-Private-File-Import/1.0' }, lookup: (_hostname, _options, callback) => callback(null, target.address, target.family) }, response => {
      if (response.statusCode !== 200) { response.destroy(); request.destroy(); return done(new CreatorUploadError('The link must directly return the ZIP without redirects, sign-in or a sharing page. Upload the file directly instead.')); }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { response.destroy(); request.destroy(); return done(new CreatorUploadError('Compressed HTTP responses are not accepted. Upload the ZIP directly instead.')); }
      const stated = Number(response.headers['content-length']);
      if (response.headers['content-length'] && (!Number.isSafeInteger(stated) || stated < 22 || stated > CREATOR_UPLOAD_LIMIT_BYTES)) { response.destroy(); request.destroy(); return done(new CreatorUploadError('The linked ZIP must be 10 MB or smaller.', stated > CREATOR_UPLOAD_LIMIT_BYTES ? 413 : 400)); }
      let size = 0; const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > CREATOR_UPLOAD_LIMIT_BYTES) { response.destroy(); request.destroy(); done(new CreatorUploadError('The linked ZIP exceeds 10 MB.', 413)); } else chunks.push(chunk); });
      response.on('end', () => { if (!response.complete) return done(new CreatorUploadError('The file transfer was incomplete. Please try again.')); const bytes = Buffer.concat(chunks); try { validateCreatorZip(bytes); done(undefined, bytes); } catch (error) { done(error as Error); } });
      response.on('error', () => done(new CreatorUploadError('The file transfer failed. Upload the ZIP directly instead.', 502)));
    });
    const deadline = setTimeout(() => { request.destroy(); done(new CreatorUploadError('The direct link took too long. Upload the ZIP directly instead.', 408)); }, 20000);
    request.on('error', () => done(new CreatorUploadError('The secure file transfer failed. Upload the ZIP directly instead.', 502)));
    request.end();
  });
}

/** Clean abandoned uploads after the provider's signed-upload token has also expired. */
export async function cleanupCreatorUploads(limit = 20) {
  const tickets = Object.values(await Store.get<Record<string, CreatorUploadTicket>>('marketplace/uploadTickets') || {}).filter(ticket => ticket.purgeAt <= Date.now()).slice(0, Math.max(1, Math.min(50, limit)));
  let removed = 0, retained = 0;
  for (const ticket of tickets) {
    const listing = await Store.get<any>(`marketplace/listings/${ticket.listingId}`);
    if (listing?.file?.stagingPath === ticket.path && !listing.file.published) { retained++; }
    else {
      const result = await supabaseAdmin().storage.from('products').remove([ticket.path]);
      if (result.error) continue;
      removed++;
    }
    await Store.delete(`marketplace/uploadTickets/${ticket.id}`);
  }
  return { checked: tickets.length, removed, retained };
}
