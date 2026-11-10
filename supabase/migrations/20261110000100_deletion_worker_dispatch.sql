-- W14-C1: bounded service-only dispatch and durable-ledger completion acknowledgement.
begin;
grant create on schema public, private to chagokchan_worker;
grant references(id) on public.account_deletion_requests to chagokchan_worker;
set local role chagokchan_worker;

create table private.deletion_ledger_completion_acks (
  request_id uuid primary key references public.account_deletion_requests(id) on delete cascade,
  ledger_reference uuid not null,
  acknowledged_at timestamptz not null default clock_timestamp()
);
alter table private.deletion_ledger_completion_acks enable row level security;
alter table private.deletion_ledger_completion_acks force row level security;
revoke all on private.deletion_ledger_completion_acks from public, anon, authenticated, service_role;

create table private.deletion_work_leases (
  request_id uuid primary key references public.account_deletion_requests(id) on delete cascade,
  lease_until timestamptz not null,
  last_attempted_at timestamptz not null
);
alter table private.deletion_work_leases enable row level security;
alter table private.deletion_work_leases force row level security;
revoke all on private.deletion_work_leases from public,anon,authenticated,service_role;

create function public.get_account_deletion_work(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare item public.account_deletion_requests%rowtype;
begin
  perform private.require_service_worker();
  if p_request_id is null then raise exception using errcode='PT400',message='invalid_deletion_work'; end if;
  select * into item from public.account_deletion_requests r where r.id=p_request_id;
  if not found then raise exception using errcode='PT404',message='deletion_request_not_found'; end if;
  return jsonb_build_object('request_id',item.id,'subject_id',item.subject_auth_user_id,'status',item.status,
    'checkpoint',item.checkpoint,'ledger_reference',item.ledger_reference,'requested_at',item.requested_at,
    'completed_at',item.completed_at,'ledger_acknowledged',exists(select 1 from private.deletion_ledger_completion_acks a where a.request_id=item.id));
end $$;

create function public.list_account_deletion_work(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare items jsonb;
begin
  perform private.require_service_worker();
  if p_limit is null or p_limit not between 1 and 25 then raise exception using errcode='PT400',message='invalid_deletion_batch'; end if;
  with selected as materialized (
    select j.id,j.requested_at from public.account_deletion_requests j
    left join private.deletion_work_leases l on l.request_id=j.id
    where j.checkpoint in ('access_revoked','ledger_recorded','app_data_erased','auth_removed')
      and not exists(select 1 from private.deletion_ledger_completion_acks a where a.request_id=j.id)
      and (l.lease_until is null or l.lease_until<=clock_timestamp())
    order by l.last_attempted_at nulls first,j.requested_at,j.id limit p_limit for update of j skip locked
  ), reserved as (
    insert into private.deletion_work_leases(request_id,lease_until,last_attempted_at)
      select s.id,clock_timestamp()+interval '5 minutes',clock_timestamp() from selected s
      on conflict(request_id) do update set lease_until=excluded.lease_until,last_attempted_at=excluded.last_attempted_at
      returning request_id
  ) select coalesce(jsonb_agg(jsonb_build_object('request_id',s.id) order by s.requested_at,s.id),'[]'::jsonb) into items
    from selected s join reserved r on r.request_id=s.id;
  return jsonb_build_object('items',items);
end $$;

create function public.ack_account_deletion_ledger(p_request_id uuid,p_ledger_reference uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare item public.account_deletion_requests%rowtype;
begin
  perform private.require_service_worker();
  if p_request_id is null or p_ledger_reference is null then raise exception using errcode='PT400',message='invalid_ledger_ack'; end if;
  select * into item from public.account_deletion_requests r where r.id=p_request_id for update;
  if not found then raise exception using errcode='PT404',message='deletion_request_not_found'; end if;
  if item.status<>'completed' or item.checkpoint<>'auth_removed' or item.ledger_reference is distinct from p_ledger_reference then
    raise exception using errcode='PT409',message='deletion_checkpoint_conflict';
  end if;
  insert into private.deletion_ledger_completion_acks(request_id,ledger_reference)
    values(p_request_id,p_ledger_reference) on conflict(request_id) do nothing;
  return jsonb_build_object('id',p_request_id,'ledger_acknowledged',true);
end $$;

revoke all on function public.get_account_deletion_work(uuid),public.list_account_deletion_work(integer),public.ack_account_deletion_ledger(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_account_deletion_work(uuid),public.list_account_deletion_work(integer),public.ack_account_deletion_ledger(uuid,uuid) to service_role;
reset role;
revoke create on schema public,private from chagokchan_worker;
notify pgrst,'reload schema';
commit;
