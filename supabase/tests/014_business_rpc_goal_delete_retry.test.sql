begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(5);

select ok((select prosecdef and 'search_path=pg_catalog'=any(proconfig) and r.rolname='chagokchan_rpc'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='public' and p.proname='delete_goal'),
  'delete_goal retry remains owned by the restricted RPC role with a fixed search path');
select ok(has_function_privilege('authenticated','public.delete_goal(uuid,integer)','EXECUTE'),
  'authenticated sessions can use the goal deletion RPC');
select ok(not has_function_privilege('anon','public.delete_goal(uuid,integer)','EXECUTE') and
  not has_function_privilege('service_role','public.delete_goal(uuid,integer)','EXECUTE'),
  'anonymous and service roles cannot invoke the user-scoped delete RPC');
select ok((select position('if current_goal.status = ''deleted'' then return' in lower(prosrc)) > 0 and
    position('if current_goal.status = ''deleted'' then return' in lower(prosrc)) <
    position('if current_goal.revision <> p_expected_revision' in lower(prosrc))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='delete_goal'),
  'an already deleted goal replays before comparing the original revision');
select ok(not has_schema_privilege('chagokchan_rpc','public','CREATE') and
  not has_schema_privilege('chagokchan_rpc','private','CREATE'),
  'the restricted RPC owner has no lingering schema creation privilege');

select * from finish();
rollback;
