-- W20-A / TC-PRAISE-TAG-001. All synthetic rows and session metadata roll back.
-- These database fixtures do not claim an Auth-issued login integration pass.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(40);

select ok((select count(*) = 3 from information_schema.column_privileges
  where table_schema='public' and table_name='praises' and column_name='tag'
    and grantee='chagokchan_rpc' and privilege_type in ('SELECT','INSERT','UPDATE')),
  'RPC owner has precisely the three required tag column grants');
select ok(not exists(select 1 from information_schema.column_privileges
  where table_schema='public' and table_name='praises' and column_name='tag'
    and grantee in ('PUBLIC','anon','authenticated','service_role')),
  'API roles have no direct tag column privileges');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('create_praise','create_personal_praise')
    and p.proargtypes='2950 2950 25 1082'::oidvector), 'old four-argument overloads and grants are absent');
select ok((select count(*)=2 and bool_and(p.prosecdef and 'search_path=pg_catalog'=any(p.proconfig)
    and r.rolname='chagokchan_rpc') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    join pg_roles r on r.oid=p.proowner where n.nspname='public'
    and p.proname in ('create_praise','create_personal_praise') and p.proargtypes='2950 2950 25 1082 25'::oidvector),
  'new overloads retain restricted ownership and fixed-search-path SECURITY DEFINER');
select ok((select bool_and(has_function_privilege('authenticated',signature,'EXECUTE')
    and not has_function_privilege('anon',signature,'EXECUTE')
    and not has_function_privilege('service_role',signature,'EXECUTE')) from (values
    ('public.create_praise(uuid,uuid,text,date,text)'),
    ('public.create_personal_praise(uuid,uuid,text,date,text)')) signatures(signature)),
  'only authenticated API sessions can enter new overloads');
select ok(not has_schema_privilege('chagokchan_rpc','public','CREATE') and
  not has_schema_privilege('chagokchan_rpc','private','CREATE'), 'ownership transfer leaves no schema CREATE grants');

select gen_random_uuid() as owner_id, gen_random_uuid() as peer_id,
  gen_random_uuid() as owner_session, gen_random_uuid() as peer_session,
  gen_random_uuid() as goal_key, gen_random_uuid() as tagged_key, gen_random_uuid() as plain_key \gset
insert into auth.users(id, is_anonymous, created_at) values (:'owner_id',false,now()),(:'peer_id',false,now());
insert into auth.sessions(id,user_id,created_at,refreshed_at)
  values (:'owner_session',:'owner_id',now(),now() at time zone 'UTC'),
         (:'peer_session',:'peer_id',now(),now() at time zone 'UTC');
insert into public.app_users(id,adult_confirmed_at,registration_policy_version)
  values (:'owner_id',now(),'w20-a-test'),(:'peer_id',now(),'w20-a-test');
insert into public.profiles(user_id) values (:'owner_id'),(:'peer_id');
select set_config('request.jwt.claims',jsonb_build_object('sub',:'owner_id','role','authenticated',
  'session_id',:'owner_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select public.create_goal(:'goal_key','태그 검사',null,2::smallint,
  '{"title":"공유 태그 검사","target_count":2}'::jsonb)->>'id' as goal_id \gset
select id as board_id from public.boards where goal_id=:'goal_id' and kind='personal' \gset
select id as shared_id from public.boards where goal_id=:'goal_id' and kind='shared' \gset

select public.create_personal_praise(:'tagged_key',:'board_id','기록',null,'consistency') as tagged \gset
select is((select tag from public.praises where id=(:'tagged'::jsonb->>'id')::uuid),'consistency','create stores self tag');
select is((:'tagged'::jsonb->>'replayed')::boolean,false,'initial tagged request is not replayed');
select is(public.create_personal_praise(:'tagged_key',:'board_id','기록',null,'consistency'),
  :'tagged'::jsonb || '{"replayed":true}'::jsonb,'same tag replays the same praise and cycle');
select throws_ok(format('select public.create_personal_praise(%L,%L,%L,null,%L)',
  :'tagged_key',:'board_id','기록','courage'),'PT409','idempotency_conflict','different tag conflicts with the same key');
select throws_ok(format('select public.create_praise(gen_random_uuid(),%L,null,null,%L)',:'board_id','unknown'),
  'PT400','invalid_praise_input','unknown tag code is rejected before writes');
select is((select valid_count from public.bunches where id=(:'tagged'::jsonb->>'bunch_id')::uuid),1,
  'tagged creation and replay count exactly once');

select public.create_personal_praise(:'plain_key',:'board_id',E'줄\r\n바꿈',null) as plain \gset
select is((select tag from public.praises where id=(:'plain'::jsonb->>'id')::uuid),null::text,'omitted tag defaults to null');
select is((select input_hash from public.request_receipts where actor_user_id=:'owner_id' and request_key=:'plain_key'),
  encode(sha256(convert_to(jsonb_build_object('board_id',:'board_id'::uuid,'message',E'줄\n바꿈','occurred_on',null)::text,'UTF8')),'hex'),
  'tagless input retains the pre-migration canonical hash including normalization');
select is(public.create_personal_praise(:'plain_key',:'board_id',E'줄\r\n바꿈',null,null),
  :'plain'::jsonb || '{"replayed":true}'::jsonb,'explicit null and omitted tag replay identically');
select throws_ok(format('select public.create_praise(%L,%L,E''줄\r\n바꿈'',null,%L)',:'plain_key',:'board_id','care'),
  'PT409','idempotency_conflict','adding a tag to a tagless receipt conflicts');
select is((select valid_count from public.bunches where id=(:'tagged'::jsonb->>'bunch_id')::uuid),2,
  'tagged and tagless praises each add one');
select is((select progress_state from public.bunches where id=(:'tagged'::jsonb->>'bunch_id')::uuid),'complete',
  'completion is independent of tag presence');
select is((select count(*)::integer from public.notifications where recipient_user_id=:'owner_id' and type='bunch_completed'),1,
  'tags and retries produce exactly one completion notice');

select is(public.edit_self_praise((:'tagged'::jsonb->>'id')::uuid,'{"tag":"courage"}')->>'replayed','false','changing only tag is not replayed');
select is((select tag from public.praises where id=(:'tagged'::jsonb->>'id')::uuid),'courage','tag edit is persisted');
select is(public.edit_self_praise((:'tagged'::jsonb->>'id')::uuid,'{"tag":"courage"}')->>'replayed','true','identical tag edit is replayed');
select public.edit_self_praise((:'tagged'::jsonb->>'id')::uuid,'{"message":"변경"}') as edited \gset
select is((select tag from public.praises where id=(:'tagged'::jsonb->>'id')::uuid),'courage','omitted patch key preserves tag');
select is(public.edit_self_praise((:'tagged'::jsonb->>'id')::uuid,'{"tag":null}')->>'replayed','false','explicit null removes the tag');
select is((select tag from public.praises where id=(:'tagged'::jsonb->>'id')::uuid),null::text,'removed tag is null');
select throws_ok(format('select public.edit_self_praise(%L,%L)',:'tagged'::jsonb->>'id','{"tag":"invalid"}'),
  'PT400','invalid_praise_patch','unknown edit code is rejected');
select throws_ok(format('select public.edit_self_praise(%L,%L)',:'tagged'::jsonb->>'id','{"tag":["care"]}'),
  'PT400','invalid_praise_patch','array tag is rejected');
select throws_ok(format('select public.edit_self_praise(%L,%L)',:'tagged'::jsonb->>'id','{"tag":true}'),
  'PT400','invalid_praise_patch','non-string tag is rejected');
select public.edit_self_praise((:'tagged'::jsonb->>'id')::uuid,'{"tag":"care"}') as edited \gset
select public.edit_self_praise((:'tagged'::jsonb->>'id')::uuid,'{"tag":"growth"}') as edited \gset
select public.edit_self_praise((:'tagged'::jsonb->>'id')::uuid,'{"tag":"rest"}') as edited \gset
select is((select tag from public.praises where id=(:'tagged'::jsonb->>'id')::uuid),'rest','all five fixed codes can be stored');
select is((select jsonb_build_array(valid_count,progress_state) from public.bunches where id=(:'tagged'::jsonb->>'bunch_id')::uuid),
  '[2,"complete"]'::jsonb,'tag edits leave count and completion unchanged');
select ok((select bool_and(item ? 'tag') from jsonb_array_elements(public.list_board_praises(:'board_id')->'items') item),
  'owner projection always includes nullable tag');

-- Establish a valid synthetic shared-board relationship without modifying existing fixtures.
insert into public.connections(user_low_id,user_high_id,status,generation,connected_at)
  values (least(:'owner_id'::uuid,:'peer_id'::uuid),greatest(:'owner_id'::uuid,:'peer_id'::uuid),'active',1,now());
select public.grant_board_member(:'shared_id',:'peer_id') as granted \gset
select set_config('request.jwt.claims',jsonb_build_object('sub',:'peer_id','role','authenticated',
  'session_id',:'peer_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select public.create_peer_praise(gen_random_uuid(),:'shared_id','응원') as peer_praise \gset
select is((select tag from public.praises where id=(:'peer_praise'::jsonb->>'id')::uuid),null::text,'peer RPC always stores null tag');
select throws_ok(format('update public.praises set tag=%L where id=%L','care',:'peer_praise'::jsonb->>'id'),
  '23514',null,'physical constraint rejects a peer tag even for privileged writes');
select ok((select bool_and(not (item ? 'tag')) from jsonb_array_elements(public.list_board_praises(:'shared_id')->'items') item),
  'contributor projection has no tag key');
select set_config('request.jwt.claims',jsonb_build_object('sub',:'owner_id','role','authenticated',
  'session_id',:'owner_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select is(public.list_board_praises(:'shared_id')->'items'->0->'tag','null'::jsonb,'shared owner sees peer tag as null');

select public.cancel_praise((:'tagged'::jsonb->>'id')::uuid) as cancelled \gset
select ok((select cancelled_at is not null and tag is null and message is null and occurred_on is null
  from public.praises where id=(:'tagged'::jsonb->>'id')::uuid),'cancel clears tag and content atomically');
select throws_ok(format('update public.praises set tag=%L where id=%L','care',:'tagged'::jsonb->>'id'),
  '23514',null,'cancelled row cannot retain a tag');
select is((select valid_count from public.bunches where id=(:'tagged'::jsonb->>'bunch_id')::uuid),1,
  'cancel decreases only the original cycle count');
select is(public.cancel_praise((:'tagged'::jsonb->>'id')::uuid)->>'replayed','true','cancel retry is idempotent');
select is((select count(*)::integer from public.notifications where recipient_user_id=:'owner_id' and type='bunch_completed'),1,
  'tag edits and cancellation do not duplicate completion notices');

select * from finish();
rollback;
