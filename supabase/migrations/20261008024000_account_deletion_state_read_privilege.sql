-- W06-D2 follow-up: allow the restricted RPC owner to verify the current deletion state.
begin;
grant select (deactivated_at) on public.app_users to chagokchan_rpc;
commit;
