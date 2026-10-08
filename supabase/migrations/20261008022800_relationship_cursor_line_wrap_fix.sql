-- PostgreSQL base64 output wraps long values; cursors are single-line URL-safe tokens.
begin;

create or replace function private.encode_relationship_cursor(p_at timestamptz, p_id uuid) returns text
language sql immutable set search_path = pg_catalog
as $$
  select replace(replace(rtrim(replace(encode(convert_to(jsonb_build_array(p_at, p_id)::text, 'UTF8'), 'base64'), E'\n', ''), '='), '+', '-'), '/', '_')
$$;
alter function private.encode_relationship_cursor(timestamptz, uuid) owner to chagokchan_rpc;
revoke all on function private.encode_relationship_cursor(timestamptz, uuid) from public, anon, authenticated, service_role;

commit;
