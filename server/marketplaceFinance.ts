import { atomicDocument } from './atomicStore';
import { Seller, ensure, getSeller, now, record } from './marketplace';
import * as gateway from './easebuzzMarketplace';
import { FirebaseRtdb as DB } from './firebaseRtdb';
function sameSplit(actual:any[],expected:any[]) {
 return Array.isArray(actual)&&actual.length===expected.length&&expected.every(e=>actual.some(a=>a.label===e.label&&Math.round(Number(a.amount)*100)===Math.round(Number(e.amount)*100)));
}
export async function settleSale(sellerId:string,orderId:string) {
 const interrupted=await getSeller(sellerId);const interruptedSale=interrupted?.ledger[orderId];
 if(interruptedSale?.status==='split_processing'&&Date.now()-new Date(interruptedSale.processingAt).getTime()>120000) await atomicDocument<Seller>('marketplace_sellers',sellerId,s=>{ensure(s,'Seller missing.');const row=s.ledger[orderId];if(row.status==='split_processing'&&Date.now()-new Date(row.processingAt).getTime()>120000)row.status='split_unknown';return s;});
 const initial=await getSeller(sellerId);ensure(initial,'Seller missing.');const sale=initial.ledger[orderId];ensure(sale,'Sale missing.');
 if(sale.status==='settled')return;
 if(sale.status==='settlement_pending'||sale.status==='settlement_unknown'){
  const result=await gateway.settlementStatus(sale.batchId);
  const transaction=result.transactions?.find((t:any)=>t.easebuzz_id===sale.paymentId);
  if(transaction?.settlement_status==='success'&&transaction.settlement_info?.settlement_id) await atomicDocument<Seller>('marketplace_sellers',sellerId,s=>{
   ensure(s,'Seller missing.');const row=s.ledger[orderId];ensure(row.batchId===sale.batchId,'Settlement changed.');row.status='settled';row.settlement=transaction.settlement_info;row.providerSettlementPaise=Math.round(Number(transaction.txn_settlement_amount)*100);row.settledAt=now();return record(s,'reconciliation','SETTLEMENT_CONFIRMED',orderId);});
  return;
 }
 ensure(process.env.EASEBUZZ_ONDEMAND_APPROVED==='true','On-demand settlement approval is required.');
 const platformLabel=process.env.EASEBUZZ_PLATFORM_SPLIT_LABEL;ensure(platformLabel,'Platform settlement label required.');
 let reserved=false;
 const locked=await atomicDocument<Seller>('marketplace_sellers',sellerId,s=>{
  reserved=false;ensure(s&&s.status==='approved'&&s.kycStatus==='approved'&&!s.hold,'Seller settlement is restricted.');
  ensure(!Object.values(s.cases).some((c:any)=>['under_review','waiting_for_seller'].includes(c.status)),'An open investigation restricts settlement.');
  const row=s.ledger[orderId];ensure(row&&['pending','split_unknown','split_confirmed'].includes(row.status),'Sale is already processing or requires review.');
  ensure(new Date(row.eligibleAt).getTime()<=Date.now(),'Sale is not yet eligible.');ensure(row.refundPaise===0,'Adjusted sales require payment-partner reconciliation.');
  ensure(Date.now()-new Date(row.createdAt).getTime()<40*86400000,'Automatic settlement deadline is approaching. Confirm actual partner state before proceeding.');
  ensure(s.splitLabel&&s.approvalReference,'Settlement configuration has not been confirmed.');
  row.splitId=row.splitId||`split_${orderId}`;row.batchId=row.batchId||`batch_${orderId}`;
  row.configuration=[{label:s.splitLabel,amount:(row.sellerPaise/100).toFixed(2)},...(row.commissionPaise?[{label:platformLabel,amount:(row.commissionPaise/100).toFixed(2)}]:[])];
  row.previousStatus=row.status;row.status='split_processing';row.processingAt=now();reserved=true;return s;
 });
 ensure(reserved,'Unable to reserve settlement.');const row=locked.ledger[orderId];
 try {
  if(row.previousStatus==='split_unknown') {
   const existing=await gateway.getSplit(row.splitId);ensure(sameSplit(existing.split_configuration,row.configuration),'Split requires manual reconciliation.');
  } else if(row.previousStatus!=='split_confirmed') {
   const result=await gateway.createSplit(row.splitId,row.paymentId,row.grossPaise,row.configuration);
   ensure(result.request_status==='success'&&result.configuration?.every((c:any)=>c.status==='success'),'Split acceptance is incomplete.');
   const existing=await gateway.getSplit(row.splitId);ensure(sameSplit(existing.split_configuration,row.configuration),'Split totals could not be confirmed.');
  }
  // Recheck restrictions after network I/O before reserving a bank instruction.
  await atomicDocument<Seller>('marketplace_sellers',sellerId,s=>{ensure(s,'Seller missing.');ensure(s.status==='approved'&&!s.hold&&!Object.values(s.cases).some((c:any)=>['under_review','waiting_for_seller'].includes(c.status)),'Settlement was restricted during processing.');s.ledger[orderId].status='settlement_pending';return record(s,'settlement','SETTLEMENT_REQUESTED',orderId);});
  const result=await gateway.requestSettlement(row.batchId,row.paymentId,row.merchantTxnId,row.grossPaise);
  ensure(result.transactions?.some((t:any)=>t.easebuzz_id===row.paymentId&&t.status==='accepted'),'Settlement acceptance is unknown.');
 } catch(error) {
  await atomicDocument<Seller>('marketplace_sellers',sellerId,s=>{ensure(s,'Seller missing.');const entry=s.ledger[orderId];entry.status=entry.status==='settlement_pending'?'settlement_unknown':'split_unknown';entry.lastAttemptAt=now();return s;});throw error;
 }
}
export async function requestRefund(sellerId:string,orderId:string,paise:number,reason:string,actor:string) {
 const order=await DB.getGlobalOrder(orderId);ensure(order?.marketplace?.sellerId===sellerId&&order.paymentStatus==='PAID','Verified sale required.');
 const {key,salt}=gateway.marketplaceCredentials();let reserved=false;
 await atomicDocument<Seller>('marketplace_sellers',sellerId,s=>{reserved=false;ensure(s,'Seller missing.');const row=s.ledger[orderId];
  ensure(row&&!row.refundRequest&&row.status==='pending','This sale requires manual payment-partner reconciliation before a refund.');
  ensure(Number.isSafeInteger(paise)&&paise>0&&paise<=row.grossPaise,'Invalid refund amount.');
  row.refundRequest={amountPaise:paise,status:'pending',reason,requestedAt:now(),actor};row.status='refund_pending';reserved=true;return record(s,actor,'REFUND_REQUESTED',orderId);});
 ensure(reserved,'Unable to reserve refund.');
 const amount=Number(order.total),refund_amount=paise/100,txnid=order.transactionId,email=order.customerEmail,phone=order.customer?.phone;
 try {
  const result=await gateway.marketplaceRequest('/transaction/v1/refund',{key,txnid,amount,refund_amount,email,phone,hash:gateway.gatewayHash(key,txnid,String(amount),String(refund_amount),email,phone,salt)});
  ensure(result.refund_id&&result.easebuzz_id===txnid&&Math.round(Number(result.refund_amount)*100)===paise,'Refund acknowledgement could not be confirmed.');
  await atomicDocument<Seller>('marketplace_sellers',sellerId,s=>{ensure(s,'Seller missing.');s.ledger[orderId].refundRequest.providerId=result.refund_id;return s;});
 } catch(error) {await atomicDocument<Seller>('marketplace_sellers',sellerId,s=>{ensure(s,'Seller missing.');s.ledger[orderId].refundRequest.status='unknown';return s;});throw error;}
}
export async function reconcileRefund(sellerId:string,orderId:string) {
 const s=await getSeller(sellerId),row=s?.ledger[orderId];ensure(row?.refundRequest?.providerId,'Refund reference required; reconcile unknown requests in the payment dashboard without submitting twice.');
 const {key,salt}=gateway.marketplaceCredentials();
 const result=await gateway.marketplaceRequest('/refund/v1/retrieve',{key,easebuzz_id:row.paymentId,hash:gateway.gatewayHash(key,row.paymentId,salt)});
 ensure(result.easebuzz_id===row.paymentId,'Refund transaction mismatch.');
 const refund=result.refunds?.find((r:any)=>r.refund_id===row.refundRequest.providerId);
 if(refund?.refund_status!=='refunded')return;
 ensure(Math.round(Number(refund.refund_amount)*100)===row.refundRequest.amountPaise,'Refund amount mismatch.');
 await atomicDocument<Seller>('marketplace_sellers',sellerId,current=>{ensure(current,'Seller missing.');const sale=current.ledger[orderId];if(sale.refundRequest.status==='refunded')return current;
  sale.refundPaise=sale.refundRequest.amountPaise;sale.refundRequest.status='refunded';sale.refundRequest.confirmedAt=now();
  sale.commissionRefundPaise=Math.round(sale.commissionPaise*sale.refundPaise/sale.grossPaise);sale.sellerRefundPaise=sale.refundPaise-sale.commissionRefundPaise;
  sale.status=sale.refundPaise===sale.grossPaise?'refunded':'adjustment_review';return record(current,'reconciliation','REFUND_CONFIRMED',orderId);});
 const order=await DB.getGlobalOrder(orderId);order.refundAmount=row.refundRequest.amountPaise/100;order.refundStatus='REFUNDED';
 if(row.refundRequest.amountPaise===row.grossPaise){order.status='REFUNDED';order.paymentStatus='REFUNDED';order.deliveryStatus='REVOKED';order.downloadStatus='UNAVAILABLE';}
 await DB.saveGlobalOrder(order);
}

export async function linkUnknownRefund(sellerId:string,orderId:string,providerId:string,actor:string) {
 const seller=await getSeller(sellerId),row=seller?.ledger[orderId];ensure(row?.refundRequest?.status==='unknown'&&!row.refundRequest.providerId,'Only an unknown refund can be linked.');
 const {key,salt}=gateway.marketplaceCredentials();
 const result=await gateway.marketplaceRequest('/refund/v1/retrieve',{key,easebuzz_id:row.paymentId,hash:gateway.gatewayHash(key,row.paymentId,salt)});
 const refund=result.refunds?.find((r:any)=>r.refund_id===providerId);
 ensure(result.easebuzz_id===row.paymentId&&refund&&Math.round(Number(refund.refund_amount)*100)===row.refundRequest.amountPaise,'Provider reference does not match this refund request.');
 await atomicDocument<Seller>('marketplace_sellers',sellerId,s=>{ensure(s,'Seller missing.');const current=s.ledger[orderId].refundRequest;ensure(current.status==='unknown'&&!current.providerId,'Refund already reconciled.');current.providerId=providerId;current.status='pending';return record(s,actor,'REFUND_REFERENCE_RECONCILED',providerId);});
 await reconcileRefund(sellerId,orderId);
}
export async function recordChargeback(sellerId:string,orderId:string,amountPaise:number,reference:string,reason:string,actor:string) {
 const order=await DB.getGlobalOrder(orderId);ensure(order?.marketplace?.sellerId===sellerId,'Sale missing.');
 await atomicDocument<Seller>('marketplace_sellers',sellerId,s=>{ensure(s,'Seller missing.');const row=s.ledger[orderId];
  ensure(row&&!['split_processing','settlement_pending','settlement_unknown','refund_pending'].includes(row.status),'Reconcile in-flight provider instructions first.');
  ensure(Number.isSafeInteger(amountPaise)&&amountPaise>0&&amountPaise<=row.grossPaise-row.refundPaise,'Invalid chargeback amount.');
  ensure(!row.chargeback,'Chargeback already recorded; further changes require reconciliation.');
  row.chargeback={amountPaise,reference,reason,recordedAt:now(),actor};row.status='dispute_review';return record(s,actor,'CHARGEBACK_RECORDED',orderId+': '+reference);});
 order.deliveryStatus='REVOKED';order.downloadStatus='UNAVAILABLE';order.chargebackStatus='UNDER_REVIEW';await DB.saveGlobalOrder(order);
}
