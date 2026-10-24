-- Durable, service-role-only subscription ledger. Separate from product purchases.
-- No browser/status flag can manufacture paid periods. Each mutation locks the ledger.
create table if not exists public.marketplace_billing_state (
 id boolean primary key default true check(id),
 data jsonb not null default '{"plans":{},"subscriptions":{},"payments":{},"events":{}}'::jsonb
);
insert into public.marketplace_billing_state(id) values(true) on conflict do nothing;
alter table public.marketplace_billing_state enable row level security;
revoke all on public.marketplace_billing_state from public, anon, authenticated;
grant all on public.marketplace_billing_state to service_role;
create or replace function public.subscription_operation(operation text, key text default '', value jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb; d jsonb; p jsonb; r jsonb; old jsonb; v jsonb; pid text; target text; item jsonb; payment_key text; ends timestamptz; starts timestamptz; plan_actor text; plan_note text; audit_key text;
begin
 select data into s from public.marketplace_billing_state where id=true for update;
 if operation='state' then return s; end if;
 if key !~ '^[A-Za-z0-9_-]{1,120}$' then raise exception 'Invalid billing key'; end if;
 if operation in ('plan','seed_plan','save_plan') then
  old=s#>array['plans',key];
  if operation='seed_plan' and old is not null then return old; end if;
  if operation='save_plan' then
   plan_actor=value->>'actorId';plan_note=value->>'reason';audit_key=value->>'auditId';value=value->'plan';
   if coalesce(plan_actor,'')='' or length(coalesce(plan_note,''))<10 or audit_key !~ '^[A-Za-z0-9_-]{1,100}$' or s#>array['audit',audit_key] is not null then raise exception 'Invalid plan audit'; end if;
  end if;
  if jsonb_typeof(value) <> 'object' or value->>'id' <> key or value->>'audience' not in ('creator','customer')
    or value->>'currency' <> 'INR' or value->>'interval' not in ('month','year') or value->>'billingMode' not in ('manual','automatic')
    or (value->>'amount')::numeric < 0 or (value->>'amount')::numeric >100000 or (value->>'amount')::numeric*100<>round((value->>'amount')::numeric*100) then raise exception 'Invalid plan'; end if;
  old=s#>array['plans',key];
  if old is not null and (old->>'audience' <> value->>'audience' or coalesce(old->>'creatorId','') <> coalesce(value->>'creatorId','')) then raise exception 'Plan ownership is immutable'; end if;
  s=jsonb_set(s,array['plans',key],value,true); r=value;
  if operation='save_plan' then s=jsonb_set(s,'{audit}',coalesce(s->'audit','{}'::jsonb)||jsonb_build_object(audit_key,jsonb_build_object('id',audit_key,'actorId',plan_actor,'action','plan_changed','planId',key,'reason',plan_note,'previous',old,'current',value,'createdAt',clock_timestamp())),true); end if;
 elsif operation='reserve' then
  old=s#>array['subscriptions',key];
  if old is not null then return old; end if;
  p=s#>array['plans',value->>'planId'];
  if p is null or p->>'published' <> 'true' or (p->>'amount')::numeric <= 0 then raise exception 'Plan is unavailable'; end if;
  if value ? 'expectedPlan' and value->'expectedPlan' is distinct from p then raise exception 'Plan changed before checkout'; end if;
  if value->>'provider' not in ('cashfree','razorpay','easebuzz') or value->>'environment' not in ('live','test') or coalesce(value->>'userId','')='' then raise exception 'Invalid subscription'; end if;
  -- Serialize duplicate starts. A second tab reuses the existing pending mandate.
  for item in select val from jsonb_each(s->'subscriptions') as q(k,val) loop
   if item->>'userId'=value->>'userId' and item->>'planId'=p->>'id' and item->>'environment'=value->>'environment' and item->>'status' in ('pending','active','cancel_scheduled','creation_uncertain')
    and coalesce(item->>'cancelAtPeriodEnd','false') <> 'true' then return item; end if;
  end loop;
  d=(value-'expectedPlan') || jsonb_build_object('id',key,'plan',p,'status','pending','cancelAtPeriodEnd',false,'payments','{}'::jsonb,'attempts','{}'::jsonb);
  s=jsonb_set(s,array['subscriptions',key],d,true); r=d;
 elsif operation='event' then
  old=s#>array['events',key];
  if old is not null then return old; end if;
  r=value || jsonb_build_object('id',key,'status','pending');
  s=jsonb_set(s,array['events',key],r,true);
 elsif operation='event_done' then
  old=s#>array['events',key]; if old is null then raise exception 'Unknown event'; end if;
  r=old || jsonb_build_object('status','done','processedAt',value->>'processedAt'); s=jsonb_set(s,array['events',key],r,true);
 elsif operation='audit' then
  if coalesce(value->>'actorId','')='' or coalesce(value->>'reason','')='' or value->>'action' not in ('subscription_reconcile','subscription_cancel') or s#>array['subscriptions',value->>'subscriptionId'] is null then raise exception 'Invalid billing audit'; end if;
  if s#>array['audit',key] is not null then raise exception 'Audit record is immutable'; end if;
  r=value || jsonb_build_object('id',key);
  s=jsonb_set(s,'{audit}',coalesce(s->'audit','{}'::jsonb)||jsonb_build_object(key,r),true);
 else
  d=s#>array['subscriptions',key]; if d is null then raise exception 'Unknown subscription'; end if;
  p=d->'plan';
  if operation='claim_checkout' then
   if (d->>'checkoutLeaseUntil')::timestamptz>now() then return null; end if;
   -- A crashed/timed-out native request may already have created a mandate.
   if d->>'checkoutLeaseUntil' is not null and d->>'providerRef' is null and p->>'billingMode'='automatic' then
    d=d || jsonb_build_object('status','creation_uncertain');
   end if;
   d=d || jsonb_build_object('checkoutLeaseUntil',value->>'leaseUntil');
  elsif operation='acceptance' then
   if value->>'acceptedBy' is distinct from d->>'userId' or coalesce(value->>'policyVersion','')='' or value->>'id' !~ '^[A-Za-z0-9_-]{1,100}$'
    or (value->>'acceptedAt')::timestamptz is null or abs(extract(epoch from now()-(value->>'acceptedAt')::timestamptz))>300
    or value#>>'{offer,id}' is distinct from p->>'id' or value#>>'{offer,currency}' is distinct from p->>'currency'
    or (value#>>'{offer,amount}')::numeric is distinct from (p->>'amount')::numeric
    or value#>>'{offer,interval}' is distinct from p->>'interval' or value#>>'{offer,billingMode}' is distinct from p->>'billingMode'
    then raise exception 'Billing agreement does not match this offer'; end if;
   if d#>array['acceptances',value->>'id'] is not null then raise exception 'Agreement receipt is immutable'; end if;
   d=jsonb_set(d,'{acceptances}',coalesce(d->'acceptances','{}'::jsonb)||jsonb_build_object(value->>'id',value),true);
   d=d || jsonb_build_object('lastAcceptanceId',value->>'id');
  elsif operation='release_checkout' then
   d=d - 'checkoutLeaseUntil';
  elsif operation='bind' then
   if coalesce(value->>'providerRef','')='' then raise exception 'Missing provider reference'; end if;
   if d->>'providerRef' is not null and d->>'providerRef' <> value->>'providerRef' then raise exception 'Provider binding is immutable'; end if;
   for item in select val from jsonb_each(s->'subscriptions') as q(k,val) loop
    if item->>'id'<>key and item->>'provider'=d->>'provider' and item->>'environment'=d->>'environment' and item->>'providerRef'=value->>'providerRef' then raise exception 'Provider reference already bound'; end if;
   end loop;
   d=d || jsonb_strip_nulls(jsonb_build_object('providerRef',value->>'providerRef','providerPlanId',value->>'providerPlanId','checkout',value->'checkout','firstChargeAt',value->>'firstChargeAt'));
   if d->>'status'='creation_uncertain' then d=d || jsonb_build_object('status','pending'); end if;
  elsif operation='attempt' then
   if p->>'billingMode'<>'manual' or d->>'cancelAtPeriodEnd'='true' then raise exception 'Renewal unavailable'; end if;
   for item in select val from jsonb_each(d->'attempts') as q(k,val) loop
    if item->>'status'='pending' and (item->>'createdAt')::timestamptz > now()-interval '24 hours' then return item; end if;
   end loop;
   if value->>'id' !~ '^[A-Za-z0-9_-]{1,80}$' then raise exception 'Invalid attempt'; end if;
   starts=greatest(now(), coalesce((select max((pay->>'periodEnd')::timestamptz) from jsonb_each(d->'payments') as q(k,pay) where pay->>'verified'='true' and pay->>'revoked'<>'true'),now()));
   ends=starts+case when p->>'interval'='year' then interval '1 year' else interval '1 month' end;
   r=value || jsonb_build_object('periodStart',starts,'periodEnd',ends,'status','pending','acceptanceId',d->>'lastAcceptanceId');
   d=jsonb_set(d,array['attempts',value->>'id'],r,true);
  elsif operation='attempt_bind' then
   old=d#>array['attempts',value->>'id']; if old is null then raise exception 'Unknown attempt'; end if;
   if old->>'providerRef' is not null and old->>'providerRef'<>value->>'providerRef' then raise exception 'Attempt binding is immutable'; end if;
   old=old || (value - 'periodStart' - 'periodEnd' - 'status');
   d=jsonb_set(d,array['attempts',value->>'id'],old,true); r=old;
  elsif operation='uncertain' then
   if d->>'providerRef' is null then d=d || jsonb_build_object('status','creation_uncertain'); end if;
  elsif operation='cancel' then
   d=d || jsonb_build_object('cancelAtPeriodEnd',true,'status','cancel_scheduled','cancelledAt',value->>'cancelledAt');
  elsif operation='snapshot' then
   if value->>'provider' is distinct from d->>'provider' or value->>'environment' is distinct from d->>'environment' or value->>'providerRef' is distinct from d->>'providerRef' then raise exception 'Subscription provider mismatch'; end if;
   if jsonb_typeof(value->'payments')<>'array' or jsonb_typeof(value->'revocations')<>'array' then raise exception 'Invalid billing snapshot'; end if;
   for v in select val from jsonb_array_elements(value->'payments') as q(val) loop
    pid=v->>'id'; payment_key=(d->>'provider')||'_'||(d->>'environment')||'_'||pid;
    if coalesce(pid,'') !~ '^[A-Za-z0-9_-]{1,100}$' or v->>'subscriptionRef' is distinct from d->>'providerRef' or v->>'currency' is distinct from 'INR' or (v->>'amountPaise')::numeric is distinct from round((p->>'amount')::numeric*100) then raise exception 'Payment mismatch'; end if;
    starts=(v->>'periodStart')::timestamptz; ends=(v->>'periodEnd')::timestamptz;
    if starts is null or ends is null or ends<=starts or ends>starts+(case when p->>'interval'='year' then interval '367 days' else interval '32 days' end)
      or starts<(d->>'createdAt')::timestamptz-interval '5 minutes' then raise exception 'Invalid paid period'; end if;
    if v->>'attemptId' is not null then
     old=d#>array['attempts',v->>'attemptId'];
     if old is null or (old->>'periodStart')::timestamptz<>starts or (old->>'periodEnd')::timestamptz<>ends or old->>'providerRef'<>v->>'orderRef' then raise exception 'Renewal period mismatch'; end if;
     d=jsonb_set(d,array['attempts',v->>'attemptId'],old || jsonb_build_object('status','paid'),true);
    elsif p->>'billingMode'='manual' then raise exception 'Manual payment requires attempt'; end if;
    target=s#>>array['payments',payment_key]; if target is not null and target<>key then raise exception 'Payment already belongs to another subscription'; end if;
    old=d#>array['payments',pid];
    if old is not null and (old->>'periodStart'<>v->>'periodStart' or old->>'periodEnd'<>v->>'periodEnd' or old->>'amountPaise'<>v->>'amountPaise') then raise exception 'Paid period is immutable'; end if;
    d=jsonb_set(d,array['payments',pid],coalesce(old,v) || jsonb_build_object('verified',true,'revoked',coalesce((old->>'revoked')::boolean,false)),true);
    s=jsonb_set(s,array['payments',payment_key],to_jsonb(key),true);
   end loop;
   for v in select val from jsonb_array_elements(value->'revocations') as q(val) loop
    pid=v->>'paymentId'; old=d#>array['payments',pid];
    if old is null or coalesce(v->>'id','')='' then raise exception 'Unknown revoked payment'; end if;
    d=jsonb_set(d,array['payments',pid],old || jsonb_build_object('revoked',true,'revocation',v),true);
   end loop;
   d=d || jsonb_build_object('lastCheckedAt',value->>'checkedAt','providerStatus',value->>'providerStatus');
   if p->>'billingMode'='automatic' and upper(coalesce(value->>'providerStatus','')) in ('CANCELLED','CUSTOMER_CANCELLED','COMPLETED','EXPIRED','LINK_EXPIRED','CARD_EXPIRED') then d=d || jsonb_build_object('cancelAtPeriodEnd',true,'status','cancel_scheduled'); end if;
   -- Cancellation is monotonic. Paid receipts remain until their own expiry; no status extends them.
   if d->>'cancelAtPeriodEnd' <> 'true' then d=d || jsonb_build_object('status',case when exists(select 1 from jsonb_each(d->'payments') as q(k,pay) where pay->>'verified'='true' and pay->>'revoked'='false' and (pay->>'periodStart')::timestamptz<=now() and (pay->>'periodEnd')::timestamptz>now()) then 'active' else 'pending' end); end if;
  else raise exception 'Unknown subscription operation'; end if;
  s=jsonb_set(s,array['subscriptions',key],d,true); if r is null then r=d; end if;
 end if;
 update public.marketplace_billing_state set data=s where id=true;
 return r;
end $$;
revoke all on function public.subscription_operation(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.subscription_operation(text,text,jsonb) to service_role;
