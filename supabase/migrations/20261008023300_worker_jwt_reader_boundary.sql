-- Evaluate the signed worker claim through the existing narrow Auth reader.
begin;
grant create on schema private to chagokchan_session_reader;
revoke usage on schema auth from chagokchan_worker;
grant chagokchan_session_reader to postgres with inherit false, set true;

alter function private.is_service_worker() owner to chagokchan_session_reader;
alter function private.require_service_worker() owner to chagokchan_session_reader;
set local role chagokchan_session_reader;
grant execute on function private.require_service_worker() to chagokchan_worker;
reset role;

revoke create on schema private from chagokchan_session_reader;
revoke chagokchan_session_reader from postgres;
commit;
