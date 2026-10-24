import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  verifyPaddleWebhookSignature,
  getPaddlePriceIdForProduct,
  getClientPaddleConfig,
  getPaddleApiBaseUrl,
  getPaddleEnvironment,
} from './paddle';

test('Paddle webhook signature verification: correctly verifies valid raw body HMAC-SHA256 signature', () => {
  const secret = 'pdl_ntf_set_01hk0y3h3z6r9q5b4w8e7a1m2c_test';
  const rawBody = JSON.stringify({
    event_id: 'evt_01hkg8b4f1yvjqmz9b7p4d2w1x',
    event_type: 'transaction.completed',
    occurred_at: '2026-09-29T12:00:00.000Z',
    data: {
      id: 'txn_01hkg8a7e3xrp9qm2w5n1v8k4y',
      status: 'completed',
      custom_data: {
        orderId: 'LN-20260929-ABC123XYZ',
      },
    },
  });

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ts = String(nowSeconds);
  const signedPayload = `${ts}:${rawBody}`;
  const h1 = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  const signatureHeader = `ts=${ts};h1=${h1}`;

  const result = verifyPaddleWebhookSignature(rawBody, signatureHeader, secret);
  assert.equal(result.isValid, true);
  assert.equal(result.timestamp, nowSeconds);
});

test('Paddle webhook signature verification: supports multiple h1 hashes and handles extra spaces', () => {
  const secret = 'pdl_ntf_set_webhook_secret_123';
  const rawBody = '{"event_type":"transaction.completed","data":{"id":"txn_123"}}';
  const ts = String(Math.floor(Date.now() / 1000));
  const validHash = crypto.createHmac('sha256', secret).update(`${ts}:${rawBody}`, 'utf8').digest('hex');

  // Header with an old/rotated key hash plus current key hash
  const signatureHeader = `ts=${ts}; h1=0000000000000000000000000000000000000000000000000000000000000000; h1=${validHash}`;

  const result = verifyPaddleWebhookSignature(rawBody, signatureHeader, secret);
  assert.equal(result.isValid, true);
});

test('Paddle webhook signature verification: rejects tampered body', () => {
  const secret = 'pdl_ntf_set_webhook_secret_123';
  const originalBody = '{"event_type":"transaction.completed","data":{"id":"txn_123"}}';
  const tamperedBody = '{"event_type":"transaction.completed","data":{"id":"txn_999"}}';
  const ts = String(Math.floor(Date.now() / 1000));
  const validHash = crypto.createHmac('sha256', secret).update(`${ts}:${originalBody}`, 'utf8').digest('hex');

  const signatureHeader = `ts=${ts};h1=${validHash}`;

  const result = verifyPaddleWebhookSignature(tamperedBody, signatureHeader, secret);
  assert.equal(result.isValid, false);
  assert.equal(result.reason, 'Signature mismatch.');
});

test('Paddle webhook signature verification: rejects expired timestamp (anti-replay)', () => {
  const secret = 'pdl_ntf_set_webhook_secret_123';
  const rawBody = '{"event_type":"transaction.completed"}';
  // 10 minutes ago
  const oldSeconds = Math.floor(Date.now() / 1000) - 600;
  const ts = String(oldSeconds);
  const hash = crypto.createHmac('sha256', secret).update(`${ts}:${rawBody}`, 'utf8').digest('hex');

  const signatureHeader = `ts=${ts};h1=${hash}`;

  const result = verifyPaddleWebhookSignature(rawBody, signatureHeader, secret, 300);
  assert.equal(result.isValid, false);
  assert.match(result.reason || '', /timestamp is too old/i);
});

test('Paddle webhook signature verification: fails gracefully if secret or header missing', () => {
  assert.equal(verifyPaddleWebhookSignature('body', 'ts=123;h1=abc', '').isValid, false);
  assert.equal(verifyPaddleWebhookSignature('', 'ts=123;h1=abc', 'secret').isValid, false);
  assert.equal(verifyPaddleWebhookSignature('body', undefined, 'secret').isValid, false);
  assert.equal(verifyPaddleWebhookSignature('body', 'invalid_header', 'secret').isValid, false);
});

test('Paddle product price mapping: resolves price ID from environment variable format', () => {
  const prev = process.env.PADDLE_PRICE_LINKNEST_PRO;
  try {
    process.env.PADDLE_PRICE_LINKNEST_PRO = 'pri_01hkg8testlinknest123';
    const resolved = getPaddlePriceIdForProduct('linknest-pro');
    assert.equal(resolved, 'pri_01hkg8testlinknest123');
  } finally {
    if (prev !== undefined) {
      process.env.PADDLE_PRICE_LINKNEST_PRO = prev;
    } else {
      delete process.env.PADDLE_PRICE_LINKNEST_PRO;
    }
  }
});

test('Paddle client config: returns safe client settings without private secrets', () => {
  const prevToken = process.env.PADDLE_CLIENT_TOKEN;
  const prevKey = process.env.PADDLE_API_KEY;
  const prevSecret = process.env.PADDLE_WEBHOOK_SECRET;

  try {
    process.env.PADDLE_CLIENT_TOKEN = 'test_7b9c1d3e5f';
    process.env.PADDLE_API_KEY = 'pdl_api_secret_do_not_expose';
    process.env.PADDLE_WEBHOOK_SECRET = 'pdl_ntf_secret_do_not_expose';

    const clientConfig = getClientPaddleConfig();
    assert.equal(clientConfig.clientToken, 'test_7b9c1d3e5f');
    assert.equal(clientConfig.environment, 'sandbox');
    // Ensure secrets are NOT in the client configuration
    assert.equal((clientConfig as any).apiKey, undefined);
    assert.equal((clientConfig as any).webhookSecret, undefined);
  } finally {
    if (prevToken) process.env.PADDLE_CLIENT_TOKEN = prevToken;
    else delete process.env.PADDLE_CLIENT_TOKEN;
    if (prevKey) process.env.PADDLE_API_KEY = prevKey;
    else delete process.env.PADDLE_API_KEY;
    if (prevSecret) process.env.PADDLE_WEBHOOK_SECRET = prevSecret;
    else delete process.env.PADDLE_WEBHOOK_SECRET;
  }
});

test('Paddle environment endpoints: sandbox vs production API baseUrl', () => {
  assert.equal(getPaddleApiBaseUrl('sandbox'), 'https://sandbox-api.paddle.com');
  assert.equal(getPaddleApiBaseUrl('production'), 'https://api.paddle.com');
});
