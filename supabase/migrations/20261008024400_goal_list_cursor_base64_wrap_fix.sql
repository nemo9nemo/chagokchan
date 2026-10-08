-- W08-B1 follow-up: PostgreSQL base64 output wraps long cursors at 76 columns.
begin;

grant create on schema private to chagokchan_rpc;

create or replace function private.encode_goal_list_cursor(p_created_at timestamptz, p_goal_id uuid, p_status text) returns text
language sql immutable set search_path = pg_catalog
as $$
  select replace(replace(replace(rtrim(encode(convert_to(jsonb_build_array(p_created_at, p_goal_id, p_status)::text, 'UTF8'), 'base64'), '='), E'\n', ''), '+', '-'), '/', '_')
$$;
alter function private.encode_goal_list_cursor(timestamptz, uuid, text) owner to chagokchan_rpc;
revoke all on function private.encode_goal_list_cursor(timestamptz, uuid, text) from public, anon, authenticated, service_role;

revoke create on schema private from chagokchan_rpc;
commit;
