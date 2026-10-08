-- W08-B2: role-scoped bunch history with board-bound keyset pagination.
begin;

grant create on schema public, private to chagokchan_rpc;
grant select (id, board_id, cycle_no, target_count, valid_count, progress_state, completed_at)
  on public.bunches to chagokchan_rpc;

create function private.encode_bunch_list_cursor(p_cycle_no integer, p_bunch_id uuid, p_board_id uuid) returns text
language sql immutable set search_path = pg_catalog
as $$
  select replace(replace(rtrim(replace(encode(convert_to(jsonb_build_array(p_cycle_no, p_bunch_id, p_board_id)::text, 'UTF8'), 'base64'), E'\n', ''), '='), '+', '-'), '/', '_')
$$;
alter function private.encode_bunch_list_cursor(integer, uuid, uuid) owner to chagokchan_rpc;
revoke all on function private.encode_bunch_list_cursor(integer, uuid, uuid) from public, anon, authenticated, service_role;

create function private.decode_bunch_list_cursor(p_cursor text) returns jsonb
language plpgsql immutable set search_path = pg_catalog
as $$
declare decoded text; value jsonb; cycle_value integer; bunch_value uuid; board_value uuid;
begin
  if p_cursor is null then return null; end if;
  if char_length(p_cursor) not between 1 and 512 or p_cursor !~ '^[A-Za-z0-9_-]+$' then
    raise exception using errcode = 'PT400', message = 'invalid_cursor';
  end if;
  begin
    decoded := convert_from(decode(replace(replace(p_cursor, '-', '+'), '_', '/') || repeat('=', (4 - char_length(p_cursor) % 4) % 4), 'base64'), 'UTF8');
    value := decoded::jsonb;
    if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) <> 3 then raise exception 'cursor_shape'; end if;
    cycle_value := (value->>0)::integer;
    bunch_value := (value->>1)::uuid;
    board_value := (value->>2)::uuid;
    if cycle_value is null or cycle_value < 1 or bunch_value is null or board_value is null then raise exception 'cursor_value'; end if;
  exception when others then
    raise exception using errcode = 'PT400', message = 'invalid_cursor';
  end;
  return value;
end $$;
alter function private.decode_bunch_list_cursor(text) owner to chagokchan_rpc;
revoke all on function private.decode_bunch_list_cursor(text) from public, anon, authenticated, service_role;

create function public.list_bunches(p_board_id uuid, p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_cycle integer; cursor_id uuid; cursor_board uuid;
  item record; item_count integer := 0; items jsonb := '[]'::jsonb; next_cursor text := null;
  last_cycle integer; last_id uuid;
begin
  actor := private.require_actor();
  if p_board_id is null then raise exception using errcode = 'PT400', message = 'invalid_board_id'; end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode = 'PT400', message = 'invalid_page_size';
  end if;
  cursor_value := private.decode_bunch_list_cursor(p_cursor);
  if cursor_value is not null then
    cursor_cycle := (cursor_value->>0)::integer;
    cursor_id := (cursor_value->>1)::uuid;
    cursor_board := (cursor_value->>2)::uuid;
    if cursor_board is distinct from p_board_id then
      raise exception using errcode = 'PT400', message = 'bunch_cursor_board_mismatch';
    end if;
  end if;
  if not exists (
    select 1 from public.boards b join public.goals g on g.id = b.goal_id and g.owner_user_id = b.owner_user_id
    where b.id = p_board_id and g.status <> 'deleted'
      and (b.owner_user_id = actor or (b.kind = 'shared' and private.current_shared_board_member(b.id, b.owner_user_id, actor)))
  ) then raise exception using errcode = 'PT404', message = 'board_not_found'; end if;

  for item in
    select bu.id, bu.cycle_no, bu.target_count, bu.valid_count, bu.progress_state, bu.completed_at
    from public.bunches bu
    join public.boards b on b.id = bu.board_id
    join public.goals g on g.id = b.goal_id and g.owner_user_id = b.owner_user_id
    where bu.board_id = p_board_id and g.status <> 'deleted'
      and (b.owner_user_id = actor or (b.kind = 'shared' and private.current_shared_board_member(b.id, b.owner_user_id, actor)))
      and (cursor_cycle is null or (bu.cycle_no, bu.id) < (cursor_cycle, cursor_id))
    order by bu.cycle_no desc, bu.id desc
    limit p_limit + 1
  loop
    if item_count = p_limit then
      next_cursor := private.encode_bunch_list_cursor(last_cycle, last_id, p_board_id);
      exit;
    end if;
    items := items || jsonb_build_array(jsonb_build_object(
      'id', item.id, 'cycle_no', item.cycle_no, 'target_count', item.target_count,
      'valid_count', item.valid_count, 'progress_state', item.progress_state, 'completed_at', item.completed_at
    ));
    item_count := item_count + 1;
    last_cycle := item.cycle_no;
    last_id := item.id;
  end loop;
  return jsonb_build_object('items', items, 'next_cursor', next_cursor);
end $$;
alter function public.list_bunches(uuid, text, integer) owner to chagokchan_rpc;
revoke all on function public.list_bunches(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_bunches(uuid, text, integer) to authenticated;

notify pgrst, 'reload schema';
revoke create on schema public, private from chagokchan_rpc;
commit;
