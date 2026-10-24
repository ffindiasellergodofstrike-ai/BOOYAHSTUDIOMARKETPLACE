import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifySignature, matchesPayment } from './razorpay';
import { isPaidOrderForProduct } from './paymentAccess';

test('signatures bind exact raw body and reject malformed, absent or forged signatures', () => {
 const body = '{"event":"payment.captured"}', key='synthetic-webhook-secret';
 const signature=crypto.createHmac('sha256',key).update(body).digest('hex');
 assert.equal(verifySignature(body,signature,key),true);
 for (const invalid of [undefined,'','bad',signature.slice(2), '0'.repeat(64)]) assert.equal(verifySignature(body,invalid,key),false);
 assert.equal(verifySignature(body+' ',signature,key),false);
 assert.equal(verifySignature(body,signature,''),false);
 assert.equal(verifySignature('other-order|pay_example',signature,key),false);
});
test('capture verification rejects underpayment, other orders, wrong currency, authorisations and mismatched environments', () => {
 process.env.RAZORPAY_KEY_ID='rzp_live_synthetic';
 const order={razorpayOrderId:'order_example',total:299,paymentEnvironment:'live'};
 const payment={id:'pay_example',order_id:'order_example',currency:'INR',amount:29900,status:'captured',captured:true,amount_refunded:0};
 assert.equal(matchesPayment(payment,order),true);
 for (const patch of [{amount:1},{order_id:'order_other'},{currency:'USD'},{status:'authorized'},{captured:false},{amount_refunded:-1},{amount_refunded:30000}]) assert.equal(matchesPayment({...payment,...patch},order),false);
 assert.equal(matchesPayment(payment,{...order,paymentEnvironment:'test'}),false);
});
test('download access requires ownership, live payment and active fulfilled order', () => {
 const order={userId:'alice',paymentEnvironment:'live',paymentStatus:'PAID',paymentProvider:'Razorpay',transactionId:'pay_example',status:'PAID',deliveryStatus:'DELIVERED',downloadStatus:'AVAILABLE',items:[{productId:'template'}]};
 assert.equal(isPaidOrderForProduct(order,'alice','template'),true);
 assert.equal(isPaidOrderForProduct(order,'bob','template'),false);
 assert.equal(isPaidOrderForProduct(order,'alice','other'),false);
 for (const patch of [{paymentEnvironment:'test'},{paymentStatus:'PENDING'},{status:'REFUNDED'},{status:'PARTIALLY_REFUNDED'},{deliveryStatus:'REVOKED'},{transactionId:''}]) assert.equal(isPaidOrderForProduct({...order,...patch},'alice','template'),false);
});
