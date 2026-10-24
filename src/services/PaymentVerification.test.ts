import assert from 'node:assert/strict';
import test from 'node:test';
import type { Order } from '../types';
import { verifyReturnedPayment } from './PaymentVerification';

const pendingOrder = { paymentStatus: 'PENDING', status: 'PENDING' } as Order;
const paidOrder = {
  paymentStatus: 'PAID', paymentEnvironment: 'live', status: 'PAID', paymentProvider: 'Razorpay',
  transactionId: 'verified-gateway-id', deliveryStatus: 'DELIVERED', downloadStatus: 'AVAILABLE',
} as Order;

test('a popup success triggers gateway reconciliation before showing a paid order', async () => {
  let reads = 0;
  let reconciliations = 0;
  const outcome = await verifyReturnedPayment(
    async () => (++reads === 1 ? pendingOrder : paidOrder),
    async () => { reconciliations++; return { httpStatus: 200, success: true, status: 'PAID' }; },
  );
  assert.equal(outcome.kind, 'paid');
  assert.equal(reads, 2);
  assert.equal(reconciliations, 1);
});

test('a gateway response never grants access unless the server order becomes paid', async () => {
  const outcome = await verifyReturnedPayment(
    async () => pendingOrder,
    async () => ({ httpStatus: 200, success: true, status: 'PAID' }),
  );
  assert.equal(outcome.kind, 'pending');
});

test('an already paid order skips gateway reconciliation', async () => {
  const outcome = await verifyReturnedPayment(
    async () => paidOrder,
    async () => { throw new Error('Reconciliation should not run'); },
  );
  assert.equal(outcome.kind, 'paid');
});

test('confirmed payment shows success while download delivery is being prepared', async () => {
  const unfulfilled = { ...paidOrder, deliveryStatus: 'PENDING', downloadStatus: 'UNAVAILABLE' } as Order;
  const outcome = await verifyReturnedPayment(
    async () => unfulfilled,
    async () => { throw new Error('Confirmed payment should not need another gateway lookup'); },
  );
  assert.equal(outcome.kind, 'paid');
});

test('a failed gateway report yields failure only when the order has not become paid', async () => {
  let reads = 0;
  const outcome = await verifyReturnedPayment(
    async () => (++reads === 1 ? pendingOrder : paidOrder),
    async () => ({ httpStatus: 200, success: false, status: 'FAILED' }),
  );
  assert.equal(outcome.kind, 'paid');
});

test('customer payment results never expose provider diagnostics', async () => {
  for (const status of ['PENDING', 'FAILED', 'REVOKED']) {
    const outcome = await verifyReturnedPayment(
      async () => pendingOrder,
      async () => ({ httpStatus: 503, status, message: 'Razorpay TEST MODE: merchant key not configured' }),
    );
    assert.notEqual(outcome.kind, 'paid');
    assert.ok('message' in outcome);
    assert.doesNotMatch(outcome.message || '', /Razorpay|TEST|configured|merchant/i);
    assert.match(outcome.message || '', /order|account/);
  }
});
