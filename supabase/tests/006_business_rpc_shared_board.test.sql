begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(25);

select ok((select count(*)=6 and bool_and(p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_rpc')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='public' and p.proname in ('get_board','list_board_praises','list_board_members','grant_board_member','revoke_board_member','create_peer_praise')),
  'all W06-C2 public RPCs use the restricted owner and fixed search path');
select ok((select bool_and(has_function_privilege('authenticated',signature,'EXECUTE')) from (values
  ('public.get_board(uuid)'),('public.list_board_praises(uuid,uuid,text,integer,boolean)'),
  ('public.list_board_members(uuid,text,integer)'),('public.grant_board_member(uuid,uuid)'),
  ('public.revoke_board_member(uuid,uuid)'),('public.create_peer_praise(uuid,uuid,text)')
) f(signature)), 'authenticated sessions enter the shared-board RPC boundary');
select ok((select bool_and(not has_function_privilege(role_name,signature,'EXECUTE')) from (values
  ('anon','public.get_board(uuid)'),('service_role','public.get_board(uuid)'),
  ('anon','public.list_board_praises(uuid,uuid,text,integer,boolean)'),('service_role','public.list_board_praises(uuid,uuid,text,integer,boolean)'),
  ('anon','public.grant_board_member(uuid,uuid)'),('service_role','public.grant_board_member(uuid,uuid)'),
  ('anon','public.create_peer_praise(uuid,uuid,text)'),('service_role','public.create_peer_praise(uuid,uuid,text)')
) denied(role_name,signature)), 'anonymous and service roles cannot enter user-scoped shared-board RPCs');
select ok(not has_function_privilege('authenticated','private.current_shared_board_member(uuid,uuid,uuid)','EXECUTE') and
  not has_function_privilege('authenticated','private.lock_connection_pair(uuid,uuid)','EXECUTE') and
  not has_function_privilege('authenticated','private.decode_relationship_cursor(text)','EXECUTE'),
  'membership, lock and cursor helpers remain internal');
select ok((select bool_and(not has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE')) from (values
  ('anon','public.board_members'),('authenticated','public.board_members'),('service_role','public.board_members'),
  ('anon','public.shared_board_profiles'),('authenticated','public.shared_board_profiles'),('service_role','public.shared_board_profiles'),
  ('anon','public.praises'),('authenticated','public.praises'),('service_role','public.praises'),
  ('anon','public.bunches'),('authenticated','public.bunches'),('service_role','public.bunches')
) denied(role_name,table_name)), 'API roles cannot query or mutate shared board, praise or cycle rows directly');
select ok(has_column_privilege('chagokchan_rpc','public.board_members','connection_id','INSERT') and
  has_column_privilege('chagokchan_rpc','public.board_members','connection_generation','INSERT') and
  has_column_privilege('chagokchan_rpc','public.board_members','granted_by_user_id','INSERT') and
  has_column_privilege('chagokchan_rpc','public.board_members','status','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.board_members','connection_generation','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.board_members','granted_by_user_id','UPDATE') and
  not has_table_privilege('chagokchan_rpc','public.board_members','DELETE'),
  'grant RPC can add and revoke membership but cannot rewrite grant identity or delete history');
select ok(has_column_privilege('chagokchan_rpc','public.praises','hidden_at','SELECT') and
  has_column_privilege('chagokchan_rpc','public.praises','actor_user_id','INSERT') and
  has_column_privilege('chagokchan_rpc','public.praises','recipient_user_id','INSERT') and
  not has_column_privilege('chagokchan_rpc','public.praises','hidden_at','UPDATE') and
  not has_table_privilege('chagokchan_rpc','public.praises','DELETE'),
  'owner projection reads hidden state while the peer RPC cannot change praise identity or delete rows');
select ok(has_column_privilege('chagokchan_rpc','public.notifications','praise_id','INSERT') and
  has_column_privilege('chagokchan_rpc','public.notifications','bunch_id','INSERT') and
  has_column_privilege('chagokchan_rpc','public.notifications','praise_id','SELECT') and
  has_column_privilege('chagokchan_rpc','public.notifications','read_at','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.notifications','type','UPDATE') and
  not has_table_privilege('chagokchan_rpc','public.notifications','DELETE'),
  'peer receipt and cycle notices remain append-only apart from W06-D recipient read state');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.boards'::regclass,'public.goals'::regclass,'public.shared_board_profiles'::regclass,
  'public.board_members'::regclass,'public.bunches'::regclass,'public.praises'::regclass,'public.notifications'::regclass
)), 'all shared-board rows remain protected by FORCE ROW LEVEL SECURITY');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='board_members'
  and policyname='rpc_owner_or_member_board_members_select' and qual ilike '%granted_by_user_id%'),
  'membership row visibility avoids a recursive board/member policy and stays within grant parties');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='board_members' and policyname='rpc_owner_board_member_insert') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='board_members' and policyname='rpc_connection_party_board_members_update'),
  'only board owners grant while connection transitions can revoke membership');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='boards' and policyname='rpc_current_contributor_boards_select') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='boards' and policyname='rpc_current_contributor_boards_lock'),
  'contributors can read and transaction-lock only a current shared-board grant');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='goals' and policyname='rpc_current_contributor_goals_select') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='goals' and policyname='rpc_current_contributor_goals_lock'),
  'contributor goal state reads and serialization stay behind a current shared grant');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='shared_board_profiles' and policyname='rpc_current_contributor_shared_profile_select'),
  'shared display fields are readable only through the live member relationship');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='bunches' and policyname='rpc_current_contributor_bunches_select') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='bunches' and policyname='rpc_current_contributor_bunches_insert') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='bunches' and policyname='rpc_current_contributor_bunches_update'),
  'shared cycle read and aggregate writes require the current contributor grant');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='praises' and policyname='rpc_owner_received_praises_select') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='praises' and policyname='rpc_current_contributor_peer_praises_insert'),
  'received praise reads and peer praise writes use separate recipient/actor rules');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='rpc_peer_praise_notifications_insert') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='rpc_peer_praise_notifications_select'),
  'praise and completion notice inserts have matching narrow ON CONFLICT visibility');
select ok((select prosecdef and 'search_path=pg_catalog'=any(proconfig) and r.rolname='chagokchan_rpc'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='private' and p.proname='current_shared_board_member'),
  'the RLS membership predicate binds its result to the checked session actor');
select ok((select not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole
  from pg_roles where rolname='chagokchan_rpc') and
  not has_schema_privilege('chagokchan_rpc','public','CREATE') and not has_schema_privilege('chagokchan_rpc','private','CREATE'),
  'shared-board RPC owner is non-login, keeps RLS and has no administrative powers');
select ok((select p.provolatile='v' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_peer_praise') and
  (select p.provolatile='s' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_board'),
  'peer writes are volatile while projections are stable reads');
select ok((select prosrc ilike '%createPeerPraise%' and prosrc ilike '%createPraise%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='enforce_reference_shape'),
  'the immutable praise reference guard accepts the dedicated peer operation and existing self operation');
select ok((select prosrc ilike '%board_member_limit%' and prosrc ilike '%active_count >= 50%' from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='grant_board_member'),
  'grant concurrency is serialized at the policy contributor limit');
select ok((select prosrc ilike '%peer_praise_board_day:%' and prosrc ilike '%praise_write_minute%' and prosrc ilike '%praise_write_day%'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_peer_praise'),
  'peer praise enforces both global and sender/board UTC day quotas');
select ok((select prosrc ilike '%last_at%' and prosrc ilike '%last_id%' and prosrc ilike '%encode_relationship_cursor(last_at%'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_board_praises') and
  (select prosrc ilike '%last_at%' and prosrc ilike '%last_id%' and prosrc ilike '%encode_relationship_cursor(last_at%'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_board_members'),
  'shared lists resume after their final returned item');
select ok((with cursor_value as (select private.encode_relationship_cursor(clock_timestamp(),gen_random_uuid()) as value)
  select value !~ E'[\n\r=+/]' and private.decode_relationship_cursor(value) is not null from cursor_value),
  'URL-safe cursors remove PostgreSQL base64 line wrapping and round-trip');

select * from finish();
rollback;
