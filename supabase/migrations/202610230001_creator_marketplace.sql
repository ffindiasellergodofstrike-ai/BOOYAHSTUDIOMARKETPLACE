-- Apply after schema.sql. Marketplace identity, moderation and commissions use the
-- same row lock as payment confirmation. No browser can call this service RPC.
create or replace function public.marketplace_operation(operation text, key text default '', value jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare doc jsonb; previous jsonb; next_value jsonb; result jsonb; creator jsonb; order_value jsonb; snapshot jsonb; payment jsonb; prior jsonb;
 uid text; cid text; slug text; old_slug text; event_id text; payment_key text; provider text; oid text;
 gross bigint; fee bigint; seller bigint; refunded bigint; seller_refund bigint; listing_count integer; blocked boolean;
 now_text text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 select data into doc from public.store_state where id=true for update;
 if doc is null then raise exception 'Marketplace storage unavailable'; end if;
 if operation='creator_create' then
  next_value:=value->'record'; uid:=next_value->>'userId'; cid:=next_value->>'id'; slug:=next_value->>'slug';
  if uid is null or uid<>key or cid !~ '^cr_[a-f0-9]{32}$' or slug !~ '^[a-z0-9][a-z0-9-]{2,49}$' or next_value->>'status'<>'pending' then raise exception 'Invalid creator'; end if;
  if doc #> array['marketplace','creatorUsers',uid] is not null then raise exception 'Creator already registered'; end if;
  if slug='booyahstudio' or doc #> array['marketplace','creatorSlugs',slug] is not null then raise exception 'Creator address already taken'; end if;
  if value->'agreementSnapshot' is not null then
   if not coalesce(next_value #>> array['agreementAcceptance','userId']=uid and next_value #>> array['agreementAcceptance','version']=next_value->>'agreementVersion' and
     next_value #>> array['agreementAcceptance','hash'] ~ '^[a-f0-9]{64}$' and next_value #>> array['agreementAcceptance','acceptedAt'] is not null,false) then raise exception 'Creator agreement acceptance required'; end if;
   prior:=doc #> array['marketplace','agreementSnapshots',next_value->>'agreementVersion'];
   if prior is not null and prior is distinct from value->'agreementSnapshot' then raise exception 'Creator agreement snapshot immutable'; end if;
   doc:=store_set(doc,array['marketplace','agreementSnapshots',next_value->>'agreementVersion'],value->'agreementSnapshot');
   doc:=store_set(doc,array['marketplace','agreementAcceptances',cid,next_value->>'agreementVersion'],next_value->'agreementAcceptance');
  end if;
  doc:=store_set(doc,array['marketplace','creators',cid],next_value);
  doc:=store_set(doc,array['marketplace','creatorUsers',uid],to_jsonb(cid));
  doc:=store_set(doc,array['marketplace','creatorSlugs',slug],to_jsonb(cid)); result:=next_value;
 elsif operation='creator_write' then
  previous:=doc #> array['marketplace','creators',key]; next_value:=value->'record';
  if previous is null or previous is distinct from value->'expected' then raise exception 'Marketplace record changed'; end if;
  if next_value->>'id'<>key or next_value->>'userId'<>previous->>'userId' then raise exception 'Creator identity immutable'; end if;
  if next_value->'agreementAcceptance' is distinct from previous->'agreementAcceptance' or next_value->'agreementVersion' is distinct from previous->'agreementVersion' then raise exception 'Creator agreement acceptance immutable'; end if;
  slug:=next_value->>'slug'; old_slug:=previous->>'slug';
  if slug !~ '^[a-z0-9][a-z0-9-]{2,49}$' or slug='booyahstudio' then raise exception 'Invalid creator address'; end if;
  if slug<>old_slug then
   if doc #> array['marketplace','creatorSlugs',slug] is not null then raise exception 'Creator address already taken'; end if;
   doc:=doc #- array['marketplace','creatorSlugs',old_slug]; doc:=store_set(doc,array['marketplace','creatorSlugs',slug],to_jsonb(key));
  end if;
  doc:=store_set(doc,array['marketplace','creators',key],next_value); result:=next_value;
  -- Suspension/rejection removes offers from new checkouts without deleting paid files.
  for cid,creator in select * from jsonb_each(coalesce(doc #> array['marketplace','listings'],'{}')) loop
   if creator->>'sellerId'=key then
    if next_value->>'status'='approved' and creator->>'status'='active' then doc:=store_set(doc,array['products',cid],creator-'file'-'revision'-'reviewReason'-'createdAt');
    elsif next_value->>'status'<>'approved' then doc:=doc #- array['products',cid]; end if;
   end if;
  end loop;
 elsif operation='creator_agreement' then
  previous:=doc #> array['marketplace','creators',key]; next_value:=value->'acceptance';
  if previous is null or previous is distinct from value->'expected' then raise exception 'Marketplace record changed'; end if;
  if not coalesce(next_value->>'userId'=previous->>'userId' and next_value->>'version' ~ '^[A-Za-z0-9_-]{1,100}$' and next_value->>'hash' ~ '^[a-f0-9]{64}$' and next_value->>'acceptedAt' is not null and jsonb_typeof(value->'agreementSnapshot')='object',false) then raise exception 'Creator agreement acceptance required'; end if;
  prior:=doc #> array['marketplace','agreementAcceptances',key,next_value->>'version'];
  if prior is not null and prior is distinct from next_value then raise exception 'Creator agreement acceptance immutable'; end if;
  prior:=doc #> array['marketplace','agreementSnapshots',next_value->>'version'];
  if prior is not null and prior is distinct from value->'agreementSnapshot' then raise exception 'Creator agreement snapshot immutable'; end if;
  if previous->'agreementAcceptance' is not null then doc:=store_set(doc,array['marketplace','agreementAcceptances',key,previous->>'agreementVersion'],previous->'agreementAcceptance'); end if;
  doc:=store_set(doc,array['marketplace','agreementAcceptances',key,next_value->>'version'],next_value);
  doc:=store_set(doc,array['marketplace','agreementSnapshots',next_value->>'version'],value->'agreementSnapshot');
  result:=previous||jsonb_build_object('agreementVersion',next_value->>'version','agreementAcceptance',next_value,'updatedAt',now_text);
  doc:=store_set(doc,array['marketplace','creators',key],result);
 elsif operation='listing_write' then
  previous:=doc #> array['marketplace','listings',key]; next_value:=value->'record'; cid:=next_value->>'sellerId';
  creator:=doc #> array['marketplace','creators',cid];
  if creator is null or creator->>'userId'<>value->>'owner' or next_value->>'id'<>key or key !~ '^mk_[a-f0-9]{32}$' then raise exception 'Invalid listing owner'; end if;
  if previous is distinct from nullif(value->'expected','null'::jsonb) then raise exception 'Marketplace record changed'; end if;
  if previous is not null and (previous->>'sellerId'<>cid or previous->>'id'<>key) then raise exception 'Listing owner immutable'; end if;
  if previous is null or (previous->>'status'='archived' and next_value->>'status'<>'archived') then
   select count(*) into listing_count from jsonb_each(coalesce(doc #> array['marketplace','listings'],'{}')) as l(id,record) where record->>'sellerId'=cid and record->>'status'<>'archived';
   if listing_count>=coalesce((value->>'limit')::integer,0) then raise exception 'Creator plan product limit reached'; end if;
  end if;
  if next_value->>'status'='active' and (creator->>'status'<>'approved' or next_value #>> array['file','uploaded']<>'true' or next_value #>> array['file','published']<>'true') then raise exception 'Listing not ready for publication'; end if;
  doc:=store_set(doc,array['marketplace','listings',key],next_value);
  if next_value->>'status'='active' and creator->>'status'='approved' then doc:=store_set(doc,array['products',key],value->'product');
  else doc:=doc #- array['products',key]; end if; result:=next_value;
 elsif operation='ledger_sync' then
  order_value:=doc #> array['orders',key]; snapshot:=order_value->'marketplace'; oid:=order_value->>'id';
  if snapshot is null then return null; end if;
  provider:=lower(order_value->>'paymentProvider'); payment:=order_value #> array['payments',order_value->>'transactionId'];
  if order_value->>'paymentEnvironment'<>'live' then return null; end if;
  if not coalesce(oid=key and provider=snapshot->>'provider' and provider in ('cashfree','razorpay','easebuzz') and order_value->>'paymentVerifiedAt' is not null and payment->>'verifiedAt' is not null and payment->>'environment'='live' and payment->>'currency'='INR' and
   ((provider='cashfree' and payment->>'status'='SUCCESS' and payment->>'order_id'=order_value->>'cashfreeOrderId') or
        (provider='razorpay' and payment->>'status' in ('captured','refunded') and payment->>'order_id'=order_value->>'razorpayOrderId') or
        (provider='easebuzz' and payment->>'status'='success' and payment->>'txnid'=order_value->>'easebuzzTxnId')), false)
  then raise exception 'Verified live provider payment required'; end if;
  gross:=(snapshot->>'grossPaise')::bigint; fee:=(snapshot->>'commissionPaise')::bigint; seller:=(snapshot->>'sellerPaise')::bigint;
  creator:=doc #> array['marketplace','creators',snapshot->>'sellerId'];
  if not coalesce(gross>0 and gross=round((order_value->>'total')::numeric*100) and gross=(payment->>'amount')::bigint and fee>=0 and seller>=0 and gross=fee+seller and
   (snapshot->>'commissionBps')::integer between 0 and 10000 and fee=floor(gross::numeric*(snapshot->>'commissionBps')::numeric/10000) and
   snapshot->>'sellerId' ~ '^cr_[a-f0-9]{32}$' and creator->>'id'=snapshot->>'sellerId' and
   snapshot->>'providerAccountId'=creator #>> array['providerAccounts',provider,'reference'] and
   creator #>> array['providerAccounts',provider,'environment']='live' and jsonb_array_length(order_value->'items')>0 and
   not exists(select 1 from jsonb_array_elements(order_value->'items') as i where coalesce(doc #>> array['marketplace','listings',i->>'productId','sellerId'],'')<>snapshot->>'sellerId'),false)
   then raise exception 'Commission snapshot mismatch'; end if;
  prior:=doc #> array['marketplace','ledger',key];
  if prior is not null and (prior->>'providerPaymentId'<>order_value->>'transactionId' or prior->>'sellerId'<>snapshot->>'sellerId' or (prior->>'grossPaise')::bigint<>gross or (prior->>'commissionPaise')::bigint<>fee) then raise exception 'Commission identity immutable'; end if;
  payment_key:=provider||'_live_'||(order_value->>'transactionId');
  if doc #> array['marketplace','ledgerPayments',payment_key] is not null and doc #>> array['marketplace','ledgerPayments',payment_key]<>key then raise exception 'Provider payment already credited'; end if;
  refunded:=greatest(coalesce((prior->>'refundedPaise')::bigint,0),coalesce(round((order_value->>'refundedAmount')::numeric*100),0)::bigint);
  if refunded<0 or refunded>gross then raise exception 'Refund amount exceeds seller sale'; end if;
  seller_refund:=case when refunded=gross then seller else floor(refunded::numeric*seller/gross)::bigint end;
  blocked:=coalesce((order_value->>'duplicatePaymentReview')::boolean,false) or coalesce((order_value->>'providerRefundReviewRequired')::boolean,false) or coalesce(order_value->>'accessReview'='required',false) or coalesce(order_value->>'deliveryStatus'='REVOKED',false) or exists(select 1 from jsonb_each(coalesce(order_value->'disputes','{}')) as d(id,record) where coalesce(record->>'status','') not in ('won','closed','CHARGEBACK_REVERSED','DISPUTE_WON') and coalesce(record->>'status','') not like '%\_MERCHANT\_WON' escape '\');
  result:=jsonb_build_object('orderId',key,'sellerId',snapshot->>'sellerId','provider',provider,'providerPaymentId',order_value->>'transactionId','grossPaise',gross,'commissionPaise',fee,'sellerPaise',seller,'refundedPaise',refunded,'refundSellerPaise',seller_refund,'payablePaise',case when blocked then 0 else seller-seller_refund end,'settlementStatus',case when blocked then 'review_required' else 'pending_provider' end,'createdAt',coalesce(prior->>'createdAt',now_text),'updatedAt',now_text);
  doc:=store_set(doc,array['marketplace','ledger',key],result); doc:=store_set(doc,array['marketplace','ledgerPayments',payment_key],to_jsonb(key));
 else raise exception 'Unsupported marketplace operation'; end if;
 if value->'audit' is not null then
  event_id:=value #>> array['audit','id'];
  if event_id !~ '^[a-f0-9]{32}$' then raise exception 'Invalid audit identity'; end if;
  doc:=store_set(doc,array['marketplace','audit',event_id],value->'audit'||jsonb_build_object('at',now_text));
 end if;
 update public.store_state set data=doc where id=true; return result;
end $$;
revoke all on function public.marketplace_operation(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.marketplace_operation(text,text,jsonb) to service_role;

-- Creator drafts share the already-private paid-file bucket under _creators/.
-- Reassert privacy even on projects that originally had a public products bucket.
insert into storage.buckets(id,name,public) values ('products','products',false) on conflict(id) do update set public=false;
