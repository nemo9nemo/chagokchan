begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(20);

select ok((select bool_and(p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_rpc')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='public' and p.proname in ('list_notifications','mark_notification_read','list_sent_praises',
    'list_trash_goals','delete_goal','restore_goal')),
  'user lifecycle RPCs are definer functions with restricted owner and fixed search path');
select ok((select bool_and(has_function_privilege('authenticated',signature,'EXECUTE')) from (values
  ('public.list_notifications(text,integer)'),('public.mark_notification_read(uuid)'),('public.list_sent_praises(text,integer)'),
  ('public.list_trash_goals(text,integer)'),('public.delete_goal(uuid,integer)'),('public.restore_goal(uuid,integer)')
) f(signature)), 'authenticated sessions can call only the user-scoped lifecycle boundary');
select ok((select bool_and(not has_function_privilege(role_name,signature,'EXECUTE')) from (values
  ('anon','public.list_notifications(text,integer)'),('service_role','public.list_notifications(text,integer)'),
  ('anon','public.mark_notification_read(uuid)'),('service_role','public.mark_notification_read(uuid)'),
  ('anon','public.list_sent_praises(text,integer)'),('service_role','public.list_sent_praises(text,integer)'),
  ('anon','public.list_trash_goals(text,integer)'),('service_role','public.list_trash_goals(text,integer)'),
  ('anon','public.delete_goal(uuid,integer)'),('service_role','public.delete_goal(uuid,integer)'),
  ('anon','public.restore_goal(uuid,integer)'),('service_role','public.restore_goal(uuid,integer)')
) denied(role_name,signature)), 'anonymous and service roles cannot invoke user-scoped operations');
select ok((select p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_worker'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='public' and p.proname='purge_expired_goals' and pg_get_function_identity_arguments(p.oid)='p_batch_size integer, p_ledger_reference uuid'),
  'goal purge is owned by its dedicated worker role');
select ok(has_function_privilege('service_role','public.purge_expired_goals(integer,uuid)','EXECUTE') and
  not has_function_privilege('authenticated','public.purge_expired_goals(integer,uuid)','EXECUTE') and
  not has_function_privilege('anon','public.purge_expired_goals(integer,uuid)','EXECUTE'),
  'only service-role callers can enter the deletion worker boundary');
select ok((select rolbypassrls and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
  from pg_roles where rolname='chagokchan_worker'), 'worker is non-login and has only its dedicated RLS bypass');
select ok(not pg_has_role('authenticated','chagokchan_worker','MEMBER') and
  not pg_has_role('anon','chagokchan_worker','MEMBER') and not pg_has_role('service_role','chagokchan_worker','MEMBER'),
  'API roles cannot assume the worker role');
select ok((select bool_and(p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_session_reader')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='private' and p.proname in ('is_service_worker','require_service_worker')) and
  not has_function_privilege('authenticated','private.is_service_worker()','EXECUTE') and
  not has_function_privilege('service_role','private.require_service_worker()','EXECUTE') and
  has_function_privilege('chagokchan_worker','private.require_service_worker()','EXECUTE'),
  'signed worker claims pass through the isolated Auth reader and only the worker owner can call the guard');
select ok((select not independent_ledger_enabled from private.deletion_worker_config where singleton),
  'physical goal purge remains disabled until the independent ledger is configured');
select ok((select bool_and(not has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE')) from (values
  ('anon','public.notifications'),('authenticated','public.notifications'),('service_role','public.notifications'),
  ('anon','public.praises'),('authenticated','public.praises'),('service_role','public.praises'),
  ('anon','public.goals'),('authenticated','public.goals'),('service_role','public.goals'),
  ('anon','public.boards'),('authenticated','public.boards'),('service_role','public.boards')
) denied(role_name,table_name)), 'API roles still cannot directly access or mutate product rows');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in (
  'public.notifications'::regclass,'public.praises'::regclass,'public.goals'::regclass,
  'public.boards'::regclass,'public.board_members'::regclass,'public.request_receipts'::regclass
)), 'all lifecycle data retains forced row security');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='rpc_recipient_notifications_select') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='rpc_recipient_notifications_update'),
  'notification reads and read-state writes are recipient scoped');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='praises' and policyname='rpc_sender_peer_praises_select'),
  'sent-praise rows are scoped to their author');
select ok(has_column_privilege('chagokchan_rpc','public.notifications','read_at','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.notifications','type','UPDATE'),
  'user RPC role can change only notification read state');
select ok(has_table_privilege('chagokchan_worker','public.notifications','DELETE') and
  has_table_privilege('chagokchan_worker','public.praises','DELETE') and
  has_table_privilege('chagokchan_worker','public.goals','DELETE') and
  has_column_privilege('chagokchan_worker','public.goals','status','UPDATE') and
  has_column_privilege('chagokchan_worker','public.app_users','account_status','UPDATE') and
  not has_table_privilege('service_role','public.goals','DELETE'),
  'only the protected function owner holds goal-purge table privileges');
select ok((select count(*)=1 from pg_attribute where attrelid='public.account_deletion_requests'::regclass
  and attname='ledger_reference' and not attisdropped), 'deletion requests can retain a non-content ledger reference for retry');
select ok((select count(*)=0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('list_notifications','mark_notification_read','list_sent_praises',
    'list_trash_goals','delete_goal','restore_goal','purge_expired_goals')
    and has_function_privilege('public',p.oid,'EXECUTE')), 'no lifecycle RPC is executable through PUBLIC');
select ok(not has_schema_privilege('authenticated','private','USAGE') and
  not has_schema_privilege('service_role','private','USAGE'), 'private worker config remains outside API schema access');
select ok((select p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_worker'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='private' and p.proname='has_authored_peer_praise_in_goal') and
  not has_function_privilege('authenticated','private.has_authored_peer_praise_in_goal(uuid,uuid)','EXECUTE') and
  has_function_privilege('chagokchan_rpc','private.has_authored_peer_praise_in_goal(uuid,uuid)','EXECUTE'),
  'the post-disconnect visibility helper is private to the fixed-path worker definer and RPC policy');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='goals' and policyname='rpc_sender_peer_goals_select') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='boards' and policyname='rpc_sender_peer_boards_select'),
  'sent-praise projection can reach only the minimal goal and board rows authored by the viewer');

select * from finish();
rollback;
