-- W06-D2 request boundary: consume a session-bound reauth grant and revoke access atomically.
begin;
grant create on schema public, private to chagokchan_rpc;
alter table public.account_deletion_requests add column request_key uuid;
alter table public.account_deletion_requests add column input_hash text check (input_hash is null or input_hash ~ '^[0-9a-f]{64}$');
create unique index account_deletion_requests_idempotency on public.account_deletion_requests(subject_auth_user_id, request_key)
  where request_key is not null;

grant select (id, user_id, subject_auth_user_id, request_key, input_hash, status, checkpoint),
  insert (id, user_id, subject_auth_user_id, request_key, input_hash, status, checkpoint)
  on public.account_deletion_requests to chagokchan_rpc;
create policy rpc_session_deletion_request_select on public.account_deletion_requests for select to chagokchan_rpc
  using (subject_auth_user_id = private.require_session_user());
create policy rpc_session_deletion_request_insert on public.account_deletion_requests for insert to chagokchan_rpc
  with check (subject_auth_user_id = private.require_session_user() and user_id = subject_auth_user_id
    and status = 'pending' and checkpoint = 'access_revoked' and request_key is not null and input_hash is not null);

grant select (id, account_status) on public.app_users to chagokchan_rpc;
grant update (account_status, deactivated_at) on public.app_users to chagokchan_rpc;
create policy rpc_session_account_deletion_update on public.app_users for update to chagokchan_rpc
  using (id = private.require_session_user())
  with check (id = private.require_session_user() and account_status = 'deleting' and deactivated_at is not null);

grant select (id, user_id, session_id, scope, verified_at, expires_at, consumed_at), update (consumed_at)
  on public.reauth_grants to chagokchan_rpc;
create policy rpc_session_reauth_select on public.reauth_grants for select to chagokchan_rpc
  using (user_id = private.require_session_user());
create policy rpc_session_reauth_consume on public.reauth_grants for update to chagokchan_rpc
  using (user_id = private.require_session_user()) with check (user_id = private.require_session_user());

-- Resolve account state through the existing session guard, without allowing a deleting account to pass require_actor().
grant create on schema private to chagokchan_guard;
set local role chagokchan_guard;
create function private.session_account_status() returns text
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; account_state text;
begin
  actor := private.require_session_user();
  select a.account_status into account_state from public.app_users a where a.id = actor;
  return account_state;
end $$;
revoke all on function private.session_account_status() from public, anon, authenticated, service_role;
grant execute on function private.session_account_status() to chagokchan_rpc;
reset role;
revoke create on schema private from chagokchan_guard;

-- Read the session claim only inside the existing Auth metadata reader.
grant create on schema private to chagokchan_session_reader;
grant chagokchan_session_reader to postgres with inherit false, set true;
set local role chagokchan_session_reader;
create function private.current_session_id() returns uuid
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare session_uuid uuid;
begin
  perform private.require_session_user();
  begin session_uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'PT401', message = 'unauthenticated';
  end;
  if session_uuid is null then raise exception using errcode = 'PT401', message = 'unauthenticated'; end if;
  return session_uuid;
end $$;
revoke all on function private.current_session_id() from public, anon, authenticated, service_role;
grant execute on function private.current_session_id() to chagokchan_rpc;

create function private.auth_user_is_live(p_user_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$ select exists(select 1 from auth.users u where u.id = p_user_id and u.deleted_at is null) $$;
revoke all on function private.auth_user_is_live(uuid) from public, anon, authenticated, service_role;
grant execute on function private.auth_user_is_live(uuid) to chagokchan_worker;
reset role;
revoke create on schema private from chagokchan_session_reader;
revoke chagokchan_session_reader from postgres;

create function public.request_account_deletion(
  p_request_key uuid, p_reauth_grant_id uuid, p_confirm boolean
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; session_uuid uuid; account_state text; request_hash text; existing record;
  grant_id uuid; request_uuid uuid := gen_random_uuid(); now_at timestamptz := clock_timestamp();
begin
  actor := private.require_session_user();
  session_uuid := private.current_session_id();
  if p_request_key is null or p_reauth_grant_id is null or p_confirm is distinct from true then
    raise exception using errcode = 'PT400', message = 'invalid_deletion_confirmation';
  end if;
  request_hash := encode(sha256(convert_to(jsonb_build_object(
    'reauth_grant_id', p_reauth_grant_id, 'confirm', p_confirm
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:' || actor::text, 0));

  select r.id, r.input_hash, r.status into existing from public.account_deletion_requests r
    where r.subject_auth_user_id = actor and r.request_key = p_request_key;
  if found then
    if existing.input_hash is distinct from request_hash then
      raise exception using errcode = 'PT409', message = 'idempotency_conflict';
    end if;
    return jsonb_build_object('id', existing.id, 'status', existing.status, 'access_revoked', true);
  end if;

  account_state := private.session_account_status();
  if account_state is null then raise exception using errcode = 'PT403', message = 'signup_required'; end if;
  if account_state <> 'active' then raise exception using errcode = 'PT403', message = 'account_unavailable'; end if;
  perform private.require_actor();

  update public.reauth_grants g set consumed_at = now_at
    where g.id = p_reauth_grant_id and g.user_id = actor and g.session_id = session_uuid
      and g.scope = 'account.delete' and g.consumed_at is null
      and g.verified_at <= now_at and g.verified_at >= now_at - interval '10 minutes'
      and g.expires_at > now_at and g.expires_at <= g.verified_at + interval '10 minutes'
    returning g.id into grant_id;
  if grant_id is null then raise exception using errcode = 'PT403', message = 'reauth_required'; end if;

  update public.app_users set account_status = 'deleting', deactivated_at = now_at
    where id = actor and account_status = 'active' and deactivated_at is null;
  if not found then raise exception using errcode = 'PT409', message = 'account_state_changed'; end if;

  insert into public.account_deletion_requests(id, user_id, subject_auth_user_id, request_key, input_hash, status, checkpoint, requested_at)
    values (request_uuid, actor, actor, p_request_key, request_hash, 'pending', 'access_revoked', now_at);
  return jsonb_build_object('id', request_uuid, 'status', 'pending', 'access_revoked', true);
end $$;
alter function public.request_account_deletion(uuid, uuid, boolean) owner to chagokchan_rpc;
revoke all on function public.request_account_deletion(uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.request_account_deletion(uuid, uuid, boolean) to authenticated;

-- Historical request rows, including completed ones, prevent the same Auth UUID from rejoining.
grant create on schema private to chagokchan_worker;
grant select (subject_auth_user_id) on public.account_deletion_requests to chagokchan_worker;
create function private.prevent_deleted_subject_rejoin() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if exists(select 1 from public.account_deletion_requests r where r.subject_auth_user_id = new.id) then
    raise exception using errcode = 'PT403', message = 'account_deletion_final';
  end if;
  return new;
end $$;
alter function private.prevent_deleted_subject_rejoin() owner to chagokchan_worker;
revoke all on function private.prevent_deleted_subject_rejoin() from public, anon, authenticated, service_role;
create trigger prevent_deleted_subject_rejoin before insert on public.app_users
  for each row execute function private.prevent_deleted_subject_rejoin();

notify pgrst, 'reload schema';
revoke create on schema public, private from chagokchan_rpc;
revoke create on schema private from chagokchan_worker;
commit;
