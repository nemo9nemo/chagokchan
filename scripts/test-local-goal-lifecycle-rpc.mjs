import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, projectRoot, sql } from "./local-database-tools.mjs";

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
let fixtureDataPreserved = false;
let failureDetail = null;
let beforeSnapshot;
let beforeSessionCount;
let admin;
let status;
let goal;
let alternateBoardId;
let bunchIds = [];

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
    email: `${label}-${crypto.randomUUID()}@goal-lifecycle.chagokchan.invalid`,
    password: crypto.randomBytes(32).toString("base64url"),
  };
  const created = await adminClient.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { local_goal_lifecycle_probe: true } });
  if (created.error || !created.data.user) throw new Error("Synthetic goal lifecycle probe setup failed.");
  const probe = { id: created.data.user.id, credentials, client: null };
  probes.push(probe);
  sql("insert into public.app_users(id, adult_confirmed_at, registration_policy_version) values (:'actor'::uuid, clock_timestamp(), :'policy');\ninsert into public.profiles(user_id) values (:'actor'::uuid);\n", {
    actor: probe.id, policy: policyVersion,
  });
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options);
  clients.push(client);
  probe.client = client;
  const session = await client.auth.signInWithPassword(credentials);
  if (session.error || !session.data.session) throw new Error("Synthetic goal lifecycle probe session could not be issued.");
  return probe;
}

function rpcData(result) {
  assert.equal(result.error, null, result.error?.message ?? "Goal lifecycle RPC failed");
  return result.data;
}

function denied(result, code, message) {
  assert.equal(result.data, null);
  assert.equal(result.error?.code, code);
  if (message) assert.equal(result.error.message, message);
}

async function record(name, work) {
  phase = name;
  await work();
  cases.push({ name, status: "passed" });
}

async function createGoal(owner, title) {
  const created = rpcData(await owner.client.rpc("create_goal", {
    p_request_key: crypto.randomUUID(), p_title: title, p_personal_target_count: 1,
  }));
  assert.equal(created.replayed, false);
  const boardId = sql("select id from public.boards where goal_id=:'goal'::uuid and owner_user_id=:'actor'::uuid and kind='personal';\n", {
    goal: created.id, actor: owner.id,
  }).trim();
  assert.match(boardId, /^[0-9a-f-]{36}$/i);
  return { id: created.id, boardId };
}

async function addPraise(owner, boardId) {
  const result = rpcData(await owner.client.rpc("create_praise", {
    p_request_key: crypto.randomUUID(), p_board_id: boardId, p_message: null, p_occurred_on: null,
  }));
  assert.equal(result.replayed, false);
  return result.id;
}

try {
  status = assertLocalDatabase();
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!serviceKey) throw new Error("Local setup key unavailable.");
  admin = createClient(status.API_URL, serviceKey, options);
  const policy = JSON.parse(fs.readFileSync(path.join(projectRoot, "policies/app-policy.json"), "utf8"));
  beforeSnapshot = snapshot();
  beforeSessionCount = sessionCount();
  const owner = await createProbe(admin, "owner", policy.policy_version);
  const outsider = await createProbe(admin, "outsider", policy.policy_version);

  await record("goal_and_board_targets_start_from_the_policy_values", async () => {
    goal = await createGoal(owner, "회차 설정 probe");
    const otherGoal = await createGoal(owner, "cursor 결합 probe");
    alternateBoardId = otherGoal.boardId;
    const detail = rpcData(await owner.client.rpc("get_goal", { p_goal_id: goal.id }));
    assert.equal(detail.goal.status, "active");
    assert.equal(detail.boards[0].next_target_count, 1);
    assert.equal(detail.boards[0].current_bunch, null);
  });

  await record("board_settings_change_only_future_bunch_snapshots", async () => {
    const changed = rpcData(await owner.client.rpc("update_board", {
      p_board_id: goal.boardId, p_patch: { expected_revision: 1, next_target_count: 2 },
    }));
    assert.equal(changed.replayed, false);
    denied(await owner.client.rpc("update_board", {
      p_board_id: goal.boardId, p_patch: { expected_revision: 1, next_target_count: 3 },
    }), "PT409", "revision_conflict");
    const detail = rpcData(await owner.client.rpc("get_goal", { p_goal_id: goal.id }));
    assert.equal(detail.boards[0].revision, 2);
    assert.equal(detail.boards[0].next_target_count, 2);
    assert.equal(detail.boards[0].current_bunch, null);
  });

  await record("praise_cycles_keep_creation_snapshot_after_next_target_changes", async () => {
    await addPraise(owner, goal.boardId);
    await addPraise(owner, goal.boardId);
    await addPraise(owner, goal.boardId);
    const firstHistory = rpcData(await owner.client.rpc("list_bunches", { p_board_id: goal.boardId, p_cursor: null, p_limit: 10 }));
    assert.equal(firstHistory.items.length, 2);
    const cycleTwo = firstHistory.items.find((item) => item.cycle_no === 2);
    assert.equal(cycleTwo.target_count, 2);
    assert.equal(cycleTwo.valid_count, 1);
    const changed = rpcData(await owner.client.rpc("update_board", {
      p_board_id: goal.boardId, p_patch: { expected_revision: 2, next_target_count: 3 },
    }));
    assert.equal(changed.replayed, false);
    await addPraise(owner, goal.boardId);
    await addPraise(owner, goal.boardId);
    const detail = rpcData(await owner.client.rpc("get_goal", { p_goal_id: goal.id }));
    assert.equal(detail.boards[0].next_target_count, 3);
    assert.equal(detail.boards[0].current_bunch.cycle_no, 3);
    assert.equal(detail.boards[0].current_bunch.target_count, 3);
    bunchIds = [1, 2, 3].map((cycleNo) => {
      const id = sql("select id from public.bunches where board_id=:'board'::uuid and cycle_no=:'cycle'::integer;\n", {
        board: goal.boardId, cycle: String(cycleNo),
      }).trim();
      assert.match(id, /^[0-9a-f-]{36}$/i);
      return id;
    });
    assert.equal(firstHistory.items.find((item) => item.cycle_no === 1).target_count, 2);
    assert.equal(firstHistory.items.find((item) => item.cycle_no === 1).progress_state, "complete");
  });

  await record("bunch_history_cursor_is_stable_and_bound_to_its_board", async () => {
    const first = rpcData(await owner.client.rpc("list_bunches", { p_board_id: goal.boardId, p_cursor: null, p_limit: 2 }));
    assert.equal(first.items.length, 2);
    assert.ok(first.next_cursor);
    const second = rpcData(await owner.client.rpc("list_bunches", { p_board_id: goal.boardId, p_cursor: first.next_cursor, p_limit: 2 }));
    assert.equal(second.items.length, 1);
    assert.equal(second.next_cursor, null);
    const listed = [...first.items, ...second.items];
    assert.deepEqual(listed.map((item) => item.cycle_no), [3, 2, 1]);
    assert.equal(new Set(listed.map((item) => item.id)).size, 3);
    assert.deepEqual(new Set(listed.map((item) => item.id)), new Set(bunchIds));
    assert.equal(listed[0].target_count, 3);
    assert.equal(listed[1].target_count, 2);
    assert.equal(listed[2].target_count, 2);
    denied(await owner.client.rpc("list_bunches", { p_board_id: alternateBoardId, p_cursor: first.next_cursor, p_limit: 2 }), "PT400", "bunch_cursor_board_mismatch");
    denied(await owner.client.rpc("list_bunches", { p_board_id: goal.boardId, p_cursor: "%%%", p_limit: 2 }), "PT400", "invalid_cursor");
    denied(await owner.client.rpc("list_bunches", { p_board_id: goal.boardId, p_cursor: null, p_limit: 51 }), "PT400", "invalid_page_size");
  });

  await record("goal_complete_archive_resume_preserve_bunch_state_and_revision", async () => {
    const complete = rpcData(await owner.client.rpc("complete_goal", { p_goal_id: goal.id, p_expected_revision: 1 }));
    assert.equal(complete.replayed, false);
    assert.equal(rpcData(await owner.client.rpc("complete_goal", { p_goal_id: goal.id, p_expected_revision: 0 })).replayed, true);
    const archived = rpcData(await owner.client.rpc("archive_goal", { p_goal_id: goal.id, p_expected_revision: 2 }));
    assert.equal(archived.replayed, false);
    denied(await owner.client.rpc("complete_goal", { p_goal_id: goal.id, p_expected_revision: 3 }), "PT409", "invalid_goal_transition");
    const resumed = rpcData(await owner.client.rpc("resume_goal", { p_goal_id: goal.id, p_expected_revision: 3 }));
    assert.equal(resumed.replayed, false);
    const detail = rpcData(await owner.client.rpc("get_goal", { p_goal_id: goal.id }));
    assert.equal(detail.goal.status, "active");
    assert.equal(detail.goal.revision, 4);
    assert.equal(detail.goal.completed_at, null);
    assert.equal(detail.goal.archived_at, null);
    assert.equal(detail.boards[0].current_bunch.cycle_no, 3);
    assert.equal(detail.boards[0].current_bunch.valid_count, 1);
  });

  await record("unrelated_user_cannot_read_bunches_or_table_rows", async () => {
    denied(await outsider.client.rpc("list_bunches", { p_board_id: goal.boardId, p_cursor: null, p_limit: 20 }), "PT404", "board_not_found");
    denied(await outsider.client.from("bunches").select("id").limit(1), "42501");
    const empty = rpcData(await owner.client.rpc("list_bunches", { p_board_id: alternateBoardId, p_cursor: null, p_limit: 20 }));
    assert.deepEqual(empty, { items: [], next_cursor: null });
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
      sql("delete from public.notifications where recipient_user_id=:'actor'::uuid or actor_user_id=:'actor'::uuid;\ndelete from public.praises where actor_user_id=:'actor'::uuid or recipient_user_id=:'actor'::uuid;\nupdate public.boards set current_bunch_id=null where owner_user_id=:'actor'::uuid;\ndelete from public.bunches where board_id in (select id from public.boards where owner_user_id=:'actor'::uuid);\ndelete from public.shared_board_profiles where board_id in (select id from public.boards where owner_user_id=:'actor'::uuid);\ndelete from public.request_receipts where actor_user_id=:'actor'::uuid;\ndelete from public.boards where owner_user_id=:'actor'::uuid;\ndelete from public.goals where owner_user_id=:'actor'::uuid;\ndelete from public.rate_usage where actor_user_id=:'actor'::uuid;\ndelete from public.profiles where user_id=:'actor'::uuid;\ndelete from public.app_users where id=:'actor'::uuid;\n", { actor: probe.id });
      const removed = await admin.auth.admin.deleteUser(probe.id);
      if (removed.error || sql("select count(*) from auth.sessions where user_id=:'actor'::uuid;\n", { actor: probe.id }).trim() !== "0") cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
  if (beforeSnapshot) {
    try {
      fixtureDataPreserved = snapshot() === beforeSnapshot && sessionCount() === beforeSessionCount;
      if (!fixtureDataPreserved) cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
}

const passed = !failed && !cleanupFailed && cases.length === 6;
const report = {
  verified_at: new Date().toISOString(),
  scope: "w08_b2_goal_transitions_board_target_snapshots_and_bunch_history",
  status: passed ? "passed" : "failed",
  executed: cases.length,
  passed: cases.filter((entry) => entry.status === "passed").length,
  cases,
  failure_detail: failureDetail,
  cleanup_passed: !cleanupFailed,
  existing_fixture_data_preserved: fixtureDataPreserved,
  synthetic_probe_accounts_removed: !cleanupFailed,
  session_tokens_fabricated: false,
  service_role_used_for_application_rpc: false,
};
fs.mkdirSync(path.join(projectRoot, "tmp"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "tmp/local-goal-lifecycle-tests.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;
