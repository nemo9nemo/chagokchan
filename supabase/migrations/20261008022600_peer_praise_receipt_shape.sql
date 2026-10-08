-- Permit the dedicated peer-praise operation while retaining source-specific receipt identity checks.
begin;

create or replace function private.enforce_reference_shape() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
declare board_kind text; owner_uuid uuid; pair_low uuid; pair_high uuid; issuer uuid; receipt record;
begin
  if tg_table_name in ('shared_board_profiles', 'board_members', 'praises') then
    select kind, owner_user_id into board_kind, owner_uuid from public.boards where id = new.board_id;
    if tg_table_name in ('shared_board_profiles', 'board_members') and board_kind is distinct from 'shared' then
      raise exception using errcode = '23514', message = 'shared_board_required';
    end if;
  end if;
  if tg_table_name = 'board_members' then
    select user_low_id, user_high_id into pair_low, pair_high from public.connections where id = new.connection_id;
    if pair_low is distinct from least(new.user_id, owner_uuid) or pair_high is distinct from greatest(new.user_id, owner_uuid) then
      raise exception using errcode = '23514', message = 'membership_connection_parties';
    end if;
  elsif tg_table_name = 'praises' then
    if (new.source = 'self' and board_kind is distinct from 'personal') or
       (new.source = 'peer' and board_kind is distinct from 'shared') then
      raise exception using errcode = '23514', message = 'praise_board_source';
    end if;
    select actor_user_id, operation, result_kind, result_id into receipt from public.request_receipts where id = new.request_receipt_id;
    if receipt.result_id is distinct from new.id or receipt.result_kind is distinct from 'praise' or
       (new.source = 'self' and receipt.operation is distinct from 'createPraise') or
       (new.source = 'peer' and receipt.operation not in ('createPraise', 'createPeerPraise')) or
       (new.author_erased_at is null and receipt.actor_user_id is distinct from new.actor_user_id) then
      raise exception using errcode = '23514', message = 'praise_creation_receipt';
    end if;
  elsif tg_table_name = 'connection_requests' then
    select user_low_id, user_high_id into pair_low, pair_high from public.connections where id = new.connection_id;
    select inviter_user_id into issuer from public.connection_invites where id = new.invite_id;
    if pair_low is distinct from least(new.requester_user_id, new.approver_user_id) or
       pair_high is distinct from greatest(new.requester_user_id, new.approver_user_id) or
       issuer is distinct from new.approver_user_id then
      raise exception using errcode = '23514', message = 'request_connection_parties';
    end if;
  end if;
  return new;
end $$;
alter function private.enforce_reference_shape() owner to chagokchan_guard;

commit;
