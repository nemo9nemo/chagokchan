-- W06-B1: atomic goal creation and revision-checked owner lifecycle.
begin;

-- Temporary CREATE is needed only while transferring SECURITY DEFINER ownership.
grant create on schema public, private to chagokchan_rpc;

grant select (id, owner_user_id, title, private_description, status, revision, created_at, completed_at, archived_at, deleted_at, purge_after),
  insert (id, owner_user_id, title, private_description),
  update (title, private_description, status, revision, completed_at, archived_at, deleted_at, purge_after)
  on public.goals to chagokchan_rpc;
grant select (id, goal_id, owner_user_id, kind, next_target_count, next_rule_code, current_bunch_id, revision),
  insert (id, goal_id, owner_user_id, kind, next_target_count, next_rule_code)
  on public.boards to chagokchan_rpc;
grant select (board_id, public_title, public_description), insert (board_id, public_title, public_description)
  on public.shared_board_profiles to chagokchan_rpc;
grant select (id, board_id, cycle_no, target_count, rule_code, valid_count, progress_state, completed_at)
  on public.bunches to chagokchan_rpc;
grant select (id, actor_user_id, operation, request_key, input_hash, result_kind, result_id),
  insert (id, actor_user_id, operation, request_key, input_hash, result_kind, result_id)
  on public.request_receipts to chagokchan_rpc;

create policy rpc_owner_goals_select on public.goals for select to chagokchan_rpc
  using (owner_user_id = private.require_actor());
create policy rpc_owner_goals_insert on public.goals for insert to chagokchan_rpc
  with check (owner_user_id = private.require_actor());
create policy rpc_owner_goals_update on public.goals for update to chagokchan_rpc
  using (owner_user_id = private.require_actor()) with check (owner_user_id = private.require_actor());
create policy rpc_owner_boards_select on public.boards for select to chagokchan_rpc
  using (owner_user_id = private.require_actor());
create policy rpc_owner_boards_insert on public.boards for insert to chagokchan_rpc
  with check (owner_user_id = private.require_actor());
create policy rpc_owner_shared_profile_select on public.shared_board_profiles for select to chagokchan_rpc
  using (exists (select 1 from public.boards b where b.id = board_id and b.owner_user_id = private.require_actor()));
create policy rpc_owner_shared_profile_insert on public.shared_board_profiles for insert to chagokchan_rpc
  with check (exists (select 1 from public.boards b where b.id = board_id and b.owner_user_id = private.require_actor()));
create policy rpc_owner_bunches_select on public.bunches for select to chagokchan_rpc
  using (exists (select 1 from public.boards b where b.id = board_id and b.owner_user_id = private.require_actor()));
create policy rpc_owner_receipts_select on public.request_receipts for select to chagokchan_rpc
  using (actor_user_id = private.require_actor());
create policy rpc_owner_receipts_insert on public.request_receipts for insert to chagokchan_rpc
  with check (actor_user_id = private.require_actor());

create function public.create_goal(
  p_request_key uuid,
  p_title text,
  p_private_description text default null,
  p_personal_target_count smallint default 20,
  p_shared_board jsonb default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  actor uuid; goal_uuid uuid := gen_random_uuid(); personal_uuid uuid := gen_random_uuid();
  shared_uuid uuid := gen_random_uuid(); receipt_uuid uuid := gen_random_uuid(); existing public.request_receipts%rowtype;
  normalized_title text; normalized_description text; shared_title text; shared_description text;
  shared_target integer; request_hash text; canonical_input jsonb; inserted_receipt uuid;
  active_count integer; retained_count integer;
begin
  actor := private.require_actor();
  if p_request_key is null or p_title is null or p_personal_target_count not between 1 and 100 then
    raise exception using errcode = 'PT400', message = 'invalid_goal_input';
  end if;
  normalized_title := normalize(btrim(p_title), NFC);
  normalized_description := case when p_private_description is null then null else
    nullif(normalize(replace(replace(p_private_description, E'\r\n', E'\n'), E'\r', E'\n'), NFC), '') end;
  if char_length(normalized_title) not between 1 and 80 or normalized_title <> btrim(normalized_title) or
     (normalized_description is not null and char_length(normalized_description) > 1000) then
    raise exception using errcode = 'PT400', message = 'invalid_goal_input';
  end if;
  if p_shared_board is not null then
    if jsonb_typeof(p_shared_board) <> 'object' or
       (p_shared_board - 'title' - 'description' - 'target_count') <> '{}'::jsonb or
       not (p_shared_board ? 'title') or not (p_shared_board ? 'target_count') or
       jsonb_typeof(p_shared_board->'title') <> 'string' or jsonb_typeof(p_shared_board->'target_count') <> 'number' then
      raise exception using errcode = 'PT400', message = 'invalid_shared_profile';
    end if;
    shared_title := normalize(btrim(p_shared_board->>'title'), NFC);
    shared_description := case when p_shared_board->'description' is null or p_shared_board->'description' = 'null'::jsonb then null
      else nullif(normalize(replace(replace(p_shared_board->>'description', E'\r\n', E'\n'), E'\r', E'\n'), NFC), '') end;
    begin shared_target := (p_shared_board->>'target_count')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = 'PT400', message = 'invalid_shared_profile';
    end;
    if shared_title is null or char_length(shared_title) not between 1 and 80 or shared_title <> btrim(shared_title) or
       shared_target not between 1 and 100 or (shared_description is not null and char_length(shared_description) > 1000) or
       (p_shared_board ? 'description' and jsonb_typeof(p_shared_board->'description') not in ('string', 'null')) then
      raise exception using errcode = 'PT400', message = 'invalid_shared_profile';
    end if;
  end if;

  canonical_input := jsonb_build_object('title', normalized_title, 'private_description', normalized_description,
    'personal_target_count', p_personal_target_count, 'shared_board',
    case when p_shared_board is null then null else jsonb_build_object('title', shared_title, 'description', shared_description, 'target_count', shared_target) end);
  request_hash := encode(sha256(convert_to(canonical_input::text, 'UTF8')), 'hex');
  insert into public.request_receipts(id, actor_user_id, operation, request_key, input_hash, result_kind, result_id)
    values (receipt_uuid, actor, 'createGoal', p_request_key, request_hash, 'goal', goal_uuid)
    on conflict (actor_user_id, operation, request_key) do nothing returning id into inserted_receipt;
  if inserted_receipt is null then
    select * into existing from public.request_receipts r
      where r.actor_user_id = actor and r.operation = 'createGoal' and r.request_key = p_request_key for update;
    if existing.input_hash is distinct from request_hash or existing.result_kind <> 'goal' then
      raise exception using errcode = 'PT409', message = 'idempotency_conflict';
    end if;
    return jsonb_build_object('id', existing.result_id, 'replayed', true);
  end if;

  -- Same-user lock serializes both active and retained-goal limits across different keys.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  select count(*) filter (where status = 'active'), count(*) into active_count, retained_count
    from public.goals where owner_user_id = actor;
  if active_count >= 20 then raise exception using errcode = 'PT409', message = 'active_goal_limit'; end if;
  if retained_count >= 100 then raise exception using errcode = 'PT409', message = 'retained_goal_limit'; end if;

  insert into public.goals(id, owner_user_id, title, private_description)
    values (goal_uuid, actor, normalized_title, normalized_description);
  insert into public.boards(id, goal_id, owner_user_id, kind, next_target_count)
    values (personal_uuid, goal_uuid, actor, 'personal', p_personal_target_count);
  if p_shared_board is not null then
    insert into public.boards(id, goal_id, owner_user_id, kind, next_target_count)
      values (shared_uuid, goal_uuid, actor, 'shared', shared_target);
    insert into public.shared_board_profiles(board_id, public_title, public_description)
      values (shared_uuid, shared_title, shared_description);
  end if;
  return jsonb_build_object('id', goal_uuid, 'replayed', false);
end $$;
alter function public.create_goal(uuid, text, text, smallint, jsonb) owner to chagokchan_rpc;
revoke all on function public.create_goal(uuid, text, text, smallint, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_goal(uuid, text, text, smallint, jsonb) to authenticated;

create function private.transition_goal(p_goal_id uuid, p_expected_revision integer, p_action text) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; current_goal public.goals%rowtype; next_status text;
begin
  actor := private.require_actor();
  select * into current_goal from public.goals g where g.id = p_goal_id and g.owner_user_id = actor for update;
  if not found or current_goal.status = 'deleted' then raise exception using errcode = 'PT404', message = 'goal_not_found'; end if;
  if p_action = 'complete' then next_status := 'completed';
  elsif p_action = 'archive' then next_status := 'archived';
  elsif p_action = 'resume' then next_status := 'active';
  else raise exception using errcode = 'PT400', message = 'invalid_goal_action'; end if;
  if current_goal.status = next_status then return jsonb_build_object('id', current_goal.id, 'replayed', true); end if;
  if p_expected_revision is null or current_goal.revision <> p_expected_revision then
    raise exception using errcode = 'PT409', message = 'revision_conflict';
  end if;
  if (p_action = 'complete' and current_goal.status <> 'active') or
     (p_action = 'archive' and current_goal.status not in ('active', 'completed')) or
     (p_action = 'resume' and current_goal.status not in ('completed', 'archived')) then
    raise exception using errcode = 'PT409', message = 'invalid_goal_transition';
  end if;
  update public.goals set status = next_status, revision = revision + 1,
    completed_at = case when next_status = 'completed' then clock_timestamp() when next_status = 'active' then null else completed_at end,
    archived_at = case when next_status = 'archived' then clock_timestamp() else null end
    where id = current_goal.id;
  return jsonb_build_object('id', current_goal.id, 'replayed', false);
end $$;
alter function private.transition_goal(uuid, integer, text) owner to chagokchan_rpc;
revoke all on function private.transition_goal(uuid, integer, text) from public, anon, authenticated, service_role;

create function public.complete_goal(p_goal_id uuid, p_expected_revision integer) returns jsonb
language sql security definer set search_path = pg_catalog
as $$ select private.transition_goal(p_goal_id, p_expected_revision, 'complete') $$;
create function public.archive_goal(p_goal_id uuid, p_expected_revision integer) returns jsonb
language sql security definer set search_path = pg_catalog
as $$ select private.transition_goal(p_goal_id, p_expected_revision, 'archive') $$;
create function public.resume_goal(p_goal_id uuid, p_expected_revision integer) returns jsonb
language sql security definer set search_path = pg_catalog
as $$ select private.transition_goal(p_goal_id, p_expected_revision, 'resume') $$;
alter function public.complete_goal(uuid, integer) owner to chagokchan_rpc;
alter function public.archive_goal(uuid, integer) owner to chagokchan_rpc;
alter function public.resume_goal(uuid, integer) owner to chagokchan_rpc;
revoke all on function public.complete_goal(uuid, integer), public.archive_goal(uuid, integer), public.resume_goal(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.complete_goal(uuid, integer), public.archive_goal(uuid, integer), public.resume_goal(uuid, integer) to authenticated;

create function public.update_goal(
  p_goal_id uuid, p_expected_revision integer, p_title text default null,
  p_private_description text default null, p_update_title boolean default false,
  p_update_private_description boolean default false
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; current_goal public.goals%rowtype; new_title text; new_description text;
begin
  actor := private.require_actor();
  if not p_update_title and not p_update_private_description then raise exception using errcode = 'PT400', message = 'empty_goal_patch'; end if;
  if (p_update_title and p_title is null) then raise exception using errcode = 'PT400', message = 'invalid_goal_input'; end if;
  new_title := case when p_update_title then normalize(btrim(p_title), NFC) else null end;
  new_description := case when p_update_private_description and p_private_description is not null
    then nullif(normalize(replace(replace(p_private_description, E'\r\n', E'\n'), E'\r', E'\n'), NFC), '') else p_private_description end;
  if (p_update_title and (char_length(new_title) not between 1 and 80 or new_title <> btrim(new_title))) or
     (p_update_private_description and new_description is not null and char_length(new_description) > 1000) then
    raise exception using errcode = 'PT400', message = 'invalid_goal_input';
  end if;
  select * into current_goal from public.goals g where g.id = p_goal_id and g.owner_user_id = actor for update;
  if not found or current_goal.status = 'deleted' then raise exception using errcode = 'PT404', message = 'goal_not_found'; end if;
  if current_goal.revision <> p_expected_revision then raise exception using errcode = 'PT409', message = 'revision_conflict'; end if;
  if (not p_update_title or new_title is not distinct from current_goal.title) and
     (not p_update_private_description or new_description is not distinct from current_goal.private_description) then
    return jsonb_build_object('id', current_goal.id, 'replayed', true);
  end if;
  update public.goals set title = case when p_update_title then new_title else title end,
    private_description = case when p_update_private_description then new_description else private_description end,
    revision = revision + 1 where id = current_goal.id;
  return jsonb_build_object('id', current_goal.id, 'replayed', false);
end $$;
alter function public.update_goal(uuid, integer, text, text, boolean, boolean) owner to chagokchan_rpc;
revoke all on function public.update_goal(uuid, integer, text, text, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.update_goal(uuid, integer, text, text, boolean, boolean) to authenticated;

create function public.get_goal(p_goal_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; goal_row public.goals%rowtype; board_rows jsonb;
begin
  actor := private.require_actor();
  select * into goal_row from public.goals g where g.id = p_goal_id and g.owner_user_id = actor and g.status <> 'deleted';
  if not found then raise exception using errcode = 'PT404', message = 'goal_not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'viewer_role', 'owner', 'id', b.id, 'goal_id', b.goal_id, 'kind', b.kind,
    'revision', b.revision, 'next_target_count', b.next_target_count,
    'shared_title', sp.public_title, 'shared_description', sp.public_description,
    'current_bunch', case when bu.id is null then null else jsonb_build_object(
      'id', bu.id, 'cycle_no', bu.cycle_no, 'target_count', bu.target_count,
      'valid_count', bu.valid_count, 'progress_state', bu.progress_state, 'completed_at', bu.completed_at) end
  ) order by b.kind), '[]'::jsonb) into board_rows
  from public.boards b
  left join public.shared_board_profiles sp on sp.board_id = b.id
  left join public.bunches bu on bu.id = b.current_bunch_id and bu.board_id = b.id
  where b.goal_id = goal_row.id and b.owner_user_id = actor;
  return jsonb_build_object('goal', jsonb_build_object(
    'id', goal_row.id, 'title', goal_row.title, 'private_description', goal_row.private_description,
    'status', goal_row.status, 'revision', goal_row.revision, 'created_at', goal_row.created_at,
    'completed_at', goal_row.completed_at, 'archived_at', goal_row.archived_at), 'boards', board_rows);
end $$;
alter function public.get_goal(uuid) owner to chagokchan_rpc;
revoke all on function public.get_goal(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_goal(uuid) to authenticated;

notify pgrst, 'reload schema';
revoke create on schema public, private from chagokchan_rpc;
commit;
