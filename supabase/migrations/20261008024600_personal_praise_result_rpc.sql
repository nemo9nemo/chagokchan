-- W08-C: return the immutable cycle ID from the same atomic personal-praise write.
begin;

grant create on schema public, private to chagokchan_rpc;
grant select (id, board_id, bunch_id, actor_user_id, recipient_user_id, source)
  on public.praises to chagokchan_rpc;

create function public.create_personal_praise(
  p_request_key uuid, p_board_id uuid, p_message text default null, p_occurred_on date default null
) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog
as $$
declare actor uuid; result jsonb; praise_id uuid; cycle_id uuid;
begin
  actor := private.require_actor();
  result := public.create_praise(p_request_key, p_board_id, p_message, p_occurred_on);
  praise_id := (result->>'id')::uuid;
  select p.bunch_id into cycle_id from public.praises p
    where p.id = praise_id and p.board_id = p_board_id and p.actor_user_id = actor
      and p.recipient_user_id = actor and p.source = 'self';
  if not found or cycle_id is null then
    raise exception using errcode = 'PT503', message = 'praise_result_unavailable';
  end if;
  return jsonb_build_object('id', praise_id, 'bunch_id', cycle_id, 'replayed', (result->>'replayed')::boolean);
end $$;
alter function public.create_personal_praise(uuid, uuid, text, date) owner to chagokchan_rpc;
revoke all on function public.create_personal_praise(uuid, uuid, text, date) from public, anon, authenticated, service_role;
grant execute on function public.create_personal_praise(uuid, uuid, text, date) to authenticated;

notify pgrst, 'reload schema';
revoke create on schema public, private from chagokchan_rpc;
commit;
