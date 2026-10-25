-- Provider-controlled settlement eligibility and seller risk reviews. Apply after
-- the creator marketplace migration. This RPC never creates a bank payment.
create or replace function public.settlement_operation(operation text, key text default '', value jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare doc jsonb; row_value jsonb; order_value jsonb; ledger jsonb; creator jsonb; risk jsonb; result jsonb; proof jsonb; billing jsonb; subscription_value jsonb; paid_period jsonb;
 actor text; cid text; token text; provider text; oid text; status text; event_id text; subscription_id text; payment_id text; is_membership boolean; allowed boolean; commission bigint;
 settlement_now timestamptz := clock_timestamp(); verified_time timestamptz; delivered_time timestamptz; due_time timestamptz;
 now_text text := to_char(settlement_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 select data into doc from public.store_state where id=true for update;
 if doc is null then raise exception 'Settlement storage unavailable'; end if;
 if operation='state' then return jsonb_build_object('settlements',coalesce(doc #> '{marketplace,settlements}','{}'::jsonb),'riskCases',coalesce(doc #> '{marketplace,riskCases}','{}'::jsonb),'ledger',coalesce(doc #> '{marketplace,ledger}','{}'::jsonb)); end if;
 if operation in ('risk_open','risk_resolve') then
  cid:=key; creator:=doc #> array['marketplace','creators',cid]; actor:=value->>'actorId';
  if creator is null or actor is null or length(actor)>100 or length(coalesce(value->>'reason',''))<10 or length(value->>'reason')>1000 or value->>'reviewed' is distinct from 'true' then raise exception 'Reviewed creator risk action required'; end if;
  risk:=doc #> array['marketplace','riskCases',cid];
  if operation='risk_open' then
   if not coalesce(value->>'category' in ('chargeback','legal_complaint','prohibited_item','fraud','other'),false) or length(coalesce(value->>'evidenceReference',''))<3 or length(value->>'evidenceReference')>300 then raise exception 'Risk evidence reference required'; end if;
   -- Repeated notices must not silently extend the original 120-day review date.
   result:=coalesce(risk,'{}'::jsonb)||jsonb_build_object('creatorId',cid,'status','open','category',value->>'category','reason',value->>'reason','evidenceReference',value->>'evidenceReference','openedAt',case when risk->>'status'='open' then risk->>'openedAt' else now_text end,'reviewAt',case when risk->>'status'='open' then risk->>'reviewAt' else to_char((settlement_now+interval '120 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,'updatedAt',now_text,'reviewedBy',actor,'resolvedAt',null,'resolvedReason',null);
   creator:=creator||jsonb_build_object('status','suspended','reviewReason',value->>'reason','updatedAt',now_text);
   doc:=store_set(doc,array['marketplace','creators',cid],creator);
  else
   if risk is null or risk->>'status'<>'open' then raise exception 'An open risk review is required'; end if;
   result:=risk||jsonb_build_object('status','resolved','resolvedAt',now_text,'resolvedReason',value->>'reason','reviewedBy',actor,'updatedAt',now_text);
   -- Resolving exposure does not reactivate new sales or erase the reserve date.
  end if;
  doc:=store_set(doc,array['marketplace','riskCases',cid],result);
 elsif operation in ('ensure','ensure_membership','claim','authorize_release','finish','note') then
  oid:=key; row_value:=doc #> array['marketplace','settlements',oid];
  is_membership:=operation='ensure_membership' or row_value->>'kind'='membership';
  if is_membership then
   subscription_id:=coalesce(value->>'subscriptionId',row_value->>'subscriptionId'); payment_id:=coalesce(value->>'paymentId',row_value->>'paymentId');
   select data into billing from public.marketplace_billing_state where id=true;
   subscription_value:=billing #> array['subscriptions',subscription_id]; paid_period:=subscription_value #> array['payments',payment_id];
   cid:=subscription_value #>> '{plan,creatorId}'; provider:=subscription_value->>'provider';
   if not coalesce(subscription_value is not null and paid_period is not null and subscription_value->>'environment'='live' and subscription_value #>> '{plan,audience}'='customer' and paid_period->>'verified'='true' and paid_period->>'revoked' in ('true','false') and paid_period->>'currency'='INR' and paid_period->>'subscriptionRef'=subscription_value->>'providerRef' and paid_period->>'id'=payment_id and (paid_period->>'amountPaise')::bigint=round((subscription_value #>> '{plan,amount}')::numeric*100),false) then raise exception 'Canonical membership payment required'; end if;
   if subscription_value #>> '{split,commissionModel}'='fixed_per_item' then commission:=(subscription_value #>> '{split,commissionPaise}')::bigint; if commission<>2000 then raise exception 'Membership commission mismatch'; end if;
   else commission:=floor((paid_period->>'amountPaise')::numeric*(subscription_value #>> '{split,commissionBps}')::numeric/10000); end if;
   if commission<0 or commission>=(paid_period->>'amountPaise')::bigint then raise exception 'Membership seller share invalid'; end if;
   order_value:=jsonb_build_object('id',oid,'paymentProvider',provider,'paymentEnvironment','live','transactionId',payment_id,'total',(paid_period->>'amountPaise')::numeric/100,'paymentVerifiedAt',coalesce(row_value->>'paymentVerifiedAt',now_text),'deliveredAt',coalesce(row_value->>'paymentVerifiedAt',now_text),'paymentStatus','PAID','deliveryStatus','DELIVERED','marketplace',jsonb_build_object('sellerId',cid,'providerAccountId',subscription_value #>> '{split,accountId}'),'providerOrderId',paid_period->>'orderRef');
   ledger:=jsonb_build_object('orderId',oid,'sellerId',cid,'provider',provider,'providerPaymentId',payment_id,'grossPaise',(paid_period->>'amountPaise')::bigint,'sellerPaise',(paid_period->>'amountPaise')::bigint-commission,'payablePaise',case when paid_period->>'revoked'='true' then 0 else (paid_period->>'amountPaise')::bigint-commission end,'settlementStatus',case when paid_period->>'revoked'='true' then 'review_required' else 'pending_provider' end);
  else
   order_value:=doc #> array['orders',oid]; ledger:=doc #> array['marketplace','ledger',oid];
  end if;
  cid:=order_value #>> '{marketplace,sellerId}'; provider:=lower(order_value->>'paymentProvider');
  creator:=doc #> array['marketplace','creators',cid]; risk:=doc #> array['marketplace','riskCases',cid];
  if not coalesce(oid ~ '^[A-Za-z0-9_-]{1,100}$' and order_value is not null and ledger is not null and creator is not null and order_value->>'paymentEnvironment'='live' and ledger->>'orderId'=oid and ledger->>'sellerId'=cid and ledger->>'providerPaymentId'=order_value->>'transactionId' and ledger->>'provider'=provider and provider in ('cashfree','razorpay','easebuzz'),false) then raise exception 'Canonical live seller ledger required'; end if;
  if not coalesce((ledger->>'grossPaise')::bigint=round((order_value->>'total')::numeric*100) and (ledger->>'grossPaise')::bigint>0 and (ledger->>'sellerPaise')::bigint>=0 and (ledger->>'payablePaise')::bigint>=0 and (ledger->>'payablePaise')::bigint<=(ledger->>'sellerPaise')::bigint,false) then raise exception 'Settlement amount mismatch'; end if;
  if row_value is not null and (row_value->>'sellerId'<>cid or row_value->>'provider'<>provider or row_value->>'paymentId'<>order_value->>'transactionId' or (row_value->>'grossPaise')::bigint<>(ledger->>'grossPaise')::bigint) then raise exception 'Settlement identity immutable'; end if;
  if operation in ('ensure','ensure_membership') then
   verified_time:=nullif(order_value->>'paymentVerifiedAt','')::timestamptz; delivered_time:=nullif(order_value->>'deliveredAt','')::timestamptz;
   if verified_time is null or delivered_time is null then raise exception 'Verified payment and delivery timestamps required'; end if;
   due_time:=greatest(verified_time,delivered_time)+interval '72 hours';
   status:=case when row_value->>'status'='provider_settled' and row_value->>'payablePaise'=ledger->>'payablePaise' and ledger->>'settlementStatus'<>'review_required' then 'provider_settled' when (ledger->>'payablePaise')::bigint<=0 or ledger->>'settlementStatus'='review_required' or risk->>'status'='open' or (row_value->>'status'='provider_settled' and row_value->>'payablePaise'<>ledger->>'payablePaise') then 'review_required' when settlement_now<due_time or (risk->>'status'='resolved' and (risk->>'reviewAt')::timestamptz>settlement_now) then 'reserved' when row_value->>'status'='provider_pending' then 'provider_pending' else 'eligible' end;
   result:=coalesce(row_value,'{}'::jsonb)||jsonb_build_object('orderId',oid,'kind',case when is_membership then 'membership' else 'product' end,'subscriptionId',subscription_id,'sellerId',cid,'provider',provider,'paymentId',order_value->>'transactionId','grossPaise',(ledger->>'grossPaise')::bigint,'sellerPaise',(ledger->>'sellerPaise')::bigint,'payablePaise',(ledger->>'payablePaise')::bigint,'paymentVerifiedAt',order_value->>'paymentVerifiedAt','eligibleAt',to_char(due_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'status',status,'createdAt',coalesce(row_value->>'createdAt',now_text),'updatedAt',now_text);
  elsif operation='claim' then
   if row_value is null or row_value->>'status'='provider_settled' or (row_value->>'leaseUntil')::timestamptz>settlement_now then return null; end if;
   if not coalesce(value->>'token' ~ '^[a-f0-9]{32}$',false) then raise exception 'Invalid settlement claim'; end if;
   result:=row_value||jsonb_build_object('claimToken',value->>'token','leaseUntil',to_char((settlement_now+interval '2 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'lastAttemptAt',now_text,'updatedAt',now_text);
  elsif operation='authorize_release' then
   allowed:=row_value is not null and value->>'token'=row_value->>'claimToken' and (row_value->>'leaseUntil')::timestamptz>settlement_now and
    (row_value->>'eligibleAt')::timestamptz<=settlement_now and (ledger->>'payablePaise')::bigint>0 and ledger->>'settlementStatus'<>'review_required' and
    ((risk is null and creator->>'status'='approved') or (risk->>'status'='resolved' and (risk->>'reviewAt')::timestamptz<=settlement_now));
   return jsonb_build_object('allowed',coalesce(allowed,false),'payablePaise',(ledger->>'payablePaise')::bigint,'sellerPaise',(ledger->>'sellerPaise')::bigint);
  elsif operation='finish' then
   if row_value is null or row_value->>'claimToken' is null or value->>'token' is distinct from row_value->>'claimToken' or not coalesce((row_value->>'leaseUntil')::timestamptz>=settlement_now,false) then raise exception 'Settlement claim expired'; end if;
   proof:=value->'proof'; status:=proof->>'status';
   if not coalesce(status in ('reserved','review_required','provider_pending','provider_settled','provider_action_required') and proof->>'provider'=provider and proof->>'paymentId'=order_value->>'transactionId' and proof->>'orderId'=oid and proof->>'sellerId'=cid,false) then raise exception 'Settlement proof mismatch'; end if;
   if status='provider_settled' and (length(coalesce(proof->>'providerSettlementId',''))<2 or length(coalesce(proof->>'providerReference',''))<2 or (proof->>'amountPaise')::bigint is distinct from (ledger->>'payablePaise')::bigint or (ledger->>'payablePaise')::bigint<=0) then raise exception 'Provider settlement confirmation required'; end if;
   result:=row_value||proof||jsonb_build_object('claimToken',null,'leaseUntil',null,'lastCheckedAt',now_text,'updatedAt',now_text);
  else
   if row_value is null then raise exception 'Settlement unavailable'; end if;
   if value->>'token' is distinct from row_value->>'claimToken' or row_value->>'claimToken' is null or (row_value->>'leaseUntil')::timestamptz<settlement_now then raise exception 'Settlement claim expired'; end if;
   result:=row_value||jsonb_build_object('lastError',left(coalesce(value->>'message','Provider verification requires review'),300),'claimToken',null,'leaseUntil',null,'updatedAt',now_text);
  end if;
  doc:=store_set(doc,array['marketplace','settlements',oid],result);
 else raise exception 'Unsupported settlement operation'; end if;
 if value->>'auditId' is not null then
  event_id:=value->>'auditId'; if event_id !~ '^[a-f0-9]{32}$' then raise exception 'Invalid settlement audit'; end if;
  doc:=store_set(doc,array['marketplace','audit',event_id],jsonb_build_object('id',event_id,'actorId',value->>'actorId','action',operation,'targetId',key,'reason',value->>'reason','at',now_text));
 end if;
 update public.store_state set data=doc where id=true; return result;
end $$;
revoke all on function public.settlement_operation(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.settlement_operation(text,text,jsonb) to service_role;
