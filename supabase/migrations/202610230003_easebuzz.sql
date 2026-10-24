-- Apply after schema.sql. Easebuzz mutations are isolated from other gateways.
-- All amount/refund inputs are integer paise from a server-retrieved provider snapshot.
create table if not exists public.easebuzz_bindings (
 environment text not null check (environment in ('live','test')),
 txnid text not null check (txnid ~ '^[A-Za-z0-9_-]{3,45}$'),
 store_order_id text not null unique,
 amount_paise bigint not null check (amount_paise > 0),
 created_at timestamptz not null default now(),
 primary key (environment,txnid)
);
create table if not exists public.easebuzz_payments (
 environment text not null check (environment in ('live','test')),
 payment_id text not null check (payment_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 txnid text not null,
 store_order_id text not null,
 amount_paise bigint not null check (amount_paise > 0),
 currency text not null check (currency = 'INR'),
 status text not null check (status in ('success','failure','pending')),
 refunded_paise bigint not null default 0 check (refunded_paise between 0 and amount_paise),
 verified_at timestamptz not null default now(),
 primary key (environment,payment_id),
 foreign key (environment,txnid) references public.easebuzz_bindings(environment,txnid)
);
create index if not exists easebuzz_payments_order_idx on public.easebuzz_payments(store_order_id);
alter table public.easebuzz_bindings enable row level security;
alter table public.easebuzz_payments enable row level security;
revoke all on public.easebuzz_bindings, public.easebuzz_payments from public, anon, authenticated;
grant select,insert,update,delete on public.easebuzz_bindings, public.easebuzz_payments to service_role;

create or replace function public.easebuzz_order_operation(operation text, order_id text, value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
 doc jsonb; current_order jsonb; previous_payment jsonb; payment jsonb;
 binding public.easebuzz_bindings%rowtype; previous_row public.easebuzz_payments%rowtype;
 oid text := order_id; uid text; pid text; item jsonb; purchase jsonb; items jsonb;
 verified_amount_paise bigint; verified_refunded_paise bigint; payment_status text; event_key text;
 now_text text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 live boolean; access_allowed boolean;
begin
 if operation not in ('bind','confirm') or not coalesce(oid ~ '^[A-Za-z0-9_-]{1,100}$',false)
  or jsonb_typeof(value) is distinct from 'object' then raise exception 'Invalid Easebuzz operation'; end if;
 select data into doc from public.store_state where id=true for update;
 current_order := doc #> array['orders',oid];
 if current_order is null or not coalesce(jsonb_typeof(current_order)='object' and current_order->>'id'=oid
  and current_order->>'userId' ~ '^[A-Za-z0-9_-]{1,150}$'
  and current_order->>'total' ~ '^[0-9]+([.][0-9]+)?$'
  and (current_order->>'total')::numeric > 0
  and round((current_order->>'total')::numeric*100) between 1 and 9007199254740991
  and jsonb_typeof(current_order->'items')='array' and jsonb_array_length(current_order->'items') between 1 and 100,false)
 then raise exception 'Unknown or invalid order'; end if;
 uid := current_order->>'userId';
 verified_amount_paise := round((current_order->>'total')::numeric*100)::bigint;
 if exists(select 1 from jsonb_array_elements(current_order->'items') i
  where not coalesce(i->>'productId' ~ '^[A-Za-z0-9_-]{1,100}$',false))
  or exists(select 1 from jsonb_array_elements(current_order->'items') i group by i->>'productId' having count(*)>1)
 then raise exception 'Invalid order items'; end if;
 if current_order->>'cashfreeOrderId' is not null or current_order->>'razorpayOrderId' is not null
  or (current_order->>'paymentProvider' is not null and current_order->>'paymentProvider'<>'Easebuzz')
 then raise exception 'Order already bound to another provider'; end if;

 if operation='bind' then
  if current_order->>'paymentEnvironment' is not null and current_order->>'paymentEnvironment' is distinct from value->>'environment'
  then raise exception 'Order belongs to another payment environment'; end if;
  if not coalesce(value->>'txnid' ~ '^[A-Za-z0-9_-]{3,45}$' and value->>'environment' in ('live','test')
   and jsonb_typeof(value->'amountPaise')='number' and (value->>'amountPaise')::numeric=verified_amount_paise
   and length(value->>'policyVersion') between 1 and 200 and length(value->>'policyAcceptedAt') between 1 and 100,false)
  then raise exception 'Easebuzz binding mismatch'; end if;
  perform (value->>'policyAcceptedAt')::timestamptz;
  select * into binding from public.easebuzz_bindings b where b.store_order_id=oid;
  if found then
   if binding.txnid<>value->>'txnid' or binding.environment<>value->>'environment' or binding.amount_paise<>verified_amount_paise
    or current_order->>'easebuzzTxnId' is distinct from binding.txnid
    or current_order->>'paymentProvider' is distinct from 'Easebuzz'
    or current_order->>'paymentEnvironment' is distinct from binding.environment
   then raise exception 'Easebuzz binding mismatch'; end if;
   -- Immutable replay also tolerates payment completing during an initiation retry.
   return current_order;
  end if;
  if current_order->>'easebuzzTxnId' is not null or current_order->>'transactionId' is not null
   or current_order->>'paymentId' is not null
   or not coalesce(current_order->>'paymentStatus' in ('PENDING','FAILED'),false)
   or coalesce(current_order->>'status','') in ('REFUNDED','REVOKED','CANCELLED')
   or current_order->>'deliveryStatus'='REVOKED'
  then raise exception 'Order is not payable'; end if;
  insert into public.easebuzz_bindings(environment,txnid,store_order_id,amount_paise)
   values(value->>'environment',value->>'txnid',oid,verified_amount_paise) on conflict do nothing;
  if not exists(select 1 from public.easebuzz_bindings b where b.environment=value->>'environment'
   and b.txnid=value->>'txnid' and b.store_order_id=oid and b.amount_paise=verified_amount_paise)
  then raise exception 'Duplicate Easebuzz binding'; end if;
  current_order := current_order || jsonb_build_object('easebuzzTxnId',value->>'txnid','paymentProvider','Easebuzz',
   'paymentEnvironment',value->>'environment','paymentInitiatedAt',now_text,
   'policyVersion',value->>'policyVersion','policyAcceptedAt',value->>'policyAcceptedAt');
 else
  if not coalesce(value->>'txnid' ~ '^[A-Za-z0-9_-]{3,45}$' and value->>'id' ~ '^[A-Za-z0-9_-]{1,100}$'
   and value->>'environment' in ('live','test') and value->>'currency'='INR'
   and value->>'status' in ('success','failure','pending') and jsonb_typeof(value->'amount')='number'
   and (value->>'amount')::numeric=verified_amount_paise and jsonb_typeof(value->'refundedPaise')='number'
   and (value->>'refundedPaise')::numeric=trunc((value->>'refundedPaise')::numeric)
   and (value->>'refundedPaise')::numeric between 0 and verified_amount_paise
   and current_order->>'easebuzzTxnId'=value->>'txnid' and current_order->>'paymentProvider'='Easebuzz'
   and current_order->>'paymentEnvironment'=value->>'environment',false)
  then raise exception 'Easebuzz payment mismatch'; end if;
  select * into binding from public.easebuzz_bindings b where b.store_order_id=oid;
  if not found or binding.txnid<>value->>'txnid' or binding.environment<>value->>'environment' or binding.amount_paise<>verified_amount_paise
  then raise exception 'Easebuzz binding mismatch'; end if;
  select * into previous_row from public.easebuzz_payments p where p.environment=value->>'environment' and p.payment_id=value->>'id';
  if found and (previous_row.store_order_id<>oid or previous_row.txnid<>binding.txnid or previous_row.amount_paise<>verified_amount_paise)
  then raise exception 'Easebuzz payment already belongs to another order'; end if;
  if (value->>'refundedPaise')::bigint>0 and value->>'status'<>'success' and coalesce(previous_row.status,'')<>'success'
  then raise exception 'Easebuzz refund requires a verified successful payment'; end if;
  payment_status := case when previous_row.status='success' then 'success' else value->>'status' end;
  verified_refunded_paise := greatest(coalesce(previous_row.refunded_paise,0),(value->>'refundedPaise')::bigint);
  previous_payment := current_order #> array['payments',value->>'id'];
  payment := jsonb_build_object('id',value->>'id','txnid',binding.txnid,'amount',verified_amount_paise,'currency','INR',
   'environment',binding.environment,'status',payment_status,'refundedPaise',verified_refunded_paise,
   'verifiedAt',case when previous_row.status=payment_status and previous_row.refunded_paise=verified_refunded_paise
    then coalesce(previous_payment->>'verifiedAt',now_text) else now_text end);
  if previous_payment=payment then return current_order; end if;
  insert into public.easebuzz_payments(environment,payment_id,txnid,store_order_id,amount_paise,currency,status,refunded_paise,verified_at)
   values(binding.environment,value->>'id',binding.txnid,oid,verified_amount_paise,'INR',payment_status,verified_refunded_paise,(payment->>'verifiedAt')::timestamptz)
   on conflict(environment,payment_id) do update set status=excluded.status,refunded_paise=excluded.refunded_paise,verified_at=excluded.verified_at;
  current_order := public.store_set(current_order,array['payments',value->>'id'],payment);
  event_key := (value->>'id')||'_'||payment_status||'_'||verified_refunded_paise;
  if current_order #> array['paymentHistory',event_key] is null then
   current_order := public.store_set(current_order,array['paymentHistory',event_key],payment);
  end if;
  current_order := current_order || jsonb_build_object('latestPaymentStatus',payment_status,'lastPaymentAttemptStatus',payment_status);
  live := binding.environment='live';
  if current_order->>'transactionId' is not null and current_order->>'transactionId'<>value->>'id' and payment_status='success' then
   current_order := current_order || jsonb_build_object('duplicatePaymentReview',true);
  end if;
  if verified_refunded_paise>0 then
   current_order := current_order || jsonb_build_object('transactionId',coalesce(current_order->>'transactionId',value->>'id'),
    'paymentId',coalesce(current_order->>'paymentId',value->>'id'),'paymentVerifiedAt',coalesce(current_order->>'paymentVerifiedAt',now_text),
    'status',case when verified_refunded_paise>=verified_amount_paise or current_order->>'paymentStatus'='REFUNDED' then 'REFUNDED' else 'PARTIALLY_REFUNDED' end,
    'paymentStatus',case when verified_refunded_paise>=verified_amount_paise or current_order->>'paymentStatus'='REFUNDED' then 'REFUNDED' else 'PARTIALLY_REFUNDED' end,
    'deliveryStatus','REVOKED','downloadStatus','UNAVAILABLE','fulfillmentStatus','REVOKED',
    'refundedAmount',greatest(coalesce((current_order->>'refundedAmount')::numeric,0),verified_refunded_paise::numeric/100),
    'refundVerifiedAt',now_text);
   -- Without reviewed allocation, any verified refund conservatively closes this order's access.
   items := '[]'::jsonb;
   for item in select * from jsonb_array_elements(current_order->'items') loop
    item := item || jsonb_build_object('accessStatus','restricted','downloadStatus','REVOKED');
    items := items || jsonb_build_array(item);
    pid := 'pur_'||oid||'_'||(item->>'productId');
    purchase := doc #> array['purchases',pid];
    if purchase is not null then
     purchase := purchase || jsonb_build_object('accessStatus','restricted');
     doc := public.store_set(doc,array['purchases',pid],purchase);
     doc := public.store_set(doc,array['users',uid,'purchases',pid],purchase);
     doc := public.store_set(doc,array['users',uid,'downloads',pid],coalesce(doc #> array['users',uid,'downloads',pid],purchase)
      || jsonb_build_object('id',pid,'downloadId',pid,'status','UNAVAILABLE'));
    end if;
   end loop;
   current_order := current_order || jsonb_build_object('items',items);
  elsif payment_status='success' and current_order->>'transactionId' is null
   and current_order->>'paymentStatus' in ('PENDING','FAILED')
   and coalesce(current_order->>'status','') not in ('REFUNDED','PARTIALLY_REFUNDED','REVOKED','CANCELLED') then
   access_allowed := live and coalesce(current_order->>'deliveryStatus','')<>'REVOKED' and coalesce(current_order->>'accessReview','')<>'required';
   current_order := current_order || jsonb_build_object('transactionId',value->>'id','paymentId',value->>'id',
    'paymentStatus','PAID','status','PAID','orderStatus','COMPLETED','paymentVerifiedAt',now_text,
    'deliveredAt',case when access_allowed then now_text else null end,
    'deliveryStatus',case when access_allowed then 'DELIVERED' when live then 'REVOKED' else 'TEST_ONLY' end,
    'downloadStatus',case when access_allowed then 'AVAILABLE' else 'UNAVAILABLE' end,
    'fulfillmentStatus',case when access_allowed then 'READY' when live then 'REVOKED' else 'TEST_ONLY' end);
   if access_allowed then
    for item in select * from jsonb_array_elements(current_order->'items') loop
     pid := 'pur_'||oid||'_'||(item->>'productId');
     purchase := doc #> array['purchases',pid];
     if purchase is null then
      purchase := jsonb_build_object('purchaseId',pid,'userId',uid,'orderId',oid,'productId',item->>'productId',
       'productTitle',coalesce(item->>'productTitle',item->>'productId'),'accessStatus','active','purchasedAt',now_text,'deliveredAt',now_text);
      doc := public.store_set(doc,array['purchases',pid],purchase);
      doc := public.store_set(doc,array['users',uid,'purchases',pid],purchase);
      doc := public.store_set(doc,array['users',uid,'downloads',pid],purchase||jsonb_build_object('id',pid,'downloadId',pid,'status','AVAILABLE','createdAt',now_text));
     end if;
    end loop;
   end if;
  end if;
 end if;
 doc := public.store_set(doc,array['orders',oid],current_order);
 doc := public.store_set(doc,array['users',uid,'orders',oid],current_order);
 doc := public.store_set(doc,array['easebuzzTxnIndex',current_order->>'easebuzzTxnId'],to_jsonb(oid));
 update public.store_state set data=doc where id=true;
 return current_order;
end $$;
revoke all on function public.easebuzz_order_operation(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.easebuzz_order_operation(text,text,jsonb) to service_role;
