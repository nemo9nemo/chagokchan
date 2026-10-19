begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(14);

select ok((select count(*) = 2 and bool_and(p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig) and r.rolname='chagokchan_rpc')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='public' and p.proname in ('bootstrap_account','get_auth_context')),
  'registration and auth-context RPCs use the restricted owner and fixed search path');
select ok(has_function_privilege('authenticated','public.bootstrap_account(boolean,text)','EXECUTE') and
  not has_function_privilege('anon','public.bootstrap_account(boolean,text)','EXECUTE') and
  not has_function_privilege('service_role','public.bootstrap_account(boolean,text)','EXECUTE'),
  'only the authenticated API role can call registration');
select ok(has_function_privilege('authenticated','public.get_auth_context()','EXECUTE') and
  not has_function_privilege('anon','public.get_auth_context()','EXECUTE') and
  not has_function_privilege('service_role','public.get_auth_context()','EXECUTE'),
  'auth context is not anonymous or a service-role user lookup');
select ok(not has_table_privilege('authenticated','public.app_users','INSERT') and
  not has_table_privilege('authenticated','public.profiles','INSERT') and
  not has_column_privilege('authenticated','public.app_users','adult_confirmed_at','UPDATE'),
  'API users still cannot directly create accounts or rewrite confirmation');
select ok(has_column_privilege('chagokchan_rpc','public.app_users','id','INSERT') and
  has_column_privilege('chagokchan_rpc','public.app_users','adult_confirmed_at','INSERT') and
  not has_column_privilege('chagokchan_rpc','public.app_users','created_at','INSERT') and
  not has_column_privilege('chagokchan_rpc','public.app_users','adult_confirmed_at','UPDATE'),
  'registration owner receives only the required account insert columns');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='app_users' and
  policyname='rpc_signup_account_insert' and with_check ilike '%session_account_id%') and
  exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and
  policyname='rpc_signup_profile_insert' and with_check ilike '%session_account_id%'),
  'registration inserts are limited by verified-session RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.app_users'::regclass) and
  (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.profiles'::regclass),
  'account and profile forced RLS stays enabled');
select ok(not has_schema_privilege('chagokchan_rpc','public','CREATE'), 'temporary schema creation privilege is removed');
select is((select column_default from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='nickname'),
  '''새로운 사용자''::character varying', 'future profile nickname defaults are independent of the presentation theme');
select is((select column_default from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='avatar_key'),
  '''star''::text', 'future default avatar matches the neutral app policy');

set local role authenticated;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.bootstrap_account(true,'0.2.0')$$,'PT401','unauthenticated','registration rejects missing live Auth session');
select throws_ok($$select public.get_auth_context()$$,'PT401','unauthenticated','auth context rejects missing live Auth session');
reset role;
set local role anon;
select throws_ok($$select public.bootstrap_account(true,'0.2.0')$$,'42501',null,'anon cannot execute registration');
select throws_ok($$select public.get_auth_context()$$,'42501',null,'anon cannot execute auth context');
reset role;

select * from finish();
rollback;
