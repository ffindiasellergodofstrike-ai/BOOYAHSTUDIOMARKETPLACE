-- Idempotent upgrade; preserves existing data. Back up before applying.
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

create or replace function public.store_operation(operation text, key text default '', value jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare doc jsonb; result jsonb; current_value jsonb; k text; v jsonb; parts text[]; item jsonb; uid text; oid text; pid text; now_text text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); live boolean; event_key text; previous_payment jsonb;
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
  if current_value is null or not coalesce(current_value->>'paymentStatus'='PAID' and current_value->>'paymentEnvironment'='live' and current_value->>'transactionId' is not null and coalesce((current_value->>'refundedAmount')::numeric,0)=0,false) then raise exception 'Order cannot be restored'; end if;
  if exists(select 1 from jsonb_each(coalesce(current_value->'disputes','{}')) as d(id,record) where d.record->>'payment_id'=current_value->>'transactionId' and d.record->>'status' not in ('won','closed')) then raise exception 'Dispute requires review'; end if;
  result:=current_value||jsonb_build_object('deliveryStatus','DELIVERED','downloadStatus','AVAILABLE','accessReview','resolved','accessRestoredAt',now_text);
  doc:=store_set(doc,parts,result); doc:=store_set(doc,array['users',result->>'userId','orders',result->>'id'],result);
 elsif operation='revoke_order' then
  result:=current_value||jsonb_build_object('deliveryStatus','REVOKED','downloadStatus','UNAVAILABLE'); doc:=store_set(doc,parts,result); doc:=store_set(doc,array['users',result->>'userId','orders',result->>'id'],result);
 else raise exception 'Unsupported operation'; end if;
 if operation in ('confirm_payment','record_dispute','revoke_order','restore_order_access') then
  for item in select * from jsonb_array_elements(coalesce(result->'items','[]')) loop
   pid:='pur_'||(result->>'id')||'_'||(item->>'productId');
   v:=doc #> array['purchases',pid];
   if v is not null then
    v:=v||jsonb_build_object('accessStatus',case when result->>'downloadStatus'='AVAILABLE' then 'active' else 'restricted' end);
    doc:=store_set(doc,array['purchases',pid],v); doc:=store_set(doc,array['users',result->>'userId','purchases',pid],v);
    doc:=store_set(doc,array['users',result->>'userId','downloads',pid],(doc #> array['users',result->>'userId','downloads',pid])||jsonb_build_object('status',result->>'downloadStatus'));
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
