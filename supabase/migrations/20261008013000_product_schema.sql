-- ERD v0.3 / app-policy 0.2.0. Auth schema is managed by Supabase.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public;

create function private.valid_timezone(value text) returns boolean
language sql stable set search_path = pg_catalog
as $$ select exists (select 1 from pg_catalog.pg_timezone_names where name = value) $$;
revoke all on function private.valid_timezone(text) from public, anon, authenticated, service_role;

create table public.app_users (
  id uuid primary key references auth.users(id) on delete restrict,
  account_status text not null default 'active' check (account_status in ('active', 'deleting')),
  timezone text not null default 'Asia/Seoul' check (private.valid_timezone(timezone)),
  adult_confirmed_at timestamptz not null,
  registration_policy_version text not null check (char_length(registration_policy_version) between 1 and 40),
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  constraint app_users_deactivation_state check (
    (account_status = 'active' and deactivated_at is null) or
    (account_status = 'deleting' and deactivated_at is not null)
  )
);
comment on table public.app_users is 'App account; initial adult confirmation is separate from Auth authentication.';

create table public.profiles (
  user_id uuid primary key references public.app_users(id) on delete restrict,
  nickname varchar not null default '새로운 포도' check (char_length(nickname) between 1 and 20 and nickname = btrim(nickname)),
  avatar_key text not null default 'grape' check (avatar_key in ('grape', 'leaf', 'star')),
  updated_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.app_users(id) on delete restrict,
  title varchar not null check (char_length(title) between 1 and 80 and title = btrim(title)),
  private_description text check (char_length(private_description) between 1 and 1000),
  status text not null default 'active' check (status in ('active', 'completed', 'archived', 'deleted')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  purge_after timestamptz,
  unique (id, owner_user_id),
  constraint goals_deletion_window check (
    (status = 'deleted' and deleted_at is not null and purge_after is not null and purge_after > deleted_at) or
    (status <> 'deleted' and deleted_at is null and purge_after is null)
  )
);
create index goals_owner_status_cursor on public.goals(owner_user_id, status, created_at desc, id desc);
create index goals_pending_purge on public.goals(purge_after, id) where status = 'deleted';

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  owner_user_id uuid not null references public.app_users(id) on delete restrict,
  kind text not null check (kind in ('personal', 'shared')),
  next_target_count smallint not null default 20 check (next_target_count between 1 and 100),
  next_rule_code text not null default 'one_praise_one_unit' check (next_rule_code = 'one_praise_one_unit'),
  current_bunch_id uuid,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  constraint boards_goal_owner_fk foreign key (goal_id, owner_user_id) references public.goals(id, owner_user_id) on delete restrict,
  unique (goal_id, kind),
  unique (id, owner_user_id)
);
create index boards_owner on public.boards(owner_user_id);
create index boards_current_bunch on public.boards(current_bunch_id, id) where current_bunch_id is not null;

create table public.shared_board_profiles (
  board_id uuid primary key references public.boards(id) on delete restrict,
  public_title varchar not null check (char_length(public_title) between 1 and 80 and public_title = btrim(public_title)),
  public_description text check (char_length(public_description) between 1 and 1000),
  updated_at timestamptz not null default now()
);
comment on table public.shared_board_profiles is 'Explicit shared display fields; never an implicit copy of private goal content.';

create table public.bunches (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete restrict,
  cycle_no integer not null check (cycle_no > 0),
  target_count smallint not null check (target_count between 1 and 100),
  rule_code text not null default 'one_praise_one_unit' check (rule_code = 'one_praise_one_unit'),
  valid_count integer not null default 0 check (valid_count between 0 and target_count),
  progress_state text not null default 'incomplete' check (progress_state in ('incomplete', 'complete')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (board_id, cycle_no),
  unique (id, board_id),
  constraint bunches_progress_count check (
    (progress_state = 'complete' and valid_count = target_count and completed_at is not null) or
    (progress_state = 'incomplete' and valid_count < target_count)
  )
);
alter table public.boards add constraint boards_current_bunch_fk
  foreign key (current_bunch_id, id) references public.bunches(id, board_id)
  on delete no action deferrable initially immediate;

create table public.request_receipts (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.app_users(id) on delete restrict,
  operation text not null check (char_length(operation) between 1 and 120),
  request_key uuid not null,
  input_hash text,
  result_kind text not null check (char_length(result_kind) between 1 and 80),
  result_id uuid not null,
  created_at timestamptz not null default now(),
  erased_at timestamptz,
  unique (actor_user_id, operation, request_key),
  constraint request_receipts_erasure_state check (
    (erased_at is null and actor_user_id is not null and input_hash is not null and input_hash ~ '^[0-9a-f]{64}$') or
    (erased_at is not null and input_hash is null)
  )
);
create index request_receipts_result on public.request_receipts(result_kind, result_id);
comment on table public.request_receipts is 'Idempotent result reference; retain an erased stub when a praise still references it.';

create table public.praises (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  bunch_id uuid not null,
  actor_user_id uuid references public.app_users(id) on delete restrict,
  recipient_user_id uuid not null references public.app_users(id) on delete restrict,
  request_receipt_id uuid not null unique references public.request_receipts(id) on delete restrict,
  source text not null check (source in ('self', 'peer')),
  message text check (char_length(message) between 1 and 1000),
  occurred_on date,
  recorded_at timestamptz not null default now(),
  cancelled_at timestamptz,
  hidden_at timestamptz,
  excluded_at timestamptz,
  author_erased_at timestamptz,
  constraint praises_bunch_board_fk foreign key (bunch_id, board_id) references public.bunches(id, board_id) on delete restrict,
  constraint praises_board_recipient_fk foreign key (board_id, recipient_user_id) references public.boards(id, owner_user_id) on delete restrict,
  constraint praises_source_parties check (
    (source = 'self' and actor_user_id = recipient_user_id) or
    (source = 'peer' and (actor_user_id is null or actor_user_id <> recipient_user_id))
  ),
  constraint praises_author_erasure check (
    (actor_user_id is not null and author_erased_at is null) or
    (actor_user_id is null and source = 'peer' and author_erased_at is not null and message is null and occurred_on is null)
  ),
  constraint praises_peer_date check (source <> 'peer' or occurred_on is null),
  constraint praises_cancel_erasure check (cancelled_at is null or (message is null and occurred_on is null))
);
create index praises_bunch_cursor on public.praises(bunch_id, recorded_at desc, id desc);
create index praises_board_cursor on public.praises(board_id, recorded_at desc, id desc);
create index praises_valid_bunch on public.praises(bunch_id) where cancelled_at is null and excluded_at is null;
create index praises_sender_cursor on public.praises(actor_user_id, recorded_at desc, id desc) where actor_user_id is not null;
create index praises_recipient_cursor on public.praises(recipient_user_id, recorded_at desc, id desc);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_low_id uuid not null references public.app_users(id) on delete restrict,
  user_high_id uuid not null references public.app_users(id) on delete restrict,
  status text not null default 'inactive' check (status in ('inactive', 'active')),
  generation integer not null default 0 check (generation >= 0),
  created_at timestamptz not null default now(),
  connected_at timestamptz,
  disconnected_at timestamptz,
  unique (user_low_id, user_high_id),
  check (user_low_id < user_high_id),
  constraint connections_active_state check (status <> 'active' or (generation > 0 and connected_at is not null and disconnected_at is null))
);
create index connections_low_status on public.connections(user_low_id, status);
create index connections_high_status on public.connections(user_high_id, status);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_user_id uuid not null references public.app_users(id) on delete restrict,
  blocked_user_id uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (blocker_user_id, blocked_user_id),
  check (blocker_user_id <> blocked_user_id)
);
create index blocks_blocked_user on public.blocks(blocked_user_id);

create table public.connection_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references public.app_users(id) on delete restrict,
  link_hash text not null unique check (link_hash ~ '^[0-9a-f]{64}$'),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by_user_id uuid references public.app_users(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((redeemed_at is null) = (redeemed_by_user_id is null)),
  check (redeemed_by_user_id is null or redeemed_by_user_id <> inviter_user_id)
);
create index connection_invites_inviter on public.connection_invites(inviter_user_id, expires_at);
create index connection_invites_redeemer on public.connection_invites(redeemed_by_user_id) where redeemed_by_user_id is not null;

create table public.connection_requests (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete restrict,
  invite_id uuid not null unique references public.connection_invites(id) on delete restrict,
  requester_user_id uuid not null references public.app_users(id) on delete restrict,
  approver_user_id uuid not null references public.app_users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (requester_user_id <> approver_user_id),
  check (expires_at > created_at),
  check ((status = 'pending') = (resolved_at is null))
);
create unique index connection_requests_one_pending on public.connection_requests(connection_id) where status = 'pending';
create index connection_requests_connection on public.connection_requests(connection_id);
create index connection_requests_approver_cursor on public.connection_requests(approver_user_id, status, created_at desc, id desc);
create index connection_requests_requester_cursor on public.connection_requests(requester_user_id, status, created_at desc, id desc);

create table public.board_members (
  board_id uuid not null references public.boards(id) on delete restrict,
  user_id uuid not null references public.app_users(id) on delete restrict,
  connection_id uuid not null references public.connections(id) on delete restrict,
  connection_generation integer not null check (connection_generation > 0),
  role text not null default 'contributor' check (role = 'contributor'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  granted_by_user_id uuid not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (board_id, user_id),
  constraint board_members_owner_grant_fk foreign key (board_id, granted_by_user_id) references public.boards(id, owner_user_id) on delete restrict,
  check (user_id <> granted_by_user_id),
  check ((status = 'active') = (revoked_at is null))
);
create index board_members_connection on public.board_members(connection_id);
create index board_members_user_status on public.board_members(user_id, status);
comment on column public.board_members.connection_generation is 'Grant-time snapshot; not a foreign key to the current connection generation.';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.app_users(id) on delete restrict,
  actor_user_id uuid references public.app_users(id) on delete restrict,
  type text not null check (type in ('praise_received', 'bunch_completed', 'connection_requested', 'connection_accepted')),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 160),
  praise_id uuid references public.praises(id) on delete restrict,
  bunch_id uuid references public.bunches(id) on delete restrict,
  connection_request_id uuid references public.connection_requests(id) on delete restrict,
  connection_id uuid references public.connections(id) on delete restrict,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_user_id, dedupe_key),
  constraint notifications_typed_target check (
    num_nonnulls(praise_id, bunch_id, connection_request_id, connection_id) = 1 and
    ((type = 'praise_received' and praise_id is not null) or
     (type = 'bunch_completed' and bunch_id is not null) or
     (type = 'connection_requested' and connection_request_id is not null) or
     (type = 'connection_accepted' and connection_id is not null))
  )
);
create index notifications_recipient_cursor on public.notifications(recipient_user_id, read_at, created_at desc, id desc);
create index notifications_actor on public.notifications(actor_user_id) where actor_user_id is not null;
create index notifications_praise on public.notifications(praise_id) where praise_id is not null;
create index notifications_bunch on public.notifications(bunch_id) where bunch_id is not null;
create index notifications_request on public.notifications(connection_request_id) where connection_request_id is not null;
create index notifications_connection on public.notifications(connection_id) where connection_id is not null;
create index notifications_retention on public.notifications(created_at);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.app_users(id) on delete restrict,
  action text not null check (char_length(action) between 1 and 120),
  result_code text not null check (char_length(result_code) between 1 and 80),
  object_kind text not null check (char_length(object_kind) between 1 and 80),
  object_id uuid not null,
  request_id uuid not null,
  created_at timestamptz not null default now()
);
create index audit_events_actor on public.audit_events(actor_user_id) where actor_user_id is not null;
create index audit_events_retention on public.audit_events(created_at);

create table public.reauth_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete restrict,
  session_id uuid not null,
  scope text not null check (char_length(scope) between 1 and 80),
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > verified_at),
  check (consumed_at is null or consumed_at >= verified_at)
);
create index reauth_grants_user_session on public.reauth_grants(user_id, session_id, scope, expires_at);
create index reauth_grants_expiry on public.reauth_grants(expires_at);

create table public.rate_usage (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.app_users(id) on delete restrict,
  scope_key text not null check (char_length(scope_key) between 1 and 256),
  window_start timestamptz not null,
  window_end timestamptz not null,
  used_count integer not null default 0 check (used_count >= 0),
  updated_at timestamptz not null default now(),
  unique (actor_user_id, scope_key, window_start),
  check (window_end > window_start)
);
create index rate_usage_cleanup on public.rate_usage(window_end);

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_users(id) on delete restrict,
  subject_auth_user_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  checkpoint text not null default 'access_revoked' check (char_length(checkpoint) between 1 and 80),
  last_error_code text check (char_length(last_error_code) between 1 and 80),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  check (user_id is null or user_id = subject_auth_user_id),
  check ((status = 'completed') = (completed_at is not null)),
  check (status not in ('running', 'completed') or started_at is not null)
);
create unique index account_deletion_requests_one_open on public.account_deletion_requests(subject_auth_user_id)
  where status in ('pending', 'running', 'failed');
create index account_deletion_requests_user on public.account_deletion_requests(user_id) where user_id is not null;
create index account_deletion_requests_work on public.account_deletion_requests(status, requested_at);
comment on column public.account_deletion_requests.subject_auth_user_id is 'Logical Auth subject retained through erasure; no FK to auth.users.';

-- Fail closed until W06 installs scoped business RPCs and their RLS policies.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'app_users', 'profiles', 'goals', 'boards', 'shared_board_profiles', 'bunches',
    'request_receipts', 'praises', 'connections', 'blocks', 'connection_invites',
    'connection_requests', 'board_members', 'notifications', 'audit_events',
    'reauth_grants', 'rate_usage', 'account_deletion_requests'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', table_name);
  end loop;
end $$;

commit;
