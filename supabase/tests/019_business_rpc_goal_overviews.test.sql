-- W26: synthetic setup, session checks and every write roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(16);
select ok((select prosecdef and 'search_path=pg_catalog'=any(proconfig) and pg_get_userbyid(proowner)='chagokchan_rpc'
  from pg_proc where oid='public.list_goal_overviews(text,integer,text)'::regprocedure),'fixed path and non-login RPC owner');
select ok(has_function_privilege('authenticated','public.list_goal_overviews(text,integer,text)','execute')
  and not has_function_privilege('anon','public.list_goal_overviews(text,integer,text)','execute')
  and not has_function_privilege('service_role','public.list_goal_overviews(text,integer,text)','execute'),'only authenticated API entry');
select ok(not has_table_privilege('authenticated','public.goals','select') and not has_table_privilege('authenticated','public.boards','select'),'no new direct product reads');
select throws_ok('select public.list_goal_overviews()','PT401','unauthenticated','live session is mandatory');
select gen_random_uuid() as owner_id, gen_random_uuid() as other_id, gen_random_uuid() as owner_session, gen_random_uuid() as other_session \gset
insert into auth.users(id,is_anonymous,created_at) values (:'owner_id',false,now()),(:'other_id',false,now());
insert into auth.sessions(id,user_id,created_at,refreshed_at) values (:'owner_session',:'owner_id',now(),now() at time zone 'UTC'),(:'other_session',:'other_id',now(),now() at time zone 'UTC');
insert into public.app_users(id,adult_confirmed_at,registration_policy_version) values (:'owner_id',now(),'w26-test'),(:'other_id',now(),'w26-test');
insert into public.profiles(user_id) values (:'owner_id'),(:'other_id');
select set_config('request.jwt.claims',jsonb_build_object('sub',:'owner_id','role','authenticated','session_id',:'owner_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select is(public.list_goal_overviews()->'items','[]'::jsonb,'empty owner list');
select public.create_goal(gen_random_uuid(),'W26 shared',null,20::smallint,'{"title":"W26 public","description":null,"target_count":20}'::jsonb) as first_goal \gset
select public.create_goal(gen_random_uuid(),'W26 archived',null,20::smallint,null) as second_goal \gset
select public.archive_goal((:'second_goal'::jsonb->>'id')::uuid,1) as archive_result \gset
select set_config('request.jwt.claims',jsonb_build_object('sub',:'other_id','role','authenticated','session_id',:'other_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select public.create_goal(gen_random_uuid(),'W26 other private',null,20::smallint,null) as other_goal \gset
select set_config('request.jwt.claims',jsonb_build_object('sub',:'owner_id','role','authenticated','session_id',:'owner_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select is(jsonb_array_length(public.list_goal_overviews()->'items'),2,'another owner is excluded');
select is((select jsonb_agg(item->'goal' order by ordinal) from jsonb_array_elements(public.list_goal_overviews()->'items') with ordinality entries(item,ordinal)),public.list_goals()->'items','same goal order and exact legacy summaries');
select is((select item from jsonb_array_elements(public.list_goal_overviews()->'items') entries(item) where item->'goal'->>'id'=:'first_goal'::jsonb->>'id'),public.get_goal((:'first_goal'::jsonb->>'id')::uuid),'exact existing owner detail projection');
select is((select jsonb_array_length(item->'boards') from jsonb_array_elements(public.list_goal_overviews()->'items') entries(item) where item->'goal'->>'id'=:'first_goal'::jsonb->>'id'),2,'personal and shared cards remain independent');
select is(jsonb_array_length(public.list_goal_overviews(p_status=>'active')->'items'),1,'status filter preserved');
select throws_ok('select public.list_goal_overviews(p_limit=>51)','PT400','invalid_page_size','page bound preserved');
select public.list_goal_overviews(p_limit=>1) as first_page \gset
select public.list_goal_overviews(p_cursor=>:'first_page'::jsonb->>'next_cursor',p_limit=>1) as second_page \gset
select ok(:'first_page'::jsonb->'items'->0->'goal'->>'id' <> :'second_page'::jsonb->'items'->0->'goal'->>'id' and :'second_page'::jsonb->'next_cursor'='null'::jsonb,'cursor has no duplicate or extra row');
select is(:'first_page'::jsonb->'next_cursor',public.list_goals(p_limit=>1)->'next_cursor','legacy cursor compatibility');
select throws_ok(format('select public.list_goal_overviews(%L,1,%L)',:'first_page'::jsonb->>'next_cursor','active'),'PT400','goal_cursor_filter_mismatch','filter-bound cursor cannot be replayed with another filter');
select public.delete_goal((:'first_goal'::jsonb->>'id')::uuid,1) as delete_result \gset
select is(jsonb_array_length(public.list_goal_overviews()->'items'),1,'deleted goal is immediately excluded');
delete from auth.sessions where id=:'owner_session';
select throws_ok('select public.list_goal_overviews()','PT401','unauthenticated','revoked session cannot reuse overview reads');
select * from finish();
rollback;
