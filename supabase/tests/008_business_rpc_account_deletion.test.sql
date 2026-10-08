begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(32);

select ok((select p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_rpc'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='public' and p.proname='request_account_deletion'
    and pg_get_function_identity_arguments(p.oid)='p_request_key uuid, p_reauth_grant_id uuid, p_confirm boolean'),
  'account deletion request is a fixed-path authenticated RPC owned by the restricted RPC role');
select ok(has_function_privilege('authenticated','public.request_account_deletion(uuid,uuid,boolean)','EXECUTE') and
  not has_function_privilege('anon','public.request_account_deletion(uuid,uuid,boolean)','EXECUTE') and
  not has_function_privilege('service_role','public.request_account_deletion(uuid,uuid,boolean)','EXECUTE'),
  'only authenticated sessions can submit their own deletion request');
select ok((select bool_and(p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_worker')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='public' and p.proname in ('process_account_deletion','fail_account_deletion','complete_account_deletion')),
  'erasure, failure checkpoint and completion operations belong to the isolated worker');
select ok((select bool_and(has_function_privilege('service_role',signature,'EXECUTE') and
  not has_function_privilege('authenticated',signature,'EXECUTE') and not has_function_privilege('anon',signature,'EXECUTE'))
  from (values ('public.process_account_deletion(uuid,uuid)'),('public.fail_account_deletion(uuid,text)'),('public.complete_account_deletion(uuid)')) f(signature)),
  'only service-role worker calls can process or finalize erasure');
select ok((select not rolcanlogin and not rolsuper and rolbypassrls and not rolcreatedb and not rolcreaterole
  from pg_roles where rolname='chagokchan_worker') and
  not pg_has_role('authenticated','chagokchan_worker','MEMBER') and
  not pg_has_role('anon','chagokchan_worker','MEMBER') and
  not pg_has_role('service_role','chagokchan_worker','MEMBER'),
  'the worker is non-login, non-admin and cannot be assumed by API roles');
select ok((select p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_session_reader'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='private' and p.proname='current_session_id') and
  (select bool_and(p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_guard')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='private' and p.proname in ('session_account_id','session_account_status')),
  'request helpers use the isolated Auth reader and live-session guard');
select ok(not has_function_privilege('authenticated','private.current_session_id()','EXECUTE') and
  not has_function_privilege('service_role','private.session_account_status()','EXECUTE') and
  not has_function_privilege('authenticated','private.session_account_id()','EXECUTE') and
  not has_function_privilege('chagokchan_rpc','private.require_session_user()','EXECUTE') and
  has_function_privilege('chagokchan_rpc','private.session_account_id()','EXECUTE') and
  has_function_privilege('chagokchan_rpc','private.current_session_id()','EXECUTE') and
  has_function_privilege('chagokchan_rpc','private.session_account_status()','EXECUTE'),
  'validated identity, session identifiers and account state are exposed only through narrow helpers to the RPC owner');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='account_deletion_requests_idempotency'
  and indexdef ilike '%subject_auth_user_id, request_key%') and
  exists(select 1 from pg_attribute where attrelid='public.account_deletion_requests'::regclass and attname='input_hash' and not attisdropped),
  'deletion requests retain a unique per-subject idempotency key and normalized input hash');
select ok(has_column_privilege('chagokchan_rpc','public.account_deletion_requests','requested_at','INSERT') and
  not has_column_privilege('authenticated','public.account_deletion_requests','requested_at','INSERT'),
  'only the request RPC can write the server-generated request timestamp');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='account_deletion_requests'
  and policyname='rpc_session_deletion_request_select' and qual ilike '%session_account_id%') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='account_deletion_requests'
  and policyname='rpc_session_deletion_request_insert' and with_check ilike '%status%pending%'),
  'users can read only their own session-bound deletion request and insert pending work');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='app_users'
  and policyname='rpc_session_account_deletion_update' and qual ilike '%session_account_id%'
  and with_check ilike '%deleting%'), 'only the current session can revoke its app account');
select ok(has_column_privilege('chagokchan_rpc','public.app_users','deactivated_at','SELECT') and
  has_column_privilege('chagokchan_rpc','public.app_users','deactivated_at','UPDATE'),
  'the request RPC can read only the deactivation timestamp needed for its guarded update');
select ok(has_function_privilege('chagokchan_rpc','private.valid_timezone(text)','EXECUTE') and
  not has_function_privilege('authenticated','private.valid_timezone(text)','EXECUTE') and
  not has_function_privilege('service_role','private.valid_timezone(text)','EXECUTE'),
  'only the restricted request RPC can evaluate the existing app-user timezone constraint');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='reauth_grants'
  and policyname='rpc_session_reauth_select' and qual ilike '%session_account_id%') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='reauth_grants'
  and policyname='rpc_session_reauth_consume' and with_check ilike '%session_account_id%'),
  'reauth grants are visible and consumable only by the currently verified user session');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.reauth_grants'::regclass) and
  (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.account_deletion_requests'::regclass),
  'reauth grant and deletion request tables retain forced RLS');
select ok(exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='app_users' and t.tgname='prevent_deleted_subject_rejoin' and not t.tgisinternal),
  'a completed deletion marker permanently blocks the same Auth UUID from bootstrapping again');
select ok((select p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_worker'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='private' and p.proname='prevent_deleted_subject_rejoin') and
  not has_function_privilege('authenticated','private.prevent_deleted_subject_rejoin()','EXECUTE'),
  'the bootstrap denial trigger uses a private fixed-path worker owner');
select ok((select p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_session_reader'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='private' and p.proname='auth_user_is_live') and
  has_function_privilege('chagokchan_worker','private.auth_user_is_live(uuid)','EXECUTE') and
  not has_function_privilege('service_role','private.auth_user_is_live(uuid)','EXECUTE'),
  'Auth removal is checked through the narrow metadata reader by worker-owned completion only');
select ok((select not independent_ledger_enabled from private.deletion_worker_config where singleton),
  'account erasure remains unavailable until an independent deletion ledger is configured');
select ok((select bool_and(not has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE')) from (values
  ('anon','public.app_users'),('authenticated','public.app_users'),('service_role','public.app_users'),
  ('anon','public.account_deletion_requests'),('authenticated','public.account_deletion_requests'),('service_role','public.account_deletion_requests'),
  ('anon','public.reauth_grants'),('authenticated','public.reauth_grants'),('service_role','public.reauth_grants')
) denied(role_name,table_name)), 'clients cannot directly read or mutate account, reauth or deletion request rows');
select ok(not has_schema_privilege('chagokchan_worker','auth','USAGE') and
  not has_column_privilege('chagokchan_worker','auth.users','email','SELECT') and
  not has_column_privilege('chagokchan_worker','public.profiles','nickname','SELECT') and
  not has_column_privilege('chagokchan_worker','public.praises','message','SELECT'),
  'the data worker cannot read Auth email, profile names or retained praise bodies');
select ok(has_column_privilege('chagokchan_worker','public.praises','message','UPDATE') and
  has_column_privilege('chagokchan_worker','public.praises','actor_user_id','UPDATE') and
  has_column_privilege('chagokchan_worker','public.request_receipts','input_hash','UPDATE') and
  has_column_privilege('chagokchan_worker','public.notifications','actor_user_id','UPDATE'),
  'author erasure can scrub only body, identity and idempotency input fields');
select ok(has_table_privilege('chagokchan_worker','public.goals','DELETE') and
  has_table_privilege('chagokchan_worker','public.profiles','DELETE') and
  has_table_privilege('chagokchan_worker','public.connections','DELETE') and
  not has_table_privilege('service_role','public.goals','DELETE'),
  'only the protected worker function owner can erase goal and relationship rows');
select ok(has_column_privilege('chagokchan_worker','public.app_users','account_status','UPDATE') and
  has_table_privilege('chagokchan_worker','public.account_deletion_requests','UPDATE') and
  not has_table_privilege('service_role','public.account_deletion_requests','UPDATE'),
  'the worker can lock accounts and checkpoint requests without granting table DML to service role');
select ok((select count(*)=0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('request_account_deletion','process_account_deletion','fail_account_deletion','complete_account_deletion')
  and has_function_privilege('public',p.oid,'EXECUTE')), 'no account deletion RPC is callable through PUBLIC');
select ok(not has_schema_privilege('authenticated','private','USAGE') and
  not has_schema_privilege('service_role','private','USAGE'), 'private request and worker helpers remain outside API schema access');
select ok(pg_get_functiondef('public.fail_account_deletion(uuid,text)'::regprocedure) ilike '%p_error_code is null%' and
  pg_get_functiondef('public.process_account_deletion(uuid,uuid)'::regprocedure) ilike '%ledger_reference_conflict%',
  'failure checkpoints reject empty error codes and retries bind to the recorded ledger reference');
select ok(pg_get_functiondef('public.complete_account_deletion(uuid)'::regprocedure) ilike '%auth_user_is_live%' and
  pg_get_functiondef('public.complete_account_deletion(uuid)'::regprocedure) ilike '%app_data_erased%',
  'completion requires erased app data and an absent Auth identity');
select ok(pg_get_functiondef('public.request_account_deletion(uuid,uuid,boolean)'::regprocedure) ilike '%10 minutes%' and
  pg_get_functiondef('public.request_account_deletion(uuid,uuid,boolean)'::regprocedure) ilike '%consumed_at is null%' and
  pg_get_functiondef('public.request_account_deletion(uuid,uuid,boolean)'::regprocedure) ilike '%session_id = session_uuid%',
  'request consumes only an unexpired grant bound to the current session');
select ok(pg_get_functiondef('public.process_account_deletion(uuid,uuid)'::regprocedure) ilike '%author_erased_at%' and
  pg_get_functiondef('public.process_account_deletion(uuid,uuid)'::regprocedure) ilike '%checkpoint = ''app_data_erased''%' and
  pg_get_functiondef('public.process_account_deletion(uuid,uuid)'::regprocedure) ilike '%delete from public.app_users%',
  'worker preserves valid received events while checkpointing app data erasure atomically');
select ok(has_table_privilege('chagokchan_worker','public.account_deletion_requests','SELECT') and
  has_column_privilege('chagokchan_worker','public.account_deletion_requests','subject_auth_user_id','SELECT') and
  not has_schema_privilege('chagokchan_worker','auth','USAGE'),
  'bootstrap marker inspection uses only retained deletion metadata, not managed Auth tables');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='notifications'
  and policyname='rpc_recipient_notifications_select') and exists(select 1 from pg_policies
  where schemaname='public' and tablename='praises' and policyname='rpc_sender_peer_praises_select'),
  'account erasure additions preserve the W06-D1 recipient and sent-praise policy boundaries');

select * from finish();
rollback;
