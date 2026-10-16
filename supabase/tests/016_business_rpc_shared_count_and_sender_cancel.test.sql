-- W09-D / TC-SHARED-COUNT-001. Synthetic users/sessions and all writes roll back.
-- These fixtures do not represent an Auth-issued or Google/OTP login test.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(39);

select ok((select not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb
  and not rolcreaterole and not rolreplication and rolbypassrls
  from pg_roles where rolname = 'chagokchan_counter'), 'counter has only the specified role attributes');
-- Supabase automatically grants postgres membership via supabase_admin, as for
-- the existing session_reader/worker roles. Allow that platform default;
-- counter must join no role, and API roles must not be members of counter.
select ok(not exists(select 1 from pg_auth_members m
  join pg_roles granted_role on granted_role.oid = m.roleid
  join pg_roles member_role on member_role.oid = m.member
  where member_role.rolname = 'chagokchan_counter'
    or (granted_role.rolname = 'chagokchan_counter'
      and member_role.rolname in ('anon','authenticated','service_role','chagokchan_rpc'))),
  'counter joins no role and API roles are not counter members');
with expected as (
  select table_name, privilege_type, unnest(columns) as column_name from (values
    ('praises','SELECT',array['id','board_id','bunch_id','actor_user_id','source','cancelled_at','excluded_at']),
    ('boards','SELECT',array['id','goal_id','owner_user_id']),
    ('goals','SELECT',array['id','owner_user_id','status']),
    ('goals','UPDATE',array['revision']),
    ('bunches','SELECT',array['id','board_id','target_count','valid_count','progress_state','completed_at']),
    ('bunches','UPDATE',array['valid_count','progress_state','completed_at'])
  ) e(table_name, privilege_type, columns)
), actual as (
  select table_name::text, privilege_type::text, column_name::text from information_schema.column_privileges
    where grantee = 'chagokchan_counter'
)
select ok(not exists((select * from actual except select * from expected)
  union all (select * from expected except select * from actual)), 'counter column grants match the entire allowlist');
select ok(not exists(select 1 from information_schema.table_privileges where grantee = 'chagokchan_counter'),
  'counter has no whole-table grants, including INSERT or DELETE');
select ok(has_schema_privilege('chagokchan_counter','private','USAGE')
  and has_schema_privilege('chagokchan_counter','public','USAGE')
  and has_function_privilege('chagokchan_counter','private.require_actor()','EXECUTE')
  and not has_schema_privilege('chagokchan_counter','private','CREATE')
  and not has_schema_privilege('chagokchan_counter','public','CREATE')
  and not has_schema_privilege('chagokchan_rpc','public','CREATE'), 'required helper access remains without schema CREATE');
select ok((select count(*) = 2 and bool_and(p.prosecdef and p.provolatile = 'v'
  and 'search_path=pg_catalog' = any(p.proconfig) and r.rolname = 'chagokchan_counter')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
  where n.nspname = 'private' and p.proname in ('lock_praise_cycle','recount_bunch')),
  'both helpers have counter ownership, volatile SECURITY DEFINER and fixed search_path');
select ok((select bool_and(has_function_privilege('chagokchan_rpc',signature,'EXECUTE')
  and not has_function_privilege('authenticated',signature,'EXECUTE')
  and not has_function_privilege('anon',signature,'EXECUTE')
  and not has_function_privilege('service_role',signature,'EXECUTE')) from (values
  ('private.lock_praise_cycle(uuid)'),('private.recount_bunch(uuid,timestamp with time zone)')) f(signature)),
  'only the RPC owner may enter the internal helpers');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
  lateral aclexplode(p.proacl) a where n.nspname = 'private'
  and p.proname in ('lock_praise_cycle','recount_bunch')
  and a.grantee not in (p.proowner, 'chagokchan_rpc'::regrole::oid)), 'helper ACLs expose no PUBLIC or additional executor');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
  where oid in ('public.goals'::regclass,'public.bunches'::regclass,'public.praises'::regclass))
  and not (select rolbypassrls from pg_roles where rolname = 'chagokchan_rpc')
  and not exists(select 1 from pg_policies where 'chagokchan_counter' = any(roles)), 'FORCE RLS and ordinary RPC boundaries remain');
select is((select count(*)::integer from public.bunches bu where bu.valid_count <>
  (select count(*) from public.praises p where p.bunch_id = bu.id and p.cancelled_at is null and p.excluded_at is null)),
  0, 'migration repair left zero mismatching existing cycles before synthetic writes');

select gen_random_uuid() as owner_id, gen_random_uuid() as p1_id, gen_random_uuid() as p2_id,
  gen_random_uuid() as owner_session, gen_random_uuid() as p1_session, gen_random_uuid() as p2_session \gset
insert into auth.users(id,is_anonymous,created_at) values (:'owner_id',false,now()),(:'p1_id',false,now()),(:'p2_id',false,now());
insert into auth.sessions(id,user_id,created_at,refreshed_at) values
  (:'owner_session',:'owner_id',now(),now() at time zone 'UTC'),
  (:'p1_session',:'p1_id',now(),now() at time zone 'UTC'),
  (:'p2_session',:'p2_id',now(),now() at time zone 'UTC');
insert into public.app_users(id,adult_confirmed_at,registration_policy_version) values
  (:'owner_id',now(),'w09-d-test'),(:'p1_id',now(),'w09-d-test'),(:'p2_id',now(),'w09-d-test');
insert into public.profiles(user_id) values (:'owner_id'),(:'p1_id'),(:'p2_id');
insert into public.connections(user_low_id,user_high_id,status,generation,connected_at) values
  (least(:'owner_id'::uuid,:'p1_id'::uuid),greatest(:'owner_id'::uuid,:'p1_id'::uuid),'active',1,now()),
  (least(:'owner_id'::uuid,:'p2_id'::uuid),greatest(:'owner_id'::uuid,:'p2_id'::uuid),'active',1,now());
select id as connection_id from public.connections where user_low_id = least(:'owner_id'::uuid,:'p1_id'::uuid)
  and user_high_id = greatest(:'owner_id'::uuid,:'p1_id'::uuid) \gset
select set_config('request.jwt.claims',jsonb_build_object('sub',:'owner_id','role','authenticated',
  'session_id',:'owner_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
set local role authenticated;
select public.create_goal(gen_random_uuid(),'공유 집계 검사',null,5::smallint,
  '{"title":"공유 집계","target_count":5}'::jsonb)->>'id' as goal_id \gset
reset role;
select id as shared_id from public.boards where goal_id = :'goal_id' and kind = 'shared' \gset
select id as personal_id from public.boards where goal_id = :'goal_id' and kind = 'personal' \gset
set local role authenticated;
select public.grant_board_member(:'shared_id',:'p1_id') as granted \gset
select public.grant_board_member(:'shared_id',:'p2_id') as granted \gset
select public.create_personal_praise(gen_random_uuid(),:'personal_id','원자 제거',current_date,'care') as self_praise \gset
-- Keep real authenticated calls, but capture their SQLSTATE without using pgTAP
-- until the role is reset: authenticated has no extensions schema USAGE.
do $$
begin
  perform private.lock_praise_cycle(gen_random_uuid());
  perform set_config('test.w09_d_lock_helper_sqlstate','00000',true);
exception when others then
  perform set_config('test.w09_d_lock_helper_sqlstate',sqlstate,true);
end $$;
do $$
begin
  perform private.recount_bunch(gen_random_uuid(),now());
  perform set_config('test.w09_d_recount_helper_sqlstate','00000',true);
exception when others then
  perform set_config('test.w09_d_recount_helper_sqlstate',sqlstate,true);
end $$;
reset role;
select is(current_setting('test.w09_d_lock_helper_sqlstate'),'42501','authenticated cannot call lock helper directly');
select is(current_setting('test.w09_d_recount_helper_sqlstate'),'42501','authenticated cannot call recount helper directly');

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',:'p1_id','role','authenticated',
  'session_id',:'p1_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select public.create_peer_praise(gen_random_uuid(),:'shared_id','첫 칭찬') as p1_first \gset
select set_config('request.jwt.claims',jsonb_build_object('sub',:'p2_id','role','authenticated',
  'session_id',:'p2_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select gen_random_uuid() as p2_key \gset
select public.create_peer_praise(:'p2_key',:'shared_id','둘째 칭찬') as p2_first \gset
select public.create_peer_praise(gen_random_uuid(),:'shared_id','셋째 칭찬') as p2_second \gset
select public.create_peer_praise(:'p2_key',:'shared_id','둘째 칭찬') as p2_replayed \gset
reset role;
select is(:'p2_replayed'::jsonb::text,
  (:'p2_first'::jsonb || '{"replayed":true}'::jsonb)::text,'peer creation replay keeps the original identity');
select is((select valid_count from public.bunches where id = (:'p1_first'::jsonb->>'bunch_id')::uuid),3,
  'two contributors with three praises count all three despite RLS');
select is((select valid_count from public.bunches where id = (:'self_praise'::jsonb->>'bunch_id')::uuid),1,
  'shared recount leaves the independent personal cycle unchanged');
-- SECURITY DEFINER business-error checks use the existing authenticated claims,
-- as in 015, while pgTAP remains available to the test runner.
select throws_ok(format('select public.cancel_praise(%L)',:'p1_first'::jsonb->>'id'),
  'PT404','praise_not_found','another author receives the same 404 as an absent praise');
select throws_ok('select public.cancel_praise(gen_random_uuid())','PT404','praise_not_found','unknown praise receives 404');
select set_config('request.jwt.claims',jsonb_build_object('sub',:'p1_id','role','authenticated',
  'session_id',:'p1_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
set local role authenticated;
select public.cancel_praise((:'p1_first'::jsonb->>'id')::uuid) as p1_cancelled \gset
select public.cancel_praise((:'p1_first'::jsonb->>'id')::uuid) as p1_cancel_retry \gset
reset role;
select is(:'p1_cancelled'::jsonb->>'replayed','false','first author cancels their own praise');
select is(:'p1_cancel_retry'::jsonb->>'replayed','true','same cancellation replays');
select is((select valid_count from public.bunches where id = (:'p1_first'::jsonb->>'bunch_id')::uuid),2,
  'cancellation and replay leave both other-author praises counted');
set local role authenticated;
select public.create_peer_praise(gen_random_uuid(),:'shared_id','연결 종료 후 취소') as p1_later \gset
select set_config('request.jwt.claims',jsonb_build_object('sub',:'p2_id','role','authenticated',
  'session_id',:'p2_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select public.create_peer_praise(gen_random_uuid(),:'shared_id','제외 뒤 취소') as p2_excluded \gset
select public.create_peer_praise(gen_random_uuid(),:'shared_id','완성 칭찬') as p2_last \gset
reset role;
select is((select jsonb_build_array(valid_count,progress_state,completed_at is not null)
  from public.bunches where id = (:'p1_first'::jsonb->>'bunch_id')::uuid)::text,'[5,"complete",true]'::jsonb::text,
  'mixed-author target completes with a completion timestamp');
select is((select count(*)::integer from public.notifications where bunch_id = (:'p1_first'::jsonb->>'bunch_id')::uuid
  and type = 'bunch_completed'),1,'mixed-author completion creates exactly one completion notice');
set local role authenticated;
select public.cancel_praise((:'p2_last'::jsonb->>'id')::uuid) as p2_last_cancelled \gset
reset role;
select is(:'p2_last_cancelled'::jsonb->>'replayed','false','cancelling from a completed cycle succeeds');
select is((select jsonb_build_array(valid_count,progress_state,completed_at)
  from public.bunches where id = (:'p1_first'::jsonb->>'bunch_id')::uuid)::text,'[4,"incomplete",null]'::jsonb::text,
  'cancellation below target clears completion state and timestamp');
set local role authenticated;
select public.create_peer_praise(gen_random_uuid(),:'shared_id','재완성') as p2_refill \gset
select set_config('request.jwt.claims',jsonb_build_object('sub',:'owner_id','role','authenticated',
  'session_id',:'owner_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select public.exclude_peer_praise((:'p2_excluded'::jsonb->>'id')::uuid) as excluded \gset
select public.disconnect(:'connection_id') as disconnected \gset
reset role;
select ok((select status = 'inactive' from public.connections where id = :'connection_id')
  and (select status = 'revoked' from public.board_members where board_id = :'shared_id' and user_id = :'p1_id'),
  'disconnect ended both the connection and board grant');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',:'p1_id','role','authenticated',
  'session_id',:'p1_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select public.cancel_praise((:'p1_later'::jsonb->>'id')::uuid) as p1_later_cancelled \gset
select public.cancel_praise((:'p1_later'::jsonb->>'id')::uuid) as p1_later_cancel_retry \gset
reset role;
select is(:'p1_later_cancelled'::jsonb->>'replayed','false','disconnected author can still cancel');
select is(:'p1_later_cancel_retry'::jsonb->>'replayed','true','disconnected cancellation replay succeeds');
select is((select valid_count from public.bunches where id = (:'p1_first'::jsonb->>'bunch_id')::uuid),3,
  'disconnected cancellation recounts remaining other-author records exactly once');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',:'p2_id','role','authenticated',
  'session_id',:'p2_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select public.cancel_praise((:'p2_excluded'::jsonb->>'id')::uuid) as p2_excluded_cancelled \gset
reset role;
select is(:'p2_excluded_cancelled'::jsonb->>'replayed','false','excluded praise may be cancelled by its author');
select is((select valid_count from public.bunches where id = (:'p1_first'::jsonb->>'bunch_id')::uuid),3,
  'cancelling an excluded praise does not decrease the count again');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',:'owner_id','role','authenticated',
  'session_id',:'owner_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select public.revoke_board_member(:'shared_id',:'p2_id') as revoked \gset
select public.cancel_praise((:'self_praise'::jsonb->>'id')::uuid) as self_cancelled \gset
reset role;
select ok((select cancelled_at is not null and message is null and occurred_on is null and tag is null
  from public.praises where id = (:'self_praise'::jsonb->>'id')::uuid),'self cancellation clears message, date and tag atomically');
select is((select valid_count from public.bunches where id = (:'self_praise'::jsonb->>'bunch_id')::uuid),0,
  'self cancellation still recounts its original cycle');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',:'p2_id','role','authenticated',
  'session_id',:'p2_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select public.cancel_praise((:'p2_second'::jsonb->>'id')::uuid) as p2_second_cancelled \gset
reset role;
select is(:'p2_second_cancelled'::jsonb->>'replayed','false','revoked author cancels while the connection remains active');
select is((select valid_count from public.bunches where id = (:'p1_first'::jsonb->>'bunch_id')::uuid),2,
  'grant revocation does not prevent an accurate recount');
select revision as goal_revision from public.goals where id = :'goal_id' \gset
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',:'owner_id','role','authenticated',
  'session_id',:'owner_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select public.delete_goal(:'goal_id',:'goal_revision') as deleted \gset
select set_config('request.jwt.claims',jsonb_build_object('sub',:'p2_id','role','authenticated',
  'session_id',:'p2_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
reset role;
select throws_ok(format('select public.cancel_praise(%L)',:'p2_first'::jsonb->>'id'),
  'PT404','praise_not_found','deleted goal rejects a fresh cancellation');
select throws_ok(format('select public.cancel_praise(%L)',:'p2_second'::jsonb->>'id'),
  'PT404','praise_not_found','deleted goal check precedes cancellation replay');
set local role chagokchan_rpc;
select private.lock_praise_cycle((:'p2_first'::jsonb->>'id')::uuid) as locked_cycle \gset
reset role;
select is(:'locked_cycle'::jsonb::text,
  jsonb_build_object('goal_status','deleted','bunch_id',(:'p1_first'::jsonb->>'bunch_id')::uuid,
    'board_id',:'shared_id'::uuid,'target_count',5)::text, 'lock helper returns only the four allowed context fields');
select is((select count(*)::integer from public.notifications where bunch_id = (:'p1_first'::jsonb->>'bunch_id')::uuid
  and type = 'bunch_completed'),1,'recompletion and cancellations never duplicate completion notices');
select is((select count(*)::integer from public.bunches bu where bu.valid_count <>
  (select count(*) from public.praises p where p.bunch_id = bu.id and p.cancelled_at is null and p.excluded_at is null)),
  0,'all cycles match actual valid praise counts after every scenario');

select * from finish();
rollback;
