begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(21);

-- 1..8: role, ownership and temporal guards without invented JWT/session rows.
select ok((select count(*)=2 and bool_and(not rolcanlogin and not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole) from pg_roles where rolname in ('chagokchan_guard','chagokchan_rpc')) and (select not rolcanlogin and not rolsuper and rolbypassrls and not rolcreatedb and not rolcreaterole from pg_roles where rolname='chagokchan_session_reader'), 'API helper owners are non-login and only the isolated Auth reader can bypass managed-table RLS');
select ok((select bool_and(not pg_has_role(role,'chagokchan_rpc','MEMBER') and not pg_has_role(role,'chagokchan_guard','MEMBER') and not pg_has_role(role,'chagokchan_session_reader','MEMBER')) from unnest(array['anon','authenticated','service_role']) roles(role)) and pg_has_role('chagokchan_session_reader','authenticated','MEMBER') and not pg_has_role('chagokchan_session_reader','authenticated','SET') and not has_table_privilege('chagokchan_session_reader','public.goals','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') and not has_schema_privilege('chagokchan_session_reader','private','CREATE'), 'Auth reader inherits authenticated schema access but cannot be assumed by API roles or read product tables');
select not has_schema_privilege('chagokchan_guard','auth','USAGE') and not has_column_privilege('chagokchan_guard','auth.sessions','id','SELECT') and has_schema_privilege('chagokchan_session_reader','auth','USAGE') and has_column_privilege('chagokchan_session_reader','auth.sessions','id','SELECT') and not has_column_privilege('chagokchan_session_reader','auth.sessions','refresh_token_hmac_key','SELECT') and not has_column_privilege('chagokchan_session_reader','auth.users','email','SELECT') and not has_column_privilege('chagokchan_session_reader','public.goals','private_description','SELECT') as auth_reader_has_only_required_columns \gset
select ok(:'auth_reader_has_only_required_columns' = 't', 'Auth reader can check issued sessions without token, mailbox or product-content privileges');
select ok(not has_schema_privilege('chagokchan_guard','private','CREATE') and not has_schema_privilege('chagokchan_rpc','public','CREATE'), 'owner transfer leaves no schema CREATE privilege');
select ok((select p.prosecdef and r.rolname='chagokchan_rpc' and 'search_path=pg_catalog'=any(p.proconfig) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='public' and p.proname='get_me') and (select p.prosecdef and r.rolname='chagokchan_session_reader' and 'search_path=pg_catalog'=any(p.proconfig) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='private' and p.proname='require_session_user'), 'get_me and session check use fixed search paths with isolated owners');
select ok(private.session_within_window(now()-interval '29 days',(now()-interval '6 days') at time zone 'UTC',null), 'recently refreshed session inside max age is allowed');
select ok(not private.session_within_window(now()-interval '30 days',now() at time zone 'UTC',null), 'exact max-age boundary is expired');
select ok(not private.session_within_window(now()-interval '8 days',(now()-interval '7 days') at time zone 'UTC',null), 'exact inactivity boundary is expired');
-- 9..12: absent times, provider deadline, time-zone independence, anonymous guard.
select ok(not private.session_within_window(null,now() at time zone 'UTC',null), 'missing managed session creation time fails closed');
select ok(not private.session_within_window(now(),now() at time zone 'UTC',now()), 'provider not_after deadline is enforced immediately');
set local timezone = 'Asia/Seoul';
select ok(private.session_within_window(now()-interval '8 days',(now()-interval '6 days 23 hours') at time zone 'UTC',null), 'naive refreshed_at is interpreted as UTC independently of display zone');
set local role authenticated;
select throws_ok('select public.get_me()', 'PT401', 'unauthenticated', 'protected RPC needs a live issued session, not role alone');
reset role;

create temporary table ids(key text primary key,value uuid not null);
insert into ids select raw_app_meta_data->>'fixture_actor',id from auth.users where raw_app_meta_data->>'fixture_project'='chagokchan' and raw_app_meta_data->>'local_fixture'='true';
insert into ids select key,gen_random_uuid() from unnest(array['goal','personal','shared','personal_bunch','shared_bunch','receipt','peer_receipt','praise','peer_praise','invite','request']) keys(key);
create function pg_temp.id(name text) returns uuid language sql stable as $$select value from pg_temp.ids where key=name$$;
insert into public.goals(id,owner_user_id,title) values(pg_temp.id('goal'),pg_temp.id('A'),'Boundary rollback fixture');
insert into public.boards(id,goal_id,owner_user_id,kind) values
  (pg_temp.id('personal'),pg_temp.id('goal'),pg_temp.id('A'),'personal'),
  (pg_temp.id('shared'),pg_temp.id('goal'),pg_temp.id('A'),'shared');
insert into public.bunches(id,board_id,cycle_no,target_count) values
  (pg_temp.id('personal_bunch'),pg_temp.id('personal'),1,20),
  (pg_temp.id('shared_bunch'),pg_temp.id('shared'),1,20);
insert into public.request_receipts(id,actor_user_id,operation,request_key,input_hash,result_kind,result_id) values
  (pg_temp.id('receipt'),pg_temp.id('A'),'createPraise',gen_random_uuid(),repeat('3',64),'praise',pg_temp.id('praise')),
  (pg_temp.id('peer_receipt'),pg_temp.id('B'),'createPraise',gen_random_uuid(),repeat('4',64),'praise',pg_temp.id('peer_praise'));
insert into public.praises(id,board_id,bunch_id,actor_user_id,recipient_user_id,request_receipt_id,source,message) values
  (pg_temp.id('praise'),pg_temp.id('personal'),pg_temp.id('personal_bunch'),pg_temp.id('A'),pg_temp.id('A'),pg_temp.id('receipt'),'self','Self message');

-- 13..21: permanent reference shape and historical identity.
select throws_ok($$insert into public.shared_board_profiles(board_id,public_title) values(pg_temp.id('personal'),'Wrong board')$$,'23514',null,'private board cannot receive a shared profile');
select throws_ok($$insert into public.praises(id,board_id,bunch_id,actor_user_id,recipient_user_id,request_receipt_id,source) values(pg_temp.id('peer_praise'),pg_temp.id('personal'),pg_temp.id('personal_bunch'),pg_temp.id('B'),pg_temp.id('A'),pg_temp.id('peer_receipt'),'peer')$$,'23514',null,'peer praise cannot be put on a personal board');
select throws_ok($$insert into public.praises(id,board_id,bunch_id,actor_user_id,recipient_user_id,request_receipt_id,source) values(gen_random_uuid(),pg_temp.id('shared'),pg_temp.id('shared_bunch'),pg_temp.id('B'),pg_temp.id('A'),pg_temp.id('peer_receipt'),'peer')$$,'23514',null,'praise identity must match its recorded creation result');
select throws_ok($$update public.app_users set adult_confirmed_at=adult_confirmed_at+interval '1 second' where id=pg_temp.id('A')$$,'23514',null,'initial adult confirmation is immutable');
select throws_ok($$update public.boards set kind='shared' where id=pg_temp.id('personal')$$,'23514',null,'board kind cannot rewrite record meaning');
select throws_ok($$update public.bunches set target_count=30 where id=pg_temp.id('personal_bunch')$$,'23514',null,'bunch keeps its original target snapshot');
select throws_ok($$update public.request_receipts set result_id=gen_random_uuid() where id=pg_temp.id('receipt')$$,'23514',null,'successful request result cannot be replaced');
update public.praises set cancelled_at=now(),message=null where id=pg_temp.id('praise');
select throws_ok($$update public.praises set cancelled_at=null where id=pg_temp.id('praise')$$,'23514',null,'cancelled praise cannot be restored');
select throws_ok($$insert into public.board_members(board_id,user_id,connection_id,connection_generation,granted_by_user_id) values(pg_temp.id('shared'),pg_temp.id('C'),'30000000-0000-4000-8000-000000000001',1,pg_temp.id('A'))$$,'23514',null,'grant connection must join its owner and contributor');

select * from finish();
rollback;
