-- Run only against a disposable database after the migration.
begin;
set local role service_role;
do $$
declare snapshot jsonb;
begin
 perform public.store_write('validation_user/u/profile','{"name":"Synthetic"}'::jsonb,'set');
 perform public.store_write('validation_user/u/credentials/passwordHash','"synthetic-hash"'::jsonb,'set');
 if public.store_read('validation_user/u/profile/name') <> '"Synthetic"'::jsonb then raise exception 'nested write failed'; end if;
 perform public.store_multiple('{"validation_order/o":{"status":"PAID"},"validation_user/u/orders/o":{"status":"PAID"}}'::jsonb);
 if public.store_read('validation_order/o') <> public.store_read('validation_user/u/orders/o') then raise exception 'mirrored order failed'; end if;
 snapshot:=public.store_snapshot('validation_order','o');
 if not public.store_compare_set('validation_order','o',(snapshot->>'version')::bigint,'{"status":"REFUNDED"}'::jsonb) then raise exception 'compare and set failed'; end if;
 if public.store_compare_set('validation_order','o',(snapshot->>'version')::bigint,'{"status":"PAID"}'::jsonb) then raise exception 'stale overwrite permitted'; end if;
 perform public.store_write('validation_user/u/credentials',null,'delete');
 if public.store_read('validation_user/u/credentials') is not null then raise exception 'nested delete failed'; end if;
 if public.store_read('validation_user/u/profile/name') <> '"Synthetic"'::jsonb then raise exception 'delete destroyed sibling'; end if;
 begin
  perform public.store_multiple('{"validation_order/o":{"status":"BAD"},"zz_invalid":42}'::jsonb);
  raise exception 'invalid transaction succeeded';
 exception when others then
  if public.store_read('validation_order/o/status') <> '"REFUNDED"'::jsonb then raise exception 'transaction rollback failed'; end if;
 end;
end $$;
reset role;
do $$
begin
 if has_table_privilege('anon','public.store_documents','SELECT') or has_table_privilege('authenticated','public.store_documents','SELECT') then raise exception 'public data exposure'; end if;
 if has_function_privilege('anon','public.store_read(text)','EXECUTE') or has_function_privilege('authenticated','public.store_compare_set(text,text,bigint,jsonb)','EXECUTE') then raise exception 'public function exposure'; end if;
 if not (select relrowsecurity from pg_class where oid='public.store_documents'::regclass) then raise exception 'RLS not enabled'; end if;
end $$;
rollback;
