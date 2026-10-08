import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, projectRoot, sql } from "./local-database-tools.mjs";

const cases = [];
const probes = [];
const authRemoved = new Set();
const retainedPraiseReceipts = [];
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
let ledgerGateWasEnabled = false;
let failureTriggerInstalled = false;
const externalLedgerConfigured = false;

const record = async (name, work) => { phase = name; await work(); cases.push({ name, status: "passed" }); };
const ok = (result) => {
  assert.equal(result.error, null, result.error?.message ?? "RPC failed");
  assert.ok(result.data && typeof result.data === "object");
  return result.data;
};
const denied = (result, code, message) => {
  assert.equal(result.data, null);
  assert.equal(result.error?.code, code, result.error?.message ?? "Expected RPC denial");
  if (message) assert.equal(result.error.message, message);
};
function countFor(query, values = {}) { return sql(query, values).trim(); }

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
function authSessionCount() { return Number(sql("select count(*) from auth.sessions;\n").trim()); }

async function createProbe(label, policyVersion) {
  const credentials = {
    email: "probe-" + crypto.randomUUID() + "@account-delete.chagokchan.invalid",
    password: crypto.randomBytes(32).toString("base64url"),
  };
  const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { local_account_deletion_probe: true } });
  if (created.error || !created.data.user) throw new Error("Synthetic probe setup failed.");
  const probe = { id: created.data.user.id, credentials, client: null };
  probes.push(probe);
  sql("insert into public.app_users(id,adult_confirmed_at,registration_policy_version) values (:'actor'::uuid,clock_timestamp(),:'policy');\ninsert into public.profiles(user_id,nickname) values (:'actor'::uuid,:'nickname');\n", {
    actor: probe.id, policy: policyVersion, nickname: label,
  });
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options);
  probe.client = client;
  const signedIn = await client.auth.signInWithPassword(credentials);
  if (signedIn.error || !signedIn.data.session) throw new Error("Synthetic probe session could not be issued.");
  return probe;
}

function sessionIdFor(probe) {
  return sql("select id::text from auth.sessions where user_id=:'actor'::uuid order by created_at desc,id desc limit 1;\n", { actor: probe.id }).trim();
}

function addReauthGrant(probe, { scope = "account.delete", sessionId = null, ageMinutes = 0, expiresInMinutes = 10 } = {}) {
  const currentSessionId = sessionId ?? sessionIdFor(probe);
  const verifiedAt = ageMinutes ? "clock_timestamp()-make_interval(mins=>:'age'::integer)" : "clock_timestamp()";
  const expiresAt = expiresInMinutes < 0 ? "clock_timestamp()-make_interval(mins=>:'expired'::integer)" : "clock_timestamp()+make_interval(mins=>:'ttl'::integer)";
  const values = { actor: probe.id, session: currentSessionId, scope, age: String(ageMinutes), expired: String(Math.abs(expiresInMinutes)), ttl: String(expiresInMinutes) };
  return sql("insert into public.reauth_grants(user_id,session_id,scope,verified_at,expires_at) values (:'actor'::uuid,:'session'::uuid,:'scope'," + verifiedAt + "," + expiresAt + ") returning id::text;\n", values).trim();
}

async function createConnection(owner, peer) {
  const invite = ok(await owner.client.rpc("create_connection_invite"));
  const token = invite.link_path.slice("/connect#invite=".length);
  const request = ok(await peer.client.rpc("create_connection_request", {
    p_request_key: crypto.randomUUID(), p_secret: { link_token: token },
  }));
  ok(await owner.client.rpc("accept_connection_request", { p_request_id: request.id }));
  const row = JSON.parse(sql("select to_jsonb(c) from public.connections c where c.user_low_id=least(:'left'::uuid,:'right'::uuid) and c.user_high_id=greatest(:'left'::uuid,:'right'::uuid);\n", {
    left: owner.id, right: peer.id,
  }));
  return { id: row.id, requestId: request.id };
}

async function createSharedGoal(owner) {
  const created = ok(await owner.client.rpc("create_goal", {
    p_request_key: crypto.randomUUID(), p_title: "계정 삭제 보존 경계", p_personal_target_count: 1,
    p_shared_board: { title: "보존할 공유 목표", target_count: 2 },
  }));
  const boardId = countFor("select id::text from public.boards where goal_id=:'goal'::uuid and kind='shared';\n", { goal: created.id });
  return { id: created.id, boardId };
}

async function submitDeletion(probe, requestKey, reauthGrantId, confirm = true) {
  return probe.client.rpc("request_account_deletion", {
    p_request_key: requestKey, p_reauth_grant_id: reauthGrantId, p_confirm: confirm,
  });
}

async function cleanup() {
  for (const probe of probes) {
    if (!probe.client || authRemoved.has(probe.id)) continue;
    try { if ((await probe.client.auth.signOut({ scope: "local" })).error) cleanupFailed = true; }
    catch { cleanupFailed = true; }
  }
  try {
    if (failureTriggerInstalled) {
      sql("drop trigger if exists w06d_test_fail_account_delete on public.app_users;\ndrop function if exists public.w06d_test_fail_account_delete();\n");
      failureTriggerInstalled = false;
    }
    sql("update private.deletion_worker_config set independent_ledger_enabled=false,updated_at=clock_timestamp() where singleton;\n");
    if (probes.length) {
      const ids = probes.map((probe) => probe.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      const quoted = ids.map((id) => "'" + id + "'").join(",");
      if (quoted) {
        const receiptValues = retainedPraiseReceipts.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).map((id) => "'" + id + "'").join(",");
        sql("delete from public.account_deletion_requests where subject_auth_user_id in (" + quoted + ");\n" +
          "delete from public.notifications where recipient_user_id in (" + quoted + ") or actor_user_id in (" + quoted + ");\n" +
          "delete from public.praises where actor_user_id in (" + quoted + ") or recipient_user_id in (" + quoted + ");\n" +
          "update public.boards set current_bunch_id=null where owner_user_id in (" + quoted + ");\n" +
          "delete from public.bunches where board_id in (select id from public.boards where owner_user_id in (" + quoted + "));\n" +
          "delete from public.shared_board_profiles where board_id in (select id from public.boards where owner_user_id in (" + quoted + "));\n" +
          "delete from public.board_members where user_id in (" + quoted + ") or granted_by_user_id in (" + quoted + ") or board_id in (select id from public.boards where owner_user_id in (" + quoted + "));\n" +
          "delete from public.boards where owner_user_id in (" + quoted + ");\n" +
          "delete from public.goals where owner_user_id in (" + quoted + ");\n" +
          "delete from public.connection_requests where requester_user_id in (" + quoted + ") or approver_user_id in (" + quoted + ") or connection_id in (select id from public.connections where user_low_id in (" + quoted + ") or user_high_id in (" + quoted + "));\n" +
          "delete from public.connection_invites where inviter_user_id in (" + quoted + ") or redeemed_by_user_id in (" + quoted + ");\n" +
          "delete from public.blocks where blocker_user_id in (" + quoted + ") or blocked_user_id in (" + quoted + ");\n" +
          "delete from public.connections where user_low_id in (" + quoted + ") or user_high_id in (" + quoted + ");\n" +
          "delete from public.request_receipts where actor_user_id in (" + quoted + ");\n" +
          (receiptValues ? "delete from public.request_receipts where id in (" + receiptValues + ");\n" : "") +
          "delete from public.audit_events where actor_user_id in (" + quoted + ");\n" +
          "delete from public.rate_usage where actor_user_id in (" + quoted + ");\n" +
          "delete from public.reauth_grants where user_id in (" + quoted + ");\n" +
          "delete from public.profiles where user_id in (" + quoted + ");\n" +
          "delete from public.app_users where id in (" + quoted + ");\n");
      }
    }
    for (let index = probes.length - 1; index >= 0; index--) {
      if (authRemoved.has(probes[index].id)) continue;
      const removed = await admin.auth.admin.deleteUser(probes[index].id);
      if (removed.error) cleanupFailed = true;
    }
  } catch { cleanupFailed = true; }
}

try {
  status = assertLocalDatabase();
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!serviceKey) throw new Error("Local worker key unavailable.");
  admin = createClient(status.API_URL, serviceKey, options);
  const policy = JSON.parse(fs.readFileSync(path.join(projectRoot, "policies/app-policy.json"), "utf8"));
  beforeSnapshot = snapshot();
  beforeSessionCount = authSessionCount();

  const recipient = await createProbe("칭찬 수신 목표 주인", policy.policy_version);
  const author = await createProbe("공유 칭찬 작성자", policy.policy_version);
  await createProbe("무관한 계정", policy.policy_version);
  const relation = await createConnection(recipient, author);
  const goal = await createSharedGoal(recipient);
  ok(await recipient.client.rpc("grant_board_member", { p_board_id: goal.boardId, p_user_id: author.id }));
  const peerPraise = ok(await author.client.rpc("create_peer_praise", {
    p_request_key: crypto.randomUUID(), p_board_id: goal.boardId, p_message: "지워야 할 작성자 문구",
  }));
  const praiseReceipt = countFor("select request_receipt_id::text from public.praises where id=:'praise'::uuid;\n", { praise: peerPraise.id });
  retainedPraiseReceipts.push(praiseReceipt);
  const authorState = JSON.parse(countFor("select to_jsonb(bu) from public.bunches bu where bu.id=:'bunch'::uuid;\n", { bunch: peerPraise.bunch_id }));
  assert.equal(authorState.valid_count, 1);

  let authorRequest;
  let authorValidGrant;
  let ledgerReference;
  await record("foreign_expired_wrong_scope_and_wrong_session_reauth_are_rejected", async () => {
    const foreignGrant = addReauthGrant(recipient);
    const expiredGrant = addReauthGrant(author, { ageMinutes: 11, expiresInMinutes: -1 });
    const wrongSessionGrant = addReauthGrant(author, { sessionId: crypto.randomUUID() });
    const wrongScopeGrant = addReauthGrant(author, { scope: "profile.update" });
    const key = crypto.randomUUID();
    denied(await submitDeletion(author, key, expiredGrant), "PT403", "reauth_required");
    denied(await submitDeletion(author, key, foreignGrant), "PT403", "reauth_required");
    denied(await submitDeletion(author, key, wrongSessionGrant), "PT403", "reauth_required");
    denied(await submitDeletion(author, key, wrongScopeGrant), "PT403", "reauth_required");
    denied(await submitDeletion(author, key, expiredGrant, false), "PT400", "invalid_deletion_confirmation");
    assert.equal(countFor("select account_status from public.app_users where id=:'actor'::uuid;\n", { actor: author.id }), "active");
    assert.equal(countFor("select count(*) from public.account_deletion_requests where subject_auth_user_id=:'actor'::uuid;\n", { actor: author.id }), "0");
    assert.equal(countFor("select count(*) from public.reauth_grants where id in (:'foreign'::uuid,:'expired'::uuid,:'wrong_session'::uuid,:'wrong_scope'::uuid) and consumed_at is not null;\n", {
      foreign: foreignGrant, expired: expiredGrant, wrong_session: wrongSessionGrant, wrong_scope: wrongScopeGrant,
    }), "0");
  });

  await record("valid_same_key_retry_consumes_grant_and_revokes_session_access", async () => {
    authorValidGrant = addReauthGrant(author);
    const key = crypto.randomUUID();
    const accepted = ok(await submitDeletion(author, key, authorValidGrant));
    assert.equal(accepted.status, "pending");
    assert.equal(accepted.access_revoked, true);
    assert.deepEqual(Object.keys(accepted).sort(), ["access_revoked", "id", "status"]);
    authorRequest = accepted.id;
    assert.deepEqual(ok(await submitDeletion(author, key, authorValidGrant)), accepted);
    denied(await submitDeletion(author, key, crypto.randomUUID()), "PT409", "idempotency_conflict");
    denied(await submitDeletion(author, crypto.randomUUID(), authorValidGrant), "PT403", "account_unavailable");
    denied(await author.client.rpc("get_me"), "PT403", "account_unavailable");
    denied(await author.client.rpc("list_notifications"), "PT403", "account_unavailable");
    assert.equal(countFor("select count(*) from public.reauth_grants where id=:'grant'::uuid and consumed_at is not null;\n", { grant: authorValidGrant }), "1");
    assert.equal(countFor("select count(*) from public.account_deletion_requests where id=:'request'::uuid and status='pending' and checkpoint='access_revoked';\n", { request: authorRequest }), "1");
  });

  await record("independent_ledger_gate_and_failure_injection_roll_back_all_erasure", async () => {
    ledgerReference = crypto.randomUUID();
    denied(await admin.rpc("process_account_deletion", { p_request_id: authorRequest, p_ledger_reference: ledgerReference }), "PT503", "deletion_ledger_unavailable");
    assert.equal(countFor("select checkpoint from public.account_deletion_requests where id=:'request'::uuid;\n", { request: authorRequest }), "access_revoked");
    sql("update private.deletion_worker_config set independent_ledger_enabled=true,updated_at=clock_timestamp() where singleton;\n");
    ledgerGateWasEnabled = true;
    const quotedAuthor = "'" + author.id + "'::uuid";
    sql("grant create on schema public to postgres;\ncreate function public.w06d_test_fail_account_delete() returns trigger language plpgsql set search_path=pg_catalog as $$ begin if old.id=" + quotedAuthor + " then raise exception using errcode='PT503',message='forced_test_account_erase_failure'; end if; return old; end $$;\ncreate trigger w06d_test_fail_account_delete before delete on public.app_users for each row execute function public.w06d_test_fail_account_delete();\n");
    failureTriggerInstalled = true;
    denied(await admin.rpc("process_account_deletion", { p_request_id: authorRequest, p_ledger_reference: ledgerReference }), "PT503", "forced_test_account_erase_failure");
    assert.equal(countFor("select count(*) from public.praises where id=:'praise'::uuid and actor_user_id=:'author'::uuid and message='지워야 할 작성자 문구';\n", { praise: peerPraise.id, author: author.id }), "1");
    assert.equal(countFor("select count(*) from public.request_receipts where id=:'receipt'::uuid and actor_user_id=:'author'::uuid and input_hash is not null and erased_at is null;\n", { receipt: praiseReceipt, author: author.id }), "1");
    assert.equal(countFor("select count(*) from public.connections where id=:'connection'::uuid;\n", { connection: relation.id }), "1");
    assert.equal(countFor("select count(*) from public.account_deletion_requests where id=:'request'::uuid and status='pending' and checkpoint='access_revoked' and ledger_reference is null;\n", { request: authorRequest }), "1");
    sql("drop trigger w06d_test_fail_account_delete on public.app_users;\ndrop function public.w06d_test_fail_account_delete();\nrevoke create on schema public from postgres;\n");
    failureTriggerInstalled = false;
  });

  await record("author_erasure_preserves_valid_event_and_erases_actor_receipt", async () => {
    const processed = ok(await admin.rpc("process_account_deletion", { p_request_id: authorRequest, p_ledger_reference: ledgerReference }));
    assert.equal(processed.checkpoint, "app_data_erased");
    assert.equal(countFor("select count(*) from public.app_users where id=:'author'::uuid;\n", { author: author.id }), "0");
    assert.equal(countFor("select count(*) from public.praises where id=:'praise'::uuid and actor_user_id is null and author_erased_at is not null and message is null and occurred_on is null;\n", { praise: peerPraise.id }), "1");
    assert.equal(countFor("select count(*) from public.bunches where id=:'bunch'::uuid and valid_count=1 and progress_state='incomplete';\n", { bunch: peerPraise.bunch_id }), "1");
    assert.equal(countFor("select count(*) from public.request_receipts where id=:'receipt'::uuid and actor_user_id is null and input_hash is null and erased_at is not null;\n", { receipt: praiseReceipt }), "1");
    assert.equal(countFor("select count(*) from public.notifications where recipient_user_id=:'recipient'::uuid and praise_id=:'praise'::uuid and actor_user_id is null;\n", { recipient: recipient.id, praise: peerPraise.id }), "1");
    const ownerView = ok(await recipient.client.rpc("get_board", { p_board_id: goal.boardId }));
    assert.equal(ownerView.current_bunch.valid_count, 1);
    const praises = ok(await recipient.client.rpc("list_board_praises", { p_board_id: goal.boardId }));
    assert.equal(praises.items[0].actor_label, "삭제된 사용자");
    assert.equal(praises.items[0].message, null);
    const notices = ok(await recipient.client.rpc("list_notifications", { p_limit: 20 }));
    assert.ok(notices.items.some((item) => item.type === "praise_received" && item.target.id === peerPraise.id));
    assert.equal(countFor("select status||':'||checkpoint||':'||coalesce(user_id::text,'null') from public.account_deletion_requests where id=:'request'::uuid;\n", { request: authorRequest }), "running:app_data_erased:null");
  });

  await record("author_auth_deletion_failure_checkpoint_retry_and_final_rejoin_block", async () => {
    denied(await admin.rpc("complete_account_deletion", { p_request_id: authorRequest }), "PT409", "auth_identity_still_present");
    assert.equal(ok(await admin.rpc("fail_account_deletion", { p_request_id: authorRequest, p_error_code: "auth_user_delete_failed" })).status, "failed");
    const replay = ok(await admin.rpc("process_account_deletion", { p_request_id: authorRequest, p_ledger_reference: ledgerReference }));
    assert.equal(replay.checkpoint, "app_data_erased");
    assert.equal(countFor("select status||':'||checkpoint from public.account_deletion_requests where id=:'request'::uuid;\n", { request: authorRequest }), "running:app_data_erased");
    const removed = await admin.auth.admin.deleteUser(author.id);
    assert.equal(removed.error, null, removed.error?.message ?? "Local Auth user delete failed");
    authRemoved.add(author.id);
    assert.equal(ok(await admin.rpc("complete_account_deletion", { p_request_id: authorRequest })).status, "completed");
    assert.equal(countFor("select status||':'||checkpoint||':'||(completed_at is not null)::text||':'||coalesce(user_id::text,'null') from public.account_deletion_requests where id=:'request'::uuid;\n", { request: authorRequest }), "completed:auth_removed:true:null");
    denied(await author.client.rpc("get_me"), "PT401", "unauthenticated");
    assert.equal(countFor("select count(*) from public.account_deletion_requests where subject_auth_user_id=:'subject'::uuid;\n", { subject: author.id }), "1");
    sql("do $$ begin insert into public.app_users(id,adult_confirmed_at,registration_policy_version) values (" + "'" + author.id + "'::uuid,clock_timestamp(),'0.2.0'); raise exception 'rejoin_guard_missing'; exception when sqlstate 'PT403' then null; end $$;\n");
  });

  await record("recipient_erasure_removes_owned_goal_received_rows_and_relationships", async () => {
    const recipientGrant = addReauthGrant(recipient);
    const accepted = ok(await submitDeletion(recipient, crypto.randomUUID(), recipientGrant));
    assert.equal(accepted.status, "pending");
    denied(await recipient.client.rpc("get_me"), "PT403", "account_unavailable");
    const recipientLedger = crypto.randomUUID();
    ok(await admin.rpc("process_account_deletion", { p_request_id: accepted.id, p_ledger_reference: recipientLedger }));
    assert.equal(countFor("select count(*) from public.app_users where id=:'recipient'::uuid;\n", { recipient: recipient.id }), "0");
    assert.equal(countFor("select count(*) from public.goals where id=:'goal'::uuid;\n", { goal: goal.id }), "0");
    assert.equal(countFor("select count(*) from public.boards where id=:'board'::uuid;\n", { board: goal.boardId }), "0");
    assert.equal(countFor("select count(*) from public.praises where recipient_user_id=:'recipient'::uuid;\n", { recipient: recipient.id }), "0");
    assert.equal(countFor("select count(*) from public.notifications where recipient_user_id=:'recipient'::uuid;\n", { recipient: recipient.id }), "0");
    assert.equal(countFor("select count(*) from public.connections where id=:'connection'::uuid;\n", { connection: relation.id }), "0");
    assert.equal(countFor("select count(*) from public.profiles where user_id=:'recipient'::uuid;\n", { recipient: recipient.id }), "0");
    const removed = await admin.auth.admin.deleteUser(recipient.id);
    assert.equal(removed.error, null, removed.error?.message ?? "Local Auth recipient delete failed");
    authRemoved.add(recipient.id);
    assert.equal(ok(await admin.rpc("complete_account_deletion", { p_request_id: accepted.id })).status, "completed");
  });
} catch (error) {
  failed = true;
  failureDetail = (phase + ": " + String(error?.message ?? error)).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uuid]").slice(0, 260);
  cases.push({ name: phase, status: "failed" });
} finally {
  await cleanup();
  if (beforeSnapshot) {
    try {
      fixturePreserved = snapshot() === beforeSnapshot && authSessionCount() === beforeSessionCount;
      if (!fixturePreserved) cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
}

const passed = !failed && !cleanupFailed && cases.length === 6;
const report = {
  verified_at: new Date().toISOString(), work_item: "W06-D2",
  scope: "session_bound_reauth_account_deletion_access_revocation_author_erasure_recipient_erasure_retry_and_auth_finalization",
  status: passed ? "passed" : "failed", executed: cases.length,
  passed: cases.filter((entry) => entry.status === "passed").length, cases,
  failure_detail: failureDetail, cleanup_passed: !cleanupFailed, existing_fixture_data_preserved: fixturePreserved,
  synthetic_probe_accounts_and_sessions_removed: !cleanupFailed, sessions_fabricated: false,
  service_role_used_for_user_scoped_app_rpc: false, service_role_used_for_deletion_worker_rpc: true,
  external_deletion_ledger_configured: externalLedgerConfigured,
  external_ledger_gate_simulated_in_local_database: ledgerGateWasEnabled,
  synthetic_local_auth_admin_deletion_executed: authRemoved.size,
  reauth_grants_seeded_for_local_policy_tests: true,
  google_or_otp_login_tests_executed: 0,
};
fs.mkdirSync(path.join(projectRoot, "tmp"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "tmp/local-account-deletion-tests.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;
