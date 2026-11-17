-- Read-only catalog evidence. Never return user rows, credentials or key values.
with product as (
  select c.oid,c.relrowsecurity,c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r'
), definers as (
  select p.oid,p.proconfig,r.rolcanlogin,r.rolsuper
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname in ('public','private') and p.prosecdef
), api_roles as (
  select rolname from pg_roles where rolname in ('anon','authenticated','service_role')
), internal_roles as (
  select rolname from pg_roles where rolname like 'chagokchan_%'
)
select jsonb_build_object(
  'postgres_version',current_setting('server_version'),
  'migrations',(select count(*) from supabase_migrations.schema_migrations),
  'auth_users',(select count(*) from auth.users),
  'app_accounts',(select count(*) from public.app_users),
  'product_tables',(select count(*) from product),
  'rls_enabled_forced',(select count(*) from product where relrowsecurity and relforcerowsecurity),
  'ordinary_direct_dml',(select count(*) from product cross join api_roles where rolname in ('anon','authenticated') and has_table_privilege(rolname,oid,'INSERT,UPDATE,DELETE')),
  'anonymous_definer_execute',(select count(*) from definers where has_function_privilege('anon',oid,'EXECUTE')),
  'login_or_superuser_definer_owners',(select count(*) from definers where rolcanlogin or rolsuper),
  'definers_without_fixed_path',(select count(*) from definers where not coalesce('search_path=pg_catalog'=any(proconfig),false)),
  'api_can_assume_internal_role',(select count(*) from api_roles a cross join internal_roles r where pg_has_role(a.rolname,r.rolname,'MEMBER')),
  'internal_roles_can_login',(select count(*) from pg_roles where rolname like 'chagokchan_%' and (rolcanlogin or rolsuper or rolcreaterole or rolcreatedb)),
  'reader_email_allowed',has_column_privilege('chagokchan_session_reader','auth.users','email','SELECT'),
  'reader_password_allowed',has_column_privilege('chagokchan_session_reader','auth.users','encrypted_password','SELECT'),
  'reader_refresh_tokens_allowed',has_table_privilege('chagokchan_session_reader','auth.refresh_tokens','SELECT'),
  'private_worker_rls_forced',(select count(*) from pg_class where oid in (to_regclass('private.deletion_work_leases'),to_regclass('private.deletion_ledger_completion_acks')) and relrowsecurity and relforcerowsecurity),
  'api_direct_worker_bookkeeping',(select count(*) from api_roles cross join (values ('private.deletion_work_leases'),('private.deletion_ledger_completion_acks')) t(relation) where has_table_privilege(rolname,to_regclass(relation),'SELECT,INSERT,UPDATE,DELETE')),
  'worker_configuration_present',to_regclass('private.deletion_worker_config') is not null
) facts;
