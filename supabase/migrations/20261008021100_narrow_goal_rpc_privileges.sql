-- W06-B1 follow-up: keep future deletion fields outside the goal owner RPC grant.
begin;
revoke update (deleted_at, purge_after) on public.goals from chagokchan_rpc;
commit;
