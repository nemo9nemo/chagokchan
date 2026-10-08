-- Qualify bunch columns so the PL/pgSQL cycle-number variable cannot shadow the column.
begin;

create or replace function public.create_peer_praise(p_request_key uuid, p_board_id uuid, p_message text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; now_at timestamptz := clock_timestamp(); utc_minute timestamptz; utc_day timestamptz;
  normalized_message text; request_hash text; canonical_input jsonb; praise_uuid uuid := gen_random_uuid();
  receipt_uuid uuid := gen_random_uuid(); inserted_receipt uuid; existing public.request_receipts%rowtype;
  board_row record; connection_row record; member_row record; cycle_row record; cycle_uuid uuid; v_cycle_no integer;
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
    v_cycle_no:=1;
    insert into public.bunches(board_id,cycle_no,target_count,rule_code)
      values(board_row.id,v_cycle_no,board_row.next_target_count,board_row.next_rule_code) returning id into cycle_uuid;
    update public.boards set current_bunch_id=cycle_uuid where id=board_row.id;
    select bu.id,bu.cycle_no,bu.target_count,bu.rule_code,bu.valid_count,bu.progress_state,bu.completed_at into cycle_row
      from public.bunches bu where bu.id=cycle_uuid;
  else
    select bu.id,bu.cycle_no,bu.target_count,bu.rule_code,bu.valid_count,bu.progress_state,bu.completed_at into cycle_row
      from public.bunches bu where bu.id=board_row.current_bunch_id and bu.board_id=board_row.id for update;
    if not found then raise exception using errcode='PT503',message='current_bunch_incomplete'; end if;
    if cycle_row.progress_state='complete' then
      v_cycle_no:=cycle_row.cycle_no+1;
      insert into public.bunches(board_id,cycle_no,target_count,rule_code)
        values(board_row.id,v_cycle_no,board_row.next_target_count,board_row.next_rule_code) returning id into cycle_uuid;
      update public.boards set current_bunch_id=cycle_uuid where id=board_row.id;
      select bu.id,bu.cycle_no,bu.target_count,bu.rule_code,bu.valid_count,bu.progress_state,bu.completed_at into cycle_row
        from public.bunches bu where bu.id=cycle_uuid;
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

commit;
