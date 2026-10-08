-- Keep an author's minimal sent-praise history readable after a connection ends.
begin;
grant create on schema private to chagokchan_worker;
grant select (actor_user_id, source) on public.praises to chagokchan_worker;

create function private.has_authored_peer_praise_in_goal(p_goal_id uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select p_goal_id is not null and p_actor is not null and exists (
    select 1 from public.boards b
    join public.praises p on p.board_id = b.id
    where b.goal_id = p_goal_id and p.actor_user_id = p_actor and p.source = 'peer'
  )
$$;
alter function private.has_authored_peer_praise_in_goal(uuid, uuid) owner to chagokchan_worker;
revoke all on function private.has_authored_peer_praise_in_goal(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.has_authored_peer_praise_in_goal(uuid, uuid) to chagokchan_rpc;

create policy rpc_sender_peer_goals_select on public.goals for select to chagokchan_rpc
  using (private.has_authored_peer_praise_in_goal(id, private.require_actor()));
create policy rpc_sender_peer_boards_select on public.boards for select to chagokchan_rpc
  using (private.has_authored_peer_praise_in_goal(goal_id, private.require_actor()));

revoke create on schema private from chagokchan_worker;
commit;
