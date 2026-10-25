-- Apply after 202610230004_subscriptions.sql and before 202610240011_creator_marketplace.sql.
-- Versioned offers never rewrite an accepted subscription's plan/price snapshot.
do $$
declare data_value jsonb; plan_value jsonb; legacy_id text;
begin
 select data into data_value from public.marketplace_billing_state where id=true for update;
 if coalesce(data_value->>'creatorCatalogVersion','') <> '2' then
  foreach legacy_id in array array['starter','creator','studio'] loop
   if data_value #> array['plans',legacy_id] is not null then
    data_value:=jsonb_set(data_value,array['plans',legacy_id,'published'],'false'::jsonb,false);
   end if;
  end loop;
  data_value:=jsonb_set(data_value,'{creatorCatalogVersion}','2'::jsonb,true);
 end if;
 plan_value:='{"id":"creator_monthly_499","name":"Creator","description":"Your storefront, with ten new digital products each paid month.","audience":"creator","amount":499,"currency":"INR","interval":"month","billingMode":"manual","published":true,"productLimit":10,"productQuota":"billing_period_creations","catalogVersion":2,"featureAccess":{"storefront":true,"secureDownloads":true,"orderManagement":true,"customerMemberships":false,"advancedAnalytics":false},"features":["10 new products per paid monthly period","Your own shareable storefront","Private files and protected downloads","Orders and basic earnings","INR20 platform fee per item sold"]}'::jsonb;
 if data_value #> array['plans',plan_value->>'id'] is null then data_value:=jsonb_set(data_value,array['plans',plan_value->>'id'],plan_value,true); end if;
 plan_value:='{"id":"studio_monthly_899","name":"Studio","description":"Unlimited product creations and every creator feature.","audience":"creator","amount":899,"currency":"INR","interval":"month","billingMode":"manual","published":true,"productLimit":null,"productQuota":"billing_period_creations","catalogVersion":2,"featureAccess":{"storefront":true,"secureDownloads":true,"orderManagement":true,"customerMemberships":true,"advancedAnalytics":true},"features":["Unlimited product creations per paid monthly period","Everything in Creator","Customer membership offers","Advanced sales analytics","10 MB maximum per product file","INR20 platform fee per item sold"]}'::jsonb;
 if data_value #> array['plans',plan_value->>'id'] is null then data_value:=jsonb_set(data_value,array['plans',plan_value->>'id'],plan_value,true); end if;
 update public.marketplace_billing_state set data=data_value where id=true;
end $$;

-- The caller holds store_state FOR UPDATE and writes the returned document in
-- that same transaction. The receipt is rechecked against durable billing data;
-- a caller-supplied quota, browser plan name or test payment is not an entitlement.
create or replace function public.marketplace_claim_listing_quota(doc jsonb, user_id text, listing_id text, quota jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare billing jsonb; subscription_value jsonb; plan_value jsonb; period_value jsonb; candidate jsonb;
 quota_limit_value jsonb; quota_kind text; subscription_id text; payment_id text; quota_key text; record_value jsonb; created_count bigint; quota_limit bigint; active_count bigint;
begin
 if user_id !~ '^[A-Za-z0-9_-]{1,100}$' or listing_id !~ '^mk_[a-f0-9]{32}$' or jsonb_typeof(quota)<>'object' then raise exception 'A verified paid creator plan is required'; end if;
 subscription_id:=quota->>'subscriptionId'; payment_id:=quota->>'paymentId';
 if coalesce(subscription_id,'') !~ '^[A-Za-z0-9_-]{1,100}$' or coalesce(payment_id,'') !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'A verified paid creator plan is required'; end if;
 select data into billing from public.marketplace_billing_state where id=true for share;
 subscription_value:=billing #> array['subscriptions',subscription_id]; plan_value:=subscription_value->'plan';
 if not coalesce(subscription_value->>'userId'=user_id and subscription_value->>'environment'='live' and plan_value->>'audience'='creator' and
   (plan_value->>'amount')::numeric>0 and subscription_value->>'providerRef' is not null,false) then raise exception 'A verified paid creator plan is required'; end if;
 period_value:=subscription_value #> array['payments',payment_id];
 if not coalesce(period_value->>'id'=payment_id and period_value->>'verified'='true' and period_value->>'revoked'='false' and
   period_value->>'subscriptionRef'=subscription_value->>'providerRef' and period_value->>'currency'='INR' and
   (period_value->>'amountPaise')::bigint=round((plan_value->>'amount')::numeric*100) and
   (period_value->>'periodStart')::timestamptz <= clock_timestamp() and (period_value->>'periodEnd')::timestamptz>clock_timestamp() and
   quota->>'periodStart'=period_value->>'periodStart' and quota->>'periodEnd'=period_value->>'periodEnd',false) then raise exception 'A current verified paid billing period is required'; end if;
 quota_key:=subscription_id||'_'||payment_id;
 if quota->>'quotaKey' is distinct from quota_key then raise exception 'Creator quota period mismatch'; end if;
 if plan_value ? 'monthlyProductLimit' then
  quota_limit_value:=plan_value->'monthlyProductLimit'; quota_kind:='billing_period_creations';
 else
  quota_limit_value:=plan_value->'productLimit'; quota_kind:=coalesce(plan_value->>'productQuota','active_listings');
 end if;
 if jsonb_typeof(quota_limit_value) is null or jsonb_typeof(quota_limit_value) not in ('number','null') then raise exception 'Invalid creator product limit'; end if;
 if jsonb_typeof(quota_limit_value)='null' then
  if not coalesce(quota->>'unlimited'='true' and jsonb_typeof(quota->'productLimit')='null',false) then raise exception 'Creator quota mismatch'; end if;
  quota_limit:=null;
 else
  if jsonb_typeof(quota_limit_value)<>'number' or (quota_limit_value #>> '{}')::numeric<>trunc((quota_limit_value #>> '{}')::numeric) then raise exception 'Invalid creator product limit'; end if;
  quota_limit:=(quota_limit_value #>> '{}')::bigint;
  if quota_limit<1 or quota_limit>10000 or jsonb_typeof(quota->'productLimit') is distinct from 'number' or (quota->>'productLimit')::bigint<>quota_limit or coalesce((quota->>'unlimited')::boolean,false) then raise exception 'Creator quota mismatch'; end if;
 end if;
 record_value:=coalesce(doc #> array['marketplace','listingCreations',user_id,quota_key],'{}'::jsonb);
 if record_value #> array['listingIds',listing_id] is not null then return doc; end if;
 created_count:=coalesce((record_value->>'created')::bigint,0);
 if created_count<0 then raise exception 'Invalid creator quota counter'; end if;
 if quota_kind='billing_period_creations' then
  if quota_limit is not null and created_count>=quota_limit then raise exception 'Creator monthly product creation limit reached'; end if;
 else
  -- Historical paid plans retain the active-listing limit they were sold with.
  select count(*) into active_count from jsonb_each(coalesce(doc #> array['marketplace','listings'],'{}')) l where l.value->>'sellerId'=doc #>> array['marketplace','creatorUsers',user_id] and l.value->>'status'<>'archived';
  if quota_limit is not null and active_count>=quota_limit then raise exception 'Creator plan product limit reached'; end if;
 end if;
 record_value:=record_value||jsonb_build_object('subscriptionId',subscription_id,'paymentId',payment_id,'planId',plan_value->>'id','periodStart',period_value->>'periodStart','periodEnd',period_value->>'periodEnd','created',created_count+1,
  'listingIds',coalesce(record_value->'listingIds','{}'::jsonb)||jsonb_build_object(listing_id,to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
 return public.store_set(doc,array['marketplace','listingCreations',user_id,quota_key],record_value);
end $$;
revoke all on function public.marketplace_claim_listing_quota(jsonb,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.marketplace_claim_listing_quota(jsonb,text,text,jsonb) to service_role;
