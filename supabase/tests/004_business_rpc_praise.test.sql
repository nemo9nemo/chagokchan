begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(26);

select ok((select count(*)=4 and bool_and(p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_rpc')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='public' and p.proname in ('update_board','create_praise','edit_self_praise','cancel_praise')),
  'W06-B2 board and personal praise RPCs use fixed-search-path SECURITY DEFINER with the RPC owner');
select ok((select p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_rpc'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='private' and p.proname='consume_rate_limit'), 'critical rate limiter uses the same restricted owner and search path');
select ok((select not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole
  from pg_roles where rolname='chagokchan_rpc'), 'business RPC owner keeps RLS and has no login or administrative powers');
select ok(not has_schema_privilege('chagokchan_rpc','public','CREATE') and not has_schema_privilege('chagokchan_rpc','private','CREATE'),
  'temporary ownership-transfer CREATE grants are removed');
select ok(has_function_privilege('authenticated','public.create_praise(uuid,uuid,text,date)','EXECUTE') and
  has_function_privilege('authenticated','public.edit_self_praise(uuid,jsonb)','EXECUTE') and
  has_function_privilege('authenticated','public.cancel_praise(uuid)','EXECUTE') and
  has_function_privilege('authenticated','public.update_board(uuid,jsonb)','EXECUTE'),
  'authenticated users can enter the owner RPC boundary');
select ok((select bool_and(not has_function_privilege(role_name, signature, 'EXECUTE')) from (values
  ('anon','public.create_praise(uuid,uuid,text,date)'),('service_role','public.create_praise(uuid,uuid,text,date)'),
  ('authenticated','private.consume_rate_limit(uuid,text,integer,timestamptz,timestamptz)')) denied(role_name,signature)),
  'anonymous, service and authenticated roles cannot bypass the public RPC boundary or call its helper');
select ok(not has_table_privilege('anon','public.praises','SELECT,INSERT,UPDATE,DELETE') and
  not has_table_privilege('authenticated','public.praises','SELECT,INSERT,UPDATE,DELETE') and
  not has_table_privilege('service_role','public.praises','SELECT,INSERT,UPDATE,DELETE'),
  'API roles still cannot access praise rows directly');
select ok(not has_table_privilege('authenticated','public.rate_usage','SELECT,INSERT,UPDATE,DELETE') and
  not has_table_privilege('authenticated','public.notifications','SELECT,INSERT,UPDATE,DELETE'),
  'rate and notification data remain private to RPC owners');
select ok(has_column_privilege('chagokchan_rpc','public.boards','next_target_count','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.boards','current_bunch_id','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.boards','revision','UPDATE') and
  not has_table_privilege('chagokchan_rpc','public.boards','DELETE') and
  not has_column_privilege('chagokchan_rpc','public.boards','owner_user_id','UPDATE'),
  'board RPC can update only future configuration, current pointer and revision');
select ok(has_column_privilege('chagokchan_rpc','public.bunches','valid_count','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.bunches','progress_state','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.bunches','completed_at','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.bunches','target_count','INSERT') and
  not has_column_privilege('chagokchan_rpc','public.bunches','target_count','UPDATE') and
  not has_table_privilege('chagokchan_rpc','public.bunches','DELETE'),
  'cycle RPC can aggregate while target snapshots remain immutable');
select ok(has_column_privilege('chagokchan_rpc','public.praises','message','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.praises','occurred_on','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.praises','cancelled_at','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.praises','actor_user_id','UPDATE') and
  not has_table_privilege('chagokchan_rpc','public.praises','DELETE'),
  'praise RPC can edit self content and perform irreversible cancellation only');
select ok(has_column_privilege('chagokchan_rpc','public.rate_usage','used_count','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.rate_usage','updated_at','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.rate_usage','actor_user_id','UPDATE') and
  not has_table_privilege('chagokchan_rpc','public.rate_usage','DELETE'),
  'rate bucket increments cannot change actor or remove usage history');
select ok(has_column_privilege('chagokchan_rpc','public.notifications','recipient_user_id','INSERT') and
  has_column_privilege('chagokchan_rpc','public.notifications','bunch_id','INSERT') and
  not has_table_privilege('chagokchan_rpc','public.notifications','DELETE'),
  'completion notifications are append-only from owner-scoped RPCs');
select ok(has_column_privilege('chagokchan_rpc','public.shared_board_profiles','public_title','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.shared_board_profiles','public_description','UPDATE') and
  not has_table_privilege('chagokchan_rpc','public.shared_board_profiles','DELETE'),
  'only explicit shared display fields can be updated by the board RPC');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='boards' and policyname='rpc_owner_boards_update'),
  'board setting writes are owner-scoped by RLS');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='bunches' and policyname='rpc_owner_bunches_insert') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='bunches' and policyname='rpc_owner_bunches_update'),
  'bunch creation and aggregate changes require ownership of its board');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='praises' and policyname='rpc_owner_praises_select') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='praises' and policyname='rpc_owner_praises_insert') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='praises' and policyname='rpc_owner_praises_update'),
  'praise reads, self inserts and author changes have distinct actor-scoped policies');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='rate_usage' and policyname='rpc_owner_rate_usage_select') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='rate_usage' and policyname='rpc_owner_rate_usage_update'),
  'rate bucket state is private to its verified actor');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='rpc_owner_notifications_insert') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='rpc_owner_notifications_select'),
  'completion notices and their conflict checks are scoped to the verified recipient');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='shared_board_profiles' and policyname='rpc_owner_shared_profile_update'),
  'shared profile writes require ownership of the referenced board');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.praises'::regclass) and
  (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.bunches'::regclass) and
  (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.rate_usage'::regclass),
  'praise, cycle and rate tables keep FORCE ROW LEVEL SECURITY');
select ok(exists(select 1 from pg_trigger where tgname='praise_shape' and not tgisinternal) and
  exists(select 1 from pg_trigger where tgname='praise_identity' and not tgisinternal),
  'cross-table praise source and irreversible identity triggers remain installed');
select ok(exists(select 1 from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_typed_target'),
  'notification target type constraint remains installed for completion notices');
select ok(has_function_privilege('authenticated','public.cancel_praise(uuid)','EXECUTE') and
  not has_function_privilege('authenticated','private.consume_rate_limit(uuid,text,integer,timestamptz,timestamptz)','EXECUTE'),
  'rate consumption is internal to the authorized business operations');
select ok((select p.provolatile='v' and r.rolname='chagokchan_rpc' from pg_proc p join pg_roles r on r.oid=p.proowner
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_praise'),
  'write RPCs are volatile functions and cannot be planned as stable reads');
select ok(not has_column_privilege('chagokchan_rpc','public.notifications','read_at','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.boards','kind','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.bunches','cycle_no','UPDATE'),
  'owner RPC cannot rewrite notification read state, board kind or cycle identity');

select * from finish();
rollback;
