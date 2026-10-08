begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions, pg_catalog;
select plan(9);

select ok((select p.prosecdef and 'search_path=pg_catalog' = any(p.proconfig) and r.rolname = 'chagokchan_rpc'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and p.proname = 'list_goals' and p.proargtypes = '25 23 25'::oidvector),
  'list_goals is a fixed-search-path SECURITY DEFINER RPC owned by the non-login RPC role');
select ok(has_function_privilege('authenticated','public.list_goals(text,integer,text)','EXECUTE') and
  not has_function_privilege('anon','public.list_goals(text,integer,text)','EXECUTE') and
  not has_function_privilege('service_role','public.list_goals(text,integer,text)','EXECUTE'),
  'only authenticated sessions can invoke the owner goal list');
select ok(not has_table_privilege('anon','public.goals','SELECT') and
  not has_table_privilege('authenticated','public.goals','SELECT') and
  not has_table_privilege('service_role','public.goals','SELECT'),
  'goal list RPC does not grant direct goal table reads');
select ok(has_column_privilege('chagokchan_rpc','public.goals','id','SELECT') and
  has_column_privilege('chagokchan_rpc','public.goals','private_description','SELECT') and
  has_column_privilege('chagokchan_rpc','public.goals','archived_at','SELECT'),
  'RPC owner has only the summary columns required by the existing goal projection');
select ok(not has_function_privilege('authenticated','private.encode_goal_list_cursor(timestamptz,uuid,text)','EXECUTE') and
  not has_function_privilege('authenticated','private.decode_goal_list_cursor(text)','EXECUTE') and
  not has_function_privilege('anon','private.decode_goal_list_cursor(text)','EXECUTE'),
  'internal filter-bound cursor helpers are unavailable to client roles');
select ok((select not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole
  from pg_roles where rolname = 'chagokchan_rpc'), 'RPC owner keeps RLS and cannot administer the database');

select is((private.decode_goal_list_cursor(private.encode_goal_list_cursor('2026-10-08T00:00:00Z'::timestamptz,
  '11111111-1111-4111-8111-111111111111'::uuid, null))->>0)::timestamptz,
  '2026-10-08T00:00:00Z'::timestamptz, 'unfiltered goal cursor preserves the timestamp');
select is(private.decode_goal_list_cursor(private.encode_goal_list_cursor('2026-10-08T00:00:00Z'::timestamptz,
  '11111111-1111-4111-8111-111111111111'::uuid, 'active'))->>2, 'active', 'filtered cursor encodes its list filter');
select throws_ok($$ select private.decode_goal_list_cursor('%%%') $$, 'PT400', 'invalid_cursor', 'malformed cursors are rejected');

select * from finish();
rollback;
