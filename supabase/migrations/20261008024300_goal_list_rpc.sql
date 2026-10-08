-- W08-B1: owner-only goal summaries with keyset pagination bound to the status filter.
begin;

grant create on schema public, private to chagokchan_rpc;

create function private.encode_goal_list_cursor(p_created_at timestamptz, p_goal_id uuid, p_status text) returns text
language sql immutable set search_path = pg_catalog
as $$
  select replace(replace(rtrim(encode(convert_to(jsonb_build_array(p_created_at, p_goal_id, p_status)::text, 'UTF8'), 'base64'), '='), '+', '-'), '/', '_')
$$;
alter function private.encode_goal_list_cursor(timestamptz, uuid, text) owner to chagokchan_rpc;
revoke all on function private.encode_goal_list_cursor(timestamptz, uuid, text) from public, anon, authenticated, service_role;

create function private.decode_goal_list_cursor(p_cursor text) returns jsonb
language plpgsql immutable set search_path = pg_catalog
as $$
declare decoded text; value jsonb;
begin
  if p_cursor is null then return null; end if;
  if char_length(p_cursor) not between 1 and 512 or p_cursor !~ '^[A-Za-z0-9_-]+$' then
    raise exception using errcode = 'PT400', message = 'invalid_cursor';
  end if;
  begin
    decoded := convert_from(decode(replace(replace(p_cursor, '-', '+'), '_', '/') || repeat('=', (4 - char_length(p_cursor) % 4) % 4), 'base64'), 'UTF8');
    value := decoded::jsonb;
    if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) <> 3 then raise exception 'cursor_shape'; end if;
    perform (value->>0)::timestamptz;
    perform (value->>1)::uuid;
    if jsonb_typeof(value->2) <> 'null' and
       (jsonb_typeof(value->2) <> 'string' or value->>2 not in ('active', 'completed', 'archived')) then
      raise exception 'cursor_filter';
    end if;
  exception when others then
    raise exception using errcode = 'PT400', message = 'invalid_cursor';
  end;
  return value;
end $$;
alter function private.decode_goal_list_cursor(text) owner to chagokchan_rpc;
revoke all on function private.decode_goal_list_cursor(text) from public, anon, authenticated, service_role;

create function public.list_goals(p_cursor text default null, p_limit integer default 20, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid; cursor_status text;
  item record; item_count integer := 0; items jsonb := '[]'::jsonb; next_cursor text := null;
  last_at timestamptz; last_id uuid;
begin
  actor := private.require_actor();
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode = 'PT400', message = 'invalid_page_size';
  end if;
  if p_status is not null and p_status not in ('active', 'completed', 'archived') then
    raise exception using errcode = 'PT400', message = 'invalid_goal_status';
  end if;
  cursor_value := private.decode_goal_list_cursor(p_cursor);
  if cursor_value is not null then
    cursor_at := (cursor_value->>0)::timestamptz;
    cursor_id := (cursor_value->>1)::uuid;
    cursor_status := case when jsonb_typeof(cursor_value->2) = 'null' then null else cursor_value->>2 end;
    if cursor_status is distinct from p_status then
      raise exception using errcode = 'PT400', message = 'goal_cursor_filter_mismatch';
    end if;
  end if;
  for item in
    select g.id, g.title, g.private_description, g.status, g.revision, g.created_at, g.completed_at, g.archived_at
    from public.goals g
    where g.owner_user_id = actor and g.status <> 'deleted'
      and (p_status is null or g.status = p_status)
      and (cursor_at is null or (g.created_at, g.id) < (cursor_at, cursor_id))
    order by g.created_at desc, g.id desc
    limit p_limit + 1
  loop
    if item_count = p_limit then
      next_cursor := private.encode_goal_list_cursor(last_at, last_id, p_status);
      exit;
    end if;
    items := items || jsonb_build_array(jsonb_build_object(
      'id', item.id, 'title', item.title, 'private_description', item.private_description,
      'status', item.status, 'revision', item.revision, 'created_at', item.created_at,
      'completed_at', item.completed_at, 'archived_at', item.archived_at
    ));
    item_count := item_count + 1;
    last_at := item.created_at;
    last_id := item.id;
  end loop;
  return jsonb_build_object('items', items, 'next_cursor', next_cursor);
end $$;
alter function public.list_goals(text, integer, text) owner to chagokchan_rpc;
revoke all on function public.list_goals(text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.list_goals(text, integer, text) to authenticated;

notify pgrst, 'reload schema';
revoke create on schema public, private from chagokchan_rpc;
commit;
