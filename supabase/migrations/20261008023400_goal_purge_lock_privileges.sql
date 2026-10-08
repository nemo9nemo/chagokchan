-- FOR UPDATE lock checks need UPDATE on a narrow column even when the worker only deletes.
begin;
grant update (status) on public.goals to chagokchan_worker;
grant update (account_status) on public.app_users to chagokchan_worker;
commit;
