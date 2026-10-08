import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, projectRoot, sql } from "./local-database-tools.mjs";

// Developer-only tests issue real local Auth sessions; the admin client is limited to probe setup/cleanup.
const cases = [];
const clients = [];
const probes = [];
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }) },
};
let phase = "local_environment";
let failed = false;
let cleanupFailed = false;
let appDataPreserved = false;
let failureDetail = null;
let beforeSnapshot;
let beforeSessionCount;
let admin;
let status;
const record = async (name, work) => {
  phase = name;
  await work();
  cases.push({ name, status: "passed" });
};
const denied = (result, code, message) => {
  assert.equal(result.data, null);
  assert.equal(result.error?.code, code);
  if (message) assert.equal(result.error.message, message);
};
function snapshot() {
  const tables = sql("select tablename from pg_tables where schemaname='public' and tablename <> 'spatial_ref_sys' order by tablename;\n").trim().split("\n").filter(Boolean);
  assert.equal(tables.length, 18);
  const hash = crypto.createHash("sha256");
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected app table.");
    hash.update(table + "\0" + sql("select coalesce(jsonb_agg(row_value order by row_value::text),'[]'::jsonb) from (select to_jsonb(t) row_value from public." + table + " t) rows;\n"));
  }
  return hash.digest("hex");
}
function sessionCount() {
  return Number(sql("select count(*) from auth.sessions;\n").trim());
}
async function createProbe(adminClient, label, policyVersion) {
  const credentials = {
    email: label + "-" + crypto.randomUUID() + "@goal-rpc.chagokchan.invalid",
    password: crypto.randomBytes(32).toString("base64url"),
  };
  const created = await adminClient.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { local_goal_rpc_probe: true } });
  if (created.error || !created.data.user) throw new Error("Synthetic probe setup failed.");
  const probe = { id: created.data.user.id, credentials, client: null };
  probes.push(probe);
  sql("insert into public.app_users(id, adult_confirmed_at, registration_policy_version) values (:'actor'::uuid, clock_timestamp(), :'policy');\ninsert into public.profiles(user_id) values (:'actor'::uuid);\n", {
    actor: probe.id, policy: policyVersion,
  });
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options);
  clients.push(client);
  probe.client = client;
  const session = await client.auth.signInWithPassword(credentials);
  if (session.error || !session.data.session) throw new Error("Synthetic probe session could not be issued.");
  return probe;
}
function rpcResult(result) {
  assert.equal(result.error, null, result.error?.message ?? "RPC failed");
  assert.equal(typeof result.data.id, "string");
  assert.equal(typeof result.data.replayed, "boolean");
  return result.data;
}

try {
  status = assertLocalDatabase();
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!serviceKey) throw new Error("Local setup key unavailable.");
  const adminOptions = { ...options, auth: { ...options.auth, autoRefreshToken: false } };
  admin = createClient(status.API_URL, serviceKey, adminOptions);
  const policy = JSON.parse(fs.readFileSync(path.join(projectRoot, "policies/app-policy.json"), "utf8"));
  const contract = JSON.parse(fs.readFileSync(path.join(projectRoot, "contracts/openapi.json"), "utf8"));
  beforeSnapshot = snapshot();
  beforeSessionCount = sessionCount();
  const owner = await createProbe(admin, "owner", policy.policy_version);
  const outsider = await createProbe(admin, "outsider", policy.policy_version);
  const requestKey = crypto.randomUUID();
  const input = {
    p_request_key: requestKey,
    p_title: "  목표 A  ",
    p_private_description: "private\r\nnote",
    p_personal_target_count: 7,
    p_shared_board: { title: "공개 제목", description: "공개 설명", target_count: 10 },
  };
  let goalId;

  await record("owner_create_goal_result", async () => {
    const created = rpcResult(await owner.client.rpc("create_goal", input));
    goalId = created.id;
    assert.equal(created.replayed, false);
    assert.match(goalId, /^[0-9a-f-]{36}$/i);
  });
  await record("goal_and_explicit_boards_atomic_shape", async () => {
    assert.equal(sql("select count(*) from public.goals where id=:'goal'::uuid and owner_user_id=:'actor'::uuid and title='목표 A' and private_description=E'private\\nnote';\n", { goal: goalId, actor: owner.id }).trim(), "1");
    assert.equal(sql("select string_agg(kind||':'||next_target_count, ',' order by kind) from public.boards where goal_id=:'goal'::uuid;\n", { goal: goalId }).trim(), "personal:7,shared:10");
    assert.equal(sql("select count(*) from public.shared_board_profiles sp join public.boards b on b.id=sp.board_id where b.goal_id=:'goal'::uuid and sp.public_title='공개 제목' and sp.public_description='공개 설명';\n", { goal: goalId }).trim(), "1");
    assert.equal(sql("select count(*) from public.bunches bu join public.boards b on b.id=bu.board_id where b.goal_id=:'goal'::uuid;\n", { goal: goalId }).trim(), "0");
  });
  await record("identical_goal_request_replay", async () => {
    const replay = rpcResult(await owner.client.rpc("create_goal", input));
    assert.equal(replay.id, goalId);
    assert.equal(replay.replayed, true);
    assert.equal(sql("select count(*) from public.goals where owner_user_id=:'actor'::uuid;\n", { actor: owner.id }).trim(), "1");
  });
  await record("goal_idempotency_input_conflict", async () => {
    const conflict = await owner.client.rpc("create_goal", { ...input, p_title: "다른 입력" });
    denied(conflict, "PT409", "idempotency_conflict");
    assert.equal(sql("select count(*) from public.goals where owner_user_id=:'actor'::uuid;\n", { actor: owner.id }).trim(), "1");
  });
  await record("goal_detail_matches_owner_contract", async () => {
    const detail = await owner.client.rpc("get_goal", { p_goal_id: goalId });
    assert.equal(detail.error, null);
    assert.deepEqual(Object.keys(detail.data).sort(), contract.components.schemas.GoalDetail.required.slice().sort());
    assert.deepEqual(Object.keys(detail.data.goal).sort(), contract.components.schemas.Goal.required.slice().sort());
    assert.deepEqual(Object.keys(detail.data.boards[0]).sort(), contract.components.schemas.OwnerBoard.required.slice().sort());
    assert.equal(detail.data.goal.title, "목표 A");
    assert.equal(detail.data.boards.length, 2);
    assert.equal(detail.data.boards[0].viewer_role, "owner");
    assert.equal(detail.data.boards[0].current_bunch, null);
  });
  await record("foreign_owner_goal_is_not_disclosed", async () => {
    denied(await outsider.client.rpc("get_goal", { p_goal_id: goalId }), "PT404", "goal_not_found");
  });
  await record("invalid_goal_rolls_back", async () => {
    denied(await owner.client.rpc("create_goal", { ...input, p_request_key: crypto.randomUUID(), p_title: " " }), "PT400", "invalid_goal_input");
    assert.equal(sql("select count(*) from public.goals where owner_user_id=:'actor'::uuid;\n", { actor: owner.id }).trim(), "1");
  });
  await record("revision_checked_owner_update", async () => {
    const updated = rpcResult(await owner.client.rpc("update_goal", {
      p_goal_id: goalId, p_expected_revision: 1, p_title: "목표 수정", p_update_title: true,
    }));
    assert.equal(updated.replayed, false);
    const detail = await owner.client.rpc("get_goal", { p_goal_id: goalId });
    assert.equal(detail.data.goal.title, "목표 수정");
    assert.equal(detail.data.goal.revision, 2);
    denied(await owner.client.rpc("update_goal", { p_goal_id: goalId, p_expected_revision: 1, p_title: "오래된 변경", p_update_title: true }), "PT409", "revision_conflict");
  });
  await record("goal_complete_archive_resume_state_machine", async () => {
    assert.equal(rpcResult(await owner.client.rpc("complete_goal", { p_goal_id: goalId, p_expected_revision: 2 })).replayed, false);
    assert.equal(rpcResult(await owner.client.rpc("complete_goal", { p_goal_id: goalId, p_expected_revision: 2 })).replayed, true);
    let detail = await owner.client.rpc("get_goal", { p_goal_id: goalId });
    assert.equal(detail.data.goal.status, "completed");
    assert.ok(detail.data.goal.completed_at);
    assert.equal(detail.data.goal.revision, 3);
    assert.equal(rpcResult(await owner.client.rpc("archive_goal", { p_goal_id: goalId, p_expected_revision: 3 })).replayed, false);
    detail = await owner.client.rpc("get_goal", { p_goal_id: goalId });
    assert.equal(detail.data.goal.status, "archived");
    assert.ok(detail.data.goal.archived_at);
    assert.ok(detail.data.goal.completed_at);
    assert.equal(rpcResult(await owner.client.rpc("resume_goal", { p_goal_id: goalId, p_expected_revision: 4 })).replayed, false);
    detail = await owner.client.rpc("get_goal", { p_goal_id: goalId });
    assert.equal(detail.data.goal.status, "active");
    assert.equal(detail.data.goal.revision, 5);
    assert.equal(detail.data.goal.archived_at, null);
    assert.equal(detail.data.goal.completed_at, null);
    assert.equal(rpcResult(await owner.client.rpc("resume_goal", { p_goal_id: goalId, p_expected_revision: 1 })).replayed, true);
    denied(await owner.client.rpc("complete_goal", { p_goal_id: goalId, p_expected_revision: 1 }), "PT409", "revision_conflict");
  });
  await record("concurrent_duplicate_goal_requests_are_idempotent", async () => {
    const duplicateInput = { ...input, p_request_key: crypto.randomUUID(), p_title: "병렬 재시도", p_shared_board: null };
    const results = await Promise.all(Array.from({ length: 10 }, () => owner.client.rpc("create_goal", duplicateInput)));
    for (const result of results) assert.equal(result.error, null, result.error?.message ?? "Concurrent request failed");
    assert.equal(new Set(results.map((result) => result.data.id)).size, 1);
    assert.equal(results.filter((result) => result.data.replayed === false).length, 1);
    assert.equal(sql("select count(*) from public.request_receipts where actor_user_id=:'actor'::uuid and operation='createGoal' and request_key=:'key'::uuid;\n", {
      actor: owner.id, key: duplicateInput.p_request_key,
    }).trim(), "1");
    assert.equal(sql("select count(*) from public.goals where id=:'goal'::uuid;\n", { goal: results[0].data.id }).trim(), "1");
  });
  await record("active_goal_limit_is_serialized", async () => {
    sql("with added as (insert into public.goals(owner_user_id,title) select :'actor'::uuid,'capacity fixture '||n from generate_series(1,17) n returning id,owner_user_id) insert into public.boards(goal_id,owner_user_id,kind) select id,owner_user_id,'personal' from added;\n", { actor: owner.id });
    assert.equal(sql("select count(*) from public.goals where owner_user_id=:'actor'::uuid and status='active';\n", { actor: owner.id }).trim(), "19");
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => owner.client.rpc("create_goal", {
      p_request_key: crypto.randomUUID(), p_title: "경합 목표 " + index, p_personal_target_count: 20,
    })));
    assert.equal(results.filter((result) => result.error === null).length, 1);
    for (const result of results.filter((entry) => entry.error)) denied(result, "PT409", "active_goal_limit");
    assert.equal(sql("select count(*) from public.goals where owner_user_id=:'actor'::uuid and status='active';\n", { actor: owner.id }).trim(), "20");
    assert.equal(sql("select count(*) from public.boards b join public.goals g on g.id=b.goal_id where g.owner_user_id=:'actor'::uuid and b.kind='personal';\n", { actor: owner.id }).trim(), "20");
  });
  await record("direct_goal_access_stays_denied", async () => {
    const direct = await owner.client.from("goals").select("id").limit(1);
    denied(direct, "42501");
  });
} catch (error) {
  failed = true;
  failureDetail = String(error?.message ?? error).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uuid]").slice(0, 240);
  cases.push({ name: phase, status: "failed" });
} finally {
  for (const client of clients) {
    try { if ((await client.auth.signOut({ scope: "local" })).error) cleanupFailed = true; }
    catch { cleanupFailed = true; }
  }
  for (const probe of probes) {
    try {
      sql("delete from public.request_receipts where actor_user_id=:'actor'::uuid;\ndelete from public.shared_board_profiles where board_id in (select id from public.boards where owner_user_id=:'actor'::uuid);\ndelete from public.boards where owner_user_id=:'actor'::uuid;\ndelete from public.goals where owner_user_id=:'actor'::uuid;\ndelete from public.profiles where user_id=:'actor'::uuid;\ndelete from public.app_users where id=:'actor'::uuid;\n", { actor: probe.id });
      const removed = await admin.auth.admin.deleteUser(probe.id);
      if (removed.error || sql("select count(*) from auth.sessions where user_id=:'actor'::uuid;\n", { actor: probe.id }).trim() !== "0") cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
  if (beforeSnapshot) {
    try {
      appDataPreserved = snapshot() === beforeSnapshot && sessionCount() === beforeSessionCount;
      if (!appDataPreserved) cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
}

const passed = !failed && !cleanupFailed && cases.length === 12;
const report = {
  verified_at: new Date().toISOString(), scope: "w06_b1_goal_rpc_with_locally_issued_auth_sessions",
  status: passed ? "passed" : "failed", executed: cases.length,
  passed: cases.filter((entry) => entry.status === "passed").length, cases,
  failure_detail: failureDetail,
  cleanup_passed: !cleanupFailed, app_fixture_data_preserved: appDataPreserved,
  synthetic_probe_accounts_removed: !cleanupFailed, session_tokens_fabricated: false,
  service_role_used_for_app_rpc: false, provider_login_tests_executed: 0,
};
fs.mkdirSync(path.join(projectRoot, "tmp"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "tmp/local-goal-rpc-tests.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;
