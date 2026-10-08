-- Resume each relationship page after its last returned row, not the extra row used for lookahead.
begin;

create or replace function public.list_connections(p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid; last_at timestamptz; last_id uuid;
  item record; items jsonb := '[]'::jsonb; next_cursor text := null; item_count integer := 0;
begin
  actor := private.require_actor();
  if p_limit not between 1 and 50 then raise exception using errcode = 'PT400', message = 'invalid_page_size'; end if;
  cursor_value := private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at := (cursor_value->>0)::timestamptz; cursor_id := (cursor_value->>1)::uuid; end if;
  for item in select c.id, c.status, c.generation, c.created_at,
      case when c.status = 'active' and not exists (select 1 from public.blocks bl where bl.revoked_at is null and
        bl.blocker_user_id in (c.user_low_id,c.user_high_id) and bl.blocked_user_id in (c.user_low_id,c.user_high_id))
        then p.user_id end as other_user_id,
      case when c.status = 'active' and not exists (select 1 from public.blocks bl where bl.revoked_at is null and
        bl.blocker_user_id in (c.user_low_id,c.user_high_id) and bl.blocked_user_id in (c.user_low_id,c.user_high_id))
        then p.nickname end as other_nickname,
      case when c.status = 'active' and not exists (select 1 from public.blocks bl where bl.revoked_at is null and
        bl.blocker_user_id in (c.user_low_id,c.user_high_id) and bl.blocked_user_id in (c.user_low_id,c.user_high_id))
        then p.avatar_key end as other_avatar
    from public.connections c left join public.profiles p on p.user_id = case when c.user_low_id = actor then c.user_high_id else c.user_low_id end
    where actor in (c.user_low_id,c.user_high_id) and (cursor_at is null or (c.created_at,c.id) < (cursor_at,cursor_id))
    order by c.created_at desc,c.id desc limit p_limit + 1
  loop
    if item_count = p_limit then next_cursor := private.encode_relationship_cursor(last_at,last_id); exit; end if;
    item_count := item_count + 1; last_at := item.created_at; last_id := item.id;
    items := items || jsonb_build_array(jsonb_build_object('id',item.id,'status',item.status,'generation',item.generation,
      'other_user',case when item.other_user_id is null then null else jsonb_build_object('user_id',item.other_user_id,'nickname',item.other_nickname,'avatar_key',item.other_avatar) end));
  end loop;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
alter function public.list_connections(text,integer) owner to chagokchan_rpc;
revoke all on function public.list_connections(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_connections(text,integer) to authenticated;

create or replace function public.list_connection_invites(p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid; last_at timestamptz; last_id uuid;
  item record; items jsonb := '[]'::jsonb; next_cursor text := null; item_count integer := 0;
begin
  actor := private.require_actor();
  if p_limit not between 1 and 50 then raise exception using errcode = 'PT400', message = 'invalid_page_size'; end if;
  cursor_value := private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at := (cursor_value->>0)::timestamptz; cursor_id := (cursor_value->>1)::uuid; end if;
  for item in select i.id,i.created_at,i.expires_at,i.redeemed_at,i.revoked_at from public.connection_invites i
    where i.inviter_user_id=actor and (cursor_at is null or (i.created_at,i.id)<(cursor_at,cursor_id))
    order by i.created_at desc,i.id desc limit p_limit+1
  loop
    if item_count=p_limit then next_cursor:=private.encode_relationship_cursor(last_at,last_id); exit; end if;
    item_count:=item_count+1; last_at:=item.created_at; last_id:=item.id;
    items:=items||jsonb_build_array(jsonb_build_object('id',item.id,'created_at',item.created_at,'expires_at',item.expires_at,'redeemed_at',item.redeemed_at,'revoked_at',item.revoked_at));
  end loop;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
alter function public.list_connection_invites(text,integer) owner to chagokchan_rpc;
revoke all on function public.list_connection_invites(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_connection_invites(text,integer) to authenticated;

create or replace function public.list_connection_requests(p_direction text default 'both',p_cursor text default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid; last_at timestamptz; last_id uuid;
  item record; items jsonb := '[]'::jsonb; next_cursor text := null; item_count integer := 0;
begin
  actor:=private.require_actor();
  if p_direction not in ('incoming','outgoing','both') or p_limit not between 1 and 50 then raise exception using errcode='PT400',message='invalid_request_list'; end if;
  cursor_value:=private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at:=(cursor_value->>0)::timestamptz;cursor_id:=(cursor_value->>1)::uuid;end if;
  for item in select cr.id,cr.requester_user_id,cr.approver_user_id,cr.status,cr.created_at,cr.expires_at,c.status as connection_status,
      case when cr.expires_at<=clock_timestamp() and cr.status='pending' then 'expired' else cr.status end as visible_status,
      p.user_id as other_user_id,p.nickname as other_nickname,p.avatar_key as other_avatar
    from public.connection_requests cr join public.connections c on c.id=cr.connection_id
    left join public.profiles p on p.user_id=case when cr.requester_user_id=actor then cr.approver_user_id else cr.requester_user_id end
    where actor in (cr.requester_user_id,cr.approver_user_id)
      and (p_direction='both' or (p_direction='incoming' and cr.approver_user_id=actor) or (p_direction='outgoing' and cr.requester_user_id=actor))
      and (cursor_at is null or (cr.created_at,cr.id)<(cursor_at,cursor_id))
    order by cr.created_at desc,cr.id desc limit p_limit+1
  loop
    if item_count=p_limit then next_cursor:=private.encode_relationship_cursor(last_at,last_id); exit; end if;
    item_count:=item_count+1; last_at:=item.created_at; last_id:=item.id;
    items:=items||jsonb_build_array(jsonb_build_object('id',item.id,'direction',case when item.approver_user_id=actor then 'incoming' else 'outgoing' end,
      'other_user',case when item.other_user_id is null then null else jsonb_build_object('user_id',item.other_user_id,'nickname',item.other_nickname,'avatar_key',item.other_avatar) end,
      'status',item.visible_status,'created_at',item.created_at,'expires_at',item.expires_at));
  end loop;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
alter function public.list_connection_requests(text,text,integer) owner to chagokchan_rpc;
revoke all on function public.list_connection_requests(text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_connection_requests(text,text,integer) to authenticated;

create or replace function public.list_blocks(p_cursor text default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid; last_at timestamptz; last_id uuid;
  item record; items jsonb:='[]'::jsonb; next_cursor text:=null; item_count integer:=0;
begin
  actor:=private.require_actor();
  if p_limit not between 1 and 50 then raise exception using errcode='PT400',message='invalid_page_size'; end if;
  cursor_value:=private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at:=(cursor_value->>0)::timestamptz;cursor_id:=(cursor_value->>1)::uuid;end if;
  for item in select bl.id,bl.blocked_user_id,bl.created_at,p.nickname,p.avatar_key from public.blocks bl
    left join public.profiles p on p.user_id=bl.blocked_user_id
    where bl.blocker_user_id=actor and bl.revoked_at is null and (cursor_at is null or (bl.created_at,bl.id)<(cursor_at,cursor_id))
    order by bl.created_at desc,bl.id desc limit p_limit+1
  loop
    if item_count=p_limit then next_cursor:=private.encode_relationship_cursor(last_at,last_id);exit;end if;
    item_count:=item_count+1;last_at:=item.created_at;last_id:=item.id;
    items:=items||jsonb_build_array(jsonb_build_object('id',item.id,'blocked_user',
      case when item.blocked_user_id is null then null else jsonb_build_object('user_id',item.blocked_user_id,'nickname',item.nickname,'avatar_key',item.avatar_key) end,'created_at',item.created_at));
  end loop;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
alter function public.list_blocks(text,integer) owner to chagokchan_rpc;
revoke all on function public.list_blocks(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_blocks(text,integer) to authenticated;

commit;
