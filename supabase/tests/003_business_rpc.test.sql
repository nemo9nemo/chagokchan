begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(18);

select ok((select count(*) = 6 and bool_and(p.prosecdef and 'search_path=pg_catalog' = any(p.proconfig) and r.rolname = 'chagokchan_rpc')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
  where (n.nspname = 'public' and p.proname in ('create_goal','complete_goal','archive_goal','resume_goal','update_goal','get_goal'))),
  'W06-B1 public goal RPCs are fixed-search-path SECURITY DEFINER owned by the non-login RPC role');
select ok((select not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole
  from pg_roles where rolname = 'chagokchan_rpc'), 'goal RPC owner retains RLS and cannot log in or administer roles');
select ok(has_function_privilege('authenticated','public.create_goal(uuid,text,text,smallint,jsonb)','EXECUTE') and
  has_function_privilege('authenticated','public.get_goal(uuid)','EXECUTE') and
  has_function_privilege('authenticated','public.update_goal(uuid,integer,text,text,boolean,boolean)','EXECUTE'),
  'authenticated may execute only the published owner goal entry points');
select ok((select bool_and(not has_function_privilege(role_name, signature, 'EXECUTE')) from (values
  ('anon','public.create_goal(uuid,text,text,smallint,jsonb)'),
  ('service_role','public.create_goal(uuid,text,text,smallint,jsonb)'),
  ('authenticated','private.transition_goal(uuid,integer,text)')) denied(role_name,signature)),
  'anonymous, service and authenticated roles cannot invoke public goal creation or its private transition helper');
select ok(not has_schema_privilege('chagokchan_rpc','public','CREATE') and not has_schema_privilege('chagokchan_rpc','private','CREATE'),
  'RPC owner holds no persistent schema CREATE privilege');
select ok(not has_table_privilege('anon','public.goals','SELECT,INSERT,UPDATE,DELETE') and
  not has_table_privilege('authenticated','public.goals','SELECT,INSERT,UPDATE,DELETE') and
  not has_table_privilege('service_role','public.goals','SELECT,INSERT,UPDATE,DELETE'),
  'client and service roles still cannot access goal rows directly');
select ok(has_column_privilege('chagokchan_rpc','public.goals','title','INSERT') and
  has_column_privilege('chagokchan_rpc','public.goals','status','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.goals','owner_user_id','UPDATE'),
  'goal RPC owner receives only the columns needed for creation and lifecycle');
select ok(not has_column_privilege('chagokchan_rpc','public.goals','deleted_at','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.goals','purge_after','UPDATE'),
  'W06-B goal RPC cannot modify fields reserved for W06-D deletion');
select ok(has_column_privilege('chagokchan_rpc','public.boards','kind','INSERT') and
  not has_table_privilege('chagokchan_rpc','public.boards','DELETE'),
  'goal RPC can create owner boards but cannot delete or rewrite them');
select ok(has_column_privilege('chagokchan_rpc','public.shared_board_profiles','public_title','INSERT') and
  not has_table_privilege('chagokchan_rpc','public.shared_board_profiles','DELETE'),
  'explicit shared profile insertion remains limited to owner RPCs');
select ok(has_column_privilege('chagokchan_rpc','public.request_receipts','input_hash','INSERT') and
  has_column_privilege('chagokchan_rpc','public.request_receipts','created_at','SELECT') and
  has_column_privilege('chagokchan_rpc','public.request_receipts','erased_at','SELECT') and
  has_column_privilege('chagokchan_rpc','public.request_receipts','result_id','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.request_receipts','input_hash','UPDATE') and
  not has_table_privilege('chagokchan_rpc','public.request_receipts','DELETE'),
  'retry locking is actor-scoped and only the immutable result key has UPDATE privilege');
select ok((select count(*) = 3 from pg_policies where schemaname='public' and tablename='goals' and roles @> array['chagokchan_rpc'::name]),
  'goal owner reads, creates and updates are RLS-scoped to the verified actor');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='boards' and policyname='rpc_owner_boards_select') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='boards' and policyname='rpc_owner_boards_insert'),
  'board access is restricted to owner rows while required creation is allowed');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='request_receipts' and policyname='rpc_owner_receipts_insert') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='request_receipts' and policyname='rpc_owner_receipts_select'),
  'idempotency lookups and inserts are actor-scoped by RLS');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='shared_board_profiles' and policyname='rpc_owner_shared_profile_insert'),
  'shared profile writes require ownership of the referenced board');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='bunches' and policyname='rpc_owner_bunches_select'),
  'goal detail can only read bunch metadata from the owner boards');
select ok(not has_table_privilege('chagokchan_rpc','public.goals','TRUNCATE,REFERENCES,TRIGGER') and
  not has_table_privilege('chagokchan_rpc','public.boards','TRUNCATE,REFERENCES,TRIGGER'),
  'goal RPC role has no table administration privileges');
select ok(exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='goals' and t.tgname='goal_identity' and not t.tgisinternal),
  'goal immutable identity trigger remains installed');

select * from finish();
rollback;
