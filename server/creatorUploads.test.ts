import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_UPLOAD_LIMIT_BYTES, validateCreatorFileName, validateCreatorZip, validateCreatorImportUrl, isPublicImportAddress, createCreatorUploadTicket, getCreatorUploadTicket, verifyCreatorStagedFile } from './creatorUploads';
import { Store } from './store';

const archive = (size: number) => { const value = Buffer.alloc(size); value.set([0x50, 0x4b, 3, 4]); return value; };

test('creator archives enforce the actual 10 MB byte limit and reject unsafe names or disguised HTML', () => {
  assert.equal(validateCreatorZip(archive(CREATOR_UPLOAD_LIMIT_BYTES)).size, CREATOR_UPLOAD_LIMIT_BYTES);
  assert.throws(() => validateCreatorZip(archive(CREATOR_UPLOAD_LIMIT_BYTES + 1)), /10 MB/);
  assert.throws(() => validateCreatorZip(Buffer.from('<html>not a ZIP file</html>')), /ZIP archive/);
  assert.throws(() => validateCreatorZip(Buffer.alloc(10)), /ZIP archive/);
  for (const name of ['../private.zip', 'folder/file.zip', 'folder\\file.zip', 'file.zip\n', 'file.zip.html', 'file\0.zip']) assert.throws(() => validateCreatorFileName(name));
  assert.equal(validateCreatorFileName('my-product.zip'), 'my-product.zip');
});

test('direct file imports reject private destinations, unsafe schemes and IPv4-mapped or transition IPv6 addresses', () => {
  for (const value of ['http://example.com/file.zip', 'https://user:password@example.com/file.zip', 'https://127.0.0.1/file.zip', 'https://2130706433/file.zip', 'https://[::1]/file.zip', 'https://metadata.internal/file.zip', 'https://example.com:8443/file.zip', 'https://example.com/file.zip#secret']) assert.throws(() => validateCreatorImportUrl(value));
  for (const address of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.1.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', '192.0.2.5', '198.51.100.4', '203.0.113.2', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '2001:db8::1', '2001:20::1', '2002:7f00:1::']) assert.equal(isPublicImportAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublicImportAddress(address), true, address);
  assert.equal(validateCreatorImportUrl('https://files.example.com/real.zip?token=private').origin, 'https://files.example.com');
});

test('private signed uploads bind user/product ownership and verify stored bytes before granting a file to a listing', async context => {
  const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.SUPABASE_URL = 'https://uploads.synthetic.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service'; delete process.env.SUPABASE_SECRET_KEY;
  context.after(() => { for (const [name, value] of Object.entries(before)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
  const records = new Map<string, any>(); let allowed = true, downloadCalls = 0;
  const bytes = archive(5 * 1024 * 1024); let objectSize = bytes.length, objectBytes = bytes;
  context.mock.method(Store, 'rpc', async (operation: string) => { assert.equal(operation, 'rate'); return allowed; });
  context.mock.method(Store, 'set', async (key: string, value: unknown) => { records.set(key, value); return value; });
  context.mock.method(Store, 'get', async (key: string) => records.get(key) || null);
  context.mock.method(globalThis, 'fetch', async (input: any) => {
    const url = new URL(String(input?.url || input)); assert.equal(url.origin, 'https://uploads.synthetic.supabase.co');
    if (url.pathname.startsWith('/storage/v1/object/upload/sign/products/')) return Response.json({ url: url.pathname.replace('/storage/v1', '') + '?token=synthetic-upload' });
    if (url.pathname.startsWith('/storage/v1/object/info/products/')) return Response.json({ name: 'product.zip', size: objectSize });
    if (url.pathname.startsWith('/storage/v1/object/products/')) { downloadCalls++; return new Response(new Uint8Array(objectBytes)); }
    throw new Error('Unexpected Storage request');
  });
  const owner = { userId: 'owner', creatorId: `cr_${'a'.repeat(32)}`, listingId: `mk_${'b'.repeat(32)}`, revision: 1, fileName: 'product.zip', size: bytes.length };
  await assert.rejects(createCreatorUploadTicket({ ...owner, creatorId: '../another-creator' }), /Invalid private upload/);
  await assert.rejects(createCreatorUploadTicket({ ...owner, size: CREATOR_UPLOAD_LIMIT_BYTES + 1 }), /10 MB/);
  const prepared = await createCreatorUploadTicket(owner);
  assert.match(prepared.signedUrl, /\/storage\/v1\/object\/upload\/sign\/products\/_creators\//);
  assert.ok(!JSON.stringify(prepared.ticket).includes('synthetic-service'));
  await assert.rejects(getCreatorUploadTicket(prepared.ticket.id, 'attacker', owner.creatorId, owner.listingId), /not found/);
  await assert.rejects(getCreatorUploadTicket(prepared.ticket.id, owner.userId, owner.creatorId, `mk_${'c'.repeat(32)}`), /not found/);
  const verified = await verifyCreatorStagedFile(prepared.ticket); assert.equal(verified.size, bytes.length); assert.match(verified.sha256, /^[a-f0-9]{64}$/);
  objectSize = CREATOR_UPLOAD_LIMIT_BYTES + 1;
  await assert.rejects(verifyCreatorStagedFile(prepared.ticket), /larger than 10 MB/); assert.equal(downloadCalls, 1, 'oversized metadata must stop before allocating the file buffer');
  objectSize = bytes.length; objectBytes = Buffer.alloc(bytes.length);
  await assert.rejects(verifyCreatorStagedFile(prepared.ticket), /ZIP archive/);
  records.set(`marketplace/uploadTickets/${prepared.ticket.id}`, { ...prepared.ticket, path: 'private-other-file.zip' });
  await assert.rejects(getCreatorUploadTicket(prepared.ticket.id, owner.userId, owner.creatorId, owner.listingId), /not found/);
  records.set(`marketplace/uploadTickets/${prepared.ticket.id}`, { ...prepared.ticket, expiresAt: Date.now() - 1 });
  await assert.rejects(getCreatorUploadTicket(prepared.ticket.id, owner.userId, owner.creatorId, owner.listingId), /expired/);
  allowed = false; await assert.rejects(createCreatorUploadTicket(owner), /temporarily limited/);
});
