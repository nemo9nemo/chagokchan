-- W06-C2: explicit shared-board grants, role-safe projections and atomic peer praise.
begin;

grant create on schema public, private to chagokchan_rpc;

grant select (board_id, user_id, connection_id, connection_generation, role, status, granted_by_user_id, granted_at, revoked_at),
  insert (board_id, user_id, connection_id, connection_generation, role, status, granted_by_user_id, granted_at, revoked_at),
  update (connection_id, connection_generation, status, granted_at, revoked_at)
  on public.board_members to chagokchan_rpc;
grant select (recipient_user_id, actor_user_id, type, dedupe_key, praise_id, bunch_id),
  insert (recipient_user_id, actor_user_id, type, dedupe_key, praise_id, bunch_id)
  on public.notifications to chagokchan_rpc;

-- This helper is callable only by the definer role and binds every check to its verified session actor.
create function private.current_shared_board_member(p_board_id uuid, p_owner_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select p_user_id = private.require_actor() and p_user_id <> p_owner_id and exists (
    select 1
    from public.board_members bm
    join public.connections c on c.id = bm.connection_id
    where bm.board_id = p_board_id and bm.user_id = p_user_id and bm.granted_by_user_id = p_owner_id
      and bm.role = 'contributor' and bm.status = 'active'
      and c.status = 'active' and c.generation = bm.connection_generation
      and c.user_low_id = least(p_owner_id, p_user_id) and c.user_high_id = greatest(p_owner_id, p_user_id)
      and not exists (
        select 1 from public.blocks bl
        where bl.revoked_at is null
          and bl.blocker_user_id in (p_owner_id, p_user_id)
          and bl.blocked_user_id in (p_owner_id, p_user_id)
      )
  )
$$;
alter function private.current_shared_board_member(uuid, uuid, uuid) owner to chagokchan_rpc;
revoke all on function private.current_shared_board_member(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Avoid an RLS cycle: board_members are visible through their immutable grant parties;
-- boards then consult the current relationship and generation using that self-scoped row.
drop policy rpc_owner_or_member_board_members_select on public.board_members;
create policy rpc_owner_or_member_board_members_select on public.board_members for select to chagokchan_rpc
  using (user_id = private.require_actor() or granted_by_user_id = private.require_actor());
create policy rpc_owner_board_member_insert on public.board_members for insert to chagokchan_rpc
  with check (granted_by_user_id = private.require_actor() and role = 'contributor' and status = 'active' and
    exists (select 1 from public.connections c where c.id = connection_id and c.status = 'active'
      and c.generation = connection_generation and c.user_low_id = least(granted_by_user_id, user_id)
      and c.user_high_id = greatest(granted_by_user_id, user_id)) and
    not exists (select 1 from public.blocks bl where bl.revoked_at is null
      and bl.blocker_user_id in (granted_by_user_id, user_id) and bl.blocked_user_id in (granted_by_user_id, user_id)));

create policy rpc_current_contributor_boards_select on public.boards for select to chagokchan_rpc
  using (kind = 'shared' and private.current_shared_board_member(id, owner_user_id, private.require_actor()));
create policy rpc_current_contributor_goals_select on public.goals for select to chagokchan_rpc
  using (status <> 'deleted' and exists (
    select 1 from public.boards b where b.goal_id = goals.id and b.owner_user_id = goals.owner_user_id and b.kind = 'shared'
      and private.current_shared_board_member(b.id, b.owner_user_id, private.require_actor())
  ));
create policy rpc_current_contributor_shared_profile_select on public.shared_board_profiles for select to chagokchan_rpc
  using (exists (select 1 from public.boards b where b.id = board_id and b.kind = 'shared'
    and private.current_shared_board_member(b.id, b.owner_user_id, private.require_actor())));
create policy rpc_current_contributor_bunches_select on public.bunches for select to chagokchan_rpc
  using (exists (select 1 from public.boards b where b.id = board_id and b.kind = 'shared'
    and private.current_shared_board_member(b.id, b.owner_user_id, private.require_actor())));
create policy rpc_owner_received_praises_select on public.praises for select to chagokchan_rpc
  using (recipient_user_id = private.require_actor() and exists (
    select 1 from public.boards b where b.id = board_id and b.owner_user_id = private.require_actor()
  ));
create policy rpc_granted_member_profile_select on public.profiles for select to chagokchan_rpc
  using (exists (select 1 from public.board_members bm
    where bm.user_id = profiles.user_id and bm.granted_by_user_id = private.require_actor()));

-- Peer praise and shared-cycle notices are insertable only for a row created by this actor
-- and a shared board whose recipient is its owner. SELECT mirrors INSERT for ON CONFLICT.
create policy rpc_peer_praise_notifications_insert on public.notifications for insert to chagokchan_rpc
  with check (
    (type = 'praise_received' and actor_user_id = private.require_actor() and exists (
      select 1 from public.praises p where p.id = praise_id and p.source = 'peer'
        and p.actor_user_id = private.require_actor() and p.recipient_user_id = recipient_user_id
    )) or
    (type = 'bunch_completed' and actor_user_id = private.require_actor() and exists (
      select 1 from public.bunches bu join public.boards b on b.id = bu.board_id
      where bu.id = bunch_id and b.kind = 'shared' and b.owner_user_id = recipient_user_id
        and private.current_shared_board_member(b.id, b.owner_user_id, private.require_actor())
    ))
  );
create policy rpc_peer_praise_notifications_select on public.notifications for select to chagokchan_rpc
  using (
    (type = 'praise_received' and actor_user_id = private.require_actor() and exists (
      select 1 from public.praises p where p.id = praise_id and p.source = 'peer'
        and p.actor_user_id = private.require_actor() and p.recipient_user_id = recipient_user_id
    )) or
    (type = 'bunch_completed' and actor_user_id = private.require_actor() and exists (
      select 1 from public.bunches bu join public.boards b on b.id = bu.board_id
      where bu.id = bunch_id and b.kind = 'shared' and b.owner_user_id = recipient_user_id
        and private.current_shared_board_member(b.id, b.owner_user_id, private.require_actor())
    ))
  );

create function public.get_board(p_board_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; board_row record; owner_profile jsonb; cycle_value jsonb;
begin
  actor := private.require_actor();
  if p_board_id is null then raise exception using errcode = 'PT400', message = 'invalid_board_id'; end if;
  select b.id, b.goal_id, b.owner_user_id, b.kind, b.revision, b.next_target_count,
    g.status as goal_status, sp.public_title, sp.public_description,
    bu.id as bunch_id, bu.cycle_no, bu.target_count, bu.valid_count, bu.progress_state, bu.completed_at
    into board_row
    from public.boards b join public.goals g on g.id = b.goal_id and g.owner_user_id = b.owner_user_id
    left join public.shared_board_profiles sp on sp.board_id = b.id
    left join public.bunches bu on bu.id = b.current_bunch_id and bu.board_id = b.id
    where b.id = p_board_id and g.status <> 'deleted'
      and (b.owner_user_id = actor or private.current_shared_board_member(b.id, b.owner_user_id, actor));
  if not found then raise exception using errcode = 'PT404', message = 'board_not_found'; end if;
  if board_row.owner_user_id = actor then
    cycle_value := case when board_row.bunch_id is null then null else jsonb_build_object(
      'id', board_row.bunch_id, 'cycle_no', board_row.cycle_no, 'target_count', board_row.target_count,
      'valid_count', board_row.valid_count, 'progress_state', board_row.progress_state, 'completed_at', board_row.completed_at) end;
    return jsonb_build_object('viewer_role', 'owner', 'id', board_row.id, 'goal_id', board_row.goal_id,
      'kind', board_row.kind, 'revision', board_row.revision, 'next_target_count', board_row.next_target_count,
      'shared_title', board_row.public_title, 'shared_description', board_row.public_description, 'current_bunch', cycle_value);
  end if;
  if board_row.kind <> 'shared' then raise exception using errcode = 'PT404', message = 'board_not_found'; end if;
  select jsonb_build_object('user_id', p.user_id, 'nickname', p.nickname, 'avatar_key', p.avatar_key)
    into owner_profile from public.profiles p where p.user_id = board_row.owner_user_id;
  owner_profile := coalesce(owner_profile, jsonb_build_object('user_id', board_row.owner_user_id, 'nickname', '새로운 포도', 'avatar_key', 'grape'));
  cycle_value := case when board_row.bunch_id is null then null else jsonb_build_object(
    'id', board_row.bunch_id, 'cycle_no', board_row.cycle_no, 'target_count', board_row.target_count,
    'valid_count', board_row.valid_count, 'progress_state', board_row.progress_state, 'completed_at', board_row.completed_at) end;
  return jsonb_build_object('viewer_role', 'contributor', 'id', board_row.id, 'kind', 'shared',
    'shared_title', board_row.public_title, 'shared_description', board_row.public_description,
    'owner', owner_profile, 'goal_state', board_row.goal_status, 'current_bunch', cycle_value,
    'can_praise', board_row.goal_status = 'active');
end $$;
alter function public.get_board(uuid) owner to chagokchan_rpc;
revoke all on function public.get_board(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_board(uuid) to authenticated;

create function public.grant_board_member(p_board_id uuid, p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; board_row record; connection_row record; member_row record; active_count integer; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  if p_board_id is null or p_user_id is null or p_user_id = actor then
    raise exception using errcode = 'PT400', message = 'invalid_board_member';
  end if;
  select b.id, b.owner_user_id, b.kind, g.status as goal_status into board_row
    from public.boards b join public.goals g on g.id = b.goal_id and g.owner_user_id = b.owner_user_id
    where b.id = p_board_id and b.owner_user_id = actor for update of g, b;
  if not found then raise exception using errcode = 'PT404', message = 'board_not_found'; end if;
  if board_row.kind <> 'shared' then raise exception using errcode = 'PT403', message = 'board_access_denied'; end if;
  if board_row.goal_status = 'deleted' then raise exception using errcode = 'PT404', message = 'board_not_found'; end if;
  perform private.lock_connection_pair(actor, p_user_id);
  select c.id, c.generation, c.status into connection_row from public.connections c
    where c.user_low_id = least(actor, p_user_id) and c.user_high_id = greatest(actor, p_user_id) for update;
  if not found or connection_row.status <> 'active' or exists (
    select 1 from public.blocks bl where bl.revoked_at is null
      and bl.blocker_user_id in (actor, p_user_id) and bl.blocked_user_id in (actor, p_user_id)
  ) then raise exception using errcode = 'PT409', message = 'active_connection_required'; end if;
  select bm.connection_id, bm.connection_generation, bm.status into member_row from public.board_members bm
    where bm.board_id = p_board_id and bm.user_id = p_user_id for update;
  if found and member_row.status = 'active' and member_row.connection_id = connection_row.id
      and member_row.connection_generation = connection_row.generation then
    return jsonb_build_object('id', p_board_id, 'replayed', true);
  end if;
  select count(*)::integer into active_count from public.board_members bm
    join public.connections c on c.id = bm.connection_id and c.status = 'active' and c.generation = bm.connection_generation
    where bm.board_id = p_board_id and bm.status = 'active'
      and c.user_low_id = least(actor, bm.user_id) and c.user_high_id = greatest(actor, bm.user_id)
      and not exists (select 1 from public.blocks bl where bl.revoked_at is null
        and bl.blocker_user_id in (actor, bm.user_id) and bl.blocked_user_id in (actor, bm.user_id));
  if active_count >= 50 then raise exception using errcode = 'PT409', message = 'board_member_limit'; end if;
  if member_row.connection_id is not null then
    update public.board_members set connection_id = connection_row.id, connection_generation = connection_row.generation,
      status = 'active', granted_at = now_at, revoked_at = null
      where board_id = p_board_id and user_id = p_user_id;
  else
    insert into public.board_members(board_id, user_id, connection_id, connection_generation, role, status, granted_by_user_id, granted_at)
      values (p_board_id, p_user_id, connection_row.id, connection_row.generation, 'contributor', 'active', actor, now_at);
  end if;
  return jsonb_build_object('id', p_board_id, 'replayed', false);
end $$;
alter function public.grant_board_member(uuid, uuid) owner to chagokchan_rpc;
revoke all on function public.grant_board_member(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.grant_board_member(uuid, uuid) to authenticated;

create function public.revoke_board_member(p_board_id uuid, p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; board_exists boolean; member_row record; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  if p_board_id is null or p_user_id is null or p_user_id = actor then
    raise exception using errcode = 'PT400', message = 'invalid_board_member';
  end if;
  select exists(select 1 from public.boards b join public.goals g on g.id = b.goal_id
    where b.id = p_board_id and b.owner_user_id = actor and g.status <> 'deleted' for update of b, g) into board_exists;
  if not board_exists then raise exception using errcode = 'PT404', message = 'board_not_found'; end if;
  select bm.status into member_row from public.board_members bm
    where bm.board_id = p_board_id and bm.user_id = p_user_id and bm.granted_by_user_id = actor for update;
  if not found then raise exception using errcode = 'PT404', message = 'board_member_not_found'; end if;
  if member_row.status = 'revoked' then return jsonb_build_object('id', p_board_id, 'replayed', true); end if;
  update public.board_members set status = 'revoked', revoked_at = now_at
    where board_id = p_board_id and user_id = p_user_id;
  return jsonb_build_object('id', p_board_id, 'replayed', false);
end $$;
alter function public.revoke_board_member(uuid, uuid) owner to chagokchan_rpc;
revoke all on function public.revoke_board_member(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.revoke_board_member(uuid, uuid) to authenticated;

create function public.list_board_members(p_board_id uuid, p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; board_exists boolean; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid;
  item record; item_count integer := 0; items jsonb := '[]'::jsonb; next_cursor text := null;
begin
  actor := private.require_actor();
  if p_board_id is null or p_limit not between 1 and 50 then raise exception using errcode = 'PT400', message = 'invalid_page_size'; end if;
  cursor_value := private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at := (cursor_value->>0)::timestamptz; cursor_id := (cursor_value->>1)::uuid; end if;
  select exists(select 1 from public.boards b join public.goals g on g.id=b.goal_id
    where b.id=p_board_id and b.owner_user_id=actor and b.kind='shared' and g.status <> 'deleted') into board_exists;
  if not board_exists then raise exception using errcode = 'PT404', message = 'board_not_found'; end if;
  for item in
    select bm.user_id, bm.role, bm.status, bm.connection_generation, bm.granted_at,
      coalesce(p.nickname, '새로운 포도') as nickname, coalesce(p.avatar_key, 'grape') as avatar_key
    from public.board_members bm left join public.profiles p on p.user_id=bm.user_id
    where bm.board_id=p_board_id and bm.granted_by_user_id=actor
      and (cursor_at is null or (bm.granted_at, bm.user_id) < (cursor_at, cursor_id))
    order by bm.granted_at desc, bm.user_id desc limit p_limit + 1
  loop
    if item_count = p_limit then
      next_cursor := private.encode_relationship_cursor(item.granted_at, item.user_id);
      exit;
    end if;
    items := items || jsonb_build_array(jsonb_build_object(
      'user', jsonb_build_object('user_id', item.user_id, 'nickname', item.nickname, 'avatar_key', item.avatar_key),
      'role', item.role, 'status', item.status, 'connection_generation', item.connection_generation));
    item_count := item_count + 1;
  end loop;
  return jsonb_build_object('items', items, 'next_cursor', next_cursor);
end $$;
alter function public.list_board_members(uuid, text, integer) owner to chagokchan_rpc;
revoke all on function public.list_board_members(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_board_members(uuid, text, integer) to authenticated;

create function public.list_board_praises(
  p_board_id uuid, p_bunch_id uuid default null, p_cursor text default null, p_limit integer default 20, p_include_hidden boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; board_row record; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid;
  item record; item_count integer := 0; items jsonb := '[]'::jsonb; next_cursor text := null; view_value jsonb;
begin
  actor := private.require_actor();
  if p_board_id is null or p_limit not between 1 and 50 or p_include_hidden is null then
    raise exception using errcode = 'PT400', message = 'invalid_praise_list';
  end if;
  cursor_value := private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at := (cursor_value->>0)::timestamptz; cursor_id := (cursor_value->>1)::uuid; end if;
  select b.id, b.owner_user_id, b.kind into board_row from public.boards b join public.goals g on g.id=b.goal_id
    where b.id=p_board_id and g.status <> 'deleted'
      and (b.owner_user_id=actor or private.current_shared_board_member(b.id,b.owner_user_id,actor));
  if not found then raise exception using errcode = 'PT404', message = 'board_not_found'; end if;
  if p_bunch_id is not null and not exists(select 1 from public.bunches bu where bu.id=p_bunch_id and bu.board_id=p_board_id) then
    raise exception using errcode = 'PT404', message = 'bunch_not_found';
  end if;
  if board_row.owner_user_id <> actor and p_include_hidden then
    raise exception using errcode = 'PT403', message = 'board_access_denied';
  end if;
  for item in
    select pr.id, pr.bunch_id, pr.source, pr.actor_user_id, pr.message, pr.occurred_on, pr.recorded_at,
      pr.cancelled_at, pr.hidden_at, pr.excluded_at, pr.author_erased_at,
      p.nickname, p.avatar_key
    from public.praises pr left join public.profiles p on p.user_id=pr.actor_user_id
    where pr.board_id=p_board_id and (p_bunch_id is null or pr.bunch_id=p_bunch_id)
      and (board_row.owner_user_id=actor or pr.actor_user_id=actor)
      and (board_row.owner_user_id <> actor or p_include_hidden or pr.hidden_at is null)
      and (cursor_at is null or (pr.recorded_at, pr.id) < (cursor_at,cursor_id))
    order by pr.recorded_at desc, pr.id desc limit p_limit+1
  loop
    if item_count = p_limit then
      next_cursor := private.encode_relationship_cursor(item.recorded_at, item.id);
      exit;
    end if;
    if board_row.owner_user_id=actor then
      view_value := jsonb_build_object('viewer_role','owner','id',item.id,'bunch_id',item.bunch_id,'source',item.source,
        'actor',case when item.actor_user_id is null or item.nickname is null then null else jsonb_build_object(
          'user_id',item.actor_user_id,'nickname',item.nickname,'avatar_key',coalesce(item.avatar_key,'grape')) end,
        'actor_label',case when item.actor_user_id is null then '삭제된 사용자' when item.nickname is null then '연결 종료 사용자' else item.nickname end,
        'message',item.message,'occurred_on',item.occurred_on,'recorded_at',item.recorded_at,
        'cancelled_at',item.cancelled_at,'hidden_at',item.hidden_at,'excluded_at',item.excluded_at,'author_erased_at',item.author_erased_at);
    else
      view_value := jsonb_build_object('viewer_role','contributor','id',item.id,'bunch_id',item.bunch_id,'source','peer',
        'message',item.message,'recorded_at',item.recorded_at,'cancelled_at',item.cancelled_at);
    end if;
    items := items || jsonb_build_array(view_value);
    item_count := item_count + 1;
  end loop;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
alter function public.list_board_praises(uuid, uuid, text, integer, boolean) owner to chagokchan_rpc;
revoke all on function public.list_board_praises(uuid, uuid, text, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.list_board_praises(uuid, uuid, text, integer, boolean) to authenticated;

create function public.create_peer_praise(p_request_key uuid, p_board_id uuid, p_message text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; now_at timestamptz := clock_timestamp(); utc_minute timestamptz; utc_day timestamptz;
  normalized_message text; request_hash text; canonical_input jsonb; praise_uuid uuid := gen_random_uuid();
  receipt_uuid uuid := gen_random_uuid(); inserted_receipt uuid; existing public.request_receipts%rowtype;
  board_row record; connection_row record; member_row record; cycle_row record; cycle_uuid uuid; cycle_no integer;
  v_valid_count integer; completed_now boolean := false;
begin
  actor := private.require_actor();
  if p_request_key is null or p_board_id is null then raise exception using errcode = 'PT400', message = 'invalid_praise_input'; end if;
  normalized_message := case when p_message is null then null else nullif(normalize(replace(replace(p_message,E'\r\n',E'\n'),E'\r',E'\n'),NFC),'') end;
  if normalized_message is not null and char_length(normalized_message)>1000 then raise exception using errcode='PT400',message='invalid_praise_input'; end if;
  canonical_input := jsonb_build_object('board_id',p_board_id,'message',normalized_message);
  request_hash := encode(sha256(convert_to(canonical_input::text,'UTF8')),'hex');
  insert into public.request_receipts(actor_user_id,operation,request_key,input_hash,result_kind,result_id)
    values(actor,'createPeerPraise',p_request_key,request_hash,'praise',praise_uuid)
    on conflict(actor_user_id,operation,request_key) do nothing returning id into inserted_receipt;
  if inserted_receipt is null then
    select * into existing from public.request_receipts r where r.actor_user_id=actor and r.operation='createPeerPraise'
      and r.request_key=p_request_key for update;
    if existing.input_hash is distinct from request_hash or existing.result_kind<>'praise' then
      raise exception using errcode='PT409',message='idempotency_conflict';
    end if;
    select p.bunch_id into cycle_uuid from public.praises p where p.id=existing.result_id and p.actor_user_id=actor;
    return jsonb_build_object('id',existing.result_id,'bunch_id',cycle_uuid,'replayed',true);
  end if;

  select b.id,b.owner_user_id,b.kind,b.next_target_count,b.next_rule_code,b.current_bunch_id,g.status as goal_status
    into board_row from public.boards b join public.goals g on g.id=b.goal_id and g.owner_user_id=b.owner_user_id
    where b.id=p_board_id for update of g,b;
  if not found then raise exception using errcode='PT404',message='board_not_found'; end if;
  if board_row.kind<>'shared' or board_row.owner_user_id=actor then raise exception using errcode='PT403',message='board_access_denied'; end if;
  if board_row.goal_status<>'active' then raise exception using errcode='PT409',message='goal_not_active'; end if;
  perform private.lock_connection_pair(actor,board_row.owner_user_id);
  select c.id,c.generation,c.status into connection_row from public.connections c
    where c.user_low_id=least(actor,board_row.owner_user_id) and c.user_high_id=greatest(actor,board_row.owner_user_id) for update;
  if not found or connection_row.status<>'active' or exists(select 1 from public.blocks bl where bl.revoked_at is null
    and bl.blocker_user_id in (actor,board_row.owner_user_id) and bl.blocked_user_id in (actor,board_row.owner_user_id)) then
    raise exception using errcode='PT404',message='board_not_found';
  end if;
  select bm.connection_id,bm.connection_generation,bm.status into member_row from public.board_members bm
    where bm.board_id=p_board_id and bm.user_id=actor for update;
  if not found or member_row.status<>'active' or member_row.connection_id<>connection_row.id
      or member_row.connection_generation<>connection_row.generation then
    raise exception using errcode='PT404',message='board_not_found';
  end if;
  utc_minute:=date_trunc('minute',now_at at time zone 'UTC') at time zone 'UTC';
  utc_day:=date_trunc('day',now_at at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(actor,'praise_write_minute',20,utc_minute,utc_minute+interval '1 minute');
  perform private.consume_rate_limit(actor,'praise_write_day',300,utc_day,utc_day+interval '1 day');
  perform private.consume_rate_limit(actor,'peer_praise_board_day:'||p_board_id::text,30,utc_day,utc_day+interval '1 day');

  if board_row.current_bunch_id is null then
    cycle_no:=1;
    insert into public.bunches(board_id,cycle_no,target_count,rule_code)
      values(board_row.id,cycle_no,board_row.next_target_count,board_row.next_rule_code) returning id into cycle_uuid;
    update public.boards set current_bunch_id=cycle_uuid where id=board_row.id;
    select id,cycle_no,target_count,rule_code,valid_count,progress_state,completed_at into cycle_row
      from public.bunches where id=cycle_uuid;
  else
    select id,cycle_no,target_count,rule_code,valid_count,progress_state,completed_at into cycle_row
      from public.bunches where id=board_row.current_bunch_id and board_id=board_row.id for update;
    if not found then raise exception using errcode='PT503',message='current_bunch_incomplete'; end if;
    if cycle_row.progress_state='complete' then
      cycle_no:=cycle_row.cycle_no+1;
      insert into public.bunches(board_id,cycle_no,target_count,rule_code)
        values(board_row.id,cycle_no,board_row.next_target_count,board_row.next_rule_code) returning id into cycle_uuid;
      update public.boards set current_bunch_id=cycle_uuid where id=board_row.id;
      select id,cycle_no,target_count,rule_code,valid_count,progress_state,completed_at into cycle_row
        from public.bunches where id=cycle_uuid;
    else cycle_uuid:=cycle_row.id;
    end if;
  end if;
  insert into public.praises(id,board_id,bunch_id,actor_user_id,recipient_user_id,request_receipt_id,source,message)
    values(praise_uuid,board_row.id,cycle_uuid,actor,board_row.owner_user_id,inserted_receipt,'peer',normalized_message);
  select count(*)::integer into v_valid_count from public.praises p where p.bunch_id=cycle_uuid and p.cancelled_at is null and p.excluded_at is null;
  if v_valid_count>cycle_row.target_count then raise exception using errcode='PT503',message='bunch_count_invalid'; end if;
  completed_now:=v_valid_count=cycle_row.target_count;
  update public.bunches set valid_count=v_valid_count,
    progress_state=case when completed_now then 'complete' else 'incomplete' end,
    completed_at=case when completed_now then coalesce(completed_at,now_at) else null end where id=cycle_uuid and board_id=board_row.id;
  insert into public.notifications(recipient_user_id,actor_user_id,type,dedupe_key,praise_id)
    values(board_row.owner_user_id,actor,'praise_received','praise-received:'||praise_uuid::text,praise_uuid)
    on conflict(recipient_user_id,dedupe_key) do nothing;
  if completed_now then
    insert into public.notifications(recipient_user_id,actor_user_id,type,dedupe_key,bunch_id)
      values(board_row.owner_user_id,actor,'bunch_completed','bunch-completed:'||cycle_uuid::text,cycle_uuid)
      on conflict(recipient_user_id,dedupe_key) do nothing;
  end if;
  return jsonb_build_object('id',praise_uuid,'bunch_id',cycle_uuid,'replayed',false);
end $$;
alter function public.create_peer_praise(uuid,uuid,text) owner to chagokchan_rpc;
revoke all on function public.create_peer_praise(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.create_peer_praise(uuid,uuid,text) to authenticated;

notify pgrst,'reload schema';
revoke create on schema public,private from chagokchan_rpc;
commit;
