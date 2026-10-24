-- Run once in the Supabase SQL editor. Only the backend service role can access store data.
create table if not exists public.store_state (id boolean primary key default true check(id), data jsonb not null default '{}'::jsonb);
insert into public.store_state(id) values(true) on conflict do nothing;
alter table public.store_state enable row level security;
revoke all on public.store_state from anon, authenticated;

create or replace function public.store_set(doc jsonb, segments text[], val jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
begin
 if cardinality(segments)=0 then return val; end if;
 return jsonb_set(coalesce(doc,'{}'), array[segments[1]],
  case when cardinality(segments)=1 then val else public.store_set(doc->segments[1],segments[2:],val) end,true);
end $$;
revoke all on function public.store_set(jsonb,text[],jsonb) from public, anon, authenticated;

-- Cashfree financial records are normalized; only the backend service role may access them.
create table if not exists public.cashfree_order_bindings (
 environment text not null check(environment in ('live','test')),
 cashfree_order_id text not null,
 store_order_id text not null unique,
 cf_order_id text not null,
 created_at timestamptz not null default now(),
 primary key(environment,cashfree_order_id)
);
create table if not exists public.cashfree_payments (
 environment text not null check(environment in ('live','test')),
 payment_id text not null,
 store_order_id text not null,
 amount_paise bigint not null check(amount_paise>0),
 currency text not null check(currency='INR'),
 status text not null,
 verified_at timestamptz not null default now(),
 primary key(environment,payment_id)
);
create index if not exists cashfree_payments_order_idx on public.cashfree_payments(store_order_id);
create table if not exists public.cashfree_refunds (
 environment text not null check(environment in ('live','test')),
 refund_id text not null,
 payment_id text not null,
 store_order_id text not null,
 amount_paise bigint not null check(amount_paise>0),
 item_allocations jsonb,
 verified_at timestamptz not null default now(),
 primary key(environment,refund_id)
);
create index if not exists cashfree_refunds_payment_idx on public.cashfree_refunds(environment,payment_id);
alter table public.cashfree_order_bindings enable row level security;
alter table public.cashfree_payments enable row level security;
alter table public.cashfree_refunds enable row level security;
revoke all on public.cashfree_order_bindings, public.cashfree_payments, public.cashfree_refunds from public, anon, authenticated;
grant select,insert,update,delete on public.cashfree_order_bindings, public.cashfree_payments, public.cashfree_refunds to service_role;

create or replace function public.store_operation(operation text, key text default '', value jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare doc jsonb; result jsonb; current_value jsonb; k text; v jsonb; parts text[]; item jsonb; uid text; oid text; pid text; now_text text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); live boolean; event_key text; previous_payment jsonb; item_subtotal numeric; remaining_paise bigint; item_number int; item_paise bigint; item_array jsonb; refund_total bigint; allocated_total numeric; allocation jsonb;
begin
 if operation='get' then select data into doc from store_state where id=true; return doc #> string_to_array(key,'/'); end if;
 select data into doc from store_state where id=true for update;
 parts := string_to_array(key,'/'); current_value := doc #> parts;
 if operation='set' then doc:=store_set(doc,parts,value); result:=value;
 elsif operation='update' then result:=coalesce(current_value,'{}')||value; doc:=store_set(doc,parts,result);
 elsif operation='delete' then doc:=doc #- parts; result:='true';
 elsif operation='multi' then
  for k,v in select * from jsonb_each(value) loop doc:=store_set(doc,string_to_array(k,'/'),v); end loop; result:='true';
 elsif operation='rate' then
  if current_value is null or (current_value->>'resetTime')::bigint < (value->>'now')::bigint then current_value:=jsonb_build_object('count',0,'resetTime',(value->>'now')::bigint+(value->>'windowMs')::bigint); end if;
  result:=to_jsonb((current_value->>'count')::int < (value->>'maxAttempts')::int);
  current_value:=current_value||jsonb_build_object('count',(current_value->>'count')::int+1); doc:=store_set(doc,parts,current_value);
 elsif operation='bind_payment' then
  if current_value is null then raise exception 'Unknown order'; end if;
  if current_value->>'cashfreeOrderId' is not null or (current_value->>'paymentProvider' is not null and current_value->>'paymentProvider'<>'Razorpay') then raise exception 'Order already bound to another provider'; end if;
  if current_value->>'razorpayOrderId' is null then current_value:=current_value||value||jsonb_build_object('paymentInitiatedAt',now_text); end if;
  result:=current_value; doc:=store_set(doc,parts,result);
  doc:=store_set(doc,array['users',result->>'userId','orders',result->>'id'],result);
  doc:=store_set(doc,array['paymentTxnIndex',result->>'razorpayOrderId'],to_jsonb(result->>'id'));
 elsif operation='confirm_payment' then
  if current_value is null or not coalesce(
    value->>'id' ~ '^pay_[A-Za-z0-9]+$' and
    current_value->>'razorpayOrderId' = value->>'order_id' and
    current_value->>'paymentEnvironment' = value->>'environment' and
    value->>'environment' in ('live','test') and
    round((current_value->>'total')::numeric*100) = (value->>'amount')::numeric and
    value->>'currency'='INR' and value->>'status' in ('created','authorized','captured','refunded','failed') and
    (value->>'amount_refunded')::numeric between 0 and (value->>'amount')::numeric, false)
  then raise exception 'Payment mismatch'; end if;
  oid:=current_value->>'id'; uid:=current_value->>'userId'; live:=value->>'environment'='live';
  previous_payment:=current_value #> array['payments',value->>'id'];
  -- Keep a monotonic refunded amount and a bounded safe history per payment state.
  value:=value||jsonb_build_object('amount_refunded',greatest((value->>'amount_refunded')::numeric,coalesce((previous_payment->>'amount_refunded')::numeric,0)));
  event_key:=(value->>'id')||'_'||(value->>'status')||'_'||(value->>'amount_refunded');
  if current_value #> array['paymentHistory',event_key] is null then
   current_value:=store_set(current_value,array['paymentHistory',event_key],value||jsonb_build_object('verifiedAt',now_text));
  end if;
  current_value:=store_set(current_value,array['payments',value->>'id'],value||jsonb_build_object('verifiedAt',now_text));
  if current_value->>'transactionId' is not null and current_value->>'transactionId' <> value->>'id' then
   if value->>'status' in ('captured','refunded') then
    current_value:=current_value||jsonb_build_object('duplicatePaymentReview',true);
   end if;
  elsif (value->>'amount_refunded')::numeric > 0 then
   current_value:=current_value||jsonb_build_object('transactionId',value->>'id','paymentId',value->>'id','status',case when (value->>'amount_refunded')::numeric >= (value->>'amount')::numeric then 'REFUNDED' else 'PARTIALLY_REFUNDED' end,'paymentStatus','REFUNDED','deliveryStatus','REVOKED','downloadStatus','UNAVAILABLE','refundedAmount',(value->>'amount_refunded')::numeric/100,'refundVerifiedAt',now_text);
  elsif current_value->>'paymentStatus'='PENDING' and value->>'status'='captured' then
   current_value:=current_value||jsonb_build_object('status','PAID','paymentStatus','PAID','orderStatus','COMPLETED','transactionId',value->>'id','paymentId',value->>'id','paymentVerifiedAt',now_text,'deliveredAt',case when live then now_text else null end,'deliveryStatus',case when current_value->>'accessReview'='required' then 'REVOKED' when live then 'DELIVERED' else 'TEST_ONLY' end,'downloadStatus',case when live and coalesce(current_value->>'accessReview','')<>'required' then 'AVAILABLE' else 'UNAVAILABLE' end,'fulfillmentStatus',case when live then 'READY' else 'TEST_ONLY' end);
   if live then
    for item in select * from jsonb_array_elements(current_value->'items') loop
     pid:='pur_'||oid||'_'||(item->>'productId');
     v:=jsonb_build_object('purchaseId',pid,'userId',uid,'orderId',oid,'productId',item->>'productId','productTitle',item->>'productTitle','accessStatus','active','purchasedAt',now_text,'deliveredAt',now_text);
     doc:=store_set(doc,array['purchases',pid],v); doc:=store_set(doc,array['users',uid,'purchases',pid],v);
     doc:=store_set(doc,array['users',uid,'downloads',pid],v||jsonb_build_object('id',pid,'downloadId',pid,'status','AVAILABLE','createdAt',now_text));
    end loop;
   end if;
  end if;
  result:=current_value; doc:=store_set(doc,parts,result); doc:=store_set(doc,array['users',uid,'orders',oid],result);
 elsif operation='bind_cashfree' then
  if current_value is null or not coalesce(
   cardinality(parts)=2 and parts[1]='orders' and current_value->>'id'=parts[2] and
   ((current_value->>'paymentStatus' in ('PENDING','FAILED') and current_value->>'transactionId' is null) or current_value->>'cashfreeOrderId' is not null) and value->>'paymentProvider'='Cashfree' and
   value->>'cashfreeOrderId'=current_value->>'id' and value->>'cfOrderId' ~ '^[A-Za-z0-9_-]{1,100}$' and
   value->>'paymentEnvironment' in ('live','test') and jsonb_array_length(current_value->'items')>0,
   false) then raise exception 'Order is not payable'; end if;
  if current_value->>'razorpayOrderId' is not null or
   (current_value->>'paymentProvider' is not null and current_value->>'paymentProvider'<>'Cashfree') then
   raise exception 'Order already bound to another provider';
  end if;
  if current_value->>'cashfreeOrderId' is not null then
   if current_value->>'cashfreeOrderId'<>value->>'cashfreeOrderId' or current_value->>'paymentEnvironment'<>value->>'paymentEnvironment' or current_value->>'cfOrderId'<>value->>'cfOrderId' then
    raise exception 'Cashfree binding mismatch';
   end if;
  else
   select coalesce(sum((x->>'price')::numeric*coalesce((x->>'quantity')::numeric,1)),0) into item_subtotal from jsonb_array_elements(current_value->'items') x;
   if item_subtotal<=0 or (current_value->>'total')::numeric<=0 then raise exception 'Invalid order amount'; end if;
   item_array:='[]'; remaining_paise:=round((current_value->>'total')::numeric*100)::bigint; item_number:=0;
   for item in select * from jsonb_array_elements(current_value->'items') loop
    item_number:=item_number+1;
    if not coalesce((item->>'price')::numeric>0 and item->>'productId' ~ '^[A-Za-z0-9_-]{1,100}$',false) then raise exception 'Invalid order item'; end if;
    item_paise:=case when item_number=jsonb_array_length(current_value->'items') then remaining_paise else least(remaining_paise,round(((item->>'price')::numeric*coalesce((item->>'quantity')::numeric,1)/item_subtotal)*(current_value->>'total')::numeric*100)::bigint) end;
    remaining_paise:=remaining_paise-item_paise;
    item_array:=item_array||jsonb_build_array(item||jsonb_build_object('paidAmountPaise',item_paise));
   end loop;
   current_value:=current_value||jsonb_build_object('cashfreeOrderId',value->>'cashfreeOrderId','cfOrderId',value->>'cfOrderId','paymentProvider','Cashfree','paymentEnvironment',value->>'paymentEnvironment','policyAcceptedAt',value->>'policyAcceptedAt','policyVersion',value->>'policyVersion','paymentInitiatedAt',now_text,'items',item_array);
  end if;
  insert into public.cashfree_order_bindings(environment,cashfree_order_id,store_order_id,cf_order_id)
   values(current_value->>'paymentEnvironment',current_value->>'cashfreeOrderId',current_value->>'id',current_value->>'cfOrderId') on conflict do nothing;
  if not exists(select 1 from public.cashfree_order_bindings b where b.environment=current_value->>'paymentEnvironment' and b.cashfree_order_id=current_value->>'cashfreeOrderId' and b.store_order_id=current_value->>'id' and b.cf_order_id=current_value->>'cfOrderId') then raise exception 'Duplicate Cashfree binding'; end if;
  result:=current_value; doc:=store_set(doc,parts,result);
  doc:=store_set(doc,array['users',result->>'userId','orders',result->>'id'],result);
  doc:=store_set(doc,array['cashfreeOrderIndex',result->>'cashfreeOrderId'],to_jsonb(result->>'id'));
 elsif operation='sync_cashfree_snapshot' then
  -- One RPC is one PostgreSQL transaction. Nested operations share this row lock;
  -- no intermediate PAID state is visible before all confirmed refunds are applied.
  if current_value is null or not coalesce(cardinality(parts)=2 and parts[1]='orders' and parts[2]=current_value->>'id' and
   current_value->>'paymentProvider'='Cashfree' and current_value->>'cashfreeOrderId' is not null and
   jsonb_typeof(value->'payments')='array' and jsonb_typeof(value->'refunds')='array',false) then raise exception 'Invalid Cashfree snapshot'; end if;
  if jsonb_array_length(value->'payments')>2500 or jsonb_array_length(value->'refunds')>2500 then raise exception 'Cashfree snapshot too large'; end if;
  for item in select * from jsonb_array_elements(value->'payments') loop
   perform public.store_operation('confirm_cashfree',key,item);
  end loop;
  for item in select * from jsonb_array_elements(value->'refunds') loop
   perform public.store_operation('record_cashfree_refund',key,item);
  end loop;
  -- Return the nested writes directly. Never rewrite this function's earlier doc snapshot.
  return public.store_operation('get',key,null);
 elsif operation='confirm_cashfree' then
  if current_value is null or not coalesce(
   cardinality(parts)=2 and parts[1]='orders' and parts[2]=current_value->>'id' and
   current_value->>'paymentProvider'='Cashfree' and value->>'id' ~ '^[A-Za-z0-9_-]{1,100}$' and
   value->>'order_id'=current_value->>'cashfreeOrderId' and value->>'environment'=current_value->>'paymentEnvironment' and
   value->>'environment' in ('live','test') and value->>'currency'='INR' and
   (value->>'amount')::numeric=trunc((value->>'amount')::numeric) and (value->>'amount')::numeric>0 and
   (value->>'amount')::numeric=round((current_value->>'total')::numeric*100) and
   value->>'status' in ('SUCCESS','FAILED','PENDING','USER_DROPPED','CANCELLED','NOT_ATTEMPTED'), false)
   then raise exception 'Cashfree payment mismatch'; end if;
  oid:=current_value->>'id'; uid:=current_value->>'userId'; live:=value->>'environment'='live';
  value:=jsonb_build_object('id',value->>'id','order_id',value->>'order_id','amount',(value->>'amount')::bigint,'currency','INR','status',value->>'status','environment',value->>'environment','providerCreatedAt',value->'providerCreatedAt');
  if exists(select 1 from public.cashfree_payments p where p.environment=value->>'environment' and p.payment_id=value->>'id' and (p.store_order_id<>oid or p.amount_paise<>(value->>'amount')::bigint)) then raise exception 'Cashfree payment already belongs to another order'; end if;
  insert into public.cashfree_payments(environment,payment_id,store_order_id,amount_paise,currency,status)
   values(value->>'environment',value->>'id',oid,(value->>'amount')::bigint,'INR',value->>'status')
   on conflict(environment,payment_id) do update set status=case when cashfree_payments.status='SUCCESS' then 'SUCCESS' else excluded.status end,verified_at=now();
  previous_payment:=current_value #> array['payments',value->>'id'];
  if previous_payment->>'status'='SUCCESS' and value->>'status'<>'SUCCESS' then value:=value||jsonb_build_object('status','SUCCESS'); end if;
  event_key:=(value->>'id')||'_'||(value->>'status');
  if current_value #> array['paymentHistory',event_key] is null then current_value:=store_set(current_value,array['paymentHistory',event_key],value||jsonb_build_object('verifiedAt',now_text)); end if;
  current_value:=store_set(current_value,array['payments',value->>'id'],value||jsonb_build_object('verifiedAt',now_text));
  current_value:=current_value||jsonb_build_object('lastPaymentAttemptStatus',value->>'status','latestPaymentStatus',value->>'status');
  if current_value->>'transactionId' is not null and current_value->>'transactionId'<>value->>'id' then
   if value->>'status'='SUCCESS' then current_value:=current_value||jsonb_build_object('duplicatePaymentReview',true); end if;
  elsif value->>'status'='SUCCESS' and current_value->>'transactionId' is null and
   current_value->>'paymentStatus' in ('PENDING','FAILED') and coalesce(current_value->>'deliveryStatus','')<>'REVOKED' and
   coalesce(current_value->>'accessReview','')<>'required' and coalesce(current_value->>'status','') not in ('REFUNDED','REVOKED','CANCELLED') then
   current_value:=current_value||jsonb_build_object('transactionId',value->>'id','paymentId',value->>'id','paymentStatus','PAID','status','PAID','orderStatus','COMPLETED','paymentVerifiedAt',now_text,'deliveredAt',case when live then now_text else null end,'deliveryStatus',case when live then 'DELIVERED' else 'TEST_ONLY' end,'downloadStatus',case when live then 'AVAILABLE' else 'UNAVAILABLE' end,'fulfillmentStatus',case when live then 'READY' else 'TEST_ONLY' end);
   if live then
    for item in select * from jsonb_array_elements(current_value->'items') loop
     pid:='pur_'||oid||'_'||(item->>'productId');
     v:=jsonb_build_object('purchaseId',pid,'userId',uid,'orderId',oid,'productId',item->>'productId','productTitle',item->>'productTitle','accessStatus','active','purchasedAt',now_text,'deliveredAt',now_text);
     doc:=store_set(doc,array['purchases',pid],v); doc:=store_set(doc,array['users',uid,'purchases',pid],v);
     doc:=store_set(doc,array['users',uid,'downloads',pid],v||jsonb_build_object('id',pid,'downloadId',pid,'status','AVAILABLE','createdAt',now_text));
    end loop;
   end if;
  end if;
  result:=current_value; doc:=store_set(doc,parts,result); doc:=store_set(doc,array['users',uid,'orders',oid],result);
 elsif operation in ('record_cashfree_refund','allocate_cashfree_refund') then
  if operation='allocate_cashfree_refund' then
   if current_value is null or current_value->>'paymentProvider'<>'Cashfree' or
    not coalesce(value->>'refund_id' ~ '^[A-Za-z0-9_-]{1,100}$' and value->>'reviewedBy' ~ '^[A-Za-z0-9_-]{1,150}$' and length(value->>'reason') between 10 and 1000 and jsonb_typeof(value->'itemAllocations')='array',false) then raise exception 'Invalid refund allocation review'; end if;
   select to_jsonb(r) into allocation from public.cashfree_refunds r where r.environment=current_value->>'paymentEnvironment' and r.refund_id=value->>'refund_id' and r.store_order_id=current_value->>'id' and r.payment_id=current_value->>'transactionId';
   if allocation is null then raise exception 'Confirmed funding refund not found'; end if;
   if allocation->'item_allocations' is not null and allocation->'item_allocations'<>'null'::jsonb then
    if allocation->'item_allocations'=value->'itemAllocations' then return current_value; else raise exception 'Refund already allocated'; end if;
   end if;
   value:=jsonb_build_object('id',allocation->>'refund_id','payment_id',allocation->>'payment_id','order_id',current_value->>'cashfreeOrderId','amount',(allocation->>'amount_paise')::bigint,'currency','INR','environment',allocation->>'environment','itemAllocations',value->'itemAllocations','reviewedBy',value->>'reviewedBy','reason',value->>'reason');
  end if;
  if current_value is null or not coalesce(
   cardinality(parts)=2 and parts[1]='orders' and parts[2]=current_value->>'id' and
   current_value->>'paymentProvider'='Cashfree' and value->>'id' ~ '^[A-Za-z0-9_-]{1,100}$' and
   value->>'payment_id' ~ '^[A-Za-z0-9_-]{1,100}$' and value->>'order_id'=current_value->>'cashfreeOrderId' and
   value->>'environment'=current_value->>'paymentEnvironment' and value->>'environment' in ('live','test') and
   value->>'currency'='INR' and (value->>'amount')::numeric=trunc((value->>'amount')::numeric) and (value->>'amount')::numeric>0 and
   current_value #>> array['payments',value->>'payment_id','status']='SUCCESS', false)
   then raise exception 'Cashfree refund mismatch'; end if;
  oid:=current_value->>'id'; uid:=current_value->>'userId';
  if operation='record_cashfree_refund' and exists(select 1 from public.cashfree_refunds r where r.environment=value->>'environment' and r.refund_id=value->>'id') then
   if not exists(select 1 from public.cashfree_refunds r where r.environment=value->>'environment' and r.refund_id=value->>'id' and r.payment_id=value->>'payment_id' and r.store_order_id=oid and r.amount_paise=(value->>'amount')::bigint and (not (value ? 'itemAllocations') or value->'itemAllocations'='null'::jsonb or coalesce(r.item_allocations,'null'::jsonb)=value->'itemAllocations')) then raise exception 'Conflicting Cashfree refund'; end if;
   return current_value;
  end if;
  select coalesce(sum(r.amount_paise),0)+case when operation='record_cashfree_refund' then (value->>'amount')::bigint else 0 end into refund_total from public.cashfree_refunds r where r.environment=value->>'environment' and r.payment_id=value->>'payment_id';
  if refund_total>round((current_value->>'total')::numeric*100) then raise exception 'Cashfree refund exceeds payment'; end if;
  if value ? 'itemAllocations' and value->'itemAllocations'<>'null'::jsonb then
   if jsonb_typeof(value->'itemAllocations')<>'array' or jsonb_array_length(value->'itemAllocations')=0 then raise exception 'Invalid refund allocations'; end if;
   select coalesce(sum((a->>'amount')::numeric),0) into allocated_total from jsonb_array_elements(value->'itemAllocations') a;
   if allocated_total<>(value->>'amount')::numeric then raise exception 'Refund allocations must match refund amount'; end if;
   if exists(select 1 from jsonb_array_elements(value->'itemAllocations') a group by a->>'productId' having count(*)>1) then raise exception 'Duplicate refund allocation'; end if;
   item_array:='[]';
   for item in select * from jsonb_array_elements(current_value->'items') loop
    select a into allocation from jsonb_array_elements(value->'itemAllocations') a where a->>'productId'=item->>'productId';
    if allocation is not null then
     if not coalesce((allocation->>'amount')::numeric>0 and (allocation->>'amount')::numeric=trunc((allocation->>'amount')::numeric),false) then raise exception 'Invalid refund allocation'; end if;
     item_paise:=coalesce((item->>'refundedAmountPaise')::bigint,0)+(allocation->>'amount')::bigint;
     if item_paise>(item->>'paidAmountPaise')::bigint then raise exception 'Item refund exceeds paid amount'; end if;
     item:=item||jsonb_build_object('refundedAmountPaise',item_paise,'refunded',item_paise>=(item->>'paidAmountPaise')::bigint);
    end if;
    item_array:=item_array||jsonb_build_array(item);
   end loop;
   if exists(select 1 from jsonb_array_elements(value->'itemAllocations') a where not exists(select 1 from jsonb_array_elements(current_value->'items') i where i->>'productId'=a->>'productId')) then raise exception 'Unknown refunded item'; end if;
   -- A separately refunded duplicate payment must not mutate original paid item access.
   if value->>'payment_id'=current_value->>'transactionId' then current_value:=current_value||jsonb_build_object('items',item_array); end if;
  end if;
  if operation='record_cashfree_refund' then
   insert into public.cashfree_refunds(environment,refund_id,payment_id,store_order_id,amount_paise,item_allocations)
    values(value->>'environment',value->>'id',value->>'payment_id',oid,(value->>'amount')::bigint,value->'itemAllocations');
  else
   update public.cashfree_refunds set item_allocations=value->'itemAllocations' where environment=value->>'environment' and refund_id=value->>'id';
  end if;
  value:=jsonb_build_object('id',value->>'id','payment_id',value->>'payment_id','amount',(value->>'amount')::bigint,'currency','INR','environment',value->>'environment','status','SUCCESS','itemAllocations',value->'itemAllocations','allocationReviewedBy',value->>'reviewedBy','allocationReviewReason',value->>'reason','allocationReviewedAt',case when operation='allocate_cashfree_refund' then now_text else null end,'verifiedAt',now_text);
  current_value:=store_set(current_value,array['refunds',value->>'id'],value);
  if value->>'payment_id'=current_value->>'transactionId' then
   if refund_total>=round((current_value->>'total')::numeric*100) then
    current_value:=current_value||jsonb_build_object('status','REFUNDED','paymentStatus','REFUNDED','deliveryStatus','REVOKED','downloadStatus','UNAVAILABLE','refundReviewRequired',false,'refundedAmount',refund_total::numeric/100,'refundVerifiedAt',now_text);
   else
    current_value:=current_value||jsonb_build_object('status','PARTIALLY_REFUNDED','paymentStatus','PARTIALLY_REFUNDED','refundedAmount',refund_total::numeric/100,'refundVerifiedAt',now_text);
    if value->'itemAllocations' is null or value->'itemAllocations'='null'::jsonb then current_value:=current_value||jsonb_build_object('refundReviewRequired',true); end if;
   end if;
  end if;
  if operation='allocate_cashfree_refund' and not exists(select 1 from public.cashfree_refunds r where r.environment=current_value->>'paymentEnvironment' and r.payment_id=current_value->>'transactionId' and (r.item_allocations is null or r.item_allocations='null'::jsonb)) then current_value:=current_value||jsonb_build_object('refundReviewRequired',false); end if;
  result:=current_value; doc:=store_set(doc,parts,result); doc:=store_set(doc,array['users',uid,'orders',oid],result);
 elsif operation='record_cashfree_dispute' then
  if current_value is null or not coalesce(
   cardinality(parts)=2 and parts[1]='orders' and parts[2]=current_value->>'id' and current_value->>'paymentProvider'='Cashfree' and
   value->>'id' ~ '^[A-Za-z0-9_-]{1,100}$' and value->>'payment_id' ~ '^[A-Za-z0-9_-]{1,100}$' and
   current_value #>> array['payments',value->>'payment_id','status']='SUCCESS' and (value->>'cashfreeOrderId' is null or value->>'cashfreeOrderId'=current_value->>'cashfreeOrderId') and
   value->>'status' ~ '^(DISPUTE|CHARGEBACK|RETRIEVAL|PRE_ARBITRATION|ARBITRATION)_[A-Z_]+$' and
   value->>'currency'='INR' and (value->>'amount')::numeric between 0 and round((current_value->>'total')::numeric*100) and
   (value->>'amount')::numeric=trunc((value->>'amount')::numeric),false) then raise exception 'Cashfree dispute mismatch'; end if;
  previous_payment:=current_value #> array['cashfreeDisputes',value->>'id'];
  if nullif(previous_payment->>'updated_at','') is not null and
   (nullif(value->>'updated_at','') is null or (value->>'updated_at')::timestamptz<(previous_payment->>'updated_at')::timestamptz or
    ((value->>'updated_at')::timestamptz=(previous_payment->>'updated_at')::timestamptz and previous_payment->>'status' like '%\_MERCHANT\_LOST' escape '\' and value->>'status' not like '%\_MERCHANT\_WON' escape '\')) then return current_value; end if;
  value:=jsonb_build_object('id',value->>'id','payment_id',value->>'payment_id','status',value->>'status','type',value->>'type','amount',(value->>'amount')::bigint,'currency','INR','reason_code',value->>'reason_code','reason_description',left(value->>'reason_description',1000),'respond_by',value->>'respond_by','updated_at',nullif(value->>'updated_at',''),'cashfreeOrderId',current_value->>'cashfreeOrderId','created_at',value->>'created_at','resolved_at',value->>'resolved_at','providerRemarks',left(value->>'providerRemarks',2000),'preferredEvidence',case when jsonb_typeof(value->'preferredEvidence')='array' then value->'preferredEvidence' else '[]'::jsonb end,'evidence',case when jsonb_typeof(value->'evidence')='array' then value->'evidence' else '[]'::jsonb end,'verifiedAt',now_text);
  v:=coalesce(doc #> array['cashfreeDisputes',value->>'id'],'{}'::jsonb)||value||jsonb_build_object('orderId',current_value->>'id','userId',current_value->>'userId');
  doc:=store_set(doc,array['cashfreeDisputes',value->>'id'],v);
  current_value:=store_set(current_value,array['cashfreeDisputes',value->>'id'],value);
  current_value:=store_set(current_value,array['disputes',value->>'id'],value);
  if value->>'status' like '%\_MERCHANT\_LOST' escape '\' and value->>'payment_id'=current_value->>'transactionId' then
   current_value:=current_value||jsonb_build_object('deliveryStatus','REVOKED','downloadStatus','UNAVAILABLE','accessReview','required');
  end if;
  result:=current_value; doc:=store_set(doc,parts,result); doc:=store_set(doc,array['users',result->>'userId','orders',result->>'id'],result);
 elsif operation='queue_email_state' then
  if not coalesce(cardinality(parts)=2 and parts[1]='notifications' and value->>'notificationId'=parts[2] and
   value->>'orderId' ~ '^[A-Za-z0-9_-]{1,100}$' and value->>'kind' in ('emailDelivery','refundEmailDelivery') and
   value->>'createdAt' is not null and (not (value ? 'status') or value->>'status' in ('pending','not_configured','failed','review_required','skipped')),false)
   then raise exception 'Invalid queued email state'; end if;
  if current_value is not null and (current_value->>'orderId' is not null and current_value->>'orderId'<>value->>'orderId' or current_value->>'kind' is not null and current_value->>'kind'<>value->>'kind') then raise exception 'Email notification identity mismatch'; end if;
  if current_value->>'status' in ('sent','review_required') or current_value->>'emailId' is not null then return current_value; end if;
  if current_value->>'status'='sending' and coalesce((current_value->>'leaseUntil')::bigint,0)>floor(extract(epoch from clock_timestamp())*1000)::bigint and (not (value ? 'status') or value->>'status' in ('pending','not_configured')) then return current_value; end if;
  perform (value->>'createdAt')::timestamptz;
  v:=jsonb_build_object('orderId',value->>'orderId','kind',value->>'kind','notificationId',parts[2],'createdAt',coalesce(current_value->>'createdAt',value->>'createdAt'));
  if value ? 'status' then v:=v||jsonb_build_object('status',value->>'status'); elsif current_value->>'status' is null then v:=v||jsonb_build_object('status','pending'); end if;
  if value ? 'nextAttemptAt' then
   if value->'nextAttemptAt'<>'null'::jsonb and not coalesce((value->>'nextAttemptAt')::numeric>=0 and (value->>'nextAttemptAt')::numeric=trunc((value->>'nextAttemptAt')::numeric),false) then raise exception 'Invalid email retry time'; end if;
   v:=v||jsonb_build_object('nextAttemptAt',value->'nextAttemptAt');
  end if;
  if value ? 'failureReason' then v:=v||jsonb_build_object('failureReason',left(value->>'failureReason',200)); end if;
  if value ? 'discoveredAt' then perform (value->>'discoveredAt')::timestamptz; v:=v||jsonb_build_object('discoveredAt',value->>'discoveredAt'); end if;
  if value ? 'attempts' then
   if not coalesce((value->>'attempts')::numeric between 0 and 1000000 and (value->>'attempts')::numeric=trunc((value->>'attempts')::numeric),false) then raise exception 'Invalid email retry count'; end if;
   v:=v||jsonb_build_object('attempts',(value->>'attempts')::int);
  end if;
  result:=coalesce(current_value,'{}'::jsonb)||v; doc:=store_set(doc,parts,result);
 elsif operation='email_provider_event' then
  if current_value is null or not coalesce(
   cardinality(parts)=2 and parts[1]='notifications' and current_value->>'emailId'=value->>'emailId' and
   value->>'notificationId'=parts[2] and value->>'eventId' ~ '^[A-Za-z0-9_:-]{1,150}$' and
   current_value->>'kind' in ('emailDelivery','refundEmailDelivery') and current_value->>'orderId' is not null and
   value->>'providerStatus' in ('accepted','delayed','delivered','bounced','complained','failed','suppressed'),false) then raise exception 'Email event mismatch'; end if;
  if current_value #> array['providerEvents',value->>'eventId'] is not null then return current_value; end if;
  -- Parse and retain only provider timestamps, status and opaque event ID; never store raw messages.
  perform (value->>'eventCreatedAt')::timestamptz; perform (value->>'receivedAt')::timestamptz;
  current_value:=store_set(current_value,array['providerEvents',value->>'eventId'],jsonb_build_object('status',value->>'providerStatus','createdAt',value->>'eventCreatedAt'));
  if not (
   (coalesce(current_value->>'providerStatus','') in ('bounced','complained','failed','suppressed') and value->>'providerStatus' in ('accepted','delayed','delivered')) or
   (current_value->>'providerStatus'='delivered' and value->>'providerStatus' in ('accepted','delayed')) or
   (current_value->>'providerEventAt' is not null and (value->>'eventCreatedAt')::timestamptz<(current_value->>'providerEventAt')::timestamptz)
  ) then
   current_value:=current_value||jsonb_build_object('providerStatus',value->>'providerStatus','providerEventAt',value->>'eventCreatedAt','providerEventReceivedAt',value->>'receivedAt');
  end if;
  result:=current_value; doc:=store_set(doc,parts,result);
  oid:=result->>'orderId'; k:=result->>'kind'; v:=doc #> array['orders',oid];
  if v is not null then
   item:=coalesce(v->k,'{}')||jsonb_build_object('status','sent','emailId',result->>'emailId','notificationId',parts[2],'providerStatus',result->>'providerStatus','providerEventAt',result->>'providerEventAt','providerEventReceivedAt',result->>'providerEventReceivedAt');
   v:=store_set(v,array[k],item); doc:=store_set(doc,array['orders',oid],v); doc:=store_set(doc,array['users',v->>'userId','orders',oid],v);
  end if;
 elsif operation='record_dispute' then
  if current_value is null or not coalesce(value->>'payment_id' ~ '^pay_[A-Za-z0-9]+$' and value->>'id' ~ '^disp_[A-Za-z0-9]+$' and (current_value #> array['payments',value->>'payment_id']) is not null,false) then raise exception 'Dispute mismatch'; end if;
  current_value:=store_set(current_value,array['disputes',value->>'id'],value||jsonb_build_object('verifiedAt',now_text));
  if value->>'status'='lost' and current_value->>'transactionId'=value->>'payment_id' then
   current_value:=current_value||jsonb_build_object('deliveryStatus','REVOKED','downloadStatus','UNAVAILABLE','accessReview','required');
  end if;
  result:=current_value; doc:=store_set(doc,parts,result); doc:=store_set(doc,array['users',result->>'userId','orders',result->>'id'],result);
 elsif operation='record_event' then
  -- Event IDs are hashed by the server. Retain no raw webhook or authentication data.
  if current_value is null then doc:=store_set(doc,parts,value||jsonb_build_object('receivedAt',now_text)); end if; result:='true';
 elsif operation='order_note' then
  if current_value is null then raise exception 'Unknown order'; end if;
  result:=current_value||value; doc:=store_set(doc,parts,result); doc:=store_set(doc,array['users',result->>'userId','orders',result->>'id'],result);
 elsif operation='claim_email' then
  if current_value->>'status'='sent' or current_value->>'status'='review_required' or
   (current_value->>'status'='sending' and (current_value->>'leaseUntil')::bigint > (value->>'now')::bigint) then return 'false'; end if;
  if current_value->>'firstAttemptAt' is not null and (value->>'now')::bigint-(current_value->>'firstAttemptAt')::bigint > 82800000 then
   doc:=store_set(doc,parts,current_value||'{"status":"review_required"}'::jsonb); result:='false';
  else
   doc:=store_set(doc,parts,coalesce(current_value,'{}')||jsonb_build_object('status','sending','firstAttemptAt',coalesce((current_value->>'firstAttemptAt')::bigint,(value->>'now')::bigint),'leaseUntil',(value->>'now')::bigint+300000)); result:='true';
  end if;
 elsif operation='email_status' then
  k:=coalesce(value->>'kind','emailDelivery');
  if k not in ('emailDelivery','refundEmailDelivery') then raise exception 'Invalid notification'; end if;
  if current_value #>> array[k,'status']='sent' and value->>'status'<>'sent' then return current_value; end if;
  result:=current_value||jsonb_build_object(k,value-'kind'); doc:=store_set(doc,parts,result); doc:=store_set(doc,array['users',result->>'userId','orders',result->>'id'],result);
 elsif operation='restore_order_access' then
  if current_value is null or not coalesce(current_value->>'paymentStatus' in ('PAID','PARTIALLY_REFUNDED') and current_value->>'paymentEnvironment'='live' and current_value->>'transactionId' is not null and (coalesce((current_value->>'refundedAmount')::numeric,0)=0 or (current_value->>'paymentProvider'='Cashfree' and current_value->>'paymentStatus'='PARTIALLY_REFUNDED')),false) then raise exception 'Order cannot be restored'; end if;
  if exists(select 1 from jsonb_each(coalesce(current_value->'disputes','{}')) as d(id,record) where d.record->>'payment_id'=current_value->>'transactionId' and d.record->>'status' not in ('won','closed') and d.record->>'status' not like '%\_MERCHANT\_WON' escape '\' and d.record->>'status' not like '%\_CLOSED' escape '\') then raise exception 'Dispute requires review'; end if;
  result:=current_value||jsonb_build_object('deliveryStatus','DELIVERED','downloadStatus','AVAILABLE','accessReview','resolved','accessRestoredAt',now_text);
  doc:=store_set(doc,parts,result); doc:=store_set(doc,array['users',result->>'userId','orders',result->>'id'],result);
 elsif operation='revoke_order' then
  result:=current_value||jsonb_build_object('deliveryStatus','REVOKED','downloadStatus','UNAVAILABLE'); doc:=store_set(doc,parts,result); doc:=store_set(doc,array['users',result->>'userId','orders',result->>'id'],result);
 else raise exception 'Unsupported operation'; end if;
 if operation in ('confirm_payment','confirm_cashfree','record_cashfree_refund','allocate_cashfree_refund','record_cashfree_dispute','record_dispute','revoke_order','restore_order_access') then
  for item in select * from jsonb_array_elements(coalesce(result->'items','[]')) loop
   pid:='pur_'||(result->>'id')||'_'||(item->>'productId');
   v:=doc #> array['purchases',pid];
   if v is not null then
    v:=v||jsonb_build_object('accessStatus',case when result->>'downloadStatus'='AVAILABLE' and coalesce((item->>'refunded')::boolean,false)=false then 'active' else 'restricted' end);
    doc:=store_set(doc,array['purchases',pid],v); doc:=store_set(doc,array['users',result->>'userId','purchases',pid],v);
    doc:=store_set(doc,array['users',result->>'userId','downloads',pid],(doc #> array['users',result->>'userId','downloads',pid])||jsonb_build_object('status',case when coalesce((item->>'refunded')::boolean,false) then 'UNAVAILABLE' else result->>'downloadStatus' end));
   end if;
  end loop;
 end if;
 update store_state set data=doc where id=true; return result;
end $$;
revoke all on function public.store_operation(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.store_operation(text,text,jsonb) to service_role;

-- Private product ZIPs. Do not add public/anonymous object policies.
insert into storage.buckets (id,name,public) values ('products','products',false) on conflict(id) do update set public=false;
-- Public catalog thumbnails only; never put product ZIPs in this bucket.
insert into storage.buckets (id,name,public) values ('product-images','product-images',true) on conflict(id) do nothing;

-- Restrictive policy protects paid objects even if an older permissive policy exists.
-- Service-role signing/upload operations bypass RLS; browser roles may not read/write paid objects directly.
drop policy if exists products_no_direct_client_access on storage.objects;
create policy products_no_direct_client_access on storage.objects as restrictive for all to anon, authenticated
 using (bucket_id <> 'products') with check (bucket_id <> 'products');
