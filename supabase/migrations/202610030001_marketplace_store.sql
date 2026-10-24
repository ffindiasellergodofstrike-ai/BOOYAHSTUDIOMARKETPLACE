-- Run in the Supabase SQL editor. No public/anonymous browser access is granted.
-- One versioned document per collection/id; existing order mirrors commit together.
create table if not exists public.store_documents (
  collection text not null, id text not null, data jsonb not null,
  version bigint not null default 1, updated_at timestamptz not null default now(),
  primary key (collection,id)
);
alter table public.store_documents enable row level security;
revoke all on public.store_documents from public, anon, authenticated;
grant all on public.store_documents to service_role;

create or replace function public.store_nested_set(doc jsonb, parts text[], val jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
begin
 if coalesce(array_length(parts,1),0)=0 then return val; end if;
 return jsonb_set(case when jsonb_typeof(doc)='object' then doc else '{}'::jsonb end,
   array[parts[1]],public.store_nested_set(coalesce(doc->parts[1],'{}'::jsonb),parts[2:],val),true);
end $$;
create or replace function public.store_read(p_path text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare parts text[] := string_to_array(trim(both '/' from p_path),'/'); result jsonb;
begin
 if array_length(parts,1)=1 then
  select jsonb_object_agg(id,data) into result from store_documents where collection=parts[1];
 else
  select data into result from store_documents where collection=parts[1] and id=parts[2];
  if array_length(parts,1)>2 then result := result #> parts[3:]; end if;
 end if;
 return result;
end $$;
create or replace function public.store_write(p_path text,p_data jsonb,p_mode text default 'set') returns jsonb
language plpgsql security invoker set search_path = public as $$
declare parts text[] := string_to_array(trim(both '/' from p_path),'/'); doc jsonb; existing jsonb; k text; v jsonb;
begin
 if parts[1] is null or parts[1]='' or p_mode not in ('set','patch','delete') then raise exception 'Invalid document operation'; end if;
 -- Collection writes are rare (setup/settings). All writes in a transaction lock in collection order.
 perform pg_advisory_xact_lock(hashtextextended(parts[1],0));
 if array_length(parts,1)=1 then
  if p_mode in ('set','delete') then delete from store_documents where collection=parts[1]; end if;
  if p_mode<>'delete' then
   if jsonb_typeof(p_data)<>'object' then raise exception 'Collection must be an object'; end if;
   for k,v in select * from jsonb_each(p_data) loop
    perform public.store_write(parts[1]||'/'||k,v,'set');
   end loop;
  end if;
  return p_data;
 end if;
 select data into doc from store_documents where collection=parts[1] and id=parts[2] for update;
 if array_length(parts,1)=2 then existing:=doc; else existing:=doc #> parts[3:]; end if;
 if p_mode='patch' then p_data:=coalesce(existing,'{}'::jsonb)||p_data; end if;
 if p_mode='delete' and array_length(parts,1)=2 then
  delete from store_documents where collection=parts[1] and id=parts[2]; return null;
 elsif p_mode='delete' then doc:=doc #- parts[3:];
 elsif array_length(parts,1)=2 then doc:=p_data;
 else doc:=public.store_nested_set(coalesce(doc,'{}'::jsonb),parts[3:],p_data);
 end if;
 if doc is null then return null; end if;
 insert into store_documents(collection,id,data) values(parts[1],parts[2],doc)
 on conflict(collection,id) do update set data=excluded.data,version=store_documents.version+1,updated_at=now();
 return p_data;
end $$;
create or replace function public.store_multiple(p_updates jsonb) returns boolean
language plpgsql security invoker set search_path = public as $$
declare k text; v jsonb; c text;
begin
 for c in select distinct split_part(key,'/',1) from jsonb_each(p_updates) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended(c,0));
 end loop;
 for k,v in select * from jsonb_each(p_updates) order by key loop
  perform public.store_write(k,v,case when v='null'::jsonb then 'delete' else 'set' end);
 end loop;
 return true;
end $$;
-- Optimistic concurrency for agreement, seller finance and payout state.
create or replace function public.store_snapshot(p_collection text,p_id text) returns jsonb
language sql security invoker set search_path = public as $$
 select coalesce((select jsonb_build_object('version',version,'data',data) from store_documents
 where collection=p_collection and id=p_id),jsonb_build_object('version',0,'data',null));
$$;
create or replace function public.store_compare_set(p_collection text,p_id text,p_version bigint,p_data jsonb) returns boolean
language plpgsql security invoker set search_path = public as $$
declare current_version bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_collection,0));
 select version into current_version from store_documents where collection=p_collection and id=p_id for update;
 if coalesce(current_version,0)<>p_version then return false; end if;
 perform public.store_write(p_collection||'/'||p_id,p_data,'set'); return true;
end $$;
-- PostgreSQL functions normally grant EXECUTE to PUBLIC; explicitly revoke it.
revoke all on function public.store_nested_set(jsonb,text[],jsonb) from public,anon,authenticated;
revoke all on function public.store_read(text) from public,anon,authenticated;
revoke all on function public.store_write(text,jsonb,text) from public,anon,authenticated;
revoke all on function public.store_multiple(jsonb) from public,anon,authenticated;
revoke all on function public.store_snapshot(text,text) from public,anon,authenticated;
revoke all on function public.store_compare_set(text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.store_nested_set(jsonb,text[],jsonb),public.store_read(text),public.store_write(text,jsonb,text),public.store_multiple(jsonb),public.store_snapshot(text,text),public.store_compare_set(text,text,bigint,jsonb) to service_role;
