-- W06-D2 follow-up: expose validated identity to the restricted RPC owner without widening the Auth reader.
begin;
grant create on schema private to chagokchan_guard;
set local role chagokchan_guard;
create function private.session_account_id() returns uuid
language sql stable security definer set search_path = pg_catalog
as $$ select private.require_session_user() $$;
revoke all on function private.session_account_id() from public, anon, authenticated, service_role;
grant execute on function private.session_account_id() to chagokchan_rpc;
reset role;
revoke create on schema private from chagokchan_guard;

alter policy rpc_session_deletion_request_select on public.account_deletion_requests
  using (subject_auth_user_id = private.session_account_id());
alter policy rpc_session_deletion_request_insert on public.account_deletion_requests
  with check (subject_auth_user_id = private.session_account_id() and user_id = subject_auth_user_id
    and status = 'pending' and checkpoint = 'access_revoked' and request_key is not null and input_hash is not null);
alter policy rpc_session_account_deletion_update on public.app_users
  using (id = private.session_account_id())
  with check (id = private.session_account_id() and account_status = 'deleting' and deactivated_at is not null);
alter policy rpc_session_reauth_select on public.reauth_grants
  using (user_id = private.session_account_id());
alter policy rpc_session_reauth_consume on public.reauth_grants
  using (user_id = private.session_account_id()) with check (user_id = private.session_account_id());

create or replace function public.request_account_deletion(
  p_request_key uuid, p_reauth_grant_id uuid, p_confirm boolean
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; session_uuid uuid; account_state text; request_hash text; existing record;
  grant_id uuid; request_uuid uuid := gen_random_uuid(); now_at timestamptz := clock_timestamp();
begin
  actor := private.session_account_id();
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
notify pgrst, 'reload schema';
commit;
