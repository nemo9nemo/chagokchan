-- W06-D1: recipient-scoped news, sent peer praise and goal trash lifecycle.
begin;

grant create on schema public, private to chagokchan_rpc;

-- This non-login bypass role can be used only as the owner of service-worker RPCs.
create role chagokchan_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication bypassrls;
grant chagokchan_worker to postgres;
grant usage on schema public, private, auth to chagokchan_worker;
grant create on schema public, private to chagokchan_worker;

-- Purge stays disabled until an independent deletion ledger is configured.
create table private.deletion_worker_config (
  singleton boolean primary key default true check (singleton),
  independent_ledger_enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
revoke all on private.deletion_worker_config from public, anon, authenticated, service_role;
grant select on private.deletion_worker_config to chagokchan_worker;
insert into private.deletion_worker_config(singleton, independent_ledger_enabled) values (true, false);

alter table public.account_deletion_requests add column ledger_reference uuid;

create function private.is_service_worker() returns boolean
language sql stable security definer set search_path = pg_catalog
as $$ select coalesce(auth.jwt()->>'role' = 'service_role', false) $$;
alter function private.is_service_worker() owner to chagokchan_worker;
revoke all on function private.is_service_worker() from public, anon, authenticated, service_role;

create function private.require_service_worker() returns void
language plpgsql stable security definer set search_path = pg_catalog
as $$
begin
  if not private.is_service_worker() then
    raise exception using errcode = 'PT403', message = 'worker_only';
  end if;
end $$;
alter function private.require_service_worker() owner to chagokchan_worker;
revoke all on function private.require_service_worker() from public, anon, authenticated, service_role;

create function private.notification_target_visible(p_notification_id uuid, p_actor uuid) returns boolean
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare notice record;
begin
  if p_actor is null or p_actor <> private.require_actor() then return false; end if;
  select n.recipient_user_id, n.actor_user_id, n.type, n.praise_id, n.bunch_id,
    n.connection_request_id, n.connection_id into notice from public.notifications n
    where n.id = p_notification_id and n.recipient_user_id = p_actor;
  if not found then return false; end if;
  if notice.type = 'praise_received' then
    return exists (
      select 1 from public.praises p
      join public.boards b on b.id = p.board_id
      join public.goals g on g.id = b.goal_id and g.owner_user_id = b.owner_user_id
      where p.id = notice.praise_id and p.recipient_user_id = p_actor and p.source = 'peer' and g.status <> 'deleted'
    );
  elsif notice.type = 'bunch_completed' then
    return exists (
      select 1 from public.bunches bu
      join public.boards b on b.id = bu.board_id
      join public.goals g on g.id = b.goal_id and g.owner_user_id = b.owner_user_id
      where bu.id = notice.bunch_id and b.kind = 'shared' and g.status <> 'deleted'
        and b.owner_user_id = p_actor and notice.recipient_user_id = p_actor
    );
  elsif notice.type = 'connection_requested' then
    return exists (
      select 1 from public.connection_requests cr
      where cr.id = notice.connection_request_id and p_actor in (cr.requester_user_id, cr.approver_user_id)
    );
  elsif notice.type = 'connection_accepted' then
    return exists (
      select 1 from public.connections c
      where c.id = notice.connection_id and p_actor in (c.user_low_id, c.user_high_id)
    );
  end if;
  return false;
end $$;
alter function private.notification_target_visible(uuid, uuid) owner to chagokchan_rpc;
revoke all on function private.notification_target_visible(uuid, uuid) from public, anon, authenticated, service_role;

grant select (id, recipient_user_id, actor_user_id, type, praise_id, bunch_id, connection_request_id, connection_id, created_at, read_at),
  update (read_at) on public.notifications to chagokchan_rpc;
create policy rpc_recipient_notifications_select on public.notifications for select to chagokchan_rpc
  using (recipient_user_id = private.require_actor());
create policy rpc_recipient_notifications_update on public.notifications for update to chagokchan_rpc
  using (recipient_user_id = private.require_actor()) with check (recipient_user_id = private.require_actor());
grant select (id, praise_id, bunch_id), delete on public.notifications to chagokchan_worker;

grant select (id, board_id, actor_user_id, recipient_user_id, source, message, recorded_at, cancelled_at, request_receipt_id)
  on public.praises to chagokchan_rpc;
create policy rpc_sender_peer_praises_select on public.praises for select to chagokchan_rpc
  using (actor_user_id = private.require_actor() and source = 'peer');
grant select (id, board_id, request_receipt_id), delete on public.praises to chagokchan_worker;

grant select (id, owner_user_id, title, status, revision, created_at, deleted_at, purge_after),
  update (status, revision, deleted_at, purge_after, archived_at) on public.goals to chagokchan_rpc;
grant select (id, owner_user_id, status, purge_after), delete on public.goals to chagokchan_worker;

grant select (id, goal_id, owner_user_id, kind, current_bunch_id), update (current_bunch_id) on public.boards to chagokchan_rpc;
grant select (id, goal_id, owner_user_id, kind, current_bunch_id), update (current_bunch_id), delete on public.boards to chagokchan_worker;
grant select (board_id), delete on public.shared_board_profiles to chagokchan_worker;
grant select (id, board_id), delete on public.bunches to chagokchan_worker;
grant select (board_id, user_id, status, granted_by_user_id, revoked_at), update (status, revoked_at) on public.board_members to chagokchan_rpc;
grant select (board_id), delete on public.board_members to chagokchan_worker;
grant select (id, actor_user_id, operation, request_key, result_kind, result_id), delete on public.request_receipts to chagokchan_worker;
grant select (id, object_id), delete on public.audit_events to chagokchan_worker;
grant select (id, account_status) on public.app_users to chagokchan_worker;

create function public.list_notifications(p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid;
  item record; item_count integer := 0; items jsonb := '[]'::jsonb; next_cursor text := null;
  last_at timestamptz; last_id uuid;
begin
  actor := private.require_actor();
  if p_limit not between 1 and 50 then raise exception using errcode = 'PT400', message = 'invalid_page_size'; end if;
  cursor_value := private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at := (cursor_value->>0)::timestamptz; cursor_id := (cursor_value->>1)::uuid; end if;
  for item in
    select n.id, n.type, n.created_at, n.read_at, n.praise_id, n.bunch_id, n.connection_request_id, n.connection_id
    from public.notifications n
    where n.recipient_user_id = actor
      and (cursor_at is null or (n.created_at, n.id) < (cursor_at, cursor_id))
      and private.notification_target_visible(n.id, actor)
    order by n.created_at desc, n.id desc limit p_limit + 1
  loop
    if item_count = p_limit then
      next_cursor := private.encode_relationship_cursor(last_at, last_id);
      exit;
    end if;
    items := items || jsonb_build_array(jsonb_build_object(
      'id', item.id, 'type', item.type, 'created_at', item.created_at, 'read_at', item.read_at,
      'target', jsonb_build_object(
        'kind', case item.type when 'praise_received' then 'praise' when 'bunch_completed' then 'bunch'
          when 'connection_requested' then 'connection_request' else 'connection' end,
        'id', coalesce(item.praise_id, item.bunch_id, item.connection_request_id, item.connection_id)
      )
    ));
    item_count := item_count + 1;
    last_at := item.created_at;
    last_id := item.id;
  end loop;
  return jsonb_build_object('items', items, 'next_cursor', next_cursor);
end $$;
alter function public.list_notifications(text, integer) owner to chagokchan_rpc;
revoke all on function public.list_notifications(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_notifications(text, integer) to authenticated;

create function public.mark_notification_read(p_notification_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; current_read_at timestamptz;
begin
  actor := private.require_actor();
  if p_notification_id is null then raise exception using errcode = 'PT400', message = 'invalid_notification_id'; end if;
  select n.read_at into current_read_at from public.notifications n
    where n.id = p_notification_id and n.recipient_user_id = actor
      and private.notification_target_visible(n.id, actor) for update;
  if not found then raise exception using errcode = 'PT404', message = 'notification_not_found'; end if;
  if current_read_at is not null then return jsonb_build_object('id', p_notification_id, 'replayed', true); end if;
  update public.notifications set read_at = clock_timestamp()
    where id = p_notification_id and recipient_user_id = actor and read_at is null;
  return jsonb_build_object('id', p_notification_id, 'replayed', false);
end $$;
alter function public.mark_notification_read(uuid) owner to chagokchan_rpc;
revoke all on function public.mark_notification_read(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create function public.list_sent_praises(p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid;
  item record; item_count integer := 0; items jsonb := '[]'::jsonb; next_cursor text := null;
  last_at timestamptz; last_id uuid;
begin
  actor := private.require_actor();
  if p_limit not between 1 and 50 then raise exception using errcode = 'PT400', message = 'invalid_page_size'; end if;
  cursor_value := private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at := (cursor_value->>0)::timestamptz; cursor_id := (cursor_value->>1)::uuid; end if;
  for item in
    select p.id, p.message, p.recorded_at, p.cancelled_at, g.status as goal_status
    from public.praises p
    join public.boards b on b.id = p.board_id
    join public.goals g on g.id = b.goal_id and g.owner_user_id = b.owner_user_id
    where p.actor_user_id = actor and p.source = 'peer' and g.status <> 'deleted'
      and (cursor_at is null or (p.recorded_at, p.id) < (cursor_at, cursor_id))
    order by p.recorded_at desc, p.id desc limit p_limit + 1
  loop
    if item_count = p_limit then
      next_cursor := private.encode_relationship_cursor(last_at, last_id);
      exit;
    end if;
    items := items || jsonb_build_array(jsonb_build_object(
      'id', item.id, 'source', 'peer', 'message', item.message, 'recorded_at', item.recorded_at,
      'cancelled_at', item.cancelled_at,
      'can_cancel', item.cancelled_at is null and item.goal_status <> 'deleted'
    ));
    item_count := item_count + 1;
    last_at := item.recorded_at;
    last_id := item.id;
  end loop;
  return jsonb_build_object('items', items, 'next_cursor', next_cursor);
end $$;
alter function public.list_sent_praises(text, integer) owner to chagokchan_rpc;
revoke all on function public.list_sent_praises(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_sent_praises(text, integer) to authenticated;

create function public.list_trash_goals(p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid;
  item record; item_count integer := 0; items jsonb := '[]'::jsonb; next_cursor text := null;
  last_at timestamptz; last_id uuid;
begin
  actor := private.require_actor();
  if p_limit not between 1 and 50 then raise exception using errcode = 'PT400', message = 'invalid_page_size'; end if;
  cursor_value := private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at := (cursor_value->>0)::timestamptz; cursor_id := (cursor_value->>1)::uuid; end if;
  for item in
    select g.id, g.title, g.deleted_at, g.purge_after, g.revision
    from public.goals g
    where g.owner_user_id = actor and g.status = 'deleted'
      and (cursor_at is null or (g.deleted_at, g.id) < (cursor_at, cursor_id))
    order by g.deleted_at desc, g.id desc limit p_limit + 1
  loop
    if item_count = p_limit then
      next_cursor := private.encode_relationship_cursor(last_at, last_id);
      exit;
    end if;
    items := items || jsonb_build_array(jsonb_build_object(
      'id', item.id, 'title', item.title, 'deleted_at', item.deleted_at,
      'purge_after', item.purge_after, 'revision', item.revision
    ));
    item_count := item_count + 1;
    last_at := item.deleted_at;
    last_id := item.id;
  end loop;
  return jsonb_build_object('items', items, 'next_cursor', next_cursor);
end $$;
alter function public.list_trash_goals(text, integer) owner to chagokchan_rpc;
revoke all on function public.list_trash_goals(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_trash_goals(text, integer) to authenticated;

create function public.delete_goal(p_goal_id uuid, p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; current_goal public.goals%rowtype; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  if p_goal_id is null or p_expected_revision is null then raise exception using errcode = 'PT400', message = 'invalid_goal_id'; end if;
  select * into current_goal from public.goals g
    where g.id = p_goal_id and g.owner_user_id = actor for update;
  if not found then raise exception using errcode = 'PT404', message = 'goal_not_found'; end if;
  if current_goal.revision <> p_expected_revision then raise exception using errcode = 'PT409', message = 'revision_conflict'; end if;
  if current_goal.status = 'deleted' then return jsonb_build_object('id', current_goal.id, 'replayed', true); end if;
  update public.goals set status = 'deleted', revision = revision + 1,
    deleted_at = now_at, purge_after = now_at + interval '30 days'
    where id = current_goal.id and owner_user_id = actor;
  update public.board_members bm set status = 'revoked', revoked_at = now_at
    where bm.board_id in (select b.id from public.boards b where b.goal_id = current_goal.id and b.owner_user_id = actor)
      and bm.status = 'active';
  return jsonb_build_object('id', current_goal.id, 'replayed', false);
end $$;
alter function public.delete_goal(uuid, integer) owner to chagokchan_rpc;
revoke all on function public.delete_goal(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.delete_goal(uuid, integer) to authenticated;

create function public.restore_goal(p_goal_id uuid, p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; current_goal public.goals%rowtype; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  if p_goal_id is null or p_expected_revision is null then raise exception using errcode = 'PT400', message = 'invalid_goal_id'; end if;
  select * into current_goal from public.goals g
    where g.id = p_goal_id and g.owner_user_id = actor for update;
  if not found then raise exception using errcode = 'PT404', message = 'goal_not_found'; end if;
  if current_goal.status <> 'deleted' then raise exception using errcode = 'PT409', message = 'goal_not_deleted'; end if;
  if current_goal.purge_after <= now_at then raise exception using errcode = 'PT409', message = 'restore_window_expired'; end if;
  if current_goal.revision <> p_expected_revision then raise exception using errcode = 'PT409', message = 'revision_conflict'; end if;
  update public.goals set status = 'archived', revision = revision + 1,
    deleted_at = null, purge_after = null, archived_at = now_at
    where id = current_goal.id and owner_user_id = actor;
  return jsonb_build_object('id', current_goal.id, 'replayed', false);
end $$;
alter function public.restore_goal(uuid, integer) owner to chagokchan_rpc;
revoke all on function public.restore_goal(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.restore_goal(uuid, integer) to authenticated;

create function public.purge_expired_goals(p_batch_size integer, p_ledger_reference uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare now_at timestamptz := clock_timestamp(); goal_row record; board_ids uuid[]; bunch_ids uuid[]; praise_ids uuid[];
  receipt_ids uuid[]; object_ids uuid[]; purged_count integer := 0;
begin
  perform private.require_service_worker();
  if p_batch_size not between 1 and 100 or p_ledger_reference is null then
    raise exception using errcode = 'PT400', message = 'invalid_purge_request';
  end if;
  if not exists (select 1 from private.deletion_worker_config c where c.singleton and c.independent_ledger_enabled) then
    raise exception using errcode = 'PT503', message = 'deletion_ledger_unavailable';
  end if;
  for goal_row in
    select g.id, g.owner_user_id from public.goals g
    join public.app_users u on u.id = g.owner_user_id and u.account_status = 'active'
    where g.status = 'deleted' and g.purge_after <= now_at
    order by g.purge_after, g.id limit p_batch_size
    for update of u, g skip locked
  loop
    select coalesce(array_agg(b.id), '{}'::uuid[]) into board_ids
      from public.boards b where b.goal_id = goal_row.id and b.owner_user_id = goal_row.owner_user_id;
    select coalesce(array_agg(bu.id), '{}'::uuid[]) into bunch_ids
      from public.bunches bu where bu.board_id = any(board_ids);
    select coalesce(array_agg(p.id), '{}'::uuid[]) into praise_ids
      from public.praises p where p.board_id = any(board_ids);
    select coalesce(array_agg(p.request_receipt_id), '{}'::uuid[]) into receipt_ids
      from public.praises p where p.id = any(praise_ids);
    object_ids := array_cat(array_cat(array_cat(array[goal_row.id], board_ids), bunch_ids), praise_ids);

    delete from public.notifications n
      where n.praise_id = any(praise_ids) or n.bunch_id = any(bunch_ids);
    update public.boards b set current_bunch_id = null where b.id = any(board_ids);
    delete from public.board_members bm where bm.board_id = any(board_ids);
    delete from public.praises p where p.id = any(praise_ids);
    delete from public.request_receipts r where r.result_kind = 'goal' and r.result_id = goal_row.id;
    delete from public.request_receipts r where r.id = any(receipt_ids)
      and not exists (select 1 from public.praises keep where keep.request_receipt_id = r.id);
    delete from public.shared_board_profiles sp where sp.board_id = any(board_ids);
    delete from public.bunches bu where bu.id = any(bunch_ids);
    delete from public.boards b where b.id = any(board_ids);
    delete from public.audit_events e where e.object_id = any(object_ids);
    delete from public.goals g where g.id = goal_row.id and g.owner_user_id = goal_row.owner_user_id
      and g.status = 'deleted' and g.purge_after <= now_at;
    if found then purged_count := purged_count + 1; end if;
  end loop;
  return jsonb_build_object('purged_count', purged_count, 'ledger_reference', p_ledger_reference);
end $$;
alter function public.purge_expired_goals(integer, uuid) owner to chagokchan_worker;
revoke all on function public.purge_expired_goals(integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_goals(integer, uuid) to service_role;

notify pgrst, 'reload schema';
revoke create on schema public, private from chagokchan_rpc;
revoke create on schema public, private from chagokchan_worker;
commit;
