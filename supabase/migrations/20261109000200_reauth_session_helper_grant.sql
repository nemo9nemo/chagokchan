-- W12-D1 follow-up: grant the existing helper as its actual isolated owner.
-- A GRANT by the migration role can otherwise warn without granting access.
begin;
grant chagokchan_session_reader to postgres with inherit false, set true;
set local role chagokchan_session_reader;
grant execute on function private.current_session_id() to chagokchan_reauth_issuer;
reset role;
revoke chagokchan_session_reader from postgres;
commit;
