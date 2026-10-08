begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(20);

select ok((select count(*) = 14 and bool_and(p.prosecdef and 'search_path=pg_catalog' = any(p.proconfig) and r.rolname = 'chagokchan_rpc')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public' and p.proname = any(array[
    'create_connection_invite','preview_connection_invite','create_connection_request','accept_connection_request',
    'reject_connection_request','cancel_connection_request','revoke_connection_invite','disconnect','create_block','revoke_block',
    'list_connections','list_connection_invites','list_connection_requests','list_blocks'
  ])), 'all W06-C1 public RPCs use the restricted SECURITY DEFINER owner and fixed path');
select ok((select not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole
  from pg_roles where rolname = 'chagokchan_rpc'), 'connection RPC owner has no login or administrative powers');
select ok(not has_schema_privilege('chagokchan_rpc','public','CREATE') and not has_schema_privilege('chagokchan_rpc','private','CREATE'),
  'temporary CREATE grants used for owner transfer are removed');
select ok((select bool_and(has_function_privilege('authenticated', signature, 'EXECUTE')) from (values
  ('public.create_connection_invite()'),('public.preview_connection_invite(jsonb)'),('public.create_connection_request(uuid,jsonb)'),
  ('public.accept_connection_request(uuid)'),('public.reject_connection_request(uuid)'),('public.cancel_connection_request(uuid)'),
  ('public.revoke_connection_invite(uuid)'),('public.disconnect(uuid)'),('public.create_block(uuid)'),('public.revoke_block(uuid)'),
  ('public.list_connections(text,integer)'),('public.list_connection_invites(text,integer)'),
  ('public.list_connection_requests(text,text,integer)'),('public.list_blocks(text,integer)')
) functions(signature)), 'authenticated sessions enter only the public connection RPC boundary');
select ok((select bool_and(not has_function_privilege(role_name, signature, 'EXECUTE')) from (values
  ('anon','public.create_connection_invite()'),('service_role','public.create_connection_invite()'),
  ('anon','public.create_connection_request(uuid,jsonb)'),('service_role','public.create_connection_request(uuid,jsonb)'),
  ('anon','public.accept_connection_request(uuid)'),('service_role','public.accept_connection_request(uuid)'),
  ('anon','public.create_block(uuid)'),('service_role','public.create_block(uuid)'),
  ('anon','public.list_connections(text,integer)'),('service_role','public.list_connections(text,integer)')
) denied(role_name,signature)), 'anonymous and service roles cannot enter user-scoped connection RPCs');
select ok(not has_function_privilege('authenticated','private.connection_secret_hash(jsonb)','EXECUTE') and
  not has_function_privilege('authenticated','private.lock_connection_pair(uuid,uuid)','EXECUTE') and
  not has_function_privilege('authenticated','private.lock_connection_capacity(uuid)','EXECUTE') and
  not has_function_privilege('authenticated','private.decode_relationship_cursor(text)','EXECUTE'),
  'secret, lock and cursor helpers remain internal');
select ok((select bool_and(not has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE')) from (values
  ('anon','public.connections'),('authenticated','public.connections'),('service_role','public.connections'),
  ('anon','public.blocks'),('authenticated','public.blocks'),('service_role','public.blocks'),
  ('anon','public.connection_invites'),('authenticated','public.connection_invites'),('service_role','public.connection_invites'),
  ('anon','public.connection_requests'),('authenticated','public.connection_requests'),('service_role','public.connection_requests')
) denied(role_name,table_name)), 'API roles cannot read or mutate relationship tables directly');
select ok((select bool_and(not has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE')) from (values
  ('anon','public.board_members'),('authenticated','public.board_members'),('service_role','public.board_members'),
  ('anon','public.notifications'),('authenticated','public.notifications'),('service_role','public.notifications')
) denied(role_name,table_name)), 'API roles cannot bypass the RPC boundary for board access or notifications');
select ok(has_column_privilege('chagokchan_rpc','public.connections','status','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.connections','generation','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.connections','user_low_id','INSERT') and
  has_column_privilege('chagokchan_rpc','public.connection_invites','link_hash','INSERT') and
  has_column_privilege('chagokchan_rpc','public.connection_requests','status','UPDATE') and
  not has_table_privilege('chagokchan_rpc','public.connections','DELETE') and
  not has_table_privilege('chagokchan_rpc','public.connection_requests','DELETE'),
  'RPC owner receives only the connection lifecycle columns it needs');
select ok(not has_column_privilege('chagokchan_rpc','public.connections','user_low_id','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.connections','user_high_id','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.connections','created_at','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.connection_invites','link_hash','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.connection_invites','code_hash','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.connection_requests','requester_user_id','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.connection_requests','approver_user_id','UPDATE'),
  'pair identity, invite hashes and request parties cannot be rewritten');
select ok(has_column_privilege('chagokchan_rpc','public.profiles','nickname','SELECT') and
  has_column_privilege('chagokchan_rpc','public.profiles','avatar_key','SELECT') and
  not has_column_privilege('chagokchan_rpc','public.profiles','updated_at','SELECT') and
  has_column_privilege('chagokchan_rpc','public.app_users','account_status','SELECT') and
  has_column_privilege('chagokchan_rpc','public.app_users','adult_confirmed_at','SELECT') and
  not has_table_privilege('chagokchan_rpc','public.profiles','SELECT') and
  not has_table_privilege('chagokchan_rpc','public.app_users','SELECT'),
  'relationship projections use column grants and preserve the existing get-me columns only');
select ok((select count(*) = 12 from pg_policies where schemaname='public' and policyname in (
  'rpc_party_connections_select','rpc_party_connections_insert','rpc_party_connections_update',
  'rpc_party_blocks_select','rpc_owner_blocks_insert','rpc_owner_blocks_update',
  'rpc_owner_invites_select','rpc_owner_invites_insert','rpc_owner_invites_update',
  'rpc_party_requests_select','rpc_requester_requests_insert','rpc_party_requests_update'
)), 'connection, block, invite and request RLS policies are installed');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='rpc_verified_related_profile_select') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='app_users' and policyname='rpc_verified_inviter_status_select') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='board_members' and policyname='rpc_owner_or_member_board_members_select') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='board_members' and policyname='rpc_connection_party_board_members_update'),
  'profile previews, inviter status and grant revocation are narrowly scoped by RLS');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='rpc_connection_transition_notifications_insert') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='rpc_connection_transition_notifications_select'),
  'request and acceptance notifications support conflict checks only for transition parties');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.connections'::regclass,'public.blocks'::regclass,'public.connection_invites'::regclass,
  'public.connection_requests'::regclass,'public.board_members'::regclass,'public.notifications'::regclass
)), 'all relationship and notification tables keep FORCE ROW LEVEL SECURITY');
select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='connection_requests' and indexname='connection_requests_one_pending' and indexdef ilike '%UNIQUE%WHERE%status%pending%') and
  exists(select 1 from pg_constraint where conrelid='public.connections'::regclass and contype='u' and conkey = array[(select attnum from pg_attribute where attrelid='public.connections'::regclass and attname='user_low_id'),(select attnum from pg_attribute where attrelid='public.connections'::regclass and attname='user_high_id')]::smallint[]),
  'normalized user pairs allow one relationship and one pending request');
select ok(exists(select 1 from pg_trigger where tgname='connection_request_shape' and not tgisinternal) and
  exists(select 1 from pg_trigger where tgname='board_member_shape' and not tgisinternal),
  'request-party and board-member relationships retain database shape guards');
select ok((select p.provolatile='v' and r.rolname='chagokchan_rpc' from pg_proc p join pg_roles r on r.oid=p.proowner
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_connection_request'),
  'request creation remains a volatile owner-scoped transaction');
select ok(has_column_privilege('chagokchan_rpc','public.notifications','connection_request_id','INSERT') and
  has_column_privilege('chagokchan_rpc','public.notifications','connection_id','INSERT') and
  not has_column_privilege('chagokchan_rpc','public.notifications','read_at','UPDATE') and
  not has_table_privilege('chagokchan_rpc','public.notifications','DELETE'),
  'connection notices are append-only with typed targets and immutable read state');
select ok((select count(*)=4 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('list_connections','list_connection_invites','list_connection_requests','list_blocks')
    and pg_get_functiondef(p.oid) like '%last_at%' and pg_get_functiondef(p.oid) like '%last_id%'
    and pg_get_functiondef(p.oid) like '%encode_relationship_cursor(last_at,last_id)%'),
  'relationship list cursors resume after the last returned item');

select * from finish();
rollback;
