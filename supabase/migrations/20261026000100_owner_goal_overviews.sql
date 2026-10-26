-- Owner list and card data in one bounded, session-checked transaction.
begin;
grant create on schema public to chagokchan_rpc;
set local role chagokchan_rpc;
create function public.list_goal_overviews(p_cursor text default null, p_limit integer default 20, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare page jsonb; items jsonb;
begin
  -- Reuse the existing owner/session/filter/cursor boundaries and exact owner
  -- projection; no new table privilege or alternate authorization path.
  page := public.list_goals(p_cursor, p_limit, p_status);
  select coalesce(jsonb_agg(public.get_goal((item->>'id')::uuid) order by ordinal), '[]'::jsonb)
    into items from jsonb_array_elements(page->'items') with ordinality as entries(item, ordinal);
  return jsonb_build_object('items', items, 'next_cursor', page->'next_cursor');
end $$;
revoke all on function public.list_goal_overviews(text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.list_goal_overviews(text, integer, text) to authenticated;
reset role;
revoke create on schema public from chagokchan_rpc;
notify pgrst, 'reload schema';
commit;
