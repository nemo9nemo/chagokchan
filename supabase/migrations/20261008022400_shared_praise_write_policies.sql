-- W06-C2 follow-up: the shared praise RPC writes only on a currently granted shared board.
begin;

create policy rpc_current_contributor_bunches_insert on public.bunches for insert to chagokchan_rpc
  with check (exists (select 1 from public.boards b where b.id = board_id and b.kind = 'shared'
    and private.current_shared_board_member(b.id, b.owner_user_id, private.require_actor())));
create policy rpc_current_contributor_bunches_update on public.bunches for update to chagokchan_rpc
  using (exists (select 1 from public.boards b where b.id = board_id and b.kind = 'shared'
    and private.current_shared_board_member(b.id, b.owner_user_id, private.require_actor())))
  with check (exists (select 1 from public.boards b where b.id = board_id and b.kind = 'shared'
    and private.current_shared_board_member(b.id, b.owner_user_id, private.require_actor())));
create policy rpc_current_contributor_peer_praises_insert on public.praises for insert to chagokchan_rpc
  with check (source = 'peer' and actor_user_id = private.require_actor() and exists (
    select 1 from public.boards b where b.id = board_id and b.owner_user_id = recipient_user_id and b.kind = 'shared'
      and private.current_shared_board_member(b.id, b.owner_user_id, private.require_actor())
  ));

commit;
