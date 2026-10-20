-- W25 / TC-PRAISE-TAG-002. Synthetic identities and every change roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(40);
select ok(has_function_privilege('authenticated','public.create_personal_praise_with_tags(uuid,uuid,text,date,text[])','execute')
  and not has_function_privilege('anon','public.create_personal_praise_with_tags(uuid,uuid,text,date,text[])','execute')
  and not has_function_privilege('service_role','public.create_personal_praise_with_tags(uuid,uuid,text,date,text[])','execute'), 'only verified API role can enter array RPC');
select ok(not has_function_privilege('authenticated','private.create_self_praise_core(uuid,uuid,text,date,text,text[])','execute'), 'atomic core is internal only');
select ok((select prosecdef and 'search_path=pg_catalog'=any(proconfig) and pg_get_userbyid(proowner)='chagokchan_rpc'
  from pg_proc where oid='public.create_personal_praise_with_tags(uuid,uuid,text,date,text[])'::regprocedure), 'restricted owner and fixed path');
select ok(not has_column_privilege('authenticated','public.praises','tags','INSERT') and not has_column_privilege('authenticated','public.praises','tags','UPDATE'), 'no direct user tag writes');
select is(private.normalize_praise_tags(array['꾸준','용기']),array['꾸준','용기'],'custom values preserve order');
select is(private.normalize_praise_tags(array['Work','work','é','é']),array['Work','é'],'NFC and ASCII duplicate folding');
select is(private.normalize_praise_tags(array['漢字','العربية','कर्म','𐐀','새_출발-2']),array['漢字','العربية','कर्म','𐐀','새_출발-2'],'Unicode category parity');
select lives_ok($$select private.normalize_praise_tags(array[repeat('가',20)])$$,'twenty codepoints accepted');
select throws_ok($$select private.normalize_praise_tags(array[repeat('가',21)])$$,'PT400','invalid_praise_input','overlong tag rejected');
select throws_ok($$select private.normalize_praise_tags(array['a','b','c','d','e','f'])$$,'PT400','invalid_praise_input','six tags rejected');
select throws_ok($$select private.normalize_praise_tags(array['#용기'])$$,'PT400','invalid_praise_input','prefix is display only');
select throws_ok($$select private.normalize_praise_tags(array['a b'])$$,'PT400','invalid_praise_input','embedded whitespace rejected');
select throws_ok($$select private.normalize_praise_tags(array['🙂'])$$,'PT400','invalid_praise_input','symbols rejected consistently');
select throws_ok($$select private.normalize_praise_tags(array[null]::text[])$$,'PT400','invalid_praise_input','null element rejected');
select throws_ok($$select private.normalize_praise_tags(array['_'])$$,'PT400','invalid_praise_input','name needs a letter or number');
select throws_ok($$select private.normalize_praise_tags(array[array['a'],array['b']])$$,'PT400','invalid_praise_input','multidimensional array rejected');

select gen_random_uuid() as owner_id, gen_random_uuid() as owner_session, gen_random_uuid() as goal_key,
  gen_random_uuid() as praise_key, gen_random_uuid() as legacy_key \gset
insert into auth.users(id,is_anonymous,created_at) values (:'owner_id',false,now());
insert into auth.sessions(id,user_id,created_at,refreshed_at) values (:'owner_session',:'owner_id',now(),now() at time zone 'UTC');
insert into public.app_users(id,adult_confirmed_at,registration_policy_version) values (:'owner_id',now(),'w25-test');
insert into public.profiles(user_id) values (:'owner_id');
select set_config('request.jwt.claims',jsonb_build_object('sub',:'owner_id','role','authenticated','session_id',:'owner_session','exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true) as claims \gset
select public.create_goal(:'goal_key','사용자 태그 검사',null,2::smallint,'{"title":"공유판","target_count":2}'::jsonb)->>'id' as goal_id \gset
select id as board_id from public.boards where goal_id=:'goal_id' and kind='personal' \gset
select public.create_personal_praise_with_tags(:'praise_key',:'board_id',null,null,array['꾸준','용기']) as praise \gset
select is((:'praise'::jsonb->>'replayed'),'false','array creation commits once');
select is((select tags from public.praises where id=(:'praise'::jsonb->>'id')::uuid),array['꾸준','용기'],'array persisted');
select is((select tag from public.praises where id=(:'praise'::jsonb->>'id')::uuid),null::text,'custom array has no legacy code projection');
select is(public.create_personal_praise_with_tags(:'praise_key',:'board_id',null,null,array['꾸준','용기'])->>'replayed','true','same array replays');
select throws_ok(format('select public.create_personal_praise_with_tags(%L,%L,null,null,array[%L,%L])',:'praise_key',:'board_id','용기','꾸준'),'PT409','idempotency_conflict','changed array order conflicts');
select is(public.edit_self_praise((:'praise'::jsonb->>'id')::uuid,'{"message":"메모"}')->>'replayed','false','unrelated legacy edit still works');
select is((select tags from public.praises where id=(:'praise'::jsonb->>'id')::uuid),array['꾸준','용기'],'omitted tags preserved');
select throws_ok(format('select public.edit_self_praise(%L,%L::jsonb)',:'praise'::jsonb->>'id','{"tag":null}'),'PT409','legacy_tag_conflict','legacy edit cannot erase custom tags');
select is(public.edit_self_praise((:'praise'::jsonb->>'id')::uuid,'{"tags":["배려"]}')->>'replayed','false','new patch replaces tags');
select is((select tag from public.praises where id=(:'praise'::jsonb->>'id')::uuid),'care','single legacy name projects compatibility code');
select is(public.edit_self_praise((:'praise'::jsonb->>'id')::uuid,'{"tags":["배려"]}')->>'replayed','true','same patch is no-op');
select throws_ok(format('select public.edit_self_praise(%L,%L::jsonb)',:'praise'::jsonb->>'id','{"tag":null,"tags":[]}'),'PT400','invalid_praise_patch','mixed fields rejected');
select is((public.list_board_praises_with_tags(:'board_id')->'items'->0->'tags'),'["배려"]'::jsonb,'owner response exposes all tags');
select public.create_personal_praise(:'legacy_key',:'board_id',null,null,'rest') as legacy \gset
select is((select tags from public.praises where id=(:'legacy'::jsonb->>'id')::uuid),array['쉼'],'old RPC writes new array');
select is(public.create_personal_praise(:'legacy_key',:'board_id',null,null,'rest')->>'replayed','true','old hash remains compatible');
select is((select valid_count from public.bunches where id=(:'praise'::jsonb->>'bunch_id')::uuid),2,'edits and replay do not inflate count');
select public.cancel_praise((:'praise'::jsonb->>'id')::uuid) as cancelled \gset
select is((select tags from public.praises where id=(:'praise'::jsonb->>'id')::uuid),'{}'::text[],'cancel clears array in same transaction');
select is((select tag from public.praises where id=(:'praise'::jsonb->>'id')::uuid),null::text,'cancel clears compatibility tag');
select is((select valid_count from public.bunches where id=(:'praise'::jsonb->>'bunch_id')::uuid),1,'cancel recount preserved');
select ok(not (public.list_board_praises(:'board_id')->'items'->0 ? 'tags'),'old owner RPC retains its exact response fields');
select ok(has_function_privilege('authenticated','public.list_board_praises_with_tags(uuid,uuid,text,integer,boolean)','execute')
  and not has_function_privilege('anon','public.list_board_praises_with_tags(uuid,uuid,text,integer,boolean)','execute'),'array list retains authenticated-only entry');
select ok((select prosecdef and 'search_path=pg_catalog'=any(proconfig) and pg_get_userbyid(proowner)='chagokchan_rpc'
  from pg_proc where oid='public.list_board_praises_with_tags(uuid,uuid,text,integer,boolean)'::regprocedure),'array list owner and path remain restricted');
select public.list_board_praises_with_tags(:'board_id',p_limit=>1) as first_page \gset
select public.list_board_praises_with_tags(:'board_id',p_cursor=>:'first_page'::jsonb->>'next_cursor',p_limit=>1) as second_page \gset
select ok(jsonb_array_length(:'first_page'::jsonb->'items')=1 and jsonb_array_length(:'second_page'::jsonb->'items')=1
  and :'first_page'::jsonb->'items'->0->>'id' <> :'second_page'::jsonb->'items'->0->>'id'
  and :'second_page'::jsonb->'next_cursor'='null'::jsonb,'array list cursor returns each row once and terminates');
select is(public.list_board_praises(:'board_id',p_limit=>1),jsonb_build_object('items',jsonb_build_array((:'first_page'::jsonb->'items'->0)-'tags'),
  'next_cursor',:'first_page'::jsonb->'next_cursor'),'legacy pagination equals the array response without the new key');
select * from finish();
rollback;
