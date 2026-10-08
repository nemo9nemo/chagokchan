-- W06-D2: service-only, resumable account data erasure and Auth-finalization boundary.
begin;
grant create on schema public to chagokchan_worker;

-- Only the non-login worker owner receives these narrowly selected product columns.
grant select (recipient_user_id, actor_user_id, id, praise_id, bunch_id, connection_request_id, connection_id),
  update (actor_user_id), delete on public.notifications to chagokchan_worker;
grant select (id, board_id, actor_user_id, recipient_user_id, source, message, occurred_on, request_receipt_id),
  update (actor_user_id, message, occurred_on, author_erased_at), delete on public.praises to chagokchan_worker;
grant select (id, goal_id, owner_user_id, kind, current_bunch_id), update (current_bunch_id), delete on public.boards to chagokchan_worker;
grant select (id, board_id), delete on public.bunches to chagokchan_worker;
grant select (board_id, user_id, connection_id, granted_by_user_id), delete on public.board_members to chagokchan_worker;
grant select (id, user_low_id, user_high_id), delete on public.connections to chagokchan_worker;
grant select (id, connection_id, invite_id, requester_user_id, approver_user_id), delete on public.connection_requests to chagokchan_worker;
grant select (id, inviter_user_id, redeemed_by_user_id), delete on public.connection_invites to chagokchan_worker;
grant select (id, blocker_user_id, blocked_user_id), delete on public.blocks to chagokchan_worker;
grant select (id, actor_user_id, operation, result_kind, result_id), update (actor_user_id, input_hash, erased_at), delete on public.request_receipts to chagokchan_worker;
grant select (actor_user_id, object_id), delete on public.audit_events to chagokchan_worker;
grant select (actor_user_id), delete on public.rate_usage to chagokchan_worker;
grant select (user_id), delete on public.reauth_grants to chagokchan_worker;
grant select (id, account_status), update (account_status), delete on public.app_users to chagokchan_worker;
grant select, update on public.account_deletion_requests to chagokchan_worker;

create function public.process_account_deletion(p_request_id uuid, p_ledger_reference uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare deletion_row public.account_deletion_requests%rowtype; subject uuid; now_at timestamptz := clock_timestamp();
  goal_ids uuid[]; board_ids uuid[]; bunch_ids uuid[]; own_praise_ids uuid[]; own_receipt_ids uuid[];
  authored_praise_ids uuid[]; authored_receipt_ids uuid[]; connection_ids uuid[]; request_ids uuid[]; invite_ids uuid[];
  object_ids uuid[];
begin
  perform private.require_service_worker();
  if p_request_id is null or p_ledger_reference is null then
    raise exception using errcode = 'PT400', message = 'invalid_deletion_work';
  end if;
  if not exists (select 1 from private.deletion_worker_config c where c.singleton and c.independent_ledger_enabled) then
    raise exception using errcode = 'PT503', message = 'deletion_ledger_unavailable';
  end if;
  select * into deletion_row from public.account_deletion_requests r where r.id = p_request_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'deletion_request_not_found'; end if;
  if deletion_row.status = 'completed' then raise exception using errcode = 'PT409', message = 'deletion_already_completed'; end if;
  if deletion_row.checkpoint = 'app_data_erased' then
    if deletion_row.ledger_reference is distinct from p_ledger_reference then
      raise exception using errcode = 'PT409', message = 'ledger_reference_conflict';
    end if;
    update public.account_deletion_requests set status = 'running', last_error_code = null where id = p_request_id;
    return jsonb_build_object('id', p_request_id, 'status', 'running', 'checkpoint', 'app_data_erased', 'auth_delete_required', true);
  end if;
  if deletion_row.status not in ('pending', 'failed', 'running') or deletion_row.user_id is null then
    raise exception using errcode = 'PT409', message = 'deletion_checkpoint_conflict';
  end if;

  subject := deletion_row.subject_auth_user_id;
  perform 1 from public.app_users a where a.id = deletion_row.user_id and a.account_status = 'deleting' for update;
  if not found then raise exception using errcode = 'PT409', message = 'deletion_account_unavailable'; end if;
  if deletion_row.ledger_reference is not null and deletion_row.ledger_reference <> p_ledger_reference then
    raise exception using errcode = 'PT409', message = 'ledger_reference_conflict';
  end if;

  update public.account_deletion_requests set status = 'running', checkpoint = 'ledger_recorded',
    ledger_reference = p_ledger_reference, last_error_code = null, started_at = coalesce(started_at, now_at)
    where id = p_request_id;

  select coalesce(array_agg(g.id), '{}'::uuid[]) into goal_ids from public.goals g where g.owner_user_id = subject;
  select coalesce(array_agg(b.id), '{}'::uuid[]) into board_ids from public.boards b where b.owner_user_id = subject;
  select coalesce(array_agg(bu.id), '{}'::uuid[]) into bunch_ids from public.bunches bu where bu.board_id = any(board_ids);
  select coalesce(array_agg(p.id), '{}'::uuid[]), coalesce(array_agg(p.request_receipt_id), '{}'::uuid[])
    into own_praise_ids, own_receipt_ids from public.praises p where p.recipient_user_id = subject;
  select coalesce(array_agg(p.id), '{}'::uuid[]), coalesce(array_agg(p.request_receipt_id), '{}'::uuid[])
    into authored_praise_ids, authored_receipt_ids
    from public.praises p where p.actor_user_id = subject and p.source = 'peer' and p.recipient_user_id <> subject;
  select coalesce(array_agg(c.id), '{}'::uuid[]) into connection_ids
    from public.connections c where subject in (c.user_low_id, c.user_high_id);
  select coalesce(array_agg(cr.id), '{}'::uuid[]) into request_ids
    from public.connection_requests cr where subject in (cr.requester_user_id, cr.approver_user_id)
      or cr.connection_id = any(connection_ids);
  select coalesce(array_agg(i.id), '{}'::uuid[]) into invite_ids
    from public.connection_invites i where i.inviter_user_id = subject or i.redeemed_by_user_id = subject;
  object_ids := array_cat(array_cat(array_cat(array_cat(array_cat(array_cat(array_cat(
    array[subject], goal_ids), board_ids), bunch_ids), own_praise_ids), connection_ids), request_ids), invite_ids);

  -- Preserve received peer events for other owners, but erase author identity/content and idempotency input.
  update public.praises p set actor_user_id = null, message = null, occurred_on = null, author_erased_at = now_at
    where p.id = any(authored_praise_ids);
  update public.request_receipts r set actor_user_id = null, input_hash = null, erased_at = now_at
    where r.id = any(authored_receipt_ids);

  delete from public.notifications n where n.recipient_user_id = subject
    or n.praise_id = any(own_praise_ids) or n.bunch_id = any(bunch_ids)
    or n.connection_request_id = any(request_ids) or n.connection_id = any(connection_ids);
  update public.notifications n set actor_user_id = null where n.actor_user_id = subject;

  update public.boards b set current_bunch_id = null where b.id = any(board_ids);
  delete from public.board_members bm where bm.user_id = subject or bm.granted_by_user_id = subject
    or bm.connection_id = any(connection_ids) or bm.board_id = any(board_ids);
  delete from public.praises p where p.id = any(own_praise_ids);
  delete from public.request_receipts r where r.id = any(own_receipt_ids)
    and not exists (select 1 from public.praises keep where keep.request_receipt_id = r.id);

  delete from public.connection_requests cr where cr.id = any(request_ids) or cr.invite_id = any(invite_ids);
  delete from public.connection_invites i where i.id = any(invite_ids);
  delete from public.blocks b where b.blocker_user_id = subject or b.blocked_user_id = subject;
  delete from public.connections c where c.id = any(connection_ids);

  delete from public.request_receipts r where r.actor_user_id = subject;
  delete from public.shared_board_profiles sp where sp.board_id = any(board_ids);
  delete from public.bunches bu where bu.id = any(bunch_ids);
  delete from public.boards b where b.id = any(board_ids);
  delete from public.goals g where g.id = any(goal_ids);
  delete from public.audit_events e where e.actor_user_id = subject or e.object_id = any(object_ids);
  delete from public.rate_usage r where r.actor_user_id = subject;
  delete from public.reauth_grants g where g.user_id = subject;
  delete from public.profiles p where p.user_id = subject;

  update public.account_deletion_requests set user_id = null, request_key = null, input_hash = null,
    checkpoint = 'app_data_erased', status = 'running', last_error_code = null where id = p_request_id;
  delete from public.app_users a where a.id = subject;
  if not found then raise exception using errcode = 'PT503', message = 'deletion_account_cleanup_incomplete'; end if;

  return jsonb_build_object('id', p_request_id, 'status', 'running', 'checkpoint', 'app_data_erased', 'auth_delete_required', true);
end $$;
alter function public.process_account_deletion(uuid, uuid) owner to chagokchan_worker;
revoke all on function public.process_account_deletion(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.process_account_deletion(uuid, uuid) to service_role;

create function public.fail_account_deletion(p_request_id uuid, p_error_code text) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare state_row public.account_deletion_requests%rowtype;
begin
  perform private.require_service_worker();
  if p_request_id is null or p_error_code not in ('deletion_ledger_write_failed','auth_session_revoke_failed','auth_user_delete_failed','account_erase_failed') then
    raise exception using errcode = 'PT400', message = 'invalid_deletion_failure';
  end if;
  select * into state_row from public.account_deletion_requests r where r.id = p_request_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'deletion_request_not_found'; end if;
  if state_row.status = 'completed' then raise exception using errcode = 'PT409', message = 'deletion_already_completed'; end if;
  update public.account_deletion_requests set status = 'failed', last_error_code = p_error_code where id = p_request_id;
  return jsonb_build_object('id', p_request_id, 'status', 'failed', 'checkpoint', state_row.checkpoint);
end $$;
alter function public.fail_account_deletion(uuid, text) owner to chagokchan_worker;
revoke all on function public.fail_account_deletion(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.fail_account_deletion(uuid, text) to service_role;

create function public.complete_account_deletion(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare state_row public.account_deletion_requests%rowtype; now_at timestamptz := clock_timestamp();
begin
  perform private.require_service_worker();
  if p_request_id is null then raise exception using errcode = 'PT400', message = 'invalid_deletion_request'; end if;
  select * into state_row from public.account_deletion_requests r where r.id = p_request_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'deletion_request_not_found'; end if;
  if state_row.status = 'completed' then return jsonb_build_object('id', p_request_id, 'status', 'completed', 'replayed', true); end if;
  if state_row.status not in ('running','failed') or state_row.checkpoint <> 'app_data_erased'
    or state_row.user_id is not null or state_row.ledger_reference is null
    or exists(select 1 from public.app_users a where a.id = state_row.subject_auth_user_id) then
    raise exception using errcode = 'PT409', message = 'deletion_checkpoint_conflict';
  end if;
  if private.auth_user_is_live(state_row.subject_auth_user_id) then
    raise exception using errcode = 'PT409', message = 'auth_identity_still_present';
  end if;
  update public.account_deletion_requests set status = 'completed', checkpoint = 'auth_removed',
    last_error_code = null, completed_at = now_at where id = p_request_id;
  return jsonb_build_object('id', p_request_id, 'status', 'completed', 'replayed', false);
end $$;
alter function public.complete_account_deletion(uuid) owner to chagokchan_worker;
revoke all on function public.complete_account_deletion(uuid) from public, anon, authenticated, service_role;
grant execute on function public.complete_account_deletion(uuid) to service_role;

notify pgrst, 'reload schema';
revoke create on schema public from chagokchan_worker;
commit;
