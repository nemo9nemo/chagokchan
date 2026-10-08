-- W06-A: keep managed Auth schema access exclusive to the session reader.
begin;
revoke usage on schema auth from chagokchan_guard;
commit;
