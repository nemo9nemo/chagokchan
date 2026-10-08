-- W06-B2 follow-up: ON CONFLICT with an arbiter also checks the proposed row against SELECT RLS.
begin;

create policy rpc_owner_notifications_select on public.notifications for select to chagokchan_rpc
  using (recipient_user_id = private.require_actor());

notify pgrst, 'reload schema';
commit;
