-- W06-D2 follow-up: let the restricted RPC owner pass the existing timezone CHECK on app_users updates.
begin;
grant execute on function private.valid_timezone(text) to chagokchan_rpc;
commit;
