import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, projectRoot, sql } from "./local-database-tools.mjs";

const cases = [];
const probes = [];
const clients = [];
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }) },
};
let status;
let admin;
let beforeSnapshot;
let beforeSessionCount;
let phase = "local_environment";
let failureDetail = null;
let failed = false;
let cleanupFailed = false;
let fixturePreserved = false;

const record = async (name, work) => {
  phase = name;
  await work();
  cases.push({ name, status: "passed" });
};
const denied = (result, code, message) => {
  assert.equal(result.data, null);
  assert.equal(result.error?.code, code, result.error?.message ?? "Expected RPC denial");
  if (message) assert.equal(result.error.message, message);
};
const ok = (result) => {
  assert.equal(result.error, null, result.error?.message ?? "RPC failed");
  assert.ok(result.data && typeof result.data === "object");
  return result.data;
};
const countFor = (query, values = {}) => sql(query, values).trim();
const hash = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

function snapshot() {
  const tables = sql("select tablename from pg_tables where schemaname='public' and tablename <> 'spatial_ref_sys' order by tablename;\n")
    .trim().split("\n").filter(Boolean);
  assert.equal(tables.length, 18);
  const digest = crypto.createHash("sha256");
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected app table.");
    digest.update(table + "\0" + sql("select coalesce(jsonb_agg(row_value order by row_value::text),'[]'::jsonb) from (select to_jsonb(t) row_value from public." + table + " t) rows;\n"));
  }
  return digest.digest("hex");
}

function authSessionCount() {
  return Number(sql("select count(*) from auth.sessions;\n").trim());
}

async function createProbe(label, policyVersion) {
  const credentials = {
    email: "probe-" + crypto.randomUUID() + "@connection.chagokchan.invalid",
    password: crypto.randomBytes(32).toString("base64url"),
  };
  const created = await admin.auth.admin.createUser({
    ...credentials,
    email_confirm: true,
    app_metadata: { local_connection_probe: true },
  });
  if (created.error || !created.data.user) throw new Error("Synthetic probe setup failed.");
  const probe = { id: created.data.user.id, credentials, client: null };
  probes.push(probe);
  sql("insert into public.app_users(id,adult_confirmed_at,registration_policy_version) values (:'actor'::uuid,clock_timestamp(),:'policy');\ninsert into public.profiles(user_id,nickname) values (:'actor'::uuid,:'nickname');\n", {
    actor: probe.id, policy: policyVersion, nickname: label,
  });
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options);
  clients.push(client);
  probe.client = client;
  const signedIn = await client.auth.signInWithPassword(credentials);
  if (signedIn.error || !signedIn.data.session) throw new Error("Synthetic probe session could not be issued.");
  return probe;
}

async function createInvite(owner) {
  const invite = ok(await owner.client.rpc("create_connection_invite"));
  assert.equal(typeof invite.id, "string");
  assert.match(invite.link_path, /^\/connect#invite=[A-Za-z0-9_-]{32}$/);
  assert.match(invite.code, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  const token = invite.link_path.slice("/connect#invite=".length);
  return { ...invite, token, expiresAt: new Date(invite.expires_at).getTime() };
}

async function createRequest(requester, secret, key = crypto.randomUUID()) {
  const result = ok(await requester.client.rpc("create_connection_request", {
    p_request_key: key,
    p_secret: secret,
  }));
  assert.equal(typeof result.id, "string");
  assert.equal(typeof result.replayed, "boolean");
  return { ...result, key, secret };
}

function requestRow(requestId) {
  return JSON.parse(countFor("select to_jsonb(cr) from public.connection_requests cr where cr.id=:'request'::uuid;\n", { request: requestId }));
}

function connectionFor(left, right) {
  return JSON.parse(countFor("select to_jsonb(c) from public.connections c where c.user_low_id=least(:'left'::uuid,:'right'::uuid) and c.user_high_id=greatest(:'left'::uuid,:'right'::uuid);\n", {
    left: left.id, right: right.id,
  }));
}

function seedRate(actorId, scope, count) {
  if (scope === "connection_request_create_day") {
    sql("with b as (select date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC' s) insert into public.rate_usage(actor_user_id,scope_key,window_start,window_end,used_count) select :'actor'::uuid,:'scope',s,s+interval '1 day',:'count'::integer from b on conflict(actor_user_id,scope_key,window_start) do update set used_count=excluded.used_count,window_end=excluded.window_end,updated_at=clock_timestamp();\n", {
      actor: actorId, scope, count: String(count),
    });
  } else if (scope === "invite_use_user_15_minutes") {
    sql("with b as (select date_trunc('minute',clock_timestamp() at time zone 'UTC') at time zone 'UTC' - (extract(minute from clock_timestamp() at time zone 'UTC')::integer % 15)*interval '1 minute' s) insert into public.rate_usage(actor_user_id,scope_key,window_start,window_end,used_count) select :'actor'::uuid,:'scope',s,s+interval '15 minutes',:'count'::integer from b on conflict(actor_user_id,scope_key,window_start) do update set used_count=excluded.used_count,window_end=excluded.window_end,updated_at=clock_timestamp();\n", {
      actor: actorId, scope, count: String(count),
    });
  } else if (scope === "connection_invite_create_day") {
    sql("with b as (select date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC' s) insert into public.rate_usage(actor_user_id,scope_key,window_start,window_end,used_count) select :'actor'::uuid,:'scope',s,s+interval '1 day',:'count'::integer from b on conflict(actor_user_id,scope_key,window_start) do update set used_count=excluded.used_count,window_end=excluded.window_end,updated_at=clock_timestamp();\n", {
      actor: actorId, scope, count: String(count),
    });
  } else {
    throw new Error("Unexpected rate scope.");
  }
}

async function safeCleanup() {
  for (const client of clients) {
    try {
      if ((await client.auth.signOut({ scope: "local" })).error) cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
  if (!probes.length) return;
  try {
    const ids = probes.map((probe) => probe.id).filter(Boolean);
    const quoted = ids.map((id) => "'" + id + "'").join(",");
    if (quoted) {
      sql("delete from public.notifications where recipient_user_id in (" + quoted + ") or actor_user_id in (" + quoted + ");\ndelete from public.board_members where user_id in (" + quoted + ") or connection_id in (select id from public.connections where user_low_id in (" + quoted + ") or user_high_id in (" + quoted + "));\ndelete from public.connection_requests where requester_user_id in (" + quoted + ") or approver_user_id in (" + quoted + ") or connection_id in (select id from public.connections where user_low_id in (" + quoted + ") or user_high_id in (" + quoted + "));\ndelete from public.connection_invites where inviter_user_id in (" + quoted + ") or redeemed_by_user_id in (" + quoted + ");\ndelete from public.blocks where blocker_user_id in (" + quoted + ") or blocked_user_id in (" + quoted + ");\ndelete from public.connections where user_low_id in (" + quoted + ") or user_high_id in (" + quoted + ");\ndelete from public.request_receipts where actor_user_id in (" + quoted + ");\ndelete from public.rate_usage where actor_user_id in (" + quoted + ");\ndelete from public.profiles where user_id in (" + quoted + ");\ndelete from public.app_users where id in (" + quoted + ");\n");
    for (let index = probes.length - 1; index >= 0; index--) {
      const removed = await admin.auth.admin.deleteUser(probes[index].id);
      if (removed.error) cleanupFailed = true;
    }
    }
  } catch { cleanupFailed = true; }
}

try {
  status = assertLocalDatabase();
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!serviceKey) throw new Error("Local setup key unavailable.");
  admin = createClient(status.API_URL, serviceKey, options);
  const policy = JSON.parse(fs.readFileSync(path.join(projectRoot, "policies/app-policy.json"), "utf8"));
  beforeSnapshot = snapshot();
  beforeSessionCount = authSessionCount();

  const owner = await createProbe("초대 발급자", policy.policy_version);
  const requester = await createProbe("요청자", policy.policy_version);
  const left = await createProbe("동시 요청자 갑", policy.policy_version);
  const right = await createProbe("동시 요청자 을", policy.policy_version);
  const quotaRequester = await createProbe("제한 검사자", policy.policy_version);
  const quotaInviter = await createProbe("제한 초대자", policy.policy_version);

  let ownerInvites;
  let primaryRequest;
  let acceptedConnectionId;
  await record("invite_secret_shape_hash_ttl_preview_and_active_cap", async () => {
    ownerInvites = [];
    for (let index = 0; index < 5; index++) ownerInvites.push(await createInvite(owner));
    const now = Date.now();
    for (const invite of ownerInvites) {
      assert.ok(invite.expiresAt >= now + 23 * 60 * 60 * 1000);
      assert.ok(invite.expiresAt <= now + 25 * 60 * 60 * 1000);
      assert.equal(countFor("select count(*) from public.connection_invites where id=:'invite'::uuid and link_hash=:'link_hash' and code_hash=:'code_hash' and link_hash<>code_hash and link_hash !~ '^[A-Za-z0-9_-]{32}$' and code_hash !~ '^[0-9A-HJKMNP-TV-Z]{12}$';\n", {
        invite: invite.id, link_hash: hash(invite.token), code_hash: hash(invite.code),
      }), "1");
    }
    denied(await owner.client.rpc("create_connection_invite"), "PT409", "active_invite_limit");
    const normalized = inviteCodeWithSeparators(ownerInvites[0].code);
    const previewByCode = ok(await requester.client.rpc("preview_connection_invite", { p_secret: { code: normalized.toLowerCase() } }));
    const previewByLink = ok(await requester.client.rpc("preview_connection_invite", { p_secret: { link_token: ownerInvites[0].token } }));
    assert.deepEqual(Object.keys(previewByCode).sort(), ["expires_at", "inviter_nickname"]);
    assert.equal(previewByCode.inviter_nickname, "초대 발급자");
    assert.equal(previewByCode.expires_at, previewByLink.expires_at);
    assert.equal(countFor("select count(*) from public.connection_invites where id=:'invite'::uuid and redeemed_at is null;\n", { invite: ownerInvites[0].id }), "1");
    denied(await owner.client.rpc("preview_connection_invite", { p_secret: { code: ownerInvites[0].code } }), "PT404", "invite_unavailable");
    denied(await requester.client.rpc("preview_connection_invite", { p_secret: { code: "INVALID-CODE" } }), "PT400", "invalid_invite_secret");
    const listedItems = [];
    let cursor = null;
    do {
      const listed = ok(await owner.client.rpc("list_connection_invites", { p_cursor: cursor, p_limit: 1 }));
      listedItems.push(...listed.items);
      cursor = listed.next_cursor;
      assert.ok(listedItems.length <= 5, "invite pagination must not repeat or exceed the fixture set");
    } while (cursor);
    assert.deepEqual(listedItems.map((item) => item.id).sort(), ownerInvites.map((item) => item.id).sort());
    for (const item of listedItems) for (const key of ["link_hash", "code_hash", "token", "code"]) assert.ok(!(key in item));
  });

  await record("invite_daily_quota_is_atomic_and_revocation_releases_active_slot", async () => {
    assert.equal(ok(await owner.client.rpc("revoke_connection_invite", { p_invite_id: ownerInvites[0].id })).replayed, false);
    seedRate(owner.id, "connection_invite_create_day", 19);
    const twentieth = await createInvite(owner);
    ownerInvites.push(twentieth);
    for (const invite of [ownerInvites[3], ownerInvites[4]]) {
      assert.equal(ok(await owner.client.rpc("revoke_connection_invite", { p_invite_id: invite.id })).replayed, false);
    }
    denied(await owner.client.rpc("create_connection_invite"), "PT429", "rate_limited");
    assert.equal(countFor("select count(*) from public.connection_invites where inviter_user_id=:'actor'::uuid and redeemed_at is null and revoked_at is null and expires_at>clock_timestamp();\n", { actor: owner.id }), "3");
  });

  await record("request_rate_limits_rollback_receipt_and_preserve_invite_for_retry", async () => {
    const quotaInvite = await createInvite(quotaInviter);
    const firstKey = crypto.randomUUID();
    seedRate(quotaRequester.id, "connection_request_create_day", 19);
    seedRate(quotaRequester.id, "invite_use_user_15_minutes", 10);
    denied(await quotaRequester.client.rpc("create_connection_request", { p_request_key: firstKey, p_secret: { code: quotaInvite.code } }), "PT429", "rate_limited");
    assert.equal(countFor("select count(*) from public.request_receipts where actor_user_id=:'actor'::uuid and operation='createConnectionRequest' and request_key=:'key'::uuid;\n", { actor: quotaRequester.id, key: firstKey }), "0");
    assert.equal(countFor("select count(*) from public.connection_invites where id=:'invite'::uuid and redeemed_at is null;\n", { invite: quotaInvite.id }), "1");
    seedRate(quotaRequester.id, "invite_use_user_15_minutes", 0);
    const request = await createRequest(quotaRequester, { code: quotaInvite.code }, firstKey);
    assert.equal(request.replayed, false);
    assert.equal(requestRow(request.id).status, "pending");
    denied(await quotaRequester.client.rpc("create_connection_request", { p_request_key: crypto.randomUUID(), p_secret: { link_token: ownerInvites[5].token } }), "PT429", "rate_limited");
    assert.equal(countFor("select count(*) from public.connection_invites where id=:'invite'::uuid and redeemed_at is null;\n", { invite: ownerInvites[5].id }), "1");
    assert.equal(ok(await quotaInviter.client.rpc("reject_connection_request", { p_request_id: request.id })).replayed, false);
  });

  await record("single_use_invite_request_idempotency_and_approval_boundary", async () => {
    const invite = await createInvite(requester);
    const preview = ok(await owner.client.rpc("preview_connection_invite", { p_secret: { link_token: invite.token } }));
    assert.equal(preview.inviter_nickname, "요청자");
    const key = crypto.randomUUID();
    primaryRequest = await createRequest(owner, { code: invite.code }, key);
    const replayByCode = ok(await owner.client.rpc("create_connection_request", { p_request_key: key, p_secret: { code: invite.code } }));
    assert.deepEqual(replayByCode, { id: primaryRequest.id, replayed: true });
    denied(await owner.client.rpc("create_connection_request", { p_request_key: key, p_secret: { link_token: invite.token } }), "PT409", "idempotency_conflict");
    const differentInvite = await createInvite(requester);
    denied(await owner.client.rpc("create_connection_request", { p_request_key: key, p_secret: { code: differentInvite.code } }), "PT409", "idempotency_conflict");
    assert.equal(countFor("select count(*) from public.connection_requests where id=:'request'::uuid and status='pending';\n", { request: primaryRequest.id }), "1");
    assert.equal(countFor("select count(*) from public.notifications where connection_request_id=:'request'::uuid and type='connection_requested';\n", { request: primaryRequest.id }), "1");
    denied(await left.client.rpc("accept_connection_request", { p_request_id: primaryRequest.id }), "PT404", "connection_request_not_found");
    denied(await owner.client.rpc("accept_connection_request", { p_request_id: primaryRequest.id }), "PT404", "connection_request_not_found");
    const incoming = ok(await requester.client.rpc("list_connection_requests", { p_direction: "incoming", p_limit: 20 }));
    const outgoing = ok(await owner.client.rpc("list_connection_requests", { p_direction: "outgoing", p_limit: 20 }));
    assert.ok(incoming.items.some((item) => item.id === primaryRequest.id));
    assert.ok(outgoing.items.some((item) => item.id === primaryRequest.id));
  });

  await record("accept_replay_generation_and_safe_connected_profile_projection", async () => {
    const accepted = ok(await requester.client.rpc("accept_connection_request", { p_request_id: primaryRequest.id }));
    assert.equal(accepted.replayed, false);
    const connection = connectionFor(owner, requester);
    acceptedConnectionId = connection.id;
    assert.equal(connection.status, "active");
    assert.equal(connection.generation, 1);
    assert.equal(ok(await requester.client.rpc("accept_connection_request", { p_request_id: primaryRequest.id })).replayed, true);
    assert.equal(connectionFor(owner, requester).generation, 1);
    assert.equal(countFor("select count(*) from public.notifications where connection_id=:'connection'::uuid and dedupe_key='connection-accepted:'||:'request' and type='connection_accepted';\n", {
      connection: acceptedConnectionId, request: primaryRequest.id,
    }), "1");
    const list = ok(await owner.client.rpc("list_connections", { p_limit: 50 }));
    const item = list.items.find((entry) => entry.id === acceptedConnectionId);
    assert.ok(item);
    assert.deepEqual(Object.keys(item.other_user).sort(), ["avatar_key", "nickname", "user_id"]);
    assert.equal(item.other_user.user_id, requester.id);
    denied(await requester.client.rpc("list_connection_requests", { p_direction: "all", p_limit: 20 }), "PT400", "invalid_request_list");
    denied(await requester.client.rpc("list_connections", { p_cursor: "not a cursor", p_limit: 20 }), "PT400", "invalid_cursor");
  });

  await record("active_connection_rejects_new_request_without_consuming_invite", async () => {
    const reverseInvite = await createInvite(requester);
    denied(await owner.client.rpc("create_connection_request", { p_request_key: crypto.randomUUID(), p_secret: { code: reverseInvite.code } }), "PT409", "connection_already_active");
    assert.equal(countFor("select count(*) from public.connection_invites where id=:'invite'::uuid and redeemed_at is null;\n", { invite: reverseInvite.id }), "1");
  });

  await record("disconnect_is_idempotent_and_reconnect_increments_generation", async () => {
    assert.equal(ok(await owner.client.rpc("disconnect", { p_connection_id: acceptedConnectionId })).replayed, false);
    assert.equal(ok(await requester.client.rpc("disconnect", { p_connection_id: acceptedConnectionId })).replayed, true);
    assert.equal(connectionFor(owner, requester).status, "inactive");
    const inactiveView = ok(await owner.client.rpc("list_connections", { p_limit: 50 }));
    assert.equal(inactiveView.items.find((entry) => entry.id === acceptedConnectionId).other_user, null);
    const reconnectInvite = await createInvite(requester);
    const reconnectRequest = await createRequest(owner, { code: reconnectInvite.code });
    assert.equal(ok(await requester.client.rpc("accept_connection_request", { p_request_id: reconnectRequest.id })).replayed, false);
    assert.equal(connectionFor(owner, requester).generation, 2);
  });

  await record("block_closes_relation_hides_invite_and_unblock_never_restores", async () => {
    const block = ok(await owner.client.rpc("create_block", { p_user_id: requester.id }));
    assert.equal(block.replayed, false);
    assert.equal(ok(await owner.client.rpc("create_block", { p_user_id: requester.id })).replayed, true);
    const connection = connectionFor(owner, requester);
    assert.equal(connection.status, "inactive");
    assert.equal(connection.generation, 2);
    denied(await requester.client.rpc("preview_connection_invite", { p_secret: { link_token: ownerInvites[5].token } }), "PT404", "invite_unavailable");
    assert.equal(ok(await owner.client.rpc("revoke_block", { p_block_id: block.id })).replayed, false);
    assert.equal(connectionFor(owner, requester).status, "inactive");
    assert.equal(ok(await owner.client.rpc("revoke_block", { p_block_id: block.id })).replayed, true);
  });

  await record("blocking_pending_request_cancels_it_and_unblock_does_not_reopen", async () => {
    const pendingInvite = await createInvite(requester);
    const pending = await createRequest(owner, { code: pendingInvite.code });
    const block = ok(await owner.client.rpc("create_block", { p_user_id: requester.id }));
    assert.equal(block.replayed, false);
    assert.equal(requestRow(pending.id).status, "cancelled");
    denied(await requester.client.rpc("accept_connection_request", { p_request_id: pending.id }), "PT409", "connection_request_resolved");
    assert.equal(ok(await owner.client.rpc("revoke_block", { p_block_id: block.id })).replayed, false);
    assert.equal(requestRow(pending.id).status, "cancelled");
    assert.equal(connectionFor(owner, requester).status, "inactive");
  });

  await record("reverse_direction_concurrent_requests_keep_one_pending_and_rollback_loser_invite", async () => {
    const leftInvite = await createInvite(left);
    const rightInvite = await createInvite(right);
    const attempts = await Promise.all([
      left.client.rpc("create_connection_request", { p_request_key: crypto.randomUUID(), p_secret: { code: rightInvite.code } }),
      right.client.rpc("create_connection_request", { p_request_key: crypto.randomUUID(), p_secret: { code: leftInvite.code } }),
    ]);
    const winners = attempts.filter((result) => !result.error);
    const losers = attempts.filter((result) => result.error);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].error.code, "PT409");
    const winnerId = winners[0].data.id;
    const winnerRow = requestRow(winnerId);
    assert.equal(winnerRow.status, "pending");
    const loserInvite = winnerRow.requester_user_id === left.id ? leftInvite : rightInvite;
    assert.equal(countFor("select count(*) from public.connection_invites where id=:'invite'::uuid and redeemed_at is null;\n", { invite: loserInvite.id }), "1");
    assert.equal(countFor("select count(*) from public.connection_requests where connection_id=:'connection'::uuid and status='pending';\n", { connection: winnerRow.connection_id }), "1");
    const currentRequester = winnerRow.requester_user_id === left.id ? left : right;
    const currentApprover = winnerRow.approver_user_id === left.id ? left : right;
    assert.equal(ok(await currentRequester.client.rpc("cancel_connection_request", { p_request_id: winnerId })).replayed, false);
    assert.equal(ok(await currentRequester.client.rpc("cancel_connection_request", { p_request_id: winnerId })).replayed, true);
    const retry = await createRequest(currentApprover, { code: loserInvite.code });
    const retryRow = requestRow(retry.id);
    const approver = retryRow.approver_user_id === left.id ? left : right;
    assert.equal(ok(await approver.client.rpc("reject_connection_request", { p_request_id: retry.id })).replayed, false);
    assert.equal(ok(await approver.client.rpc("reject_connection_request", { p_request_id: retry.id })).replayed, true);
  });

  await record("one_invite_competed_by_two_users_is_consumed_once", async () => {
    const sharedInvite = await createInvite(quotaInviter);
    const attempts = await Promise.all([
      left.client.rpc("create_connection_request", { p_request_key: crypto.randomUUID(), p_secret: { code: sharedInvite.code } }),
      right.client.rpc("create_connection_request", { p_request_key: crypto.randomUUID(), p_secret: { link_token: sharedInvite.token } }),
    ]);
    const winners = attempts.filter((result) => !result.error);
    const losers = attempts.filter((result) => result.error);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].error.code, "PT404");
    const row = requestRow(winners[0].data.id);
    assert.equal(countFor("select count(*) from public.connection_invites where id=:'invite'::uuid and redeemed_at is not null and redeemed_by_user_id=:'requester'::uuid;\n", {
      invite: sharedInvite.id, requester: row.requester_user_id,
    }), "1");
    assert.equal(ok(await quotaInviter.client.rpc("reject_connection_request", { p_request_id: row.id })).replayed, false);
  });

  await record("notification_and_relationship_lists_are_recipient_and_party_scoped", async () => {
    const ownNotifications = await requester.client.from("notifications").select("id");
    assert.equal(ownNotifications.error?.code, "42501");
    const outsiderConnections = ok(await left.client.rpc("list_connections", { p_limit: 50 }));
    assert.equal(outsiderConnections.items.some((item) => item.id === acceptedConnectionId), false);
    const expectedRequestIds = countFor("select id from public.connection_requests where :'owner'::uuid in (requester_user_id,approver_user_id) order by created_at desc,id desc;\n", { owner: owner.id }).trim().split("\n").filter(Boolean);
    assert.ok(expectedRequestIds.length >= 3, "request fixture set must cross a multi-page boundary");
    const requestIds = [];
    let requestCursor = null;
    do {
      const page = ok(await owner.client.rpc("list_connection_requests", { p_direction: "both", p_cursor: requestCursor, p_limit: 1 }));
      requestIds.push(...page.items.map((item) => item.id));
      requestCursor = page.next_cursor;
      assert.ok(requestIds.length <= expectedRequestIds.length, "request pagination must not repeat rows");
    } while (requestCursor);
    assert.deepEqual(requestIds.sort(), expectedRequestIds.sort());
    denied(await left.client.rpc("disconnect", { p_connection_id: acceptedConnectionId }), "PT404", "connection_not_found");
    denied(await left.client.rpc("revoke_connection_invite", { p_invite_id: ownerInvites[1].id }), "PT404", "invite_not_found");
  });

  await record("active_connection_ceiling_serializes_two_competing_accepts", async () => {
    const auxiliary = [];
    for (let index = 0; index < 199; index++) {
      const created = await admin.auth.admin.createUser({
        email: "capacity-" + crypto.randomUUID() + "@connection.chagokchan.invalid",
        password: crypto.randomBytes(32).toString("base64url"),
        email_confirm: true,
        app_metadata: { local_connection_capacity_probe: true },
      });
      if (created.error || !created.data.user) throw new Error("Capacity probe setup failed.");
      const probe = { id: created.data.user.id, credentials: null, client: null };
      probes.push(probe);
      auxiliary.push(probe.id);
    }
    const ids = auxiliary.join(",");
    sql("with users as (select unnest(string_to_array(:'users',','))::uuid id) insert into public.app_users(id,adult_confirmed_at,registration_policy_version) select id,clock_timestamp(),:'policy' from users;\nwith users as (select unnest(string_to_array(:'users',','))::uuid id) insert into public.profiles(user_id) select id from users;\nwith users as (select unnest(string_to_array(:'users',','))::uuid id) insert into public.connections(user_low_id,user_high_id,status,generation,connected_at) select least(:'owner'::uuid,id),greatest(:'owner'::uuid,id),'active',1,clock_timestamp() from users;\n", {
      users: ids, policy: JSON.parse(fs.readFileSync(path.join(projectRoot, "policies/app-policy.json"), "utf8")).policy_version, owner: owner.id,
    });
    assert.equal(countFor("select count(*) from public.connections where status='active' and :'owner'::uuid in (user_low_id,user_high_id);\n", { owner: owner.id }), "199");
    const firstRequest = await createRequest(left, { code: ownerInvites[1].code });
    const secondRequest = await createRequest(right, { code: ownerInvites[2].code });
    const accepts = await Promise.all([
      owner.client.rpc("accept_connection_request", { p_request_id: firstRequest.id }),
      owner.client.rpc("accept_connection_request", { p_request_id: secondRequest.id }),
    ]);
    assert.equal(accepts.filter((result) => !result.error).length, 1);
    const rejected = accepts.find((result) => result.error);
    assert.equal(rejected.error.code, "PT409");
    assert.equal(rejected.error.message, "active_connection_limit");
    assert.equal(countFor("select count(*) from public.connections where status='active' and :'owner'::uuid in (user_low_id,user_high_id);\n", { owner: owner.id }), "200");
    const expectedConnectionIds = countFor("select id from public.connections where :'owner'::uuid in (user_low_id,user_high_id) order by created_at desc,id desc;\n", { owner: owner.id }).trim().split("\n").filter(Boolean);
    assert.ok(expectedConnectionIds.length >= 200);
    const connectionIds = [];
    let connectionCursor = null;
    do {
      const page = ok(await owner.client.rpc("list_connections", { p_cursor: connectionCursor, p_limit: 50 }));
      connectionIds.push(...page.items.map((item) => item.id));
      connectionCursor = page.next_cursor;
      assert.ok(connectionIds.length <= expectedConnectionIds.length, "connection pagination must not repeat rows");
    } while (connectionCursor);
    assert.deepEqual(connectionIds.sort(), expectedConnectionIds.sort());
    const rejectedId = rejected === accepts[0] ? firstRequest.id : secondRequest.id;
    assert.equal(requestRow(rejectedId).status, "pending");
    const successfulId = rejected === accepts[0] ? secondRequest.id : firstRequest.id;
    assert.equal(ok(await owner.client.rpc("reject_connection_request", { p_request_id: rejectedId })).replayed, false);
    assert.equal(requestRow(successfulId).status, "accepted");
    for (const userId of auxiliary.slice(0, 5)) ok(await owner.client.rpc("create_block", { p_user_id: userId }));
    const expectedBlockIds = countFor("select id from public.blocks where blocker_user_id=:'owner'::uuid and revoked_at is null order by created_at desc,id desc;\n", { owner: owner.id }).trim().split("\n").filter(Boolean);
    assert.equal(expectedBlockIds.length, 5);
    const listedBlockIds = [];
    let blockCursor = null;
    do {
      const page = ok(await owner.client.rpc("list_blocks", { p_cursor: blockCursor, p_limit: 1 }));
      listedBlockIds.push(...page.items.map((item) => item.id));
      blockCursor = page.next_cursor;
      assert.ok(listedBlockIds.length <= expectedBlockIds.length, "block pagination must not repeat rows");
    } while (blockCursor);
    assert.deepEqual(listedBlockIds.sort(), expectedBlockIds.sort());
  });
} catch (error) {
  failed = true;
  failureDetail = String(error?.message ?? error).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uuid]").slice(0, 240);
  cases.push({ name: phase, status: "failed" });
} finally {
  await safeCleanup();
  if (beforeSnapshot) {
    try {
      fixturePreserved = snapshot() === beforeSnapshot && authSessionCount() === beforeSessionCount;
      if (!fixturePreserved) cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
}

const passed = !failed && !cleanupFailed && cases.length === 13;
const report = {
  verified_at: new Date().toISOString(),
  scope: "w06_c1_invites_requests_connections_blocks_and_acceptance_capacity_with_issued_auth_sessions",
  status: passed ? "passed" : "failed",
  executed: cases.length,
  passed: cases.filter((entry) => entry.status === "passed").length,
  cases,
  failure_detail: failureDetail,
  cleanup_passed: !cleanupFailed,
  existing_fixture_data_preserved: fixturePreserved,
  synthetic_probe_accounts_and_sessions_removed: !cleanupFailed,
  sessions_fabricated: false,
  service_role_used_for_app_rpc: false,
  provider_login_tests_executed: 0,
};
fs.mkdirSync(path.join(projectRoot, "tmp"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "tmp/local-connection-tests.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;

function inviteCodeWithSeparators(value) {
  return value.slice(0, 4) + "-" + value.slice(4, 8) + "-" + value.slice(8);
}
