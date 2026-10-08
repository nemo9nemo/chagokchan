begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions, pg_catalog;
select plan(9);

select ok((select p.prosecdef and 'search_path=pg_catalog' = any(p.proconfig) and r.rolname = 'chagokchan_rpc'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and p.proname = 'list_bunches' and p.proargtypes = '2950 25 23'::oidvector),
  'list_bunches is a fixed-search-path SECURITY DEFINER RPC owned by the non-login RPC role');
select ok(has_function_privilege('authenticated','public.list_bunches(uuid,text,integer)','EXECUTE') and
  not has_function_privilege('anon','public.list_bunches(uuid,text,integer)','EXECUTE') and
  not has_function_privilege('service_role','public.list_bunches(uuid,text,integer)','EXECUTE'),
  'only authenticated sessions can invoke the role-scoped bunch list');
select ok(not has_table_privilege('anon','public.bunches','SELECT') and
  not has_table_privilege('authenticated','public.bunches','SELECT') and
  not has_table_privilege('service_role','public.bunches','SELECT'),
  'the bunch list RPC does not grant direct table reads');
select ok(has_column_privilege('chagokchan_rpc','public.bunches','id','SELECT') and
  has_column_privilege('chagokchan_rpc','public.bunches','cycle_no','SELECT') and
  has_column_privilege('chagokchan_rpc','public.bunches','completed_at','SELECT'),
  'RPC owner can read only the fields needed by the bunch summary');
select ok(not has_function_privilege('authenticated','private.encode_bunch_list_cursor(integer,uuid,uuid)','EXECUTE') and
  not has_function_privilege('authenticated','private.decode_bunch_list_cursor(text)','EXECUTE') and
  not has_function_privilege('anon','private.decode_bunch_list_cursor(text)','EXECUTE'),
  'internal board-bound cursor helpers are unavailable to client roles');
select is((private.decode_bunch_list_cursor(private.encode_bunch_list_cursor(9,
  '11111111-1111-4111-8111-111111111111'::uuid, '22222222-2222-4222-8222-222222222222'::uuid))->>0)::integer,
  9, 'bunch cursor preserves the last cycle number');
select is((private.decode_bunch_list_cursor(private.encode_bunch_list_cursor(9,
  '11111111-1111-4111-8111-111111111111'::uuid, '22222222-2222-4222-8222-222222222222'::uuid))->>2)::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid, 'bunch cursor is bound to its board');
select throws_ok($$ select private.decode_bunch_list_cursor('%%%') $$, 'PT400', 'invalid_cursor', 'malformed bunch cursors are rejected');
select ok(has_function_privilege('authenticated','public.complete_goal(uuid,integer)','EXECUTE') and
  has_function_privilege('authenticated','public.archive_goal(uuid,integer)','EXECUTE') and
  has_function_privilege('authenticated','public.resume_goal(uuid,integer)','EXECUTE') and
  has_function_privilege('authenticated','public.update_board(uuid,jsonb)','EXECUTE'),
  'goal transitions and owner board settings use their existing authenticated RPCs');

select * from finish();
rollback;
