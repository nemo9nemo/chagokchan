begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(5);

select ok((select prosecdef and 'search_path=pg_catalog'=any(proconfig) and r.rolname='chagokchan_rpc'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='public' and p.proname='list_my_shared_boards'),
  'shared board directory uses the restricted RPC owner and fixed search path');
select ok(has_function_privilege('authenticated','public.list_my_shared_boards(text,integer)','EXECUTE'),
  'authenticated sessions can list their shared board grants');
select ok(not has_function_privilege('anon','public.list_my_shared_boards(text,integer)','EXECUTE') and
  not has_function_privilege('service_role','public.list_my_shared_boards(text,integer)','EXECUTE'),
  'anonymous and service roles cannot invoke the session-scoped directory');
select ok((select prosrc ilike '%private.require_actor%' and prosrc ilike '%private.current_shared_board_member%' and
    prosrc ilike '%g.status <> ''deleted''%' and prosrc ilike '%bm.status = ''active''%' and
    prosrc ilike '%limit p_limit + 1%' and prosrc not ilike '%private_description%'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='list_my_shared_boards'),
  'directory filters by the current live grant and deleted goal state while using bounded keyset pages');
select ok(not has_schema_privilege('chagokchan_rpc','public','CREATE') and not has_schema_privilege('chagokchan_rpc','private','CREATE'),
  'RPC owner has no lingering schema creation privilege');

select * from finish();
rollback;
