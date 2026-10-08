-- Keep the erasure worker content-blind and reject empty failure checkpoints.
begin;
revoke select (message, occurred_on) on public.praises from chagokchan_worker;
grant create on schema public to chagokchan_worker;
set local role chagokchan_worker;
create or replace function public.fail_account_deletion(p_request_id uuid, p_error_code text) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare state_row public.account_deletion_requests%rowtype;
begin
  perform private.require_service_worker();
  if p_request_id is null or p_error_code is null or p_error_code not in (
    'deletion_ledger_write_failed','auth_session_revoke_failed','auth_user_delete_failed','account_erase_failed'
  ) then
    raise exception using errcode = 'PT400', message = 'invalid_deletion_failure';
  end if;
  select * into state_row from public.account_deletion_requests r where r.id = p_request_id for update;
  if not found then raise exception using errcode = 'PT404', message = 'deletion_request_not_found'; end if;
  if state_row.status = 'completed' then raise exception using errcode = 'PT409', message = 'deletion_already_completed'; end if;
  update public.account_deletion_requests set status = 'failed', last_error_code = p_error_code where id = p_request_id;
  return jsonb_build_object('id', p_request_id, 'status', 'failed', 'checkpoint', state_row.checkpoint);
end $$;
reset role;
revoke create on schema public from chagokchan_worker;
commit;
