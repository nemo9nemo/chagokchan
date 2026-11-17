-- W12-E: self profile patches; no caller-specified identity or direct API DML.
begin;
grant create on schema public to chagokchan_rpc;
grant update (nickname, avatar_key, updated_at) on public.profiles to chagokchan_rpc;
create policy rpc_self_profile_update on public.profiles for update to chagokchan_rpc
  using (user_id = private.require_actor()) with check (user_id = private.require_actor());

create function public.update_my_profile(p_nickname text default null, p_avatar_key text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; normalized_name text; now_at timestamptz; utc_minute timestamptz;
begin
  actor := private.session_account_id();
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:' || actor::text, 0));
  actor := private.require_actor();
  if p_nickname is null and p_avatar_key is null then
    raise exception using errcode = 'PT400', message = 'invalid_profile_input';
  end if;
  if p_nickname is not null then
    normalized_name := normalize(btrim(p_nickname), NFC);
    if char_length(normalized_name) not between 1 and 20 or normalized_name ~ '[[:cntrl:]]' or normalized_name !~ '[^[:space:]]' then
      raise exception using errcode = 'PT400', message = 'invalid_profile_input';
    end if;
  end if;
  if p_avatar_key is not null and p_avatar_key not in ('grape', 'leaf', 'star') then
    raise exception using errcode = 'PT400', message = 'invalid_profile_input';
  end if;
  now_at := clock_timestamp();
  utc_minute := date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(actor, 'profile_update_minute', 10, utc_minute, utc_minute + interval '1 minute');
  update public.profiles set nickname = coalesce(normalized_name, nickname),
    avatar_key = coalesce(p_avatar_key, avatar_key), updated_at = now_at where user_id = actor;
  if not found then raise exception using errcode = 'PT503', message = 'account_incomplete'; end if;
  return public.get_me();
end $$;
alter function public.update_my_profile(text, text) owner to chagokchan_rpc;
revoke all on function public.update_my_profile(text, text) from public, anon, authenticated, service_role;
grant execute on function public.update_my_profile(text, text) to authenticated;

create or replace function public.preview_connection_invite(p_secret jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; secret_digest text; invite_row record; display_name text;
  utc_minute timestamptz; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  secret_digest := private.connection_secret_hash(p_secret);
  utc_minute := date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(actor, 'invite_use_user_15_minutes', 10, date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC' -
    (extract(minute from now_at at time zone 'UTC')::integer % 15) * interval '1 minute',
    date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC' -
    (extract(minute from now_at at time zone 'UTC')::integer % 15) * interval '1 minute' + interval '15 minutes');
  perform set_config('chagokchan.invite_secret_hash', secret_digest, true);
  select i.id, i.inviter_user_id, i.expires_at into invite_row from public.connection_invites i
    where (i.link_hash = secret_digest or i.code_hash = secret_digest) and i.redeemed_at is null and i.revoked_at is null and i.expires_at > now_at;
  if not found or invite_row.inviter_user_id = actor then raise exception using errcode = 'PT404', message = 'invite_unavailable'; end if;
  perform private.lock_connection_pair(actor, invite_row.inviter_user_id);
  if exists (select 1 from public.blocks bl where bl.revoked_at is null and
      ((bl.blocker_user_id = actor and bl.blocked_user_id = invite_row.inviter_user_id) or
       (bl.blocker_user_id = invite_row.inviter_user_id and bl.blocked_user_id = actor))) then
    raise exception using errcode = 'PT404', message = 'invite_unavailable';
  end if;
  perform set_config('chagokchan.preview_profile_id', invite_row.inviter_user_id::text, true);
  select p.nickname into display_name from public.profiles p join public.app_users a on a.id = p.user_id
    where p.user_id = invite_row.inviter_user_id and a.account_status = 'active';
  if display_name is null then raise exception using errcode = 'PT404', message = 'invite_unavailable'; end if;
  return jsonb_build_object('inviter_nickname', display_name, 'expires_at', invite_row.expires_at, 'inviter_display_code', upper(right(replace(invite_row.inviter_user_id::text, '-', ''), 12)));
end $$;

revoke create on schema public from chagokchan_rpc;
notify pgrst, 'reload schema';
commit;
