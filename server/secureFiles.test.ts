import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { SecureFileManager } from './secureFiles';

test('maps product ids to Vercel environment variable names', () => {
  assert.equal(
    SecureFileManager.getProductDownloadEnvironmentKey('linknest-pro'),
    'PRODUCT_DOWNLOAD_URL_LINKNEST_PRO'
  );
  assert.equal(
    SecureFileManager.getProductDownloadEnvironmentKey('Creator Kit / v2'),
    'PRODUCT_DOWNLOAD_URL_CREATOR_KIT___V2'
  );
});

test('rejects non-HTTPS product download URLs', async () => {
  const key = SecureFileManager.getProductDownloadEnvironmentKey('test-product');
  const previousValue = process.env[key];
  process.env[key] = 'http://storage.example/test-product.zip';

  try {
    await assert.rejects(
      SecureFileManager.openProductFile('test-product'),
      /must use HTTPS/
    );
  } finally {
    if (previousValue === undefined) delete process.env[key];
    else process.env[key] = previousValue;
  }
});

test('recognizes complete MEGA file links but not folders or lookalike hosts', () => {
  assert.equal(SecureFileManager.isMegaFileUrl(new URL('https://mega.nz/file/example#key')), true);
  assert.equal(SecureFileManager.isMegaFileUrl(new URL('https://mega.nz/folder/example#key')), false);
  assert.equal(SecureFileManager.isMegaFileUrl(new URL('https://mega.nz.evil.example/file/example#key')), false);
});

test('rejects MEGA links missing the decryption key', async () => {
  const key = SecureFileManager.getProductDownloadEnvironmentKey('test-product');
  const previousValue = process.env[key];
  process.env[key] = 'https://mega.nz/file/example';

  try {
    await assert.rejects(
      SecureFileManager.openProductFile('test-product'),
      /complete MEGA file link/
    );
  } finally {
    if (previousValue === undefined) delete process.env[key];
    else process.env[key] = previousValue;
  }
});

test('fetches and verifies a configured product ZIP without exposing its URL', async () => {
  const key = SecureFileManager.getProductDownloadEnvironmentKey('test-product');
  const previousValue = process.env[key];
  const originalFetch = globalThis.fetch;
  process.env[key] = 'https://storage.example/test-product.zip';

  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), process.env[key]);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'follow');
    return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), { status: 200 });
  };

  try {
    const source = await SecureFileManager.openProductFile('test-product');
    const chunks: Buffer[] = [];
    for await (const chunk of source.stream) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  } finally {
    globalThis.fetch = originalFetch;
    if (previousValue === undefined) delete process.env[key];
    else process.env[key] = previousValue;
  }
});

test('rejects an HTML response masquerading as a ZIP', async () => {
  const key = SecureFileManager.getProductDownloadEnvironmentKey('test-product');
  const previousValue = process.env[key];
  const originalFetch = globalThis.fetch;
  process.env[key] = 'https://storage.example/test-product.zip';
  globalThis.fetch = async () => new Response('<html>not a zip</html>', { status: 200 });

  try {
    await assert.rejects(
      SecureFileManager.openProductFile('test-product'),
      /not a valid ZIP/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousValue === undefined) delete process.env[key];
    else process.env[key] = previousValue;
  }
});

test('streams the upstream ZIP with protected download headers', async () => {
  const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  let statusCode: number | undefined;
  let responseHeaders: Record<string, string> | undefined;

  output.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  (output as any).writeHead = (status: number, headers: Record<string, string>) => {
    statusCode = status;
    responseHeaders = headers;
    return output;
  };

  SecureFileManager.streamProductFileToResponse(
    { stream: Readable.from([Buffer.from(zipBytes)]), contentLength: zipBytes.byteLength },
    'linknest-pro-package.zip',
    output as any
  );
  await once(output, 'finish');

  assert.equal(statusCode, 200);
  assert.equal(responseHeaders?.['Content-Type'], 'application/zip');
  assert.equal(responseHeaders?.['Content-Length'], String(zipBytes.byteLength));
  assert.equal(responseHeaders?.['Cache-Control'], 'private, no-store, no-cache, must-revalidate');
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(zipBytes));
});
