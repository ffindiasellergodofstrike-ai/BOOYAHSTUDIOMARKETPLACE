import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { payuRequestHash, verifyPayUHash, matchesPayUVerification } from './payu';
const sha=(s:string)=>crypto.createHash('sha512').update(s).digest('hex');
test('PayU request and reverse hashes follow the documented field ordering',()=>{
 const f={key:'key',txnid:'txn',amount:'550.00',productinfo:'Templates',firstname:'Buyer',email:'buyer@example.test',udf1:'order',udf2:'buyer',udf3:'test',status:'success'};
 assert.equal(payuRequestHash(f,'salt'),sha('key|txn|550.00|Templates|Buyer|buyer@example.test|order|buyer|test||||||||salt'));
 const hash=sha('salt|success||||||||test|buyer|order|buyer@example.test|Buyer|Templates|550.00|txn|key');
 assert.equal(verifyPayUHash({...f,hash},'salt'),true);
 assert.equal(verifyPayUHash({...f,amount:'1.00',hash},'salt'),false);
 assert.equal(verifyPayUHash({...f,hash:'garbage'},'salt'),false);
 assert.equal(verifyPayUHash({...f,additionalCharges:'5.00',hash:sha('5.00|salt|success||||||||test|buyer|order|buyer@example.test|Buyer|Templates|550.00|txn|key')},'salt'),true);
});
test('PayU verification rejects uncaptured, mismatched, missing and underpaid transactions',()=>{
 const order={payuTxnId:'txn',total:550}; const payment={txnid:'txn',mihpayid:'gateway-id',transaction_amount:'550.00',status:'success',unmappedstatus:'captured'};
 assert.equal(matchesPayUVerification(payment,order),true);
 for(const update of [{txnid:'other'},{transaction_amount:'5.50'},{mihpayid:''},{status:'failure'},{unmappedstatus:'auth'}]) assert.equal(matchesPayUVerification({...payment,...update},order),false);
 assert.equal(matchesPayUVerification(null,order),false);
});
