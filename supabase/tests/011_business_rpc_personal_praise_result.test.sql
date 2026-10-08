begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions, pg_catalog;
select plan(6);

select ok((select p.prosecdef and 'search_path=pg_catalog' = any(p.proconfig) and r.rolname = 'chagokchan_rpc'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and p.proname = 'create_personal_praise' and p.proargtypes = '2950 2950 25 1082'::oidvector),
  'create_personal_praise is a fixed-search-path SECURITY DEFINER RPC owned by the non-login RPC role');
select ok(has_function_privilege('authenticated','public.create_personal_praise(uuid,uuid,text,date)','EXECUTE') and
  not has_function_privilege('anon','public.create_personal_praise(uuid,uuid,text,date)','EXECUTE') and
  not has_function_privilege('service_role','public.create_personal_praise(uuid,uuid,text,date)','EXECUTE'),
  'only authenticated sessions can invoke the personal-praise API result RPC');
select ok(not has_table_privilege('anon','public.praises','SELECT') and
  not has_table_privilege('authenticated','public.praises','SELECT') and
  not has_table_privilege('service_role','public.praises','SELECT'),
  'the result RPC does not grant direct praise table reads');
select ok(has_column_privilege('chagokchan_rpc','public.praises','bunch_id','SELECT') and
  has_column_privilege('chagokchan_rpc','public.praises','actor_user_id','SELECT') and
  has_column_privilege('chagokchan_rpc','public.praises','source','SELECT'),
  'the RPC owner can read only the fields needed to recover the created row cycle');
select ok(has_function_privilege('chagokchan_rpc','public.create_praise(uuid,uuid,text,date)','EXECUTE'),
  'the wrapper delegates the atomic write to the existing personal-praise transaction');
select ok(has_function_privilege('authenticated','public.create_praise(uuid,uuid,text,date)','EXECUTE') and
  not has_function_privilege('anon','public.create_praise(uuid,uuid,text,date)','EXECUTE'),
  'the original product RPC keeps its authenticated-only privilege boundary');

select * from finish();
rollback;
