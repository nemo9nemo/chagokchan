-- W06-D2 follow-up: the request RPC supplies its server-side request timestamp explicitly.
begin;
grant insert (requested_at) on public.account_deletion_requests to chagokchan_rpc;
commit;
