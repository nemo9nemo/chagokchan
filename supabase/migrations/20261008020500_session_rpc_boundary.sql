-- W06-A: live session/account guard, least-privilege owners, self account projection.
begin;
create role chagokchan_guard nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role chagokchan_rpc nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant chagokchan_guard, chagokchan_rpc to postgres;
grant usage on schema public, private to chagokchan_guard, chagokchan_rpc;
grant usage on schema auth to chagokchan_guard;
-- Ownership transfer requires CREATE, removed before committing this migration.
grant create on schema private to chagokchan_guard;
grant create on schema public to chagokchan_rpc;

grant select (id, user_id, created_at, refreshed_at, not_after) on auth.sessions to chagokchan_guard;
grant select (id, banned_until, deleted_at, is_anonymous) on auth.users to chagokchan_guard;
grant select (id, account_status) on public.app_users to chagokchan_guard;
grant select (id, goal_id, owner_user_id, kind) on public.boards to chagokchan_guard;
grant select (id, user_low_id, user_high_id, status, generation) on public.connections to chagokchan_guard;
grant select (id, actor_user_id, operation, result_kind, result_id) on public.request_receipts to chagokchan_guard;
grant select (id, inviter_user_id) on public.connection_invites to chagokchan_guard;

-- This role can inspect only the listed metadata columns and cannot log in.
create policy guard_account_metadata on public.app_users for select to chagokchan_guard using (true);
create policy guard_board_metadata on public.boards for select to chagokchan_guard using (true);
create policy guard_connection_metadata on public.connections for select to chagokchan_guard using (true);
create policy guard_receipt_metadata on public.request_receipts for select to chagokchan_guard using (true);
create policy guard_invite_metadata on public.connection_invites for select to chagokchan_guard using (true);

create function private.session_within_window(created timestamptz, refreshed timestamp, deadline timestamptz) returns boolean
language sql stable set search_path = pg_catalog
as $$ select coalesce(
  created is not null and created <= now() + interval '1 minute' and
  created + interval '30 days' > now() and
  coalesce(refreshed at time zone 'UTC', created) + interval '7 days' > now() and
  (deadline is null or deadline > now()), false
) $$;
alter function private.session_within_window(timestamptz, timestamp, timestamptz) owner to chagokchan_guard;
revoke all on function private.session_within_window(timestamptz, timestamp, timestamptz) from public, anon, authenticated, service_role;

create function private.require_session_user() returns uuid
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; session_uuid uuid; claims jsonb; valid boolean;
begin
  claims := auth.jwt();
  if claims->>'role' is distinct from 'authenticated' or
     coalesce(claims->>'exp', '') !~ '^[0-9]{1,16}$' then
    raise exception using errcode = 'PT401', message = 'unauthenticated';
  end if;
  begin
    actor := auth.uid();
    session_uuid := nullif(claims->>'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'PT401', message = 'unauthenticated';
  end;
  if actor is null or session_uuid is null or (claims->>'exp')::bigint <= extract(epoch from now()) then
    raise exception using errcode = 'PT401', message = 'unauthenticated';
  end if;
  select exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = session_uuid and s.user_id = actor
      -- Auth refreshed_at has no time zone: interpret it explicitly as UTC.
      and private.session_within_window(s.created_at, s.refreshed_at, s.not_after)
      and u.deleted_at is null and not u.is_anonymous
      and (u.banned_until is null or u.banned_until <= now())
  ) into valid;
  if not valid then raise exception using errcode = 'PT401', message = 'unauthenticated'; end if;
  return actor;
end $$;
alter function private.require_session_user() owner to chagokchan_guard;
revoke all on function private.require_session_user() from public, anon, authenticated, service_role;
grant execute on function private.require_session_user() to chagokchan_rpc;

create function private.require_actor() returns uuid
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; state text;
begin
  actor := private.require_session_user();
  select account_status into state from public.app_users where id = actor;
  if state is null then raise exception using errcode = 'PT403', message = 'signup_required'; end if;
  if state <> 'active' then raise exception using errcode = 'PT403', message = 'account_unavailable'; end if;
  return actor;
end $$;
alter function private.require_actor() owner to chagokchan_guard;
revoke all on function private.require_actor() from public, anon, authenticated, service_role;
grant execute on function private.require_actor() to chagokchan_rpc;

grant select (id, account_status, timezone, adult_confirmed_at, registration_policy_version) on public.app_users to chagokchan_rpc;
grant select (user_id, nickname, avatar_key) on public.profiles to chagokchan_rpc;
create policy rpc_self_account on public.app_users for select to chagokchan_rpc using (id = private.require_actor());
create policy rpc_self_profile on public.profiles for select to chagokchan_rpc using (user_id = private.require_actor());

create function public.get_me() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; result jsonb;
begin
  actor := private.require_actor();
  select jsonb_build_object(
    'user_id', a.id,
    'profile', jsonb_build_object('user_id', p.user_id, 'nickname', p.nickname, 'avatar_key', p.avatar_key),
    'timezone', a.timezone, 'account_status', a.account_status,
    'adult_confirmed_at', a.adult_confirmed_at, 'registration_policy_version', a.registration_policy_version
  ) into result from public.app_users a join public.profiles p on p.user_id = a.id where a.id = actor;
  if result is null then raise exception using errcode = 'PT503', message = 'account_incomplete'; end if;
  return result;
end $$;
alter function public.get_me() owner to chagokchan_rpc;
revoke all on function public.get_me() from public, anon, authenticated, service_role;
grant execute on function public.get_me() to authenticated;

-- Permanent cross-table identity/type checks; temporal permission checks remain in RPCs.
create function private.enforce_reference_shape() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
declare board_kind text; owner_uuid uuid; pair_low uuid; pair_high uuid; issuer uuid; receipt record;
begin
  if tg_table_name in ('shared_board_profiles', 'board_members', 'praises') then
    select kind, owner_user_id into board_kind, owner_uuid from public.boards where id = new.board_id;
    if tg_table_name in ('shared_board_profiles', 'board_members') and board_kind is distinct from 'shared' then
      raise exception using errcode = '23514', message = 'shared_board_required';
    end if;
  end if;
  if tg_table_name = 'board_members' then
    select user_low_id, user_high_id into pair_low, pair_high from public.connections where id = new.connection_id;
    if pair_low is distinct from least(new.user_id, owner_uuid) or pair_high is distinct from greatest(new.user_id, owner_uuid) then
      raise exception using errcode = '23514', message = 'membership_connection_parties';
    end if;
  elsif tg_table_name = 'praises' then
    if (new.source = 'self' and board_kind is distinct from 'personal') or
       (new.source = 'peer' and board_kind is distinct from 'shared') then
      raise exception using errcode = '23514', message = 'praise_board_source';
    end if;
    select actor_user_id, operation, result_kind, result_id into receipt from public.request_receipts where id = new.request_receipt_id;
    if receipt.result_id is distinct from new.id or receipt.result_kind is distinct from 'praise' or
       receipt.operation is distinct from 'createPraise' or
       (new.author_erased_at is null and receipt.actor_user_id is distinct from new.actor_user_id) then
      raise exception using errcode = '23514', message = 'praise_creation_receipt';
    end if;
  elsif tg_table_name = 'connection_requests' then
    select user_low_id, user_high_id into pair_low, pair_high from public.connections where id = new.connection_id;
    select inviter_user_id into issuer from public.connection_invites where id = new.invite_id;
    if pair_low is distinct from least(new.requester_user_id, new.approver_user_id) or
       pair_high is distinct from greatest(new.requester_user_id, new.approver_user_id) or
       issuer is distinct from new.approver_user_id then
      raise exception using errcode = '23514', message = 'request_connection_parties';
    end if;
  end if;
  return new;
end $$;
alter function private.enforce_reference_shape() owner to chagokchan_guard;
revoke all on function private.enforce_reference_shape() from public, anon, authenticated, service_role;
create trigger shared_profile_shape before insert or update on public.shared_board_profiles for each row execute function private.enforce_reference_shape();
create trigger board_member_shape before insert or update on public.board_members for each row execute function private.enforce_reference_shape();
create trigger praise_shape before insert or update on public.praises for each row execute function private.enforce_reference_shape();
create trigger connection_request_shape before insert or update on public.connection_requests for each row execute function private.enforce_reference_shape();

create function private.enforce_record_identity() returns trigger
language plpgsql set search_path = pg_catalog
as $$
declare field text; old_value jsonb; new_value jsonb;
begin
  old_value := to_jsonb(old); new_value := to_jsonb(new);
  foreach field in array tg_argv loop
    if old_value->field is distinct from new_value->field then
      raise exception using errcode = '23514', message = 'immutable_record_identity';
    end if;
  end loop;
  if tg_table_name = 'praises' then
    if new.actor_user_id is not null and new.actor_user_id is distinct from old.actor_user_id then
      raise exception using errcode = '23514', message = 'immutable_praise_author';
    end if;
    foreach field in array array['cancelled_at','excluded_at','author_erased_at'] loop
      if old_value->field <> 'null'::jsonb and old_value->field is distinct from new_value->field then
        raise exception using errcode = '23514', message = 'irreversible_praise_state';
      end if;
    end loop;
    if old.source = 'peer' and new.message is distinct from old.message and not (
      new.message is null and (new.cancelled_at is not null or new.author_erased_at is not null)
    ) then raise exception using errcode = '23514', message = 'immutable_peer_message'; end if;
  end if;
  return new;
end $$;
alter function private.enforce_record_identity() owner to chagokchan_guard;
revoke all on function private.enforce_record_identity() from public, anon, authenticated, service_role;
create trigger app_account_identity before update on public.app_users for each row execute function private.enforce_record_identity('id','adult_confirmed_at','registration_policy_version','created_at');
create trigger goal_identity before update on public.goals for each row execute function private.enforce_record_identity('id','owner_user_id','created_at');
create trigger board_identity before update on public.boards for each row execute function private.enforce_record_identity('id','goal_id','owner_user_id','kind','created_at');
create trigger bunch_identity before update on public.bunches for each row execute function private.enforce_record_identity('id','board_id','cycle_no','target_count','rule_code','created_at');
create trigger praise_identity before update on public.praises for each row execute function private.enforce_record_identity('id','board_id','bunch_id','recipient_user_id','request_receipt_id','source','recorded_at');
create trigger receipt_identity before update on public.request_receipts for each row execute function private.enforce_record_identity('id','operation','request_key','result_kind','result_id','created_at');
create trigger connection_identity before update on public.connections for each row execute function private.enforce_record_identity('id','user_low_id','user_high_id','created_at');
create trigger invite_identity before update on public.connection_invites for each row execute function private.enforce_record_identity('id','inviter_user_id','link_hash','code_hash','expires_at','created_at');
create trigger connection_request_identity before update on public.connection_requests for each row execute function private.enforce_record_identity('id','connection_id','invite_id','requester_user_id','approver_user_id','expires_at','created_at');
create trigger board_member_identity before update on public.board_members for each row execute function private.enforce_record_identity('board_id','user_id');

revoke create on schema private from chagokchan_guard;
revoke create on schema public from chagokchan_rpc;
notify pgrst, 'reload schema';
commit;
