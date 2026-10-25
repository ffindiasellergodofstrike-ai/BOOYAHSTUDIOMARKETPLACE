import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketplaceService } from './MarketplaceService';

test('a 5 MB seller ZIP goes directly to private Storage; API calls carry metadata and finalize only after a successful upload', async context => {
  const calls: { path: string; options?: RequestInit }[] = [];
  const id = 'a'.repeat(32), uploadUrl = `https://uploads.synthetic.supabase.co/storage/v1/object/upload/sign/products/_creators/cr_owner/mk_product/${id}.zip?token=synthetic-only`;
  context.mock.method(globalThis, 'fetch', async (input: any, options?: RequestInit) => {
    const path = String(input); calls.push({ path, options });
    if (path.endsWith('/upload-intent')) return Response.json({ success: true, uploadId: id, uploadUrl, uploadOrigin: 'https://uploads.synthetic.supabase.co', expiresAt: Date.now() + 60000, method: 'PUT' });
    if (path === uploadUrl) return Response.json({ Key: 'private-object' });
    if (path.endsWith('/upload-complete')) return Response.json({ success: true, listing: { id: 'listing', file: { uploaded: true } } });
    throw new Error('Unexpected upload URL');
  });
  const zip = new File([new Uint8Array(5 * 1024 * 1024)], 'product.zip', { type: 'application/zip' });
  const response = await MarketplaceService.uploadListing('listing', zip); assert.equal(response.listing.file.uploaded, true);
  assert.equal(calls.length, 3); assert.equal(calls[1].options?.body, zip); assert.equal(calls[1].options?.credentials, 'omit'); assert.equal(calls[1].options?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[0].options?.body)), { fileName: zip.name, size: zip.size });
  assert.deepEqual(JSON.parse(String(calls[2].options?.body)), { uploadId: id });
  await assert.rejects(MarketplaceService.uploadListing('listing', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'too-big.zip')), /10 MB/);
  assert.equal(calls.length, 3, 'an oversized file never starts an API or Storage upload');
});

test('failed Storage uploads never call finalization or report an uploaded listing', async context => {
  let finalized = false;
  context.mock.method(globalThis, 'fetch', async (input: any) => {
    const path = String(input);
    if (path.endsWith('/upload-intent')) return Response.json({ success: true, uploadId: 'a'.repeat(32), uploadUrl: 'https://uploads.synthetic.supabase.co/storage/v1/object/upload/sign/products/_creators/file.zip?token=synthetic', uploadOrigin: 'https://uploads.synthetic.supabase.co', expiresAt: Date.now() + 60000, method: 'PUT' });
    if (path.endsWith('/upload-complete')) finalized = true;
    return Response.json({ message: 'Synthetic failure' }, { status: 413 });
  });
  await assert.rejects(MarketplaceService.uploadListing('listing', new File([new Uint8Array(22)], 'product.zip')), /10 MB/);
  assert.equal(finalized, false);
});
