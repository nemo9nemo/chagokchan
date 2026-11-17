begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(11);

select ok((select p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_rpc' and not r.rolcanlogin and not r.rolsuper and not r.rolbypassrls
  from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='public.update_my_profile(text,text)'::regprocedure),
  'profile RPC has a restricted NOLOGIN owner and fixed search path');
select ok(has_function_privilege('authenticated','public.update_my_profile(text,text)','EXECUTE') and
  not has_function_privilege('anon','public.update_my_profile(text,text)','EXECUTE') and
  not has_function_privilege('service_role','public.update_my_profile(text,text)','EXECUTE'), 'only authenticated users enter the profile RPC');
select ok(not has_table_privilege('authenticated','public.profiles','SELECT,INSERT,UPDATE,DELETE') and
  not has_table_privilege('anon','public.profiles','SELECT,INSERT,UPDATE,DELETE'), 'ordinary roles still have no direct profile DML');
select ok(has_column_privilege('chagokchan_rpc','public.profiles','nickname','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.profiles','avatar_key','UPDATE') and
  has_column_privilege('chagokchan_rpc','public.profiles','updated_at','UPDATE') and
  not has_column_privilege('chagokchan_rpc','public.profiles','user_id','UPDATE'), 'internal profile updates cannot reassign ownership');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.profiles'::regclass), 'profile RLS remains forced');
select ok(not has_schema_privilege('chagokchan_rpc','public','CREATE') and not has_schema_privilege('chagokchan_rpc','private','CREATE'), 'temporary schema CREATE is revoked');
select ok(not pg_has_role('authenticated','chagokchan_rpc','MEMBER') and not pg_has_role('anon','chagokchan_rpc','MEMBER'), 'API roles cannot assume the internal owner');
select is((select proargnames::text from pg_proc where oid='public.update_my_profile(text,text)'::regprocedure),
  '{p_nickname,p_avatar_key}', 'profile RPC accepts no target user ID or account metadata');
select ok((select p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_rpc' and not r.rolcanlogin
  from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='public.preview_connection_invite_with_profile(jsonb)'::regprocedure),
  'profile preview has the restricted owner and fixed path');
select ok(has_function_privilege('authenticated','public.preview_connection_invite_with_profile(jsonb)','EXECUTE') and
  not has_function_privilege('anon','public.preview_connection_invite_with_profile(jsonb)','EXECUTE') and
  not has_function_privilege('service_role','public.preview_connection_invite_with_profile(jsonb)','EXECUTE'), 'profile preview excludes anonymous and service entry');
select ok(pg_get_functiondef('public.preview_connection_invite(jsonb)'::regprocedure) not like '%inviter_display_code%',
  'legacy preview projection remains compatible with the previous BFF');

select * from finish();
rollback;
