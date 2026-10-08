begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(10);

select ok((select count(*)=3 and bool_and(p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_rpc')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='public' and p.proname in ('hide_peer_praise','unhide_peer_praise','exclude_peer_praise')),
  'all peer praise moderation RPCs use the restricted owner and fixed search path');
select ok((select bool_and(has_function_privilege('authenticated',signature,'EXECUTE')) from (values
  ('public.hide_peer_praise(uuid)'),('public.unhide_peer_praise(uuid)'),('public.exclude_peer_praise(uuid)')
) f(signature)), 'authenticated sessions can invoke recipient moderation operations');
select ok((select bool_and(not has_function_privilege(role_name,signature,'EXECUTE')) from (values
  ('anon','public.hide_peer_praise(uuid)'),('service_role','public.hide_peer_praise(uuid)'),
  ('anon','public.unhide_peer_praise(uuid)'),('service_role','public.unhide_peer_praise(uuid)'),
  ('anon','public.exclude_peer_praise(uuid)'),('service_role','public.exclude_peer_praise(uuid)')
) denied(role_name,signature)), 'anonymous and service roles cannot invoke user-scoped moderation');
select ok(not has_function_privilege('authenticated','private.set_peer_praise_state(uuid,text)','EXECUTE'),
  'the shared moderation state helper is not exposed to API roles');
select ok(has_column_privilege('chagokchan_rpc','public.praises','hidden_at','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.praises','excluded_at','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.praises','message','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.praises','occurred_on','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.praises','actor_user_id','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.praises','recipient_user_id','UPDATE') and
  not has_table_privilege('chagokchan_rpc','public.praises','DELETE'),
  'moderation columns are granted without identity or delete access and existing personal edit fields remain available');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='praises'
  and policyname='rpc_owner_peer_praise_moderation_update'
  and qual ilike '%recipient_user_id%' and qual ilike '%source%'
  and with_check ilike '%recipient_user_id%' and with_check ilike '%source%'),
  'the RLS update policy is restricted to the authenticated recipient and peer rows');
select ok((select prosecdef and 'search_path=pg_catalog'=any(proconfig) and r.rolname='chagokchan_rpc'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='private' and p.proname='set_peer_praise_state'),
  'the common state transition helper runs as the restricted owner with a fixed search path');
select ok((select count(*)=3 and bool_and(prosrc ilike '%private.set_peer_praise_state%')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('hide_peer_praise','unhide_peer_praise','exclude_peer_praise')),
  'public wrappers select only their fixed moderation action');
select ok((select prosrc ilike '%set hidden_at%' and prosrc ilike '%set excluded_at%' and
    prosrc not ilike '%set message%' and prosrc not ilike '%set occurred_on%' and prosrc not ilike '%set actor_user_id%'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='set_peer_praise_state'),
  'the shared moderation helper changes no author, message, or practice-date fields');
select ok(not has_schema_privilege('chagokchan_rpc','public','CREATE') and not has_schema_privilege('chagokchan_rpc','private','CREATE'),
  'the RPC owner has no lingering schema creation privilege');

select * from finish();
rollback;
