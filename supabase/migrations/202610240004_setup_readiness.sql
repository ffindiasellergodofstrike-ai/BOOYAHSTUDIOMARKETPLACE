-- Service-only, read-only deployment diagnostics. Returns booleans, never users,
-- payment state, bank details or credentials. Apply before/after 011; call after all migrations.
create or replace function public.marketplace_setup_status()
returns jsonb language plpgsql stable security definer set search_path = public,pg_temp as $$
declare creator_rpc regprocedure; product_bucket record; catalog_version text;
begin
 creator_rpc := to_regprocedure('public.marketplace_operation(text,text,jsonb)');
 select public, file_size_limit into product_bucket from storage.buckets where id='products';
 select data->>'creatorCatalogVersion' into catalog_version from public.marketplace_billing_state where id=true;
 return jsonb_build_object(
  'storeRpc',to_regprocedure('public.store_operation(text,text,jsonb)') is not null,
  'creatorRpc',creator_rpc is not null,
  'subscriptionRpc',to_regprocedure('public.subscription_operation(text,text,jsonb)') is not null,
  'settlementRpc',to_regprocedure('public.settlement_operation(text,text,jsonb)') is not null,
  'monthlyQuotaRpc',to_regprocedure('public.marketplace_claim_listing_quota(jsonb,text,text,jsonb)') is not null,
  'monthlyQuotaEnforced',coalesce(position('marketplace_claim_listing_quota' in pg_get_functiondef(creator_rpc))>0,false),
  'creatorCatalogV2',coalesce(catalog_version='2',false),
  'privateProductBucket',coalesce(product_bucket.public=false,false),
  'tenMbObjectLimit',coalesce(product_bucket.file_size_limit=10485760,false)
 );
end $$;
revoke all on function public.marketplace_setup_status() from public, anon, authenticated;
grant execute on function public.marketplace_setup_status() to service_role;
