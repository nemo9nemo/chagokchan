begin;

grant create on schema public, private to chagokchan_rpc;
grant update (hidden_at, excluded_at) on public.praises to chagokchan_rpc;

create policy rpc_owner_peer_praise_moderation_update on public.praises for update to chagokchan_rpc
  using (recipient_user_id = private.require_actor() and source = 'peer')
  with check (recipient_user_id = private.require_actor() and source = 'peer');

create function private.set_peer_praise_state(p_praise_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid;
  board_row record;
  current_praise record;
  bunch_row record;
  now_at timestamptz := clock_timestamp();
  utc_minute timestamptz;
  next_count integer;
begin
  actor := private.require_actor();
  if p_praise_id is null or p_action is null or p_action not in ('hide', 'unhide', 'exclude') then
    raise exception using errcode = 'PT400', message = 'invalid_praise_state';
  end if;

  select b.id, b.goal_id, p.bunch_id into board_row
    from public.praises p
    join public.boards b on b.id = p.board_id
    where p.id = p_praise_id and p.source = 'peer' and p.recipient_user_id = actor;
  if not found then raise exception using errcode = 'PT404', message = 'praise_not_found'; end if;

  perform 1 from public.goals g where g.id = board_row.goal_id and g.owner_user_id = actor and g.status <> 'deleted' for update;
  if not found then raise exception using errcode = 'PT404', message = 'praise_not_found'; end if;
  perform 1 from public.boards b where b.id = board_row.id and b.owner_user_id = actor for update;
  if not found then raise exception using errcode = 'PT404', message = 'praise_not_found'; end if;

  if p_action = 'exclude' then
    select b.id, b.target_count into bunch_row from public.bunches b
      where b.id = board_row.bunch_id and b.board_id = board_row.id for update;
    if not found then raise exception using errcode = 'PT503', message = 'bunch_not_found'; end if;
  end if;

  select p.id, p.bunch_id, p.cancelled_at, p.hidden_at, p.excluded_at
    into current_praise from public.praises p
    where p.id = p_praise_id and p.source = 'peer' and p.recipient_user_id = actor for update;
  if not found then raise exception using errcode = 'PT404', message = 'praise_not_found'; end if;
  if current_praise.cancelled_at is not null then raise exception using errcode = 'PT409', message = 'praise_cancelled'; end if;

  if p_action = 'hide' and current_praise.hidden_at is not null then
    return jsonb_build_object('id', current_praise.id, 'replayed', true);
  elsif p_action = 'unhide' and current_praise.hidden_at is null then
    return jsonb_build_object('id', current_praise.id, 'replayed', true);
  elsif p_action = 'exclude' and current_praise.excluded_at is not null then
    return jsonb_build_object('id', current_praise.id, 'replayed', true);
  end if;

  utc_minute := date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(actor, 'praise_state_change_minute', 60, utc_minute, utc_minute + interval '1 minute');

  if p_action = 'hide' then
    update public.praises set hidden_at = now_at where id = current_praise.id;
  elsif p_action = 'unhide' then
    update public.praises set hidden_at = null where id = current_praise.id;
  else
    update public.praises set excluded_at = now_at where id = current_praise.id;
    select count(*)::integer into next_count from public.praises p
      where p.bunch_id = current_praise.bunch_id and p.cancelled_at is null and p.excluded_at is null;
    update public.bunches set valid_count = next_count,
      progress_state = case when next_count = bunch_row.target_count then 'complete' else 'incomplete' end,
      completed_at = case when next_count = bunch_row.target_count then coalesce(completed_at, now_at) else null end
      where id = current_praise.bunch_id and board_id = board_row.id;
  end if;

  return jsonb_build_object('id', current_praise.id, 'replayed', false);
end $$;
alter function private.set_peer_praise_state(uuid, text) owner to chagokchan_rpc;
revoke all on function private.set_peer_praise_state(uuid, text) from public, anon, authenticated, service_role;

create function public.hide_peer_praise(p_praise_id uuid) returns jsonb
language sql security definer set search_path = pg_catalog
as $$ select private.set_peer_praise_state(p_praise_id, 'hide') $$;
alter function public.hide_peer_praise(uuid) owner to chagokchan_rpc;
revoke all on function public.hide_peer_praise(uuid) from public, anon, authenticated, service_role;
grant execute on function public.hide_peer_praise(uuid) to authenticated;

create function public.unhide_peer_praise(p_praise_id uuid) returns jsonb
language sql security definer set search_path = pg_catalog
as $$ select private.set_peer_praise_state(p_praise_id, 'unhide') $$;
alter function public.unhide_peer_praise(uuid) owner to chagokchan_rpc;
revoke all on function public.unhide_peer_praise(uuid) from public, anon, authenticated, service_role;
grant execute on function public.unhide_peer_praise(uuid) to authenticated;

create function public.exclude_peer_praise(p_praise_id uuid) returns jsonb
language sql security definer set search_path = pg_catalog
as $$ select private.set_peer_praise_state(p_praise_id, 'exclude') $$;
alter function public.exclude_peer_praise(uuid) owner to chagokchan_rpc;
revoke all on function public.exclude_peer_praise(uuid) from public, anon, authenticated, service_role;
grant execute on function public.exclude_peer_praise(uuid) to authenticated;

revoke create on schema public, private from chagokchan_rpc;
notify pgrst, 'reload schema';
commit;
