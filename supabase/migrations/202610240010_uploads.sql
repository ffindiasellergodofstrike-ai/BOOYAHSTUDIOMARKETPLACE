-- Seller ZIPs stay in the existing PRIVATE products bucket. Direct browser
-- uploads use service-minted object-scoped signed URLs, not an anonymous policy.
-- The storage service rejects an object above 10 MiB before finalization.
-- Current Supabase already has this column. Avoid attempting an ALTER on its
-- managed Storage table when only an existing bucket setting needs updating.
do $$ begin
 if not exists(select 1 from pg_attribute where attrelid='storage.buckets'::regclass and attname='file_size_limit' and not attisdropped) then
  alter table storage.buckets add column file_size_limit bigint;
 end if;
end $$;
update storage.buckets set public = false, file_size_limit = 10485760 where id = 'products';
-- No public INSERT/SELECT policy is created. The service-role RPC and Storage
-- access remain server-only; download links are short-lived and authenticated.
