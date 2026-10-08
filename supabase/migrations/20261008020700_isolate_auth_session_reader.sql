-- W06-A: query managed Auth session metadata through one static, narrowly granted owner.
begin;
create role chagokchan_session_reader nologin noinherit nosuperuser nocreatedb nocreaterole noreplication bypassrls;
grant authenticated to chagokchan_session_reader with inherit true, set false;
grant usage on schema private to chagokchan_session_reader;
grant select (id, user_id, created_at, refreshed_at, not_after) on auth.sessions to chagokchan_session_reader;
grant select (id, banned_until, deleted_at, is_anonymous) on auth.users to chagokchan_session_reader;

-- Auth's managed tables have RLS enabled without app policies. Keep the reader
-- non-login, non-assumable by API roles, and without any product-table grants.
grant create on schema private to chagokchan_session_reader;
grant chagokchan_session_reader to postgres with inherit false, set true;
grant chagokchan_session_reader to chagokchan_guard with inherit false, set true;
grant create on schema private to chagokchan_guard;
set local role chagokchan_guard;
drop function private.require_session_user();
grant execute on function private.session_within_window(timestamptz, timestamp, timestamptz) to chagokchan_session_reader;
reset role;
revoke create on schema private from chagokchan_guard;

set local role chagokchan_session_reader;
create function private.require_session_user() returns uuid
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; session_uuid uuid; claims jsonb; valid boolean;
begin
  claims := auth.jwt();
  if claims->>'role' is distinct from 'authenticated' or
     coalesce(claims->>'exp', '') !~ '^[0-9]{1,16}$' then
    raise exception using errcode = 'PT401', message = 'unauthenticated';
  end if;
  begin
    actor := auth.uid();
    session_uuid := nullif(claims->>'session_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = 'PT401', message = 'unauthenticated';
  end;
  if actor is null or session_uuid is null or (claims->>'exp')::bigint <= extract(epoch from now()) then
    raise exception using errcode = 'PT401', message = 'unauthenticated';
  end if;
  select exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = session_uuid and s.user_id = actor
      and private.session_within_window(s.created_at, s.refreshed_at, s.not_after)
      and u.deleted_at is null and not u.is_anonymous
      and (u.banned_until is null or u.banned_until <= now())
  ) into valid;
  if not valid then raise exception using errcode = 'PT401', message = 'unauthenticated'; end if;
  return actor;
end $$;
revoke all on function private.require_session_user() from public, anon, authenticated, service_role;
grant execute on function private.require_session_user() to chagokchan_guard;
reset role;
revoke create on schema private from chagokchan_session_reader;

revoke chagokchan_session_reader from chagokchan_guard;
revoke chagokchan_session_reader from postgres;
notify pgrst, 'reload schema';
commit;
