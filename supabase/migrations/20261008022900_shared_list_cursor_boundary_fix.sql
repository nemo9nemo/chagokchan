-- Keep the cursor at the last row returned, not the extra row used to detect another page.
begin;

create or replace function public.list_board_members(p_board_id uuid, p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; board_exists boolean; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid;
  last_at timestamptz; last_id uuid; item record; item_count integer := 0; items jsonb := '[]'::jsonb; next_cursor text := null;
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
      next_cursor := private.encode_relationship_cursor(last_at, last_id);
      exit;
    end if;
    items := items || jsonb_build_array(jsonb_build_object(
      'user', jsonb_build_object('user_id', item.user_id, 'nickname', item.nickname, 'avatar_key', item.avatar_key),
      'role', item.role, 'status', item.status, 'connection_generation', item.connection_generation));
    last_at := item.granted_at; last_id := item.user_id; item_count := item_count + 1;
  end loop;
  return jsonb_build_object('items', items, 'next_cursor', next_cursor);
end $$;
alter function public.list_board_members(uuid, text, integer) owner to chagokchan_rpc;
revoke all on function public.list_board_members(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_board_members(uuid, text, integer) to authenticated;

create or replace function public.list_board_praises(
  p_board_id uuid, p_bunch_id uuid default null, p_cursor text default null, p_limit integer default 20, p_include_hidden boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; board_row record; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid;
  last_at timestamptz; last_id uuid; item record; item_count integer := 0; items jsonb := '[]'::jsonb; next_cursor text := null; view_value jsonb;
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
      pr.cancelled_at, pr.hidden_at, pr.excluded_at, pr.author_erased_at, p.nickname, p.avatar_key
    from public.praises pr left join public.profiles p on p.user_id=pr.actor_user_id
    where pr.board_id=p_board_id and (p_bunch_id is null or pr.bunch_id=p_bunch_id)
      and (board_row.owner_user_id=actor or pr.actor_user_id=actor)
      and (board_row.owner_user_id <> actor or p_include_hidden or pr.hidden_at is null)
      and (cursor_at is null or (pr.recorded_at, pr.id) < (cursor_at,cursor_id))
    order by pr.recorded_at desc, pr.id desc limit p_limit+1
  loop
    if item_count = p_limit then
      next_cursor := private.encode_relationship_cursor(last_at,last_id);
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
    last_at := item.recorded_at; last_id := item.id; item_count := item_count + 1;
  end loop;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
alter function public.list_board_praises(uuid, uuid, text, integer, boolean) owner to chagokchan_rpc;
revoke all on function public.list_board_praises(uuid, uuid, text, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.list_board_praises(uuid, uuid, text, integer, boolean) to authenticated;

commit;
