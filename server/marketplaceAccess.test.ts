import test from 'node:test';
import assert from 'node:assert/strict';
import { isPaidOrderForProduct } from './paymentAccess';
import { customerOrder } from './customerOrder';

test('Easebuzz downloads require an exact canonical live proof and reject mismatches or revoked access', () => {
  const payment = { id: 'eb_verified', txnid: 'EB_order', status: 'success', amount: 10000, currency: 'INR', environment: 'live', refundedPaise: 0, verifiedAt: '2026-10-23T12:00:00Z' };
  const order: any = { id: 'order', userId: 'buyer', paymentProvider: 'Easebuzz', paymentEnvironment: 'live', paymentVerifiedAt: payment.verifiedAt,
    easebuzzTxnId: 'EB_order', transactionId: payment.id, total: 100, paymentStatus: 'PAID', status: 'PAID', deliveryStatus: 'DELIVERED', downloadStatus: 'AVAILABLE', items: [{ productId: 'product' }], payments: { [payment.id]: payment } };
  assert.equal(isPaidOrderForProduct(order, 'buyer', 'product'), true);
  for (const patch of [{ amount: 9999 }, { txnid: 'another_order' }, { environment: 'test' }, { status: 'pending' }, { currency: 'USD' }, { refundedPaise: 1 }, { id: 'another_payment' }, { verifiedAt: null }]) {
    assert.equal(isPaidOrderForProduct({ ...order, payments: { [payment.id]: { ...payment, ...patch } } }, 'buyer', 'product'), false, JSON.stringify(patch));
  }
  for (const patch of [{ paymentEnvironment: 'test' }, { deliveryStatus: 'REVOKED' }, { paymentVerifiedAt: null }, { paymentStatus: 'REFUNDED' }, { payments: {} }]) assert.equal(isPaidOrderForProduct({ ...order, ...patch }, 'buyer', 'product'), false);
  assert.equal(isPaidOrderForProduct(order, 'other-buyer', 'product'), false);
  assert.equal(isPaidOrderForProduct(order, 'buyer', 'other-product'), false);
});

test('customer order DTO removes private seller routing references without mutating the financial snapshot', () => {
  const order = { id: 'order', marketplace: { sellerId: 'creator', sellerName: 'Creator', provider: 'cashfree', providerAccountId: 'private_vendor', commissionBps: 1000 } };
  const result = customerOrder(order);
  assert.equal(result.marketplace.providerAccountId, undefined);
  assert.equal(result.marketplace.sellerName, 'Creator');
  assert.equal(order.marketplace.providerAccountId, 'private_vendor');
});
