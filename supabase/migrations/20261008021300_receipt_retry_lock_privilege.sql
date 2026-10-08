-- W06-B1: SELECT FOR UPDATE needs UPDATE privilege; expose only an immutable key column.
begin;
grant update (result_id) on public.request_receipts to chagokchan_rpc;
create policy rpc_owner_receipts_retry_lock on public.request_receipts for update to chagokchan_rpc
  using (actor_user_id = private.require_actor()) with check (actor_user_id = private.require_actor());
commit;
