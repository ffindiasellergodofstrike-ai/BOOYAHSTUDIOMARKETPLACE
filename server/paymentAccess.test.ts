import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { Store } from './store';
import { easebuzzRetrieveHash, findPaidPurchase, isPaidOrderForProduct, matchesVerifiedEasebuzzPayment } from './paymentAccess';

const paidOrder = {
  id: 'order-1', orderNumber: 'order-1', userId: 'buyer-1', total: 550,
  status: 'PAID', paymentStatus: 'PAID', paymentEnvironment: 'live', paymentProvider: 'Razorpay',
  transactionId: 'pay_verified', razorpayOrderId: 'order_verified',
  deliveryStatus: 'DELIVERED', downloadStatus: 'AVAILABLE',
  items: [{ productId: 'linknest-pro' }],
};

const purchase = {
  purchaseId: 'purchase-1', orderId: 'order-1', userId: 'buyer-1',
  productId: 'linknest-pro', accessStatus: 'active', downloadCount: 0, downloadLimit: 10,
};

test('order lookup never returns a global order belonging to another user', async (context) => {
  assert.equal(await Store.getGlobalOrder('../users/buyer-1'), null);
  context.mock.method(Store, 'getGlobalOrder', async () => paidOrder);
  assert.equal(await Store.getUserOrderById('buyer-2', 'order-1'), null);
  assert.deepEqual(await Store.getUserOrderById('buyer-1', 'order-1'), paidOrder);
});

test('active purchase alone cannot authorize an unpaid, revoked or manually marked paid order', async (context) => {
  let currentOrder: any = { ...paidOrder, paymentStatus: 'PENDING' };
  context.mock.method(Store, 'getUserPurchases', async () => [purchase]);
  context.mock.method(Store, 'getGlobalOrder', async () => currentOrder);

  assert.equal(await findPaidPurchase('buyer-1', 'linknest-pro'), null);
  currentOrder = { ...paidOrder, paymentStatus: 'FAILED' };
  assert.equal(await findPaidPurchase('buyer-1', 'linknest-pro'), null);
  currentOrder = { ...paidOrder, paymentProvider: undefined, transactionId: undefined };
  assert.equal(await findPaidPurchase('buyer-1', 'linknest-pro'), null);
  currentOrder = { ...paidOrder, deliveryStatus: 'REVOKED' };
  assert.equal(await findPaidPurchase('buyer-1', 'linknest-pro'), null);
  currentOrder = { ...paidOrder, status: 'PARTIALLY_REFUNDED' };
  assert.equal(await findPaidPurchase('buyer-1', 'linknest-pro'), null);
  currentOrder = paidOrder;
  currentOrder = { ...paidOrder, items: [{ productId: 'linknest-pro', accessStatus: 'restricted' }] };
  assert.equal(await findPaidPurchase('buyer-1', 'linknest-pro'), null, 'a stale active purchase cannot bypass the current item restriction');
  currentOrder = paidOrder;
  assert.deepEqual(await findPaidPurchase('buyer-1', 'linknest-pro'), purchase);
});

test('download tokens stay bound to their buyer, purchase and order', async (context) => {
  context.mock.method(Store, 'getUserPurchases', async () => [purchase]);
  context.mock.method(Store, 'getGlobalOrder', async () => paidOrder);
  assert.equal(await findPaidPurchase('buyer-2', 'linknest-pro'), null);
  assert.equal(await findPaidPurchase('buyer-1', 'finora'), null);
  assert.equal(await findPaidPurchase('buyer-1', 'linknest-pro', 'other-purchase'), null);
  assert.equal(await findPaidPurchase('buyer-1', 'linknest-pro', 'purchase-1', 'other-order'), null);
  assert.equal(isPaidOrderForProduct({ ...paidOrder, userId: 'buyer-2' }, 'buyer-1', 'linknest-pro'), false);
});

test('Cashfree access requires a verified matching funding payment and preserves only unaffected partial-refund items', () => {
  const payment = { status: 'SUCCESS', order_id: 'cashfree-order-1', currency: 'INR', amount: 55000, environment: 'live' };
  const order = { ...paidOrder, paymentProvider: 'Cashfree', cashfreeOrderId: 'cashfree-order-1', transactionId: '10001', payments: { '10001': payment } };
  const permits = (candidate: any, product = 'linknest-pro') => isPaidOrderForProduct(candidate, 'buyer-1', product);
  assert.equal(permits(order), true);
  assert.equal(permits({ ...order, payments: {} }), false, 'manually marked paid cannot create verified funding evidence');
  for (const invalid of [
    { ...payment, status: 'PENDING' }, { ...payment, amount: 54999 },
    { ...payment, currency: 'USD' }, { ...payment, environment: 'test' },
    { ...payment, order_id: 'another-order' },
  ]) assert.equal(permits({ ...order, payments: { '10001': invalid } }), false);
  assert.equal(permits({ ...order, paymentEnvironment: 'test' }), false);
  assert.equal(permits({ ...order, userId: 'another-buyer' }), false);
  assert.equal(permits({ ...order, deliveryStatus: 'REVOKED' }), false);
  assert.equal(permits({ ...order, items: [{ productId: 'linknest-pro', accessStatus: 'restricted' }] }), false, 'an explicit item restriction also blocks an otherwise funded order');
  const partial = { ...order, status: 'PARTIALLY_REFUNDED', paymentStatus: 'PARTIALLY_REFUNDED', items: [
    { productId: 'linknest-pro', refunded: false }, { productId: 'finora', refunded: true },
  ] };
  assert.equal(permits(partial), true, 'unaffected item retains valid purchased access');
  assert.equal(permits(partial, 'finora'), false, 'fully refunded item is restricted');
  assert.equal(permits({ ...partial, status: 'REFUNDED', paymentStatus: 'REFUNDED' }), false);
});

test('Easebuzz retrieval uses merchant key, txnid and salt and verifies transaction identity and amount', () => {
  const expectedHash = crypto.createHash('sha512').update('merchant|order-1|private-salt').digest('hex');
  assert.equal(easebuzzRetrieveHash('merchant', 'order-1', 'private-salt'), expectedHash);
  const providerPayment = { status: 'success', txnid: 'order-1', amount: '550.00', easepayid: 'ebz-1' };
  assert.equal(matchesVerifiedEasebuzzPayment(providerPayment, { ...paidOrder, paymentProvider: 'Easebuzz', easebuzzTxnId: 'order-1' }, 'merchant'), true);
  assert.equal(matchesVerifiedEasebuzzPayment({ ...providerPayment, status: 'failed' }, paidOrder, 'merchant'), false);
  assert.equal(matchesVerifiedEasebuzzPayment({ ...providerPayment, txnid: 'other-order' }, paidOrder, 'merchant'), false);
  assert.equal(matchesVerifiedEasebuzzPayment({ ...providerPayment, amount: '5.50' }, paidOrder, 'merchant'), false);
  assert.equal(matchesVerifiedEasebuzzPayment({ ...providerPayment, amount: undefined }, paidOrder, 'merchant'), false);
  assert.equal(matchesVerifiedEasebuzzPayment({ ...providerPayment, key: 'another-merchant' }, paidOrder, 'merchant'), false);
});
