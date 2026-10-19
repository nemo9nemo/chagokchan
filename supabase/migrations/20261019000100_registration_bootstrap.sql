-- W12-B: explicit adult confirmation, atomic registration and self auth context.
begin;

grant create on schema public to chagokchan_rpc;
grant insert (id, adult_confirmed_at, registration_policy_version) on public.app_users to chagokchan_rpc;
grant insert (user_id, nickname, avatar_key) on public.profiles to chagokchan_rpc;

create policy rpc_signup_account_insert on public.app_users for insert to chagokchan_rpc
  with check (id = private.session_account_id() and account_status = 'active' and deactivated_at is null);
create policy rpc_signup_profile_insert on public.profiles for insert to chagokchan_rpc
  with check (user_id = private.session_account_id());

create function public.get_auth_context() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; state text;
begin
  actor := private.session_account_id();
  state := private.session_account_status();
  if state = 'active' then
    return jsonb_build_object('user_id', actor, 'account_state', 'active', 'next', '/');
  end if;
  if state = 'deleting' or exists (
    select 1 from public.account_deletion_requests r where r.subject_auth_user_id = actor
  ) then
    return jsonb_build_object('user_id', actor, 'account_state', 'deleting', 'next', '/account/deletion');
  end if;
  return jsonb_build_object('user_id', actor, 'account_state', 'signup_required', 'next', '/signup');
end $$;
alter function public.get_auth_context() owner to chagokchan_rpc;
revoke all on function public.get_auth_context() from public, anon, authenticated, service_role;
grant execute on function public.get_auth_context() to authenticated;

create function public.bootstrap_account(p_adult_confirmed boolean, p_registration_policy_version text) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; state text;
begin
  actor := private.session_account_id();
  if p_adult_confirmed is distinct from true or p_registration_policy_version is null or
     char_length(p_registration_policy_version) > 40 or p_registration_policy_version !~ '^[0-9]+\.[0-9]+\.[0-9]+$' then
    raise exception using errcode = 'PT400', message = 'invalid_registration';
  end if;
  -- Use the existing deletion namespace so registration and account deletion
  -- cannot pass each other's state check for the same Auth UUID.
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:' || actor::text, 0));
  state := private.session_account_status();
  if state = 'active' then return public.get_me(); end if;
  if state is not null or exists (
    select 1 from public.account_deletion_requests r where r.subject_auth_user_id = actor
  ) then
    raise exception using errcode = 'PT403', message = 'account_unavailable';
  end if;
  if p_registration_policy_version <> '0.2.0' then
    raise exception using errcode = 'PT409', message = 'policy_version_changed';
  end if;
  insert into public.app_users(id, adult_confirmed_at, registration_policy_version)
    values (actor, statement_timestamp(), '0.2.0');
  -- A theme is presentation, not the new account's common identity.
  insert into public.profiles(user_id, nickname, avatar_key)
    values (actor, '새로운 사용자', 'star');
  return public.get_me();
end $$;
alter function public.bootstrap_account(boolean, text) owner to chagokchan_rpc;
revoke all on function public.bootstrap_account(boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_account(boolean, text) to authenticated;

revoke create on schema public from chagokchan_rpc;
notify pgrst, 'reload schema';
commit;
