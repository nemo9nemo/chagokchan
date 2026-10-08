-- W10-B: a retry after a committed soft delete must return the existing result.
begin;

create or replace function public.delete_goal(p_goal_id uuid, p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; current_goal public.goals%rowtype; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  if p_goal_id is null or p_expected_revision is null then
    raise exception using errcode = 'PT400', message = 'invalid_goal_id';
  end if;
  select * into current_goal from public.goals g
    where g.id = p_goal_id and g.owner_user_id = actor for update;
  if not found then raise exception using errcode = 'PT404', message = 'goal_not_found'; end if;
  if current_goal.status = 'deleted' then return jsonb_build_object('id', current_goal.id, 'replayed', true); end if;
  if current_goal.revision <> p_expected_revision then
    raise exception using errcode = 'PT409', message = 'revision_conflict';
  end if;
  update public.goals set status = 'deleted', revision = revision + 1,
    deleted_at = now_at, purge_after = now_at + interval '30 days'
    where id = current_goal.id and owner_user_id = actor;
  update public.board_members bm set status = 'revoked', revoked_at = now_at
    where bm.board_id in (select b.id from public.boards b where b.goal_id = current_goal.id and b.owner_user_id = actor)
      and bm.status = 'active';
  return jsonb_build_object('id', current_goal.id, 'replayed', false);
end $$;
alter function public.delete_goal(uuid, integer) owner to chagokchan_rpc;
revoke all on function public.delete_goal(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.delete_goal(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
