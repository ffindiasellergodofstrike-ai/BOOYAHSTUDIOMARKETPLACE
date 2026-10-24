import test from 'node:test';
import assert from 'node:assert/strict';

test('account services expose only purchased active items and bind download requests to the selected order', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalFetch = globalThis.fetch;
  const user = { id: 'account-buyer', email: 'buyer@example.test', name: 'Buyer' };
  const values = new Map([['booyah-studio_auth_user_v1', JSON.stringify(user)]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  const base = { userId: user.id, status: 'PAID', paymentStatus: 'PAID', paymentEnvironment: 'live', paymentProvider: 'Cashfree',
    total: 100, cashfreeOrderId: 'cashfree-order', payments: { '10001': { status: 'SUCCESS', order_id: 'cashfree-order', environment: 'live', currency: 'INR', amount: 10000 } }, transactionId: '10001', deliveryStatus: 'DELIVERED', downloadStatus: 'AVAILABLE' };
  const item = (productId: string, refunded = false) => ({ productId, productTitle: productId, product: { id: productId }, refunded });
  const orders = [
    { ...base, id: 'cashfree-paid', items: [item('paid-product')] },
    { ...base, id: 'cashfree-partial', status: 'PARTIALLY_REFUNDED', paymentStatus: 'PARTIALLY_REFUNDED', items: [item('refunded-product', true), item('unaffected-product')] },
    { ...base, id: 'legacy-paid', paymentProvider: 'Razorpay', transactionId: 'pay_legacy', items: [item('legacy-product')] },
    { ...base, id: 'sandbox', paymentEnvironment: 'test', items: [item('sandbox-product')] },
    { ...base, id: 'revoked', deliveryStatus: 'REVOKED', downloadStatus: 'UNAVAILABLE', items: [item('revoked-product')] },
    { ...base, id: 'other-buyer', userId: 'another-buyer', items: [item('other-buyer-product')] },
  ];
  let downloadRequest: any;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url === '/api/auth/me') return Response.json({ success: true, user });
    if (url === '/api/user/orders') return Response.json({ success: true, orders });
    if (url === '/api/downloads/unaffected-product/token') {
      downloadRequest = options;
      return Response.json({ success: true, downloadUrl: 'https://storage.example.test/signed?token=synthetic' });
    }
    throw new Error('Unexpected request');
  };
  try {
    const { AuthService } = await import('./AuthService');
    const { OrderService } = await import('./OrderService');
    const { DownloadService } = await import('./DownloadService');
    await AuthService.verifySession();
    await OrderService.fetchUserOrders();
    assert.deepEqual(OrderService.getUserDownloads().map(item => item.productId).sort(), ['legacy-product', 'paid-product', 'unaffected-product']);
    assert.deepEqual(OrderService.getDownloads().map(item => item.productId).sort(), ['legacy-product', 'paid-product', 'unaffected-product']);
    const access = DownloadService.getUserDownloads();
    assert.equal(access.find(row => row.item.productId === 'refunded-product')?.isAccessible, false);
    assert.equal(access.find(row => row.item.productId === 'unaffected-product')?.isAccessible, true);
    assert.equal(access.find(row => row.item.productId === 'sandbox-product')?.isAccessible, false);
    const result = await OrderService.requestDownloadToken('unaffected-product', 'cashfree-partial');
    assert.equal(result.success, true);
    assert.equal(downloadRequest.credentials, 'include');
    assert.deepEqual(JSON.parse(downloadRequest.body), { orderId: 'cashfree-partial' });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete (globalThis as any).localStorage;
  }
});
