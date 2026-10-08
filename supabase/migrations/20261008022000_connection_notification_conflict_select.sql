-- W06-C1 follow-up: ON CONFLICT also checks proposed notification rows against SELECT RLS.
begin;

create policy rpc_connection_transition_notifications_select on public.notifications for select to chagokchan_rpc
  using (
    (type = 'connection_requested' and exists (
      select 1 from public.connection_requests cr where cr.id = connection_request_id and cr.status = 'pending'
        and cr.requester_user_id = private.require_actor() and recipient_user_id = cr.approver_user_id
        and actor_user_id = cr.requester_user_id
    )) or
    (type = 'connection_accepted' and exists (
      select 1 from public.connection_requests cr where cr.id = connection_request_id and cr.status = 'accepted'
        and cr.approver_user_id = private.require_actor() and recipient_user_id = cr.requester_user_id
        and actor_user_id = cr.approver_user_id
    ))
  );

commit;
