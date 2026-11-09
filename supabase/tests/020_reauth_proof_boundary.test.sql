-- W12-D1 catalog boundary; every test transaction rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(13);
select ok((select not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole and not rolinherit
  from pg_roles where rolname='chagokchan_reauth_issuer'), 'reauth issuer has no login, admin, inheritance or RLS bypass');
select ok((select bool_and(not pg_has_role(role,'chagokchan_reauth_issuer','MEMBER'))
  from unnest(array['anon','authenticated','service_role','chagokchan_rpc','chagokchan_worker']) roles(role)), 'API and product roles cannot assume the issuer');
select ok((select prosecdef and 'search_path=pg_catalog'=any(proconfig) and pg_get_userbyid(proowner)='chagokchan_reauth_issuer'
  from pg_proc where oid='public.issue_reauth_grant(text,text)'::regprocedure), 'proof RPC has a fixed path and dedicated owner');
select ok(has_function_privilege('authenticated','public.issue_reauth_grant(text,text)','execute')
  and not has_function_privilege('anon','public.issue_reauth_grant(text,text)','execute')
  and not has_function_privilege('service_role','public.issue_reauth_grant(text,text)','execute'), 'only authenticated callers reach proof verification');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.reauth_proof_keys'::regclass), 'verification configuration forces RLS');
select ok((select bool_and(not has_table_privilege(role,'private.reauth_proof_keys','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_column_privilege(role,'private.reauth_proof_keys','key_bytes','SELECT'))
  from unnest(array['anon','authenticated','service_role','chagokchan_rpc','chagokchan_worker']) roles(role)), 'API and product roles cannot access verification keys');
select ok(has_column_privilege('chagokchan_reauth_issuer','private.reauth_proof_keys','key_bytes','SELECT')
  and not has_table_privilege('chagokchan_reauth_issuer','private.reauth_proof_keys','INSERT,UPDATE,DELETE,TRUNCATE'), 'issuer reads keys but cannot change configuration');
select ok(has_column_privilege('chagokchan_reauth_issuer','public.reauth_grants','id','INSERT')
  and not has_table_privilege('chagokchan_reauth_issuer','public.reauth_grants','UPDATE,DELETE,TRUNCATE'), 'issuer can insert grants but cannot consume or delete them');
select ok((select bool_and(not has_column_privilege(role,'public.reauth_grants','id','INSERT'))
  from unnest(array['anon','authenticated','service_role']) roles(role)), 'API roles cannot directly create grants');
select ok(not has_table_privilege('chagokchan_reauth_issuer','auth.users','SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('chagokchan_reauth_issuer','auth.sessions','SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('chagokchan_reauth_issuer','public.goals','SELECT,INSERT,UPDATE,DELETE'), 'issuer has no managed Auth or unrelated product table access');
select ok(not has_schema_privilege('chagokchan_reauth_issuer','public','CREATE') and not has_schema_privilege('chagokchan_reauth_issuer','private','CREATE'), 'temporary schema creation grants are removed');
select ok(has_function_privilege('chagokchan_reauth_issuer','private.current_session_id()','EXECUTE')
  and not pg_has_role('chagokchan_reauth_issuer','chagokchan_session_reader','MEMBER'), 'issuer uses only the session helper without inheriting the Auth reader role');
select throws_ok($$select public.issue_reauth_grant('bad','bad')$$,'PT401','unauthenticated','a live active user is required before examining a proof');
select * from finish();
rollback;
