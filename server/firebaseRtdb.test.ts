import assert from 'node:assert/strict';
import test from 'node:test';
import { FirebaseRtdb } from './firebaseRtdb';

test('production account, payment and token data cannot fall back to process memory', async (context) => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    url: process.env.FIREBASE_DATABASE_URL,
    auth: process.env.FIREBASE_DATABASE_AUTH,
    secret: process.env.FIREBASE_DATABASE_SECRET,
  };
  context.after(() => {
    for (const [key, value] of Object.entries({
      NODE_ENV: previous.nodeEnv, FIREBASE_DATABASE_URL: previous.url,
      FIREBASE_DATABASE_AUTH: previous.auth, FIREBASE_DATABASE_SECRET: previous.secret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  process.env.NODE_ENV = 'production';
  delete process.env.FIREBASE_DATABASE_AUTH;
  delete process.env.FIREBASE_DATABASE_SECRET;
  delete process.env.FIREBASE_DATABASE_URL;
  await assert.rejects(FirebaseRtdb.get('orders/synthetic-1'), /Authenticated Firebase/);
  await assert.rejects(FirebaseRtdb.set('sessions/synthetic-1', { userId: 'buyer' }), /Authenticated Firebase/);
  await assert.rejects(FirebaseRtdb.update('purchases/synthetic-1', { accessStatus: 'active' }), /Authenticated Firebase/);
  await assert.rejects(FirebaseRtdb.delete('downloadTokens/synthetic-1'), /Authenticated Firebase/);
  await assert.rejects(FirebaseRtdb.set('auditLogs/synthetic-1', { eventType: 'TEST' }), /Authenticated Firebase/);
  await assert.rejects(FirebaseRtdb.set('products/synthetic-1', { title: 'Test' }), /Authenticated Firebase/);
  await assert.rejects(FirebaseRtdb.set('rateLimits/synthetic-1', { count: 1 }), /Authenticated Firebase/);
  await assert.rejects(FirebaseRtdb.setMultiple({ 'orders/synthetic-1': {} }), /Authenticated Firebase/);

  process.env.FIREBASE_DATABASE_URL = 'https://example.test';
  process.env.FIREBASE_DATABASE_AUTH = 'synthetic-credential';
  context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  await assert.rejects(FirebaseRtdb.get('orders/synthetic-1'), /Firebase read failed/);
  await assert.rejects(FirebaseRtdb.set('downloadTokens/synthetic-1', { used: false }), /Firebase write failed/);
  await assert.rejects(FirebaseRtdb.update('users/buyer/credentials', { passwordHash: 'synthetic' }), /Firebase update failed/);
  await assert.rejects(FirebaseRtdb.delete('sessions/synthetic-1'), /Firebase delete failed/);
  await assert.rejects(FirebaseRtdb.saveGlobalOrder({ id: 'synthetic-1', userId: 'buyer' }), /Firebase multi-path write failed/);

});

test('order and purchase mirrors use one atomic Firebase multi-path request', async (context) => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    url: process.env.FIREBASE_DATABASE_URL,
    auth: process.env.FIREBASE_DATABASE_AUTH,
  };
  context.after(() => {
    for (const [key, value] of Object.entries({ NODE_ENV: previous.nodeEnv,
      FIREBASE_DATABASE_URL: previous.url, FIREBASE_DATABASE_AUTH: previous.auth })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.NODE_ENV = 'production';
  process.env.FIREBASE_DATABASE_URL = 'https://example.test';
  process.env.FIREBASE_DATABASE_AUTH = 'synthetic-credential';
  const writes: any[] = [];
  context.mock.method(globalThis, 'fetch', async (_url: any, init: any) => {
    writes.push({ method: init.method, body: JSON.parse(init.body) });
    return Response.json(null);
  });
  await FirebaseRtdb.saveGlobalOrder({ id: 'synthetic-order', userId: 'buyer', easebuzzTxnId: 'synthetic-txn' });
  await FirebaseRtdb.savePurchase('buyer', 'synthetic-purchase', { purchaseId: 'synthetic-purchase' });
  assert.deepEqual(writes.map((write) => write.method), ['PATCH', 'PATCH']);
  assert.deepEqual(Object.keys(writes[0].body).sort(), [
    'orders/synthetic-order', 'paymentTxnIndex/synthetic-txn', 'users/buyer/orders/synthetic-order',
  ]);
  assert.equal(writes[0].body['paymentTxnIndex/synthetic-txn'], 'synthetic-order');
  assert.deepEqual(Object.keys(writes[1].body).sort(), ['purchases/synthetic-purchase', 'users/buyer/purchases/synthetic-purchase']);
});

test('transaction index finds new orders without scanning all orders and checks the mapping', async (context) => {
  const reads: string[] = [];
  context.mock.method(FirebaseRtdb, 'get', async (path: string) => {
    reads.push(path);
    if (path === 'paymentTxnIndex/synthetic-txn') return 'synthetic-order';
    if (path === 'orders/synthetic-order') return { id: 'synthetic-order', easebuzzTxnId: 'synthetic-txn' };
    if (path === 'orders') return { 'legacy-order': { id: 'legacy-order', easebuzzTxnId: 'legacy-txn' } };
    return null;
  });
  const order = await FirebaseRtdb.getGlobalOrder('synthetic-txn');
  assert.equal(order?.id, 'synthetic-order');
  assert.deepEqual(reads, [
    'orders/synthetic-txn', 'paymentTxnIndex/synthetic-txn', 'orders/synthetic-order',
  ]);
  assert.equal((await FirebaseRtdb.getGlobalOrder('legacy-txn'))?.id, 'legacy-order');
  assert.deepEqual(reads.slice(3), ['orders/legacy-txn', 'paymentTxnIndex/legacy-txn', 'orders']);
});
