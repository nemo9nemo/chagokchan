-- SELECT ... FOR UPDATE also checks UPDATE RLS. The non-login RPC role may lock
-- current shared rows for atomic praise/goal-state ordering; public clients keep
-- all direct product-table DML revoked and may invoke only reviewed RPCs.
begin;

create policy rpc_current_contributor_boards_lock on public.boards for update to chagokchan_rpc
  using (kind = 'shared' and private.current_shared_board_member(id, owner_user_id, private.require_actor()))
  with check (kind = 'shared' and private.current_shared_board_member(id, owner_user_id, private.require_actor()));
create policy rpc_current_contributor_goals_lock on public.goals for update to chagokchan_rpc
  using (status <> 'deleted' and exists (
    select 1 from public.boards b where b.goal_id = goals.id and b.owner_user_id = goals.owner_user_id and b.kind = 'shared'
      and private.current_shared_board_member(b.id, b.owner_user_id, private.require_actor())
  ))
  with check (status <> 'deleted' and exists (
    select 1 from public.boards b where b.goal_id = goals.id and b.owner_user_id = goals.owner_user_id and b.kind = 'shared'
      and private.current_shared_board_member(b.id, b.owner_user_id, private.require_actor())
  ));

commit;
