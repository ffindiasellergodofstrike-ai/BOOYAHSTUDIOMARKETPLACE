import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { buildInvoicePdf } from './purchaseEmail';
test('receipt handles a full cart across pages and rejects test/unpaid transactions', async () => {
 const order={id:'synthetic',transactionId:'pay_example',paymentEnvironment:'live',paymentStatus:'PAID',paymentProvider:'Cashfree',total:5000,customerEmail:'buyer@example.com',items:Array.from({length:30},()=>({productTitle:'A detailed digital template product title that is deliberately long enough to wrap onto two lines for a large cart',quantity:1,price:199}))};
 const bytes=await buildInvoicePdf(order);
 assert.ok((await PDFDocument.load(bytes)).getPageCount()>1);
 await assert.rejects(buildInvoicePdf({...order,paymentEnvironment:'test'}));
 await assert.rejects(buildInvoicePdf({...order,paymentStatus:'PENDING'}));
});


test('original payment receipts remain available after confirmed partial and full refunds', async () => {
 for (const paymentStatus of ['PARTIALLY_REFUNDED', 'REFUNDED']) {
  const order = { id: 'BS-refund-receipt', transactionId: 'verified_payment', paymentProvider: 'Cashfree', paymentEnvironment: 'live', paymentStatus, refundedAmount: paymentStatus === 'REFUNDED' ? 500 : 100, total: 500, items: [{ productTitle: 'Template', price: 500, quantity: 1 }] };
  assert.ok((await PDFDocument.load(await buildInvoicePdf(order))).getPageCount() >= 1);
  await assert.rejects(buildInvoicePdf({ ...order, paymentEnvironment: 'test' }), /Live payment required/);
  await assert.rejects(buildInvoicePdf({ ...order, transactionId: '' }), /Live payment required/);
  await assert.rejects(buildInvoicePdf({ ...order, paymentProvider: 'retired-provider' }), /Live payment required/);
 }
});
