-- W12-E: preserve the old preview projection for a rolling web deployment.
begin;
grant create on schema public to chagokchan_rpc;
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
  return jsonb_build_object('inviter_nickname', display_name, 'expires_at', invite_row.expires_at);
end $$;


create function public.preview_connection_invite_with_profile(p_secret jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare preview jsonb; inviter uuid;
begin
  -- The existing RPC validates the current actor, secret, rate, block and invite,
  -- then overwrites this transaction-local profile context for this exact invite.
  preview := public.preview_connection_invite(p_secret);
  inviter := nullif(current_setting('chagokchan.preview_profile_id', true), '')::uuid;
  if inviter is null then raise exception using errcode = 'PT503', message = 'preview_unavailable'; end if;
  return preview || jsonb_build_object('inviter_display_code', upper(right(replace(inviter::text, '-', ''), 12)));
end $$;
alter function public.preview_connection_invite_with_profile(jsonb) owner to chagokchan_rpc;
revoke all on function public.preview_connection_invite_with_profile(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.preview_connection_invite_with_profile(jsonb) to authenticated;

revoke create on schema public from chagokchan_rpc;
notify pgrst, 'reload schema';
commit;
