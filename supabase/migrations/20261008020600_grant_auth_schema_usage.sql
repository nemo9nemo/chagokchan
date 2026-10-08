-- W06-A correction: the guard's SECURITY DEFINER session check resolves auth.jwt/auth.uid.
begin;
grant usage on schema auth to chagokchan_guard;
commit;
