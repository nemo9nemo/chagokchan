-- Explicit local setup only. Managed Auth accounts are created by the Admin API.
-- Run with scripts/seed-local-fixtures.mjs, never by automatic db reset/start.
begin;
select set_config('chagokchan.fixture_a', :'actor_a', true);
select set_config('chagokchan.fixture_b', :'actor_b', true);
select set_config('chagokchan.fixture_c', :'actor_c', true);
select id from public.app_users where id in (:'actor_a'::uuid, :'actor_b'::uuid, :'actor_c'::uuid) order by id for update;
do $$
begin
  if exists (
    select 1 from public.app_users where id in (
      current_setting('chagokchan.fixture_a')::uuid,
      current_setting('chagokchan.fixture_b')::uuid,
      current_setting('chagokchan.fixture_c')::uuid
    ) and account_status <> 'active'
  ) or exists (
    select 1 from public.account_deletion_requests where subject_auth_user_id in (
      current_setting('chagokchan.fixture_a')::uuid,
      current_setting('chagokchan.fixture_b')::uuid,
      current_setting('chagokchan.fixture_c')::uuid
    ) and status in ('pending', 'running', 'failed')
  ) then raise exception 'Local fixture deletion in progress'; end if;
end $$;

-- These confirmation fields are synthetic setup values, not a human age declaration.
insert into public.app_users(id, adult_confirmed_at, registration_policy_version)
select actor_id, now(), :'policy_version' from (values (:'actor_a'::uuid), (:'actor_b'::uuid), (:'actor_c'::uuid)) as actors(actor_id)
on conflict (id) do nothing;
insert into public.profiles(user_id, nickname, avatar_key) values
  (:'actor_a'::uuid, '로컬 A', 'grape'), (:'actor_b'::uuid, '로컬 B', 'leaf'), (:'actor_c'::uuid, '로컬 C', 'star')
on conflict (user_id) do nothing;

insert into public.goals(id, owner_user_id, title, private_description)
values ('10000000-0000-4000-8000-000000000001', :'actor_a'::uuid, '오늘의 작은 수고', '개인 목표 메모: 공유판에는 이 문구가 나타나지 않습니다.')
on conflict (id) do nothing;
insert into public.boards(id, goal_id, owner_user_id, kind) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', :'actor_a'::uuid, 'personal'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', :'actor_a'::uuid, 'shared')
on conflict (id) do nothing;
insert into public.shared_board_profiles(board_id, public_title, public_description)
values ('20000000-0000-4000-8000-000000000002', '작은 수고 모으기', '지인의 응원을 따로 모으는 개발용 공유판입니다.')
on conflict (board_id) do nothing;

insert into public.connections(id, user_low_id, user_high_id, status, generation, connected_at)
values ('30000000-0000-4000-8000-000000000001', least(:'actor_a'::uuid, :'actor_b'::uuid), greatest(:'actor_a'::uuid, :'actor_b'::uuid), 'active', 1, now())
on conflict (id) do nothing;
insert into public.board_members(board_id, user_id, connection_id, connection_generation, granted_by_user_id)
values ('20000000-0000-4000-8000-000000000002', :'actor_b'::uuid, '30000000-0000-4000-8000-000000000001', 1, :'actor_a'::uuid)
on conflict (board_id, user_id) do nothing;
commit;
