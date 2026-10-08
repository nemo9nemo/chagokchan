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
let ledgerGateWasEnabled = false;

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
    email: "probe-" + crypto.randomUUID() + "@lifecycle.chagokchan.invalid",
    password: crypto.randomBytes(32).toString("base64url"),
  };
  const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { local_lifecycle_probe: true } });
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

async function connect(owner, peer) {
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
    p_request_key: crypto.randomUUID(), p_title: "소식과 삭제 경계", p_personal_target_count: 1,
    p_shared_board: { title: "공유 대상", target_count: 3 },
  }));
  const boardId = sql("select id::text from public.boards where goal_id=:'goal'::uuid and kind='shared';\n", { goal: created.id }).trim();
  return { id: created.id, boardId };
}

function invoke(client, name, args) { return client.rpc(name, args); }

async function cleanup() {
  for (const client of clients) {
    try { if ((await client.auth.signOut({ scope: "local" })).error) cleanupFailed = true; }
    catch { cleanupFailed = true; }
  }
  try {
    sql("update private.deletion_worker_config set independent_ledger_enabled=false,updated_at=clock_timestamp() where singleton;\n");
    if (probes.length) {
      const ids = probes.map((probe) => probe.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      const quoted = ids.map((id) => "'" + id + "'").join(",");
      if (quoted) {
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
          "delete from public.audit_events where actor_user_id in (" + quoted + ");\n" +
          "delete from public.rate_usage where actor_user_id in (" + quoted + ");\n" +
          "delete from public.reauth_grants where user_id in (" + quoted + ");\n" +
          "delete from public.profiles where user_id in (" + quoted + ");\n" +
          "delete from public.app_users where id in (" + quoted + ");\n");
      }
    }
    for (let index = probes.length - 1; index >= 0; index--) {
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

  const owner = await createProbe("소식 수신자", policy.policy_version);
  const peer = await createProbe("칭찬 작성자", policy.policy_version);
  const outsider = await createProbe("무관한 사용자", policy.policy_version);
  const relation = await connect(owner, peer);
  const goal = await createSharedGoal(owner);
  ok(await owner.client.rpc("grant_board_member", { p_board_id: goal.boardId, p_user_id: peer.id }));
  const sentPraiseIds = [];
  let bunchId;
  for (let index = 0; index < 3; index++) {
    const created = ok(await peer.client.rpc("create_peer_praise", {
      p_request_key: crypto.randomUUID(), p_board_id: goal.boardId, p_message: "공유 칭찬 " + index,
    }));
    sentPraiseIds.push(created.id);
    bunchId = created.bunch_id;
  }

  let peerNoticeId;
  await record("recipient_scoped_minimal_notifications_cursor_and_read_retry", async () => {
    const expectedPraiseIds = new Set(sentPraiseIds);
    const pages = [];
    let cursor = null;
    for (let index = 0; index < 8; index++) {
      const page = ok(await owner.client.rpc("list_notifications", { p_cursor: cursor, p_limit: 2 }));
      pages.push(...page.items);
      cursor = page.next_cursor;
      if (!cursor) break;
    }
    assert.equal(cursor, null, "notification cursor should terminate within the fixture page bound");
    const notificationIds = pages.map((item) => item.id);
    assert.equal(new Set(notificationIds).size, notificationIds.length, "notification pages must not repeat a row");
    assert.equal(pages.filter((item) => item.type === "praise_received").length, 3);
    assert.equal(pages.filter((item) => item.type === "bunch_completed").length, 1);
    assert.ok(pages.some((item) => item.type === "connection_requested" && item.target.id === relation.requestId));
    for (const item of pages) {
      assert.deepEqual(Object.keys(item).sort(), ["created_at", "id", "read_at", "target", "type"]);
      assert.deepEqual(Object.keys(item.target).sort(), ["id", "kind"]);
    }
    const praiseItems = pages.filter((item) => item.type === "praise_received");
    assert.deepEqual(new Set(praiseItems.map((item) => item.target.id)), expectedPraiseIds);
    peerNoticeId = praiseItems[0].id;
    denied(await peer.client.rpc("mark_notification_read", { p_notification_id: peerNoticeId }), "PT404", "notification_not_found");
    denied(await outsider.client.rpc("mark_notification_read", { p_notification_id: peerNoticeId }), "PT404", "notification_not_found");
    assert.equal(ok(await owner.client.rpc("mark_notification_read", { p_notification_id: peerNoticeId })).replayed, false);
    assert.equal(ok(await owner.client.rpc("mark_notification_read", { p_notification_id: peerNoticeId })).replayed, true);
    denied(await outsider.client.from("notifications").select("id").limit(1), "42501");
  });

  await record("sent_praise_cursor_survives_disconnect_and_hides_goal_state", async () => {
    const first = ok(await peer.client.rpc("list_sent_praises", { p_limit: 1 }));
    assert.equal(first.items.length, 1);
    assert.ok(first.next_cursor);
    const found = first.items.concat(ok(await peer.client.rpc("list_sent_praises", { p_cursor: first.next_cursor, p_limit: 2 })).items);
    assert.deepEqual(new Set(found.map((item) => item.id)), new Set(sentPraiseIds));
    for (const item of found) {
      assert.deepEqual(Object.keys(item).sort(), ["can_cancel", "cancelled_at", "id", "message", "recorded_at", "source"]);
      assert.equal(item.source, "peer");
      assert.equal(item.can_cancel, true);
    }
    assert.equal(ok(await owner.client.rpc("disconnect", { p_connection_id: relation.id })).replayed, false);
    const afterDisconnect = ok(await peer.client.rpc("list_sent_praises", { p_limit: 50 }));
    assert.deepEqual(new Set(afterDisconnect.items.map((item) => item.id)), new Set(sentPraiseIds));
    denied(await peer.client.from("praises").select("id").limit(1), "42501");
  });

  await record("soft_delete_trash_restore_and_membership_revoke", async () => {
    assert.equal(ok(await owner.client.rpc("delete_goal", { p_goal_id: goal.id, p_expected_revision: 1 })).replayed, false);
    denied(await owner.client.rpc("get_goal", { p_goal_id: goal.id }), "PT404", "goal_not_found");
    denied(await peer.client.rpc("get_board", { p_board_id: goal.boardId }), "PT404", "board_not_found");
    denied(await peer.client.rpc("create_peer_praise", { p_request_key: crypto.randomUUID(), p_board_id: goal.boardId }), "PT404", "board_not_found");
    const trash = ok(await owner.client.rpc("list_trash_goals", { p_limit: 1 }));
    const row = trash.items.find((item) => item.id === goal.id);
    assert.ok(row);
    assert.deepEqual(Object.keys(row).sort(), ["deleted_at", "id", "purge_after", "revision", "title"]);
    assert.equal(row.revision, 2);
    assert.ok(new Date(row.purge_after).getTime() > Date.now() + 29 * 86400000);
    assert.equal(countFor("select count(*) from public.board_members where board_id=:'board'::uuid and user_id=:'peer'::uuid and status='revoked';\n", { board: goal.boardId, peer: peer.id }), "1");
    const hiddenSent = ok(await peer.client.rpc("list_sent_praises", { p_limit: 50 }));
    assert.equal(hiddenSent.items.length, 0, "deleted goal should hide its sent entries");
    assert.equal(ok(await owner.client.rpc("restore_goal", { p_goal_id: goal.id, p_expected_revision: 2 })).replayed, false);
    const restored = ok(await owner.client.rpc("get_goal", { p_goal_id: goal.id }));
    assert.equal(restored.goal.status, "archived");
    assert.equal(restored.goal.revision, 3);
    denied(await peer.client.rpc("get_board", { p_board_id: goal.boardId }), "PT404", "board_not_found");
    assert.equal(countFor("select count(*) from public.board_members where board_id=:'board'::uuid and user_id=:'peer'::uuid and status='active';\n", { board: goal.boardId, peer: peer.id }), "0");
    denied(await owner.client.rpc("restore_goal", { p_goal_id: goal.id, p_expected_revision: 3 }), "PT409", "goal_not_deleted");
  });

  await record("purge_requires_ledger_gate_and_cleans_fk_dependents", async () => {
    assert.equal(ok(await owner.client.rpc("delete_goal", { p_goal_id: goal.id, p_expected_revision: 3 })).replayed, false);
    sql("update public.goals set deleted_at=clock_timestamp()-interval '31 days',purge_after=clock_timestamp()-interval '1 day' where id=:'goal'::uuid;\n", { goal: goal.id });
    denied(await invoke(admin, "purge_expired_goals", { p_batch_size: 10, p_ledger_reference: crypto.randomUUID() }), "PT503", "deletion_ledger_unavailable");
    assert.equal(countFor("select count(*) from public.goals where id=:'goal'::uuid and status='deleted';\n", { goal: goal.id }), "1");
    sql("update private.deletion_worker_config set independent_ledger_enabled=true,updated_at=clock_timestamp() where singleton;\n");
    ledgerGateWasEnabled = true;
    const purged = ok(await invoke(admin, "purge_expired_goals", { p_batch_size: 10, p_ledger_reference: crypto.randomUUID() }));
    assert.equal(purged.purged_count, 1);
    assert.equal(countFor("select count(*) from public.goals where id=:'goal'::uuid;\n", { goal: goal.id }), "0");
    assert.equal(countFor("select count(*) from public.boards where goal_id=:'goal'::uuid;\n", { goal: goal.id }), "0");
    assert.equal(countFor("select count(*) from public.praises where id in (" + sentPraiseIds.map((id) => "'" + id + "'::uuid").join(",") + ");\n"), "0");
    assert.equal(countFor("select count(*) from public.bunches where id=:'bunch'::uuid;\n", { bunch: bunchId }), "0");
    assert.equal(countFor("select count(*) from public.notifications where praise_id in (" + sentPraiseIds.map((id) => "'" + id + "'::uuid").join(",") + ") or bunch_id=:'bunch'::uuid;\n", { bunch: bunchId }), "0");
  });
} catch (error) {
  failed = true;
  failureDetail = (phase + ": " + String(error?.message ?? error)).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uuid]").slice(0, 240);
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

const passed = !failed && !cleanupFailed && cases.length === 4;
const report = {
  verified_at: new Date().toISOString(), work_item: "W06-D1",
  scope: "recipient_scoped_news_sent_peer_praise_goal_trash_restore_and_ledger_gated_purge",
  status: passed ? "passed" : "failed", executed: cases.length,
  passed: cases.filter((entry) => entry.status === "passed").length, cases,
  failure_detail: failureDetail, cleanup_passed: !cleanupFailed, existing_fixture_data_preserved: fixturePreserved,
  synthetic_probe_accounts_and_sessions_removed: !cleanupFailed, sessions_fabricated: false,
  service_role_used_for_user_scoped_app_rpc: false,
  service_role_used_for_worker_rpc: true,
  external_deletion_ledger_configured: false,
  external_ledger_gate_simulated_in_local_database: ledgerGateWasEnabled,
  google_or_otp_login_tests_executed: 0,
};
fs.mkdirSync(path.join(projectRoot, "tmp"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "tmp/local-lifecycle-tests.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;
