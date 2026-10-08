-- W09-C: enumerate only shared boards where the current actor has a live grant.
begin;

grant create on schema public, private to chagokchan_rpc;

create function public.list_my_shared_boards(p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid;
  item record; item_count integer := 0; items jsonb := '[]'::jsonb; next_cursor text := null;
  last_at timestamptz; last_id uuid; cycle_value jsonb;
begin
  actor := private.require_actor();
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode = 'PT400', message = 'invalid_page_size';
  end if;
  cursor_value := private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then
    cursor_at := (cursor_value->>0)::timestamptz;
    cursor_id := (cursor_value->>1)::uuid;
  end if;
  for item in
    select bm.granted_at, b.id, b.owner_user_id, g.status as goal_status,
      sp.public_title, sp.public_description,
      coalesce(p.nickname, '새로운 포도') as owner_nickname, coalesce(p.avatar_key, 'grape') as owner_avatar,
      bu.id as bunch_id, bu.cycle_no, bu.target_count, bu.valid_count, bu.progress_state, bu.completed_at
    from public.board_members bm
    join public.boards b on b.id = bm.board_id and b.kind = 'shared'
    join public.goals g on g.id = b.goal_id and g.owner_user_id = b.owner_user_id and g.status <> 'deleted'
    join public.shared_board_profiles sp on sp.board_id = b.id
    left join public.profiles p on p.user_id = b.owner_user_id
    left join public.bunches bu on bu.id = b.current_bunch_id and bu.board_id = b.id
    where bm.user_id = actor and bm.role = 'contributor' and bm.status = 'active'
      and private.current_shared_board_member(b.id, b.owner_user_id, actor)
      and (cursor_at is null or (bm.granted_at, b.id) < (cursor_at, cursor_id))
    order by bm.granted_at desc, b.id desc
    limit p_limit + 1
  loop
    if item_count = p_limit then
      next_cursor := private.encode_relationship_cursor(last_at, last_id);
      exit;
    end if;
    cycle_value := case when item.bunch_id is null then null else jsonb_build_object(
      'id', item.bunch_id, 'cycle_no', item.cycle_no, 'target_count', item.target_count,
      'valid_count', item.valid_count, 'progress_state', item.progress_state, 'completed_at', item.completed_at) end;
    items := items || jsonb_build_array(jsonb_build_object(
      'viewer_role', 'contributor', 'id', item.id, 'kind', 'shared',
      'shared_title', item.public_title, 'shared_description', item.public_description,
      'owner', jsonb_build_object('user_id', item.owner_user_id, 'nickname', item.owner_nickname, 'avatar_key', item.owner_avatar),
      'goal_state', item.goal_status, 'current_bunch', cycle_value, 'can_praise', item.goal_status = 'active'));
    last_at := item.granted_at; last_id := item.id; item_count := item_count + 1;
  end loop;
  return jsonb_build_object('items', items, 'next_cursor', next_cursor);
end $$;
alter function public.list_my_shared_boards(text, integer) owner to chagokchan_rpc;
revoke all on function public.list_my_shared_boards(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_my_shared_boards(text, integer) to authenticated;

notify pgrst, 'reload schema';
revoke create on schema public, private from chagokchan_rpc;
commit;
