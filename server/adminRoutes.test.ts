import assert from 'node:assert/strict';
import test from 'node:test';
import { safeCsvCell } from './adminRoutes';
import { adminRouter } from './adminRoutes';
import { Store } from './store';
import { AuditLogger } from './audit';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

test('admin CSV export escapes quotes and spreadsheet formulas in customer input', () => {
  assert.equal(safeCsvCell('Buyer "One"'), '"Buyer ""One"""');
  assert.equal(safeCsvCell('=HYPERLINK("https://example.test")'), '"\'=HYPERLINK(""https://example.test"")"');
  assert.equal(safeCsvCell('  +1+2'), '"\'  +1+2"');
  assert.equal(safeCsvCell('normal@example.test'), '"normal@example.test"');
});

test('admin revenue uses verified payment time and real daily totals', async (context) => {
  context.mock.method(Store, 'getAllGlobalOrders', async () => [{
    paymentStatus: 'PAID', paymentEnvironment: 'live', total: 500,
    createdAt: '2026-01-01T00:00:00.000Z', paymentVerifiedAt: new Date().toISOString(),
  }, {
    paymentStatus: 'PARTIALLY_REFUNDED', paymentEnvironment: 'live', paymentProvider: 'Cashfree',
    total: 100, refundedAmount: 20, createdAt: '2026-01-01T00:00:00.000Z', paymentVerifiedAt: new Date().toISOString(),
  }, {
    paymentStatus: 'PAID', paymentEnvironment: 'test', total: 5000, paymentVerifiedAt: new Date().toISOString(),
  }]);
  context.mock.method(Store, 'getAllProducts', async () => []);
  context.mock.method(Store, 'getAllUsers', async () => []);
  context.mock.method(AuditLogger, 'getAllLogs', async () => []);
  const app = express();
  app.use(adminRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/dashboard/stats`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.stats.revenue.today, 580);
  assert.equal(payload.stats.revenue.last30d, 580);
  assert.equal(payload.stats.revenue.daily.at(-1).revenue, 580);
  assert.equal(payload.stats.revenue.total, 580, 'test payments excluded and verified refunds deducted');
  assert.equal(payload.stats.orders.paid, 2);
});
