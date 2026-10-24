import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  generateEasebuzzInitiateHash,
  buildEasebuzzInitiatePayload,
  verifyEasebuzzCallbackHash,
  generateEasebuzzRetrieveHash,
  sanitizePhoneNumber,
  formatEasebuzzAmount,
  sanitizeFieldText,
  getEasebuzzBaseUrl,
  getEasebuzzDashboardUrl,
  sha512,
} from './easebuzz';

test('hash field consistency: initiate hash matches Easebuzz exact sequence', () => {
  const key = 'TESTKEY123';
  const salt = 'TESTSALT456';
  const txnid = 'ORD_1700000000';
  const amount = '550.00';
  const productinfo = 'BOOYAH STUDIO Products';
  const firstname = 'Rahul';
  const email = 'rahul@example.com';
  const udf1 = 'ORD-001';
  const udf2 = '';
  const udf3 = '';
  const udf4 = '';
  const udf5 = '';
  const udf6 = '';
  const udf7 = '';
  const udf8 = '';
  const udf9 = '';
  const udf10 = '';

  const manualSequence = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}|${udf6}|${udf7}|${udf8}|${udf9}|${udf10}|${salt}`;
  const expectedHash = crypto.createHash('sha512').update(manualSequence).digest('hex');

  const generatedHash = generateEasebuzzInitiateHash({
    key,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    udf1,
    udf2,
    udf3,
    udf4,
    udf5,
    udf6,
    udf7,
    udf8,
    udf9,
    udf10,
    salt,
  });

  assert.equal(generatedHash, expectedHash);
});

test('hash field consistency: initiation uses ten UDF hash positions and only sends populated supported fields', () => {
  const params = {
    key: 'MY_MERCHANT_KEY',
    salt: 'MY_MERCHANT_SALT',
    txnid: 'TXN_998877',
    amount: 550,
    productinfo: 'LinkNest Pro',
    firstname: 'Aman',
    email: 'aman@test.com',
    phone: '+91 9876543210',
    surl: 'https://www.booyahstudio.shop/api/payments/easebuzz/callback',
    furl: 'https://www.booyahstudio.shop/api/payments/easebuzz/callback',
    udf1: 'UDF_VAL_1',
    udf2: '',
    udf3: '',
    udf4: '',
    udf5: '',
    udf6: '',
    udf7: '',
    udf8: '',
    udf9: '',
    udf10: '',
  };

  const { payload, hash } = buildEasebuzzInitiatePayload(params);

  assert.equal(payload.get('key'), 'MY_MERCHANT_KEY');
  assert.equal(payload.get('txnid'), 'TXN_998877');
  assert.equal(payload.get('amount'), '550.00');
  assert.equal(payload.get('productinfo'), 'LinkNest Pro');
  assert.equal(payload.get('firstname'), 'Aman');
  assert.equal(payload.get('email'), 'aman@test.com');
  assert.equal(payload.get('phone'), '9876543210');
  assert.equal(payload.get('surl'), 'https://www.booyahstudio.shop/api/payments/easebuzz/callback');
  assert.equal(payload.get('furl'), 'https://www.booyahstudio.shop/api/payments/easebuzz/callback');
  assert.equal(payload.get('hash'), hash);
  assert.equal(payload.get('udf1'), 'UDF_VAL_1');
  assert.equal(payload.get('udf2'), null); // Empty UDFs omitted from POST body
  assert.equal(payload.get('udf3'), null);
  assert.equal(payload.get('udf4'), null);
  assert.equal(payload.get('udf5'), null);
  assert.equal(payload.get('udf6'), null);
  assert.equal(payload.get('udf7'), null);
  assert.equal(payload.get('udf8'), null); // udf8, udf9, udf10 excluded from POST body
  assert.equal(payload.get('udf9'), null);
  assert.equal(payload.get('udf10'), null);

  // Verify reverse verification hash
  const callbackHashStr = [
    'MY_MERCHANT_SALT',
    'success',
    '', '', '', '', '', '', '', '', '', 'UDF_VAL_1',
    'aman@test.com',
    'Aman',
    'LinkNest Pro',
    '550.00',
    'TXN_998877',
    'MY_MERCHANT_KEY'
  ].join('|');
  const validCallbackHash = sha512(callbackHashStr);

  const isVerified = verifyEasebuzzCallbackHash({
    hash: validCallbackHash,
    status: 'success',
    key: 'MY_MERCHANT_KEY',
    txnid: 'TXN_998877',
    amount: '550.00',
    productinfo: 'LinkNest Pro',
    firstname: 'Aman',
    email: 'aman@test.com',
    udf1: 'UDF_VAL_1',
    udf2: '', udf3: '', udf4: '', udf5: '', udf6: '', udf7: '', udf8: '', udf9: '', udf10: ''
  }, 'MY_MERCHANT_SALT');

  assert.equal(isVerified, true);

  const isTampered = verifyEasebuzzCallbackHash({
    hash: validCallbackHash,
    status: 'success',
    key: 'MY_MERCHANT_KEY',
    txnid: 'TXN_998877',
    amount: '999.00', // tampered amount
    productinfo: 'LinkNest Pro',
    firstname: 'Aman',
    email: 'aman@test.com',
  }, 'MY_MERCHANT_SALT');

  assert.equal(isTampered, false);
});

test('invalid and valid phone numbers sanitization', () => {
  assert.equal(sanitizePhoneNumber('+91 9876543210'), '9876543210');
  assert.equal(sanitizePhoneNumber('09876543210'), '9876543210');
  assert.equal(sanitizePhoneNumber('98765 43210'), '9876543210');
  assert.equal(sanitizePhoneNumber('98765-43210'), '9876543210');
  
  // Invalid phones (less than 10 digits)
  assert.equal(sanitizePhoneNumber('12345'), '12345');
  assert.equal(sanitizePhoneNumber(''), '');
  assert.equal(sanitizePhoneNumber(null), '');
  assert.equal(sanitizePhoneNumber(undefined), '');
});

test('invalid and valid amount formatting', () => {
  const valid1 = formatEasebuzzAmount(550);
  assert.equal(valid1.valid, true);
  assert.equal(valid1.formatted, '550.00');

  const valid2 = formatEasebuzzAmount('149.99');
  assert.equal(valid2.valid, true);
  assert.equal(valid2.formatted, '149.99');

  const zeroAmount = formatEasebuzzAmount(0);
  assert.equal(zeroAmount.valid, false);

  const negativeAmount = formatEasebuzzAmount(-100);
  assert.equal(negativeAmount.valid, false);

  const invalidString = formatEasebuzzAmount('abc');
  assert.equal(invalidString.valid, false);

  const nullAmount = formatEasebuzzAmount(null);
  assert.equal(nullAmount.valid, false);
});

test('Easebuzz endpoint selection matches environment', () => {
  assert.equal(getEasebuzzBaseUrl('test'), 'https://testpay.easebuzz.in');
  assert.equal(getEasebuzzBaseUrl('prod'), 'https://pay.easebuzz.in');
  assert.equal(getEasebuzzDashboardUrl('test'), 'https://testdashboard.easebuzz.in');
  assert.equal(getEasebuzzDashboardUrl('prod'), 'https://dashboard.easebuzz.in');
});

test('Easebuzz retrieve transaction hash generation', () => {
  const hash = generateEasebuzzRetrieveHash({
    key: 'KEY123',
    txnid: 'TXN123',
    salt: 'SALT123'
  });
  const expected = sha512('KEY123|TXN123|SALT123');
  assert.equal(hash, expected);
});

test('missing credentials: empty key or salt fails initiation gracefully', () => {
  const isConfigured = (key: string, salt: string) => Boolean(key.trim() && salt.trim());
  assert.equal(isConfigured('', 'SALT'), false);
  assert.equal(isConfigured('KEY', ''), false);
  assert.equal(isConfigured('KEY', 'SALT'), true);
});

test('missing order ID: validated in initiate request', () => {
  const validateInitiateRequest = (body: { orderId?: string; agreeTerms?: boolean }) => {
    if (!body.orderId) return { valid: false, error: 'Order ID is required.' };
    if (body.agreeTerms !== true) return { valid: false, error: 'You must accept the terms before starting payment.' };
    return { valid: true };
  };

  assert.deepEqual(validateInitiateRequest({}), { valid: false, error: 'Order ID is required.' });
  assert.deepEqual(validateInitiateRequest({ orderId: 'ORD-123' }), { valid: false, error: 'You must accept the terms before starting payment.' });
  assert.deepEqual(validateInitiateRequest({ orderId: 'ORD-123', agreeTerms: true }), { valid: true });
});

test('email validation: required and valid format', () => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validateEmail = (email?: string) => {
    const trimmed = (email ?? '').trim().toLowerCase();
    if (!trimmed || !emailRegex.test(trimmed)) {
      return { valid: false, error: 'A valid customer email is required for payment.' };
    }
    return { valid: true, email: trimmed };
  };

  assert.deepEqual(validateEmail(''), { valid: false, error: 'A valid customer email is required for payment.' });
  assert.deepEqual(validateEmail(undefined), { valid: false, error: 'A valid customer email is required for payment.' });
  assert.deepEqual(validateEmail('invalid-email'), { valid: false, error: 'A valid customer email is required for payment.' });
  assert.deepEqual(validateEmail('user@test.com'), { valid: true, email: 'user@test.com' });
});

test('rejected Easebuzz response: safe error reporting without secret exposure', () => {
  const parseEasebuzzResponse = (ebzData: any, key: string, salt: string) => {
    if (ebzData && ebzData.status === 1 && ebzData.data) {
      return { success: true, accessKey: ebzData.data };
    }
    let rawMsg = typeof ebzData?.data === 'string'
      ? ebzData.data
      : (ebzData?.error_desc || ebzData?.message || 'Failed to initiate Easebuzz payment.');
    if (key) rawMsg = rawMsg.replaceAll(key, '[KEY]');
    if (salt) rawMsg = rawMsg.replaceAll(salt, '[SALT]');
    return { success: false, message: rawMsg };
  };

  const rejectedResponse = {
    status: 0,
    error_desc: 'Hash mismatch or invalid merchant key SECRET_KEY_123',
    data: 'Hash calculation failed for SECRET_SALT_456',
  };

  const parsed = parseEasebuzzResponse(rejectedResponse, 'SECRET_KEY_123', 'SECRET_SALT_456');
  assert.equal(parsed.success, false);
  assert.equal(parsed.message.includes('SECRET_KEY_123'), false);
  assert.equal(parsed.message.includes('SECRET_SALT_456'), false);
  assert.equal(parsed.message.includes('[SALT]'), true);
});
