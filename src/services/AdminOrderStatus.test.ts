import test from 'node:test';
import assert from 'node:assert/strict';
import { adminAccessStatus, adminEmailStatus, adminPaymentStatus, filterAdminOrders, adminOrderSummary, adminOrderDate } from './AdminOrderStatus';
const order = { id: 'BS-100', customerEmail: 'buyer@example.test', customerName: 'Buyer Name', customer: { phone: '9876543210' }, paymentProvider: 'Cashfree', paymentEnvironment: 'live', paymentStatus: 'PAID', transactionId: '123456', cashfreeOrderId: 'cf-BS-100', total: 199, payments: { '123456': { status: 'SUCCESS', order_id: 'cf-BS-100', environment: 'live', currency: 'INR', amount: 19900 } }, deliveryStatus: 'DELIVERED', downloadStatus: 'AVAILABLE', items: [{ productId: 'first', productTitle: 'First template' }, { productId: 'second', productTitle: 'Second template' }] };
test('admin access distinguishes account delivery, refunds, test-only and unpaid records', () => {
  assert.equal(adminAccessStatus(order).key, 'available');
  assert.equal(adminAccessStatus({ ...order, deliveryStatus: 'PENDING' }).key, 'pending');
  assert.equal(adminAccessStatus({ ...order, paymentStatus: 'PARTIALLY_REFUNDED', items: [{ ...order.items[0], refunded: true }, order.items[1]] }).key, 'partial');
  assert.equal(adminAccessStatus({ ...order, paymentStatus: 'REFUNDED' }).key, 'revoked');
  assert.equal(adminAccessStatus({ ...order, deliveryStatus: 'REVOKED' }).key, 'revoked');
  assert.equal(adminAccessStatus({ ...order, downloadStatus: 'REVOKED' }).key, 'revoked');
  assert.equal(adminAccessStatus({ ...order, paymentEnvironment: 'test' }).key, 'test');
  assert.notEqual(adminAccessStatus({ ...order, transactionId: undefined }).key, 'available');
  assert.equal(adminAccessStatus({ ...order, items: [{ ...order.items[0], downloadStatus: 'REVOKED' }, order.items[1]] }).key, 'partial');
  assert.equal(adminAccessStatus({ ...order, items: order.items.map(item => ({ ...item, downloadStatus: 'REVOKED' })) }).availableItems, 0);
  assert.equal(adminAccessStatus({ ...order, paymentProvider: 'Razorpay', payments: undefined }).key, 'available');
  assert.equal(adminAccessStatus({ ...order, paymentProvider: 'Razorpay', paymentStatus: 'PARTIALLY_REFUNDED' }).key, 'unavailable');
});
test('a paid label cannot create admin access without canonical funding payment verification', () => {
  const payment = order.payments['123456'];
  for (const change of [{ status: 'FAILED' }, { order_id: 'another-order' }, { environment: 'test' }, { currency: 'USD' }, { amount: 1 }, { amount: '19900' }]) {
    const access = adminAccessStatus({ ...order, payments: { '123456': { ...payment, ...change } } });
    assert.equal(access.key, 'unavailable');
    assert.equal(access.availableItems, 0);
  }
  assert.equal(adminAccessStatus({ ...order, payments: {} }).key, 'unavailable');
  assert.equal(adminAccessStatus({ ...order, cashfreeOrderId: undefined }).key, 'unavailable');
  assert.equal(adminAccessStatus({ ...order, total: 200 }).key, 'unavailable');
  assert.equal(adminAccessStatus({ ...order, paymentProvider: 'unknown' }).key, 'unavailable');
  assert.equal(adminAccessStatus({ ...order, deliveryStatus: 'delivered' }).key, 'pending');
  assert.equal(adminOrderSummary([{ ...order, total: 200 }]).pending, 1);
});
test('admin email API acceptance never claims inbox delivery and bounce/complaint remain visible', () => {
  assert.equal(adminEmailStatus({ ...order, emailDelivery: { status: 'sent' } }).key, 'accepted');
  assert.doesNotMatch(adminEmailStatus({ ...order, emailDelivery: { status: 'sent' } }).label, /delivered/i);
  assert.equal(adminEmailStatus({ ...order, emailDelivery: { status: 'sent', providerStatus: 'delivered' } }).key, 'delivered');
  assert.match(adminEmailStatus({ ...order, emailDelivery: { status: 'sent', providerStatus: 'bounced' } }).label, /bounced/);
  assert.equal(adminEmailStatus({ ...order, emailDelivery: { status: 'not_configured' } }).key, 'not_configured');
  assert.equal(adminEmailStatus({ ...order, emailDelivery: { providerStatus: 'complained' } }).key, 'failed');
});
test('order filters search customer, product and payment references without turning failed attempts into failed orders', () => {
  assert.equal(filterAdminOrders([order], { search: 'buyer first 123456' }).length, 1);
  assert.equal(filterAdminOrders([order], { search: '9876543210', access: 'available', environment: 'live' }).length, 1);
  assert.equal(filterAdminOrders([order], { email: 'delivered' }).length, 0);
  assert.equal(adminPaymentStatus({ paymentStatus: 'PENDING', latestPaymentStatus: 'FAILED' }).key, 'PENDING');
  assert.match(adminPaymentStatus({ paymentStatus: 'PENDING', latestPaymentStatus: 'FAILED' }).detail!, /failed/);
  const summary = adminOrderSummary([order, { ...order, id: 'test', paymentEnvironment: 'test' }, { ...order, id: 'revoked', deliveryStatus: 'REVOKED' }]);
  assert.equal(summary.total, 3); assert.equal(summary.paid, 2); assert.equal(summary.available, 1); assert.equal(summary.revoked, 1);
  assert.equal(adminOrderDate(undefined), 'Not recorded');
});
