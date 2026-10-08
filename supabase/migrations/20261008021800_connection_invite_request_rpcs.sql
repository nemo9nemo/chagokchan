-- W06-C1: one-time invitations, connection requests, current-pair blocking and safe relationship projections.
begin;

grant create on schema public, private to chagokchan_rpc;

grant select (id, user_low_id, user_high_id, status, generation, created_at, connected_at, disconnected_at),
  insert (id, user_low_id, user_high_id),
  update (status, generation, connected_at, disconnected_at)
  on public.connections to chagokchan_rpc;
grant select (id, blocker_user_id, blocked_user_id, created_at, revoked_at),
  insert (id, blocker_user_id, blocked_user_id), update (revoked_at)
  on public.blocks to chagokchan_rpc;
grant select (id, inviter_user_id, link_hash, code_hash, expires_at, redeemed_at, redeemed_by_user_id, revoked_at, created_at),
  insert (id, inviter_user_id, link_hash, code_hash, expires_at), update (redeemed_at, redeemed_by_user_id, revoked_at)
  on public.connection_invites to chagokchan_rpc;
grant select (id, connection_id, invite_id, requester_user_id, approver_user_id, status, expires_at, resolved_at, created_at),
  insert (id, connection_id, invite_id, requester_user_id, approver_user_id, status, expires_at),
  update (status, resolved_at)
  on public.connection_requests to chagokchan_rpc;
grant select (board_id, user_id, connection_id, connection_generation, role, status, granted_by_user_id, granted_at, revoked_at),
  update (status, revoked_at)
  on public.board_members to chagokchan_rpc;
grant insert (connection_request_id, connection_id) on public.notifications to chagokchan_rpc;

create policy rpc_party_connections_select on public.connections for select to chagokchan_rpc
  using (private.require_actor() in (user_low_id, user_high_id));
create policy rpc_party_connections_insert on public.connections for insert to chagokchan_rpc
  with check (private.require_actor() in (user_low_id, user_high_id) and status = 'inactive' and generation = 0);
create policy rpc_party_connections_update on public.connections for update to chagokchan_rpc
  using (private.require_actor() in (user_low_id, user_high_id))
  with check (private.require_actor() in (user_low_id, user_high_id));

create policy rpc_party_blocks_select on public.blocks for select to chagokchan_rpc
  using (private.require_actor() in (blocker_user_id, blocked_user_id));
create policy rpc_owner_blocks_insert on public.blocks for insert to chagokchan_rpc
  with check (blocker_user_id = private.require_actor());
create policy rpc_owner_blocks_update on public.blocks for update to chagokchan_rpc
  using (blocker_user_id = private.require_actor()) with check (blocker_user_id = private.require_actor());

create policy rpc_owner_invites_select on public.connection_invites for select to chagokchan_rpc
  using (inviter_user_id = private.require_actor() or
    link_hash = nullif(current_setting('chagokchan.invite_secret_hash', true), '') or
    code_hash = nullif(current_setting('chagokchan.invite_secret_hash', true), ''));
create policy rpc_owner_invites_insert on public.connection_invites for insert to chagokchan_rpc
  with check (inviter_user_id = private.require_actor());
create policy rpc_owner_invites_update on public.connection_invites for update to chagokchan_rpc
  using (inviter_user_id = private.require_actor() or
    link_hash = nullif(current_setting('chagokchan.invite_secret_hash', true), '') or
    code_hash = nullif(current_setting('chagokchan.invite_secret_hash', true), ''))
  with check (inviter_user_id = private.require_actor() or
    link_hash = nullif(current_setting('chagokchan.invite_secret_hash', true), '') or
    code_hash = nullif(current_setting('chagokchan.invite_secret_hash', true), ''));

create policy rpc_party_requests_select on public.connection_requests for select to chagokchan_rpc
  using (private.require_actor() in (requester_user_id, approver_user_id));
create policy rpc_requester_requests_insert on public.connection_requests for insert to chagokchan_rpc
  with check (requester_user_id = private.require_actor() and requester_user_id <> approver_user_id);
create policy rpc_party_requests_update on public.connection_requests for update to chagokchan_rpc
  using (private.require_actor() in (requester_user_id, approver_user_id))
  with check (private.require_actor() in (requester_user_id, approver_user_id));

create policy rpc_owner_or_member_board_members_select on public.board_members for select to chagokchan_rpc
  using (user_id = private.require_actor() or exists (
    select 1 from public.boards b where b.id = board_id and b.owner_user_id = private.require_actor()
  ));
create policy rpc_connection_party_board_members_update on public.board_members for update to chagokchan_rpc
  using (exists (select 1 from public.boards b where b.id = board_id and b.owner_user_id = private.require_actor()) or
    exists (select 1 from public.connections c where c.id = connection_id and private.require_actor() in (c.user_low_id, c.user_high_id)))
  with check (exists (select 1 from public.boards b where b.id = board_id and b.owner_user_id = private.require_actor()) or
    exists (select 1 from public.connections c where c.id = connection_id and private.require_actor() in (c.user_low_id, c.user_high_id)));

-- Only an RPC that validated a one-time invite can set this transaction-local profile projection context.
create policy rpc_verified_related_profile_select on public.profiles for select to chagokchan_rpc
  using (user_id = private.require_actor() or
    user_id = nullif(current_setting('chagokchan.preview_profile_id', true), '')::uuid or
    exists (
      select 1 from public.connections c
      where c.status = 'active' and user_id in (c.user_low_id, c.user_high_id)
        and private.require_actor() in (c.user_low_id, c.user_high_id)
        and not exists (select 1 from public.blocks bl where bl.revoked_at is null and
          bl.blocker_user_id in (c.user_low_id, c.user_high_id) and bl.blocked_user_id in (c.user_low_id, c.user_high_id))
    ) or
    exists (select 1 from public.connection_requests cr where user_id in (cr.requester_user_id, cr.approver_user_id)
      and private.require_actor() in (cr.requester_user_id, cr.approver_user_id)
      and cr.created_at >= now() - interval '30 days') or
    exists (select 1 from public.blocks bl where bl.blocker_user_id = private.require_actor()
      and bl.blocked_user_id = user_id and bl.revoked_at is null));
create policy rpc_verified_inviter_status_select on public.app_users for select to chagokchan_rpc
  using (id = nullif(current_setting('chagokchan.preview_profile_id', true), '')::uuid);

-- ON CONFLICT for request/accept notices is permitted only for the corresponding transition and parties.
create policy rpc_connection_transition_notifications_insert on public.notifications for insert to chagokchan_rpc
  with check (
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

create function private.connection_secret_hash(p_secret jsonb) returns text
language plpgsql set search_path = pg_catalog
as $$
declare secret_value text; normalized_code text;
begin
  if p_secret is null or jsonb_typeof(p_secret) <> 'object' or jsonb_object_length(p_secret) <> 1 then
    raise exception using errcode = 'PT400', message = 'invalid_invite_secret';
  end if;
  if p_secret ? 'link_token' and jsonb_typeof(p_secret->'link_token') = 'string' then
    secret_value := p_secret->>'link_token';
    if char_length(secret_value) <> 32 or secret_value !~ '^[A-Za-z0-9_-]{32}$' then
      raise exception using errcode = 'PT400', message = 'invalid_invite_secret';
    end if;
  elsif p_secret ? 'code' and jsonb_typeof(p_secret->'code') = 'string' then
    secret_value := p_secret->>'code';
    if char_length(secret_value) not between 12 and 17 or secret_value !~ '^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z-]{12,17}$' then
      raise exception using errcode = 'PT400', message = 'invalid_invite_secret';
    end if;
    normalized_code := upper(replace(secret_value, '-', ''));
    if char_length(normalized_code) <> 12 or normalized_code !~ '^[0-9A-HJKMNP-TV-Z]{12}$' then
      raise exception using errcode = 'PT400', message = 'invalid_invite_secret';
    end if;
    secret_value := normalized_code;
  else
    raise exception using errcode = 'PT400', message = 'invalid_invite_secret';
  end if;
  return encode(sha256(convert_to(secret_value, 'UTF8')), 'hex');
end $$;
alter function private.connection_secret_hash(jsonb) owner to chagokchan_rpc;
revoke all on function private.connection_secret_hash(jsonb) from public, anon, authenticated, service_role;

create function private.lock_connection_pair(p_left uuid, p_right uuid) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if p_left is null or p_right is null or p_left = p_right then
    raise exception using errcode = 'PT400', message = 'invalid_connection_pair';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('connection-pair:' || least(p_left, p_right)::text || ':' || greatest(p_left, p_right)::text, 1));
end $$;
alter function private.lock_connection_pair(uuid, uuid) owner to chagokchan_rpc;
revoke all on function private.lock_connection_pair(uuid, uuid) from public, anon, authenticated, service_role;

create function private.lock_connection_capacity(p_user uuid) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if p_user is null then raise exception using errcode = 'PT400', message = 'invalid_connection_pair'; end if;
  perform pg_advisory_xact_lock(hashtextextended('connection-capacity:' || p_user::text, 2));
end $$;
alter function private.lock_connection_capacity(uuid) owner to chagokchan_rpc;
revoke all on function private.lock_connection_capacity(uuid) from public, anon, authenticated, service_role;

create function private.encode_relationship_cursor(p_at timestamptz, p_id uuid) returns text
language sql immutable set search_path = pg_catalog
as $$
  select replace(replace(rtrim(encode(convert_to(jsonb_build_array(p_at, p_id)::text, 'UTF8'), 'base64'), '='), '+', '-'), '/', '_')
$$;
alter function private.encode_relationship_cursor(timestamptz, uuid) owner to chagokchan_rpc;
revoke all on function private.encode_relationship_cursor(timestamptz, uuid) from public, anon, authenticated, service_role;

create function private.decode_relationship_cursor(p_cursor text) returns jsonb
language plpgsql immutable set search_path = pg_catalog
as $$
declare decoded text; value jsonb;
begin
  if p_cursor is null then return null; end if;
  if char_length(p_cursor) not between 1 and 512 or p_cursor !~ '^[A-Za-z0-9_-]+$' then
    raise exception using errcode = 'PT400', message = 'invalid_cursor';
  end if;
  begin
    decoded := convert_from(decode(replace(replace(p_cursor, '-', '+'), '_', '/') || repeat('=', (4 - char_length(p_cursor) % 4) % 4), 'base64'), 'UTF8');
    value := decoded::jsonb;
    if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) <> 2 then raise exception 'cursor_shape'; end if;
    perform (value->>0)::timestamptz;
    perform (value->>1)::uuid;
  exception when others then
    raise exception using errcode = 'PT400', message = 'invalid_cursor';
  end;
  return value;
end $$;
alter function private.decode_relationship_cursor(text) owner to chagokchan_rpc;
revoke all on function private.decode_relationship_cursor(text) from public, anon, authenticated, service_role;

create function public.create_connection_invite() returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; token text; code_value text; raw_hex text; raw_bytes bytea; link_digest text; code_digest text;
  invite_uuid uuid := gen_random_uuid(); expires timestamptz := clock_timestamp() + interval '24 hours';
  utc_day timestamptz; active_count integer; attempt integer; bit_value integer; bit_position integer; byte_position integer; code_value_index integer;
begin
  actor := private.require_actor();
  perform pg_advisory_xact_lock(hashtextextended('connection-invites:' || actor::text, 3));
  select count(*)::integer into active_count from public.connection_invites i
    where i.inviter_user_id = actor and i.redeemed_at is null and i.revoked_at is null and i.expires_at > clock_timestamp();
  if active_count >= 5 then raise exception using errcode = 'PT409', message = 'active_invite_limit'; end if;
  utc_day := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(actor, 'connection_invite_create_day', 20, utc_day, utc_day + interval '1 day');
  for attempt in 1..5 loop
    raw_hex := substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 48);
    raw_bytes := decode(raw_hex, 'hex');
    token := translate(rtrim(encode(raw_bytes, 'base64'), '='), '+/', '-_');
    raw_hex := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
    raw_bytes := decode(raw_hex, 'hex');
    code_value := '';
    for code_value_index in 0..11 loop
      bit_value := 0;
      for bit_position in 0..4 loop
        byte_position := (code_value_index * 5 + bit_position) / 8;
        bit_value := bit_value * 2 + ((get_byte(raw_bytes, byte_position) >> (7 - ((code_value_index * 5 + bit_position) % 8))) & 1);
      end loop;
      code_value := code_value || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', bit_value + 1, 1);
    end loop;
    link_digest := encode(sha256(convert_to(token, 'UTF8')), 'hex');
    code_digest := encode(sha256(convert_to(code_value, 'UTF8')), 'hex');
    begin
      insert into public.connection_invites(id, inviter_user_id, link_hash, code_hash, expires_at)
        values (invite_uuid, actor, link_digest, code_digest, expires);
      exit;
    exception when unique_violation then
      if attempt = 5 then raise exception using errcode = 'PT503', message = 'invite_generation_unavailable'; end if;
      invite_uuid := gen_random_uuid();
    end;
  end loop;
  return jsonb_build_object('id', invite_uuid, 'link_path', '/connect#invite=' || token, 'code', code_value, 'expires_at', expires);
end $$;
alter function public.create_connection_invite() owner to chagokchan_rpc;
revoke all on function public.create_connection_invite() from public, anon, authenticated, service_role;
grant execute on function public.create_connection_invite() to authenticated;

create function public.preview_connection_invite(p_secret jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; secret_digest text; invite_row record; display_name text;
  utc_minute timestamptz; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  secret_digest := private.connection_secret_hash(p_secret);
  utc_minute := date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(actor, 'invite_use_user_15_minutes', 10, date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC' -
    (extract(minute from now_at at time zone 'UTC')::integer % 15) * interval '1 minute',
    date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC' -
    (extract(minute from now_at at time zone 'UTC')::integer % 15) * interval '1 minute' + interval '15 minutes');
  perform set_config('chagokchan.invite_secret_hash', secret_digest, true);
  select i.id, i.inviter_user_id, i.expires_at into invite_row from public.connection_invites i
    where (i.link_hash = secret_digest or i.code_hash = secret_digest) and i.redeemed_at is null and i.revoked_at is null and i.expires_at > now_at;
  if not found or invite_row.inviter_user_id = actor then raise exception using errcode = 'PT404', message = 'invite_unavailable'; end if;
  perform private.lock_connection_pair(actor, invite_row.inviter_user_id);
  if exists (select 1 from public.blocks bl where bl.revoked_at is null and
      ((bl.blocker_user_id = actor and bl.blocked_user_id = invite_row.inviter_user_id) or
       (bl.blocker_user_id = invite_row.inviter_user_id and bl.blocked_user_id = actor))) then
    raise exception using errcode = 'PT404', message = 'invite_unavailable';
  end if;
  perform set_config('chagokchan.preview_profile_id', invite_row.inviter_user_id::text, true);
  select p.nickname into display_name from public.profiles p join public.app_users a on a.id = p.user_id
    where p.user_id = invite_row.inviter_user_id and a.account_status = 'active';
  if display_name is null then raise exception using errcode = 'PT404', message = 'invite_unavailable'; end if;
  return jsonb_build_object('inviter_nickname', display_name, 'expires_at', invite_row.expires_at);
end $$;
alter function public.preview_connection_invite(jsonb) owner to chagokchan_rpc;
revoke all on function public.preview_connection_invite(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.preview_connection_invite(jsonb) to authenticated;

create function public.create_connection_request(p_request_key uuid, p_secret jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; secret_digest text; request_hash text; canonical_input jsonb; receipt_uuid uuid := gen_random_uuid();
  request_uuid uuid := gen_random_uuid(); inserted_receipt uuid; existing public.request_receipts%rowtype;
  invite_row record; pair_low uuid; pair_high uuid; connection_uuid uuid; pending_count integer;
  now_at timestamptz := clock_timestamp(); utc_day timestamptz; utc_15_start timestamptz;
begin
  actor := private.require_actor();
  if p_request_key is null then raise exception using errcode = 'PT400', message = 'invalid_request_key'; end if;
  secret_digest := private.connection_secret_hash(p_secret);
  canonical_input := jsonb_build_object('invite_hash', secret_digest);
  request_hash := encode(sha256(convert_to(canonical_input::text, 'UTF8')), 'hex');
  insert into public.request_receipts(id, actor_user_id, operation, request_key, input_hash, result_kind, result_id)
    values (receipt_uuid, actor, 'createConnectionRequest', p_request_key, request_hash, 'connection_request', request_uuid)
    on conflict (actor_user_id, operation, request_key) do nothing returning id into inserted_receipt;
  if inserted_receipt is null then
    select * into existing from public.request_receipts r where r.actor_user_id = actor
      and r.operation = 'createConnectionRequest' and r.request_key = p_request_key for update;
    if existing.input_hash is distinct from request_hash or existing.result_kind <> 'connection_request' then
      raise exception using errcode = 'PT409', message = 'idempotency_conflict';
    end if;
    return jsonb_build_object('id', existing.result_id, 'replayed', true);
  end if;
  utc_day := date_trunc('day', now_at at time zone 'UTC') at time zone 'UTC';
  perform private.consume_rate_limit(actor, 'connection_request_create_day', 20, utc_day, utc_day + interval '1 day');
  utc_15_start := date_trunc('minute', now_at at time zone 'UTC') at time zone 'UTC' -
    (extract(minute from now_at at time zone 'UTC')::integer % 15) * interval '1 minute';
  perform private.consume_rate_limit(actor, 'invite_use_user_15_minutes', 10, utc_15_start, utc_15_start + interval '15 minutes');
  perform set_config('chagokchan.invite_secret_hash', secret_digest, true);
  select i.id, i.inviter_user_id, i.expires_at, i.redeemed_at, i.revoked_at, i.link_hash, i.code_hash into invite_row
    from public.connection_invites i where (i.link_hash = secret_digest or i.code_hash = secret_digest) for update;
  if not found or invite_row.expires_at <= now_at or invite_row.revoked_at is not null or invite_row.redeemed_at is not null or
     invite_row.inviter_user_id = actor then
    raise exception using errcode = 'PT404', message = 'invite_unavailable';
  end if;
  pair_low := least(actor, invite_row.inviter_user_id); pair_high := greatest(actor, invite_row.inviter_user_id);
  perform private.lock_connection_pair(pair_low, pair_high);
  if exists (select 1 from public.blocks bl where bl.revoked_at is null and
      ((bl.blocker_user_id = pair_low and bl.blocked_user_id = pair_high) or (bl.blocker_user_id = pair_high and bl.blocked_user_id = pair_low))) then
    raise exception using errcode = 'PT404', message = 'invite_unavailable';
  end if;
  if exists (select 1 from public.connections c where c.user_low_id = pair_low and c.user_high_id = pair_high and c.status = 'active') then
    raise exception using errcode = 'PT409', message = 'connection_already_active';
  end if;
  update public.connection_requests set status = 'expired', resolved_at = now_at
    where connection_id in (select c.id from public.connections c where c.user_low_id = pair_low and c.user_high_id = pair_high)
      and status = 'pending' and expires_at <= now_at;
  select count(*)::integer into pending_count from public.connection_requests cr
    join public.connections c on c.id = cr.connection_id
    where c.user_low_id = pair_low and c.user_high_id = pair_high and cr.status = 'pending';
  if pending_count > 0 then raise exception using errcode = 'PT409', message = 'connection_request_pending'; end if;
  select c.id into connection_uuid from public.connections c where c.user_low_id = pair_low and c.user_high_id = pair_high for update;
  if connection_uuid is null then
    connection_uuid := gen_random_uuid();
    insert into public.connections(id, user_low_id, user_high_id) values (connection_uuid, pair_low, pair_high);
  end if;
  update public.connection_invites set redeemed_at = now_at, redeemed_by_user_id = actor where id = invite_row.id;
  insert into public.connection_requests(id, connection_id, invite_id, requester_user_id, approver_user_id, expires_at)
    values (request_uuid, connection_uuid, invite_row.id, actor, invite_row.inviter_user_id, now_at + interval '48 hours');
  insert into public.notifications(recipient_user_id, actor_user_id, type, dedupe_key, connection_request_id)
    values (invite_row.inviter_user_id, actor, 'connection_requested', 'connection-request:' || request_uuid::text, request_uuid)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  return jsonb_build_object('id', request_uuid, 'replayed', false);
end $$;
alter function public.create_connection_request(uuid, jsonb) owner to chagokchan_rpc;
revoke all on function public.create_connection_request(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_connection_request(uuid, jsonb) to authenticated;

create function public.accept_connection_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; request_row record; connection_row record; now_at timestamptz := clock_timestamp(); active_low integer; active_high integer;
begin
  actor := private.require_actor();
  select cr.id, cr.connection_id, cr.requester_user_id, cr.approver_user_id, cr.status, cr.expires_at,
    c.user_low_id, c.user_high_id into request_row
    from public.connection_requests cr join public.connections c on c.id = cr.connection_id
    where cr.id = p_request_id and cr.approver_user_id = actor;
  if not found then raise exception using errcode = 'PT404', message = 'connection_request_not_found'; end if;
  if request_row.status = 'accepted' then return jsonb_build_object('id', request_row.id, 'replayed', true); end if;
  if request_row.status <> 'pending' then raise exception using errcode = 'PT409', message = 'connection_request_resolved'; end if;
  perform private.lock_connection_capacity(request_row.user_low_id);
  perform private.lock_connection_capacity(request_row.user_high_id);
  perform private.lock_connection_pair(request_row.user_low_id, request_row.user_high_id);
  select cr.id, cr.connection_id, cr.requester_user_id, cr.approver_user_id, cr.status, cr.expires_at
    into request_row from public.connection_requests cr where cr.id = p_request_id and cr.approver_user_id = actor for update;
  if not found then raise exception using errcode = 'PT404', message = 'connection_request_not_found'; end if;
  if request_row.status = 'accepted' then return jsonb_build_object('id', request_row.id, 'replayed', true); end if;
  if request_row.status <> 'pending' then raise exception using errcode = 'PT409', message = 'connection_request_resolved'; end if;
  if request_row.expires_at <= now_at then raise exception using errcode = 'PT409', message = 'connection_request_expired'; end if;
  select c.id, c.user_low_id, c.user_high_id, c.status, c.generation into connection_row
    from public.connections c where c.id = request_row.connection_id for update;
  if not found then raise exception using errcode = 'PT503', message = 'connection_incomplete'; end if;
  if exists (select 1 from public.blocks bl where bl.revoked_at is null and
      ((bl.blocker_user_id = connection_row.user_low_id and bl.blocked_user_id = connection_row.user_high_id) or
       (bl.blocker_user_id = connection_row.user_high_id and bl.blocked_user_id = connection_row.user_low_id))) then
    raise exception using errcode = 'PT409', message = 'connection_blocked';
  end if;
  if connection_row.status = 'active' then raise exception using errcode = 'PT409', message = 'connection_already_active'; end if;
  select count(*)::integer into active_low from public.connections c where c.status = 'active' and connection_row.user_low_id in (c.user_low_id, c.user_high_id);
  select count(*)::integer into active_high from public.connections c where c.status = 'active' and connection_row.user_high_id in (c.user_low_id, c.user_high_id);
  if active_low >= 200 or active_high >= 200 then raise exception using errcode = 'PT409', message = 'active_connection_limit'; end if;
  update public.connections set status = 'active', generation = generation + 1, connected_at = now_at, disconnected_at = null where id = connection_row.id;
  update public.connection_requests set status = 'accepted', resolved_at = now_at where id = request_row.id;
  insert into public.notifications(recipient_user_id, actor_user_id, type, dedupe_key, connection_request_id, connection_id)
    values (request_row.requester_user_id, actor, 'connection_accepted', 'connection-accepted:' || request_row.id::text, request_row.id, connection_row.id)
    on conflict (recipient_user_id, dedupe_key) do nothing;
  return jsonb_build_object('id', request_row.id, 'replayed', false);
end $$;
alter function public.accept_connection_request(uuid) owner to chagokchan_rpc;
revoke all on function public.accept_connection_request(uuid) from public, anon, authenticated, service_role;
grant execute on function public.accept_connection_request(uuid) to authenticated;

create function public.reject_connection_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; request_row record; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  select cr.id, cr.connection_id, cr.requester_user_id, cr.approver_user_id into request_row
    from public.connection_requests cr where cr.id = p_request_id and cr.approver_user_id = actor;
  if not found then raise exception using errcode = 'PT404', message = 'connection_request_not_found'; end if;
  perform private.lock_connection_pair(request_row.requester_user_id, request_row.approver_user_id);
  select cr.id, cr.status into request_row from public.connection_requests cr
    where cr.id = p_request_id and cr.approver_user_id = actor for update;
  if not found then raise exception using errcode = 'PT404', message = 'connection_request_not_found'; end if;
  if request_row.status = 'rejected' then return jsonb_build_object('id', request_row.id, 'replayed', true); end if;
  if request_row.status <> 'pending' then raise exception using errcode = 'PT409', message = 'connection_request_resolved'; end if;
  update public.connection_requests set status = 'rejected', resolved_at = now_at where id = request_row.id;
  return jsonb_build_object('id', request_row.id, 'replayed', false);
end $$;
alter function public.reject_connection_request(uuid) owner to chagokchan_rpc;
revoke all on function public.reject_connection_request(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reject_connection_request(uuid) to authenticated;

create function public.cancel_connection_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; request_row record; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  select cr.id, cr.connection_id, cr.requester_user_id, cr.approver_user_id into request_row
    from public.connection_requests cr where cr.id = p_request_id and cr.requester_user_id = actor;
  if not found then raise exception using errcode = 'PT404', message = 'connection_request_not_found'; end if;
  perform private.lock_connection_pair(request_row.requester_user_id, request_row.approver_user_id);
  select cr.id, cr.status into request_row from public.connection_requests cr
    where cr.id = p_request_id and cr.requester_user_id = actor for update;
  if not found then raise exception using errcode = 'PT404', message = 'connection_request_not_found'; end if;
  if request_row.status = 'cancelled' then return jsonb_build_object('id', request_row.id, 'replayed', true); end if;
  if request_row.status <> 'pending' then raise exception using errcode = 'PT409', message = 'connection_request_resolved'; end if;
  update public.connection_requests set status = 'cancelled', resolved_at = now_at where id = request_row.id;
  return jsonb_build_object('id', request_row.id, 'replayed', false);
end $$;
alter function public.cancel_connection_request(uuid) owner to chagokchan_rpc;
revoke all on function public.cancel_connection_request(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_connection_request(uuid) to authenticated;

create function public.revoke_connection_invite(p_invite_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; invite_row record; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  select i.id, i.inviter_user_id, i.redeemed_at, i.revoked_at into invite_row
    from public.connection_invites i where i.id = p_invite_id and i.inviter_user_id = actor for update;
  if not found then raise exception using errcode = 'PT404', message = 'invite_not_found'; end if;
  if invite_row.revoked_at is not null then return jsonb_build_object('id', invite_row.id, 'replayed', true); end if;
  if invite_row.redeemed_at is not null then raise exception using errcode = 'PT409', message = 'invite_already_used'; end if;
  update public.connection_invites set revoked_at = now_at where id = invite_row.id;
  return jsonb_build_object('id', invite_row.id, 'replayed', false);
end $$;
alter function public.revoke_connection_invite(uuid) owner to chagokchan_rpc;
revoke all on function public.revoke_connection_invite(uuid) from public, anon, authenticated, service_role;
grant execute on function public.revoke_connection_invite(uuid) to authenticated;

create function public.disconnect(p_connection_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; connection_row record; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  select c.id, c.user_low_id, c.user_high_id into connection_row from public.connections c
    where c.id = p_connection_id and actor in (c.user_low_id, c.user_high_id);
  if not found then raise exception using errcode = 'PT404', message = 'connection_not_found'; end if;
  perform private.lock_connection_pair(connection_row.user_low_id, connection_row.user_high_id);
  select c.id, c.status, c.user_low_id, c.user_high_id into connection_row from public.connections c
    where c.id = p_connection_id and actor in (c.user_low_id, c.user_high_id) for update;
  if not found then raise exception using errcode = 'PT404', message = 'connection_not_found'; end if;
  if connection_row.status = 'inactive' then return jsonb_build_object('id', connection_row.id, 'replayed', true); end if;
  update public.connections set status = 'inactive', disconnected_at = now_at where id = connection_row.id;
  update public.board_members set status = 'revoked', revoked_at = now_at where connection_id = connection_row.id and status = 'active';
  return jsonb_build_object('id', connection_row.id, 'replayed', false);
end $$;
alter function public.disconnect(uuid) owner to chagokchan_rpc;
revoke all on function public.disconnect(uuid) from public, anon, authenticated, service_role;
grant execute on function public.disconnect(uuid) to authenticated;

create function public.create_block(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; low_id uuid; high_id uuid; block_uuid uuid; block_revoked_at timestamptz; connection_uuid uuid; now_at timestamptz := clock_timestamp();
  known boolean;
begin
  actor := private.require_actor();
  if p_user_id is null or p_user_id = actor then raise exception using errcode = 'PT400', message = 'invalid_block_target'; end if;
  low_id := least(actor, p_user_id); high_id := greatest(actor, p_user_id);
  perform private.lock_connection_pair(low_id, high_id);
  select exists(select 1 from public.connections c where c.user_low_id = low_id and c.user_high_id = high_id) or
    exists(select 1 from public.connection_requests cr join public.connections c on c.id = cr.connection_id
      where c.user_low_id = low_id and c.user_high_id = high_id and actor in (cr.requester_user_id, cr.approver_user_id)) into known;
  if not known then raise exception using errcode = 'PT404', message = 'block_target_not_found'; end if;
  select bl.id, bl.revoked_at into block_uuid, block_revoked_at from public.blocks bl
    where bl.blocker_user_id = actor and bl.blocked_user_id = p_user_id for update;
  if block_uuid is not null and block_revoked_at is null then return jsonb_build_object('id', block_uuid, 'replayed', true); end if;
  if block_uuid is null then
    block_uuid := gen_random_uuid();
    insert into public.blocks(id, blocker_user_id, blocked_user_id) values (block_uuid, actor, p_user_id);
  else
    update public.blocks set revoked_at = null where id = block_uuid;
  end if;
  select c.id into connection_uuid from public.connections c where c.user_low_id = low_id and c.user_high_id = high_id for update;
  if found and connection_uuid is not null then
    update public.connections set status = 'inactive', disconnected_at = case when status = 'active' then now_at else disconnected_at end
      where id = connection_uuid and status = 'active';
    update public.board_members set status = 'revoked', revoked_at = now_at where connection_id = connection_uuid and status = 'active';
    update public.connection_requests set status = 'cancelled', resolved_at = now_at
      where connection_id = connection_uuid and status = 'pending';
  end if;
  return jsonb_build_object('id', block_uuid, 'replayed', false);
end $$;
alter function public.create_block(uuid) owner to chagokchan_rpc;
revoke all on function public.create_block(uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_block(uuid) to authenticated;

create function public.revoke_block(p_block_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; block_row record; now_at timestamptz := clock_timestamp();
begin
  actor := private.require_actor();
  select bl.id, bl.blocker_user_id, bl.blocked_user_id, bl.revoked_at into block_row
    from public.blocks bl where bl.id = p_block_id and bl.blocker_user_id = actor;
  if not found then raise exception using errcode = 'PT404', message = 'block_not_found'; end if;
  if block_row.revoked_at is not null then return jsonb_build_object('id', block_row.id, 'replayed', true); end if;
  perform private.lock_connection_pair(block_row.blocker_user_id, block_row.blocked_user_id);
  select bl.id, bl.revoked_at into block_row from public.blocks bl where bl.id = p_block_id and bl.blocker_user_id = actor for update;
  if not found then raise exception using errcode = 'PT404', message = 'block_not_found'; end if;
  if block_row.revoked_at is not null then return jsonb_build_object('id', block_row.id, 'replayed', true); end if;
  update public.blocks set revoked_at = now_at where id = block_row.id;
  return jsonb_build_object('id', block_row.id, 'replayed', false);
end $$;
alter function public.revoke_block(uuid) owner to chagokchan_rpc;
revoke all on function public.revoke_block(uuid) from public, anon, authenticated, service_role;
grant execute on function public.revoke_block(uuid) to authenticated;

create function public.list_connections(p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid; item record; items jsonb := '[]'::jsonb;
  next_cursor text := null; item_count integer := 0;
begin
  actor := private.require_actor();
  if p_limit not between 1 and 50 then raise exception using errcode = 'PT400', message = 'invalid_page_size'; end if;
  cursor_value := private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at := (cursor_value->>0)::timestamptz; cursor_id := (cursor_value->>1)::uuid; end if;
  for item in select c.id, c.status, c.generation, c.created_at,
      case when c.status = 'active' and not exists (select 1 from public.blocks bl where bl.revoked_at is null and
        bl.blocker_user_id in (c.user_low_id,c.user_high_id) and bl.blocked_user_id in (c.user_low_id,c.user_high_id))
        then p.user_id end as other_user_id,
      case when c.status = 'active' and not exists (select 1 from public.blocks bl where bl.revoked_at is null and
        bl.blocker_user_id in (c.user_low_id,c.user_high_id) and bl.blocked_user_id in (c.user_low_id,c.user_high_id))
        then p.nickname end as other_nickname,
      case when c.status = 'active' and not exists (select 1 from public.blocks bl where bl.revoked_at is null and
        bl.blocker_user_id in (c.user_low_id,c.user_high_id) and bl.blocked_user_id in (c.user_low_id,c.user_high_id))
        then p.avatar_key end as other_avatar
    from public.connections c left join public.profiles p on p.user_id = case when c.user_low_id = actor then c.user_high_id else c.user_low_id end
    where actor in (c.user_low_id,c.user_high_id) and (cursor_at is null or (c.created_at,c.id) < (cursor_at,cursor_id))
    order by c.created_at desc,c.id desc limit p_limit + 1
  loop
    if item_count = p_limit then next_cursor := private.encode_relationship_cursor(item.created_at,item.id); exit; end if;
    item_count := item_count + 1;
    items := items || jsonb_build_array(jsonb_build_object('id',item.id,'status',item.status,'generation',item.generation,
      'other_user',case when item.other_user_id is null then null else jsonb_build_object('user_id',item.other_user_id,'nickname',item.other_nickname,'avatar_key',item.other_avatar) end));
  end loop;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
alter function public.list_connections(text, integer) owner to chagokchan_rpc;
revoke all on function public.list_connections(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_connections(text, integer) to authenticated;

create function public.list_connection_invites(p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid; item record; items jsonb := '[]'::jsonb;
  next_cursor text := null; item_count integer := 0;
begin
  actor := private.require_actor();
  if p_limit not between 1 and 50 then raise exception using errcode = 'PT400', message = 'invalid_page_size'; end if;
  cursor_value := private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at := (cursor_value->>0)::timestamptz; cursor_id := (cursor_value->>1)::uuid; end if;
  for item in select i.id,i.created_at,i.expires_at,i.redeemed_at,i.revoked_at from public.connection_invites i
    where i.inviter_user_id=actor and (cursor_at is null or (i.created_at,i.id)<(cursor_at,cursor_id))
    order by i.created_at desc,i.id desc limit p_limit+1
  loop
    if item_count=p_limit then next_cursor:=private.encode_relationship_cursor(item.created_at,item.id); exit; end if;
    item_count:=item_count+1; items:=items||jsonb_build_array(jsonb_build_object('id',item.id,'created_at',item.created_at,'expires_at',item.expires_at,'redeemed_at',item.redeemed_at,'revoked_at',item.revoked_at));
  end loop;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
alter function public.list_connection_invites(text, integer) owner to chagokchan_rpc;
revoke all on function public.list_connection_invites(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_connection_invites(text, integer) to authenticated;

create function public.list_connection_requests(p_direction text default 'both',p_cursor text default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid; item record; items jsonb := '[]'::jsonb;
  next_cursor text := null; item_count integer := 0;
begin
  actor:=private.require_actor();
  if p_direction not in ('incoming','outgoing','both') or p_limit not between 1 and 50 then raise exception using errcode='PT400',message='invalid_request_list'; end if;
  cursor_value:=private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at:=(cursor_value->>0)::timestamptz; cursor_id:=(cursor_value->>1)::uuid; end if;
  for item in select cr.id,cr.requester_user_id,cr.approver_user_id,cr.status,cr.created_at,cr.expires_at,c.status as connection_status,
      case when cr.expires_at<=clock_timestamp() and cr.status='pending' then 'expired' else cr.status end as visible_status,
      p.user_id as other_user_id,p.nickname as other_nickname,p.avatar_key as other_avatar
    from public.connection_requests cr join public.connections c on c.id=cr.connection_id
    left join public.profiles p on p.user_id=case when cr.requester_user_id=actor then cr.approver_user_id else cr.requester_user_id end
    where actor in (cr.requester_user_id,cr.approver_user_id)
      and (p_direction='both' or (p_direction='incoming' and cr.approver_user_id=actor) or (p_direction='outgoing' and cr.requester_user_id=actor))
      and (cursor_at is null or (cr.created_at,cr.id)<(cursor_at,cursor_id))
    order by cr.created_at desc,cr.id desc limit p_limit+1
  loop
    if item_count=p_limit then next_cursor:=private.encode_relationship_cursor(item.created_at,item.id); exit; end if;
    item_count:=item_count+1;
    items:=items||jsonb_build_array(jsonb_build_object('id',item.id,'direction',case when item.approver_user_id=actor then 'incoming' else 'outgoing' end,
      'other_user',case when item.other_user_id is null then null else jsonb_build_object('user_id',item.other_user_id,'nickname',item.other_nickname,'avatar_key',item.other_avatar) end,
      'status',item.visible_status,'created_at',item.created_at,'expires_at',item.expires_at));
  end loop;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
alter function public.list_connection_requests(text,text,integer) owner to chagokchan_rpc;
revoke all on function public.list_connection_requests(text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_connection_requests(text,text,integer) to authenticated;

create function public.list_blocks(p_cursor text default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare actor uuid; cursor_value jsonb; cursor_at timestamptz; cursor_id uuid; item record; items jsonb:='[]'::jsonb;
  next_cursor text:=null; item_count integer:=0;
begin
  actor:=private.require_actor();
  if p_limit not between 1 and 50 then raise exception using errcode='PT400',message='invalid_page_size'; end if;
  cursor_value:=private.decode_relationship_cursor(p_cursor);
  if cursor_value is not null then cursor_at:=(cursor_value->>0)::timestamptz;cursor_id:=(cursor_value->>1)::uuid;end if;
  for item in select bl.id,bl.blocked_user_id,bl.created_at,p.nickname,p.avatar_key from public.blocks bl
    left join public.profiles p on p.user_id=bl.blocked_user_id
    where bl.blocker_user_id=actor and bl.revoked_at is null and (cursor_at is null or (bl.created_at,bl.id)<(cursor_at,cursor_id))
    order by bl.created_at desc,bl.id desc limit p_limit+1
  loop
    if item_count=p_limit then next_cursor:=private.encode_relationship_cursor(item.created_at,item.id);exit;end if;
    item_count:=item_count+1;items:=items||jsonb_build_array(jsonb_build_object('id',item.id,'blocked_user',
      case when item.blocked_user_id is null then null else jsonb_build_object('user_id',item.blocked_user_id,'nickname',item.nickname,'avatar_key',item.avatar_key) end,'created_at',item.created_at));
  end loop;
  return jsonb_build_object('items',items,'next_cursor',next_cursor);
end $$;
alter function public.list_blocks(text,integer) owner to chagokchan_rpc;
revoke all on function public.list_blocks(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_blocks(text,integer) to authenticated;

revoke create on schema public,private from chagokchan_rpc;
notify pgrst,'reload schema';
commit;
