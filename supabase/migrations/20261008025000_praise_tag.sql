-- W20-A / REQ-003, REQ-007 / POL-PRAISE-001, POL-PRAISE-002 / TC-PRAISE-TAG-001.
-- Preserve the atomic write, live actor checks, counts and tagless idempotency hashes.
begin;

grant create on schema public, private to chagokchan_rpc;
alter table public.praises add column tag text;
alter table public.praises
  add constraint praises_tag_code check (tag is null or tag in ('consistency', 'courage', 'care', 'growth', 'rest')),
  add constraint praises_peer_no_tag check (source <> 'peer' or tag is null),
  add constraint praises_cancel_clears_tag check (cancelled_at is null or tag is null);
grant select (tag), insert (tag), update (tag) on public.praises to chagokchan_rpc;


create or replace function public.create_praise(
  p_request_key uuid, p_board_id uuid, p_message text default null, p_occurred_on date default null, p_tag text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; actor_timezone text; now_at timestamptz := clock_timestamp(); utc_minute timestamptz; utc_day timestamptz;
  normalized_message text; request_hash text; canonical_input jsonb; praise_uuid uuid := gen_random_uuid();
  receipt_uuid uuid := gen_random_uuid(); inserted_receipt uuid; existing public.request_receipts%rowtype;
  board_row record; cycle_row record; cycle_uuid uuid; v_cycle_no integer; v_valid_count integer; completed_now boolean := false;
begin
  actor := private.require_actor();
  if p_request_key is null or p_board_id is null then raise exception using errcode = 'PT400', message = 'invalid_praise_input'; end if;
  if p_tag is not null and p_tag not in ('consistency', 'courage', 'care', 'growth', 'rest') then
    raise exception using errcode = 'PT400', message = 'invalid_praise_input';
  end if;
  normalized_message := case when p_message is null then null else
    nullif(normalize(replace(replace(p_message, E'\r\n', E'\n'), E'\r', E'\n'), NFC), '') end;
  if normalized_message is not null and char_length(normalized_message) > 1000 then
    raise exception using errcode = 'PT400', message = 'invalid_praise_input';
  end if;
  select timezone into actor_timezone from public.app_users where id = actor;
  if actor_timezone is null then raise exception using errcode = 'PT403', message = 'account_unavailable'; end if;
  if p_occurred_on is not null and (p_occurred_on > (now_at at time zone actor_timezone)::date or
     p_occurred_on < (now_at at time zone actor_timezone)::date - 365) then
    raise exception using errcode = 'PT400', message = 'occurred_on_out_of_range';
  end if;
  canonical_input := jsonb_build_object('board_id', p_board_id, 'message', normalized_message, 'occurred_on', p_occurred_on);
  -- Omit the null tag key to preserve hashes of requests created before W20-A.
  if p_tag is not null then canonical_input := canonical_input || jsonb_build_object('tag', p_tag); end if;
  request_hash := encode(sha256(convert_to(canonical_input::text, 'UTF8')), 'hex');
  insert into public.request_receipts(id, actor_user_id, operation, request_key, input_hash, result_kind, result_id)
    values (receipt_uuid, actor, 'createPraise', p_request_key, request_hash, 'praise', praise_uuid)
    on conflict (actor_user_id, operation, request_key) do nothing returning id into inserted_receipt;
  if inserted_receipt is null then
    select * into existing from public.request_receipts r
      where r.actor_user_id = actor and r.operation = 'createPraise' and r.request_key = p_request_key for update;
    if existing.input_hash is distinct from request_hash or existing.result_kind <> 'praise' then
      raise exception using errcode = 'PT409', message = 'idempotency_conflict';
    end if;
    return jsonb_build_object('id', existing.result_id, 'replayed', true);
  end if;

  select b.id, b.goal_id, b.owner_user_id, b.kind, b.next_target_count, b.next_rule_code, b.current_bunch_id,
    g.status as goal_status into board_row
    from public.boards b join public.goals g on g.id = b.goal_id and g.owner_user_id = b.owner_user_id
    where b.id = p_board_id and b.owner_user_id = actor for update of g, b;
  if not found then raise exception using errcode = 'PT404', message = 'board_not_found'; end if;
  if board_row.kind <> 'personal' then raise exception using errcode = 'PT403', message = 'board_access_denied'; end if;
  if board_row.goal_status <> 'active' then raise exception using errcode = 'PT409', message = 'goal_not_active'; end if;

  utc_minute := date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC';
  utc_day := date_trunc('day', now_at at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(actor, 'praise_write_minute', 20, utc_minute, utc_minute + interval '1 minute');
  perform private.consume_rate_limit(actor, 'praise_write_day', 300, utc_day, utc_day + interval '1 day');

  if board_row.current_bunch_id is null then
    v_cycle_no := 1;
    insert into public.bunches(board_id, cycle_no, target_count, rule_code)
      values (board_row.id, v_cycle_no, board_row.next_target_count, board_row.next_rule_code) returning id into cycle_uuid;
    update public.boards set current_bunch_id = cycle_uuid where id = board_row.id;
    select bu.id, bu.target_count, bu.rule_code, bu.valid_count, bu.progress_state, bu.completed_at into cycle_row
      from public.bunches bu where bu.id = cycle_uuid;
  else
    select bu.id, bu.cycle_no, bu.target_count, bu.rule_code, bu.valid_count, bu.progress_state, bu.completed_at into cycle_row
      from public.bunches bu where bu.id = board_row.current_bunch_id and bu.board_id = board_row.id for update;
    if not found then raise exception using errcode = 'PT503', message = 'current_bunch_incomplete'; end if;
    if cycle_row.progress_state = 'complete' then
      v_cycle_no := cycle_row.cycle_no + 1;
      insert into public.bunches(board_id, cycle_no, target_count, rule_code)
        values (board_row.id, v_cycle_no, board_row.next_target_count, board_row.next_rule_code) returning id into cycle_uuid;
      update public.boards set current_bunch_id = cycle_uuid where id = board_row.id;
      select bu.id, bu.target_count, bu.rule_code, bu.valid_count, bu.progress_state, bu.completed_at into cycle_row
        from public.bunches bu where bu.id = cycle_uuid;
    else
      cycle_uuid := cycle_row.id;
    end if;
  end if;

  insert into public.praises(id, board_id, bunch_id, actor_user_id, recipient_user_id, request_receipt_id, source, message, occurred_on, tag)
    values (praise_uuid, board_row.id, cycle_uuid, actor, actor, receipt_uuid, 'self', normalized_message, p_occurred_on, p_tag);
  select count(*)::integer into v_valid_count from public.praises p
    where p.bunch_id = cycle_uuid and p.cancelled_at is null and p.excluded_at is null;
  if v_valid_count > cycle_row.target_count then raise exception using errcode = 'PT503', message = 'bunch_count_invalid'; end if;
  completed_now := v_valid_count = cycle_row.target_count;
  update public.bunches set valid_count = v_valid_count,
    progress_state = case when completed_now then 'complete' else 'incomplete' end,
    completed_at = case when completed_now then coalesce(completed_at, now_at) else null end
    where id = cycle_uuid and board_id = board_row.id;
  if completed_now then
    if actor is distinct from private.require_actor() then raise exception using errcode = 'PT503', message = 'actor_context_changed'; end if;
    insert into public.notifications(recipient_user_id, actor_user_id, type, dedupe_key, bunch_id)
      values (private.require_actor(), actor, 'bunch_completed', 'bunch-completed:' || cycle_uuid::text, cycle_uuid)
      on conflict (recipient_user_id, dedupe_key) do nothing;
  end if;
  return jsonb_build_object('id', praise_uuid, 'replayed', false);
end $$;
alter function public.create_praise(uuid, uuid, text, date, text) owner to chagokchan_rpc;
revoke all on function public.create_praise(uuid, uuid, text, date, text) from public, anon, authenticated, service_role;
grant execute on function public.create_praise(uuid, uuid, text, date, text) to authenticated;

create function public.create_personal_praise(
  p_request_key uuid, p_board_id uuid, p_message text default null, p_occurred_on date default null, p_tag text default null
) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog
as $$
declare actor uuid; result jsonb; praise_id uuid; cycle_id uuid;
begin
  actor := private.require_actor();
  result := public.create_praise(p_request_key, p_board_id, p_message, p_occurred_on, p_tag);
  praise_id := (result->>'id')::uuid;
  select p.bunch_id into cycle_id from public.praises p
    where p.id = praise_id and p.board_id = p_board_id and p.actor_user_id = actor
      and p.recipient_user_id = actor and p.source = 'self';
  if not found or cycle_id is null then
    raise exception using errcode = 'PT503', message = 'praise_result_unavailable';
  end if;
  return jsonb_build_object('id', praise_id, 'bunch_id', cycle_id, 'replayed', (result->>'replayed')::boolean);
end $$;
alter function public.create_personal_praise(uuid, uuid, text, date, text) owner to chagokchan_rpc;
revoke all on function public.create_personal_praise(uuid, uuid, text, date, text) from public, anon, authenticated, service_role;
grant execute on function public.create_personal_praise(uuid, uuid, text, date, text) to authenticated;

-- Remove obsolete overloads and their grants after installing both new signatures.
drop function public.create_personal_praise(uuid, uuid, text, date);
drop function public.create_praise(uuid, uuid, text, date);

create or replace function public.edit_self_praise(p_praise_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; current_praise record; actor_timezone text; next_message text; next_occurred_on date; next_tag text;
  has_message boolean; has_date boolean; has_tag boolean; utc_minute timestamptz; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or
     (p_patch - 'message' - 'occurred_on' - 'tag') <> '{}'::jsonb or p_patch = '{}'::jsonb then
    raise exception using errcode = 'PT400', message = 'invalid_praise_patch';
  end if;
  has_message := p_patch ? 'message'; has_date := p_patch ? 'occurred_on'; has_tag := p_patch ? 'tag';
  select p.id, p.board_id, p.bunch_id, p.actor_user_id, p.recipient_user_id, p.source, p.message, p.occurred_on, p.tag,
    p.cancelled_at, p.excluded_at, p.author_erased_at, g.status as goal_status, a.timezone as actor_timezone
    into current_praise from public.praises p
    join public.boards b on b.id = p.board_id
    join public.goals g on g.id = b.goal_id
    join public.app_users a on a.id = actor
    where p.id = p_praise_id for update of p, g;
  if not found then raise exception using errcode = 'PT404', message = 'praise_not_found'; end if;
  if current_praise.actor_user_id is distinct from actor then raise exception using errcode = 'PT403', message = 'praise_not_author'; end if;
  if current_praise.source <> 'self' or current_praise.recipient_user_id <> actor then raise exception using errcode = 'PT403', message = 'self_praise_required'; end if;
  if current_praise.goal_status = 'deleted' then raise exception using errcode = 'PT404', message = 'praise_not_found'; end if;
  if current_praise.cancelled_at is not null then raise exception using errcode = 'PT409', message = 'praise_cancelled'; end if;
  next_message := current_praise.message;
  if has_message then
    if jsonb_typeof(p_patch->'message') not in ('string', 'null') then raise exception using errcode = 'PT400', message = 'invalid_praise_patch'; end if;
    next_message := case when jsonb_typeof(p_patch->'message') = 'null' then null else
      nullif(normalize(replace(replace(p_patch->>'message', E'\r\n', E'\n'), E'\r', E'\n'), NFC), '') end;
    if next_message is not null and char_length(next_message) > 1000 then raise exception using errcode = 'PT400', message = 'invalid_praise_patch'; end if;
  end if;
  next_occurred_on := current_praise.occurred_on;
  if has_date then
    if jsonb_typeof(p_patch->'occurred_on') = 'null' then next_occurred_on := null;
    elsif jsonb_typeof(p_patch->'occurred_on') = 'string' and p_patch->>'occurred_on' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      begin next_occurred_on := (p_patch->>'occurred_on')::date;
      exception when others then raise exception using errcode = 'PT400', message = 'invalid_occurred_on'; end;
    else raise exception using errcode = 'PT400', message = 'invalid_occurred_on'; end if;
    if next_occurred_on is not null and (next_occurred_on > (now_at at time zone current_praise.actor_timezone)::date or
       next_occurred_on < (now_at at time zone current_praise.actor_timezone)::date - 365) then
      raise exception using errcode = 'PT400', message = 'occurred_on_out_of_range';
    end if;
  end if;
  next_tag := current_praise.tag;
  if has_tag then
    if jsonb_typeof(p_patch->'tag') not in ('string', 'null') then
      raise exception using errcode = 'PT400', message = 'invalid_praise_patch';
    end if;
    next_tag := p_patch->>'tag';
    if next_tag is not null and next_tag not in ('consistency', 'courage', 'care', 'growth', 'rest') then
      raise exception using errcode = 'PT400', message = 'invalid_praise_patch';
    end if;
  end if;
  if next_message is not distinct from current_praise.message and next_occurred_on is not distinct from current_praise.occurred_on and
     next_tag is not distinct from current_praise.tag then
    return jsonb_build_object('id', current_praise.id, 'replayed', true);
  end if;
  utc_minute := date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(actor, 'praise_state_change_minute', 60, utc_minute, utc_minute + interval '1 minute');
  update public.praises set message = next_message, occurred_on = next_occurred_on, tag = next_tag where id = current_praise.id;
  return jsonb_build_object('id', current_praise.id, 'replayed', false);
end $$;
alter function public.edit_self_praise(uuid, jsonb) owner to chagokchan_rpc;
revoke all on function public.edit_self_praise(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.edit_self_praise(uuid, jsonb) to authenticated;

create or replace function public.cancel_praise(p_praise_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; current_praise record; cycle_row record; remaining_count integer; utc_minute timestamptz;
  now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  select p.id, p.board_id, p.bunch_id, p.actor_user_id, p.recipient_user_id, p.source, p.cancelled_at,
    p.excluded_at, g.status as goal_status into current_praise
    from public.praises p join public.boards b on b.id = p.board_id join public.goals g on g.id = b.goal_id
    where p.id = p_praise_id for update of p, g;
  if not found then raise exception using errcode = 'PT404', message = 'praise_not_found'; end if;
  if current_praise.actor_user_id is distinct from actor then raise exception using errcode = 'PT403', message = 'praise_not_author'; end if;
  if current_praise.goal_status = 'deleted' then raise exception using errcode = 'PT404', message = 'praise_not_found'; end if;
  if current_praise.cancelled_at is not null then return jsonb_build_object('id', current_praise.id, 'replayed', true); end if;
  utc_minute := date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(actor, 'praise_state_change_minute', 60, utc_minute, utc_minute + interval '1 minute');
  update public.praises set cancelled_at = now_at, message = null, occurred_on = null, tag = null where id = current_praise.id;
  select id, board_id, target_count into cycle_row from public.bunches where id = current_praise.bunch_id for update;
  if not found then raise exception using errcode = 'PT503', message = 'bunch_not_found'; end if;
  select count(*)::integer into remaining_count from public.praises p
    where p.bunch_id = cycle_row.id and p.cancelled_at is null and p.excluded_at is null;
  update public.bunches set valid_count = remaining_count,
    progress_state = case when remaining_count = target_count then 'complete' else 'incomplete' end,
    completed_at = case when remaining_count = target_count then coalesce(completed_at, now_at) else null end
    where id = cycle_row.id;
  return jsonb_build_object('id', current_praise.id, 'replayed', false);
end $$;
alter function public.cancel_praise(uuid) owner to chagokchan_rpc;
revoke all on function public.cancel_praise(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_praise(uuid) to authenticated;

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
    select pr.id, pr.bunch_id, pr.source, pr.actor_user_id, pr.message, pr.occurred_on, pr.tag, pr.recorded_at,
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
        'message',item.message,'occurred_on',item.occurred_on,'tag',item.tag,'recorded_at',item.recorded_at,
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

revoke create on schema public, private from chagokchan_rpc;
notify pgrst, 'reload schema';
commit;
