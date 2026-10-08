-- W06-C1 follow-up: accepted-connection notices use the schema's single connection target.
begin;

create or replace function public.accept_connection_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; request_row record; connection_row record; now_at timestamptz := clock_timestamp(); active_low integer; active_high integer;
begin
  actor := private.require_actor();
  select cr.id, cr.connection_id, cr.requester_user_id, cr.approver_user_id, cr.status, cr.expires_at,
    c.user_low_id, c.user_high_id into request_row
    from public.connection_requests cr join public.connections c on c.id = cr.connection_id
    where cr.id = p_request_id and cr.approver_user_id = actor;
  if not found then raise exception using errcode = 'PT404', message = 'connection_request_not_found'; end if;
  if request_row.status = 'accepted' then return jsonb_build_object('id', request_row.id, 'replayed', true); end if;
  if request_row.status <> 'pending' then raise exception using errcode = 'PT409', message = 'connection_request_resolved'; end if;
  perform private.lock_connection_capacity(request_row.user_low_id);
  perform private.lock_connection_capacity(request_row.user_high_id);
  perform private.lock_connection_pair(request_row.user_low_id, request_row.user_high_id);
  select cr.id, cr.connection_id, cr.requester_user_id, cr.approver_user_id, cr.status, cr.expires_at
    into request_row from public.connection_requests cr where cr.id = p_request_id and cr.approver_user_id = actor for update;
  if not found then raise exception using errcode = 'PT404', message = 'connection_request_not_found'; end if;
  if request_row.status = 'accepted' then return jsonb_build_object('id', request_row.id, 'replayed', true); end if;
  if request_row.status <> 'pending' then raise exception using errcode = 'PT409', message = 'connection_request_resolved'; end if;
  if request_row.expires_at <= now_at then raise exception using errcode = 'PT409', message = 'connection_request_expired'; end if;
  select c.id, c.user_low_id, c.user_high_id, c.status, c.generation into connection_row
    from public.connections c where c.id = request_row.connection_id for update;
  if not found then raise exception using errcode = 'PT503', message = 'connection_incomplete'; end if;
  if exists (select 1 from public.blocks bl where bl.revoked_at is null and
      ((bl.blocker_user_id = connection_row.user_low_id and bl.blocked_user_id = connection_row.user_high_id) or
       (bl.blocker_user_id = connection_row.user_high_id and bl.blocked_user_id = connection_row.user_low_id))) then
    raise exception using errcode = 'PT409', message = 'connection_blocked';
  end if;
  if connection_row.status = 'active' then raise exception using errcode = 'PT409', message = 'connection_already_active'; end if;
  select count(*)::integer into active_low from public.connections c where c.status = 'active' and connection_row.user_low_id in (c.user_low_id, c.user_high_id);
  select count(*)::integer into active_high from public.connections c where c.status = 'active' and connection_row.user_high_id in (c.user_low_id, c.user_high_id);
  if active_low >= 200 or active_high >= 200 then raise exception using errcode = 'PT409', message = 'active_connection_limit'; end if;
  update public.connections set status = 'active', generation = generation + 1, connected_at = now_at, disconnected_at = null where id = connection_row.id;
  update public.connection_requests set status = 'accepted', resolved_at = now_at where id = request_row.id;
  insert into public.notifications(recipient_user_id, actor_user_id, type, dedupe_key, connection_id)
    values (request_row.requester_user_id, actor, 'connection_accepted', 'connection-accepted:' || request_row.id::text, connection_row.id)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  return jsonb_build_object('id', request_row.id, 'replayed', false);
end $$;

alter function public.accept_connection_request(uuid) owner to chagokchan_rpc;
revoke all on function public.accept_connection_request(uuid) from public, anon, authenticated, service_role;
grant execute on function public.accept_connection_request(uuid) to authenticated;

drop policy rpc_connection_transition_notifications_insert on public.notifications;
drop policy rpc_connection_transition_notifications_select on public.notifications;

create policy rpc_connection_transition_notifications_insert on public.notifications for insert to chagokchan_rpc
  with check (
    (type = 'connection_requested' and exists (
      select 1 from public.connection_requests cr where cr.id = connection_request_id and cr.status = 'pending'
        and cr.requester_user_id = private.require_actor() and recipient_user_id = cr.approver_user_id
        and actor_user_id = cr.requester_user_id
    )) or
    (type = 'connection_accepted' and exists (
      select 1 from public.connection_requests cr join public.connections c on c.id = cr.connection_id
      where c.id = connection_id and cr.status = 'accepted' and cr.approver_user_id = private.require_actor()
        and recipient_user_id = cr.requester_user_id and actor_user_id = cr.approver_user_id
    ))
  );

create policy rpc_connection_transition_notifications_select on public.notifications for select to chagokchan_rpc
  using (
    (type = 'connection_requested' and exists (
      select 1 from public.connection_requests cr where cr.id = connection_request_id and cr.status = 'pending'
        and cr.requester_user_id = private.require_actor() and recipient_user_id = cr.approver_user_id
        and actor_user_id = cr.requester_user_id
    )) or
    (type = 'connection_accepted' and exists (
      select 1 from public.connection_requests cr join public.connections c on c.id = cr.connection_id
      where c.id = connection_id and cr.status = 'accepted' and cr.approver_user_id = private.require_actor()
        and recipient_user_id = cr.requester_user_id and actor_user_id = cr.approver_user_id
    ))
  );

commit;
