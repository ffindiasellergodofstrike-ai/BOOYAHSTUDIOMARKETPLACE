import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedHostedCheckoutUrl } from './GatewayCheckout';
import { selectCustomerCheckout } from '../config/checkout';
import { isConfirmedPaidOrder, isVerifiedPaidOrder } from './PaymentVerification';

test('admin default selects enabled ready provider, including Easebuzz', () => {
  const gateways = { cashfree: { configured: true, environment: 'live', enabled: true }, easebuzz: { configured: true, environment: 'test', enabled: true, isDefault: true } };
  assert.equal(selectCustomerCheckout(gateways), 'easebuzz');
  assert.equal(selectCustomerCheckout({ ...gateways, easebuzz: { ...gateways.easebuzz, enabled: false } }), 'cashfree');
  assert.equal(selectCustomerCheckout({ easebuzz: { configured: true, environment: 'live', enabled: false } }), null);
});
test('hosted checkout rejects unsafe hosts, cross-environment links and browser supplied script URLs', () => {
  const path = `/pay/${'a'.repeat(64)}`;
  assert.equal(approvedHostedCheckoutUrl(`https://pay.easebuzz.in${path}`, 'easebuzz', 'live'), `https://pay.easebuzz.in${path}`);
  for (const url of [`https://pay.easebuzz.in.evil.test${path}`, `http://pay.easebuzz.in${path}`, `https://testpay.easebuzz.in${path}`, `https://user@pay.easebuzz.in${path}`, 'javascript:alert(1)', 'https://pay.easebuzz.in/pay/bad']) assert.throws(() => approvedHostedCheckoutUrl(url, 'easebuzz', 'live'));
});
test('Easebuzz browser confirmation requires the canonical verified payment record and live delivery', () => {
  const record: any = { id: 'order', total: 299, transactionId: 'payment', easebuzzTxnId: 'order', paymentProvider: 'Easebuzz', paymentEnvironment: 'live', paymentStatus: 'PAID', status: 'PAID', deliveryStatus: 'DELIVERED', downloadStatus: 'AVAILABLE', paymentVerifiedAt: '2026-10-23T00:00:00Z', payments: { payment: { id: 'payment', txnid: 'order', amount: 29900, currency: 'INR', status: 'success', environment: 'live', refundedPaise: 0, verifiedAt: '2026-10-23T00:00:00Z' } } };
  assert.equal(isConfirmedPaidOrder(record), true); assert.equal(isVerifiedPaidOrder(record), true);
  assert.equal(isConfirmedPaidOrder({ ...record, payments: {} }), false);
  assert.equal(isConfirmedPaidOrder({ ...record, payments: { payment: { ...record.payments.payment, amount: 1 } } }), false);
  assert.equal(isConfirmedPaidOrder({ ...record, payments: { payment: { ...record.payments.payment, refundedPaise: 1 } } }), false);
  assert.equal(isVerifiedPaidOrder({ ...record, paymentEnvironment: 'test', payments: { payment: { ...record.payments.payment, environment: 'test' } } }), false);
});
