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
    email: `${label}-${crypto.randomUUID()}@goal-list.chagokchan.invalid`,
    password: crypto.randomBytes(32).toString("base64url"),
  };
  const created = await adminClient.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { local_goal_list_probe: true } });
  if (created.error || !created.data.user) throw new Error("Synthetic goal list probe setup failed.");
  const probe = { id: created.data.user.id, credentials, client: null };
  probes.push(probe);
  sql("insert into public.app_users(id, adult_confirmed_at, registration_policy_version) values (:'actor'::uuid, clock_timestamp(), :'policy');\ninsert into public.profiles(user_id) values (:'actor'::uuid);\n", {
    actor: probe.id, policy: policyVersion,
  });
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options);
  clients.push(client);
  probe.client = client;
  const session = await client.auth.signInWithPassword(credentials);
  if (session.error || !session.data.session) throw new Error("Synthetic goal list probe session could not be issued.");
  return probe;
}

function denied(result, code, message) {
  assert.equal(result.data, null);
  assert.equal(result.error?.code, code);
  if (message) assert.equal(result.error.message, message);
}

function rpcData(result) {
  assert.equal(result.error, null, result.error?.message ?? "Goal list RPC failed");
  return result.data;
}

async function record(name, work) {
  phase = name;
  await work();
  cases.push({ name, status: "passed" });
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
  const goalIds = [];

  await record("owner_creates_isolated_goal_rows", async () => {
    for (let index = 0; index < 5; index += 1) {
      const result = rpcData(await owner.client.rpc("create_goal", {
        p_request_key: crypto.randomUUID(),
        p_title: `페이지 목표 ${index + 1}`,
        p_private_description: `비공개 메모 ${index + 1}`,
      }));
      assert.equal(result.replayed, false);
      goalIds.push(result.id);
    }
  });

  await record("keyset_pages_have_no_duplicates_or_skips", async () => {
    const pages = [];
    let cursor = null;
    do {
      const page = rpcData(await owner.client.rpc("list_goals", { p_cursor: cursor, p_limit: 2, p_status: null }));
      assert.ok(Array.isArray(page.items));
      assert.ok(page.items.length <= 2);
      pages.push(...page.items);
      cursor = page.next_cursor;
      if (cursor !== null) assert.match(cursor, /^[A-Za-z0-9_-]{1,512}$/);
    } while (cursor !== null);
    const listedIds = pages.map((item) => item.id);
    assert.equal(pages.length, goalIds.length);
    assert.equal(new Set(listedIds).size, goalIds.length);
    assert.deepEqual(new Set(listedIds), new Set(goalIds));
    for (const item of pages) {
      assert.deepEqual(Object.keys(item).sort(), ["archived_at", "completed_at", "created_at", "id", "private_description", "revision", "status", "title"].sort());
    }
  });

  await record("status_filters_and_filter_bound_cursor", async () => {
    const firstActive = rpcData(await owner.client.rpc("list_goals", { p_cursor: null, p_limit: 1, p_status: "active" }));
    assert.equal(firstActive.items.length, 1);
    assert.ok(firstActive.next_cursor);
    const completeId = goalIds[0];
    rpcData(await owner.client.rpc("complete_goal", { p_goal_id: completeId, p_expected_revision: 1 }));
    const active = rpcData(await owner.client.rpc("list_goals", { p_cursor: null, p_limit: 20, p_status: "active" }));
    const completed = rpcData(await owner.client.rpc("list_goals", { p_cursor: null, p_limit: 20, p_status: "completed" }));
    assert.equal(active.items.length, 4);
    assert.equal(completed.items.length, 1);
    assert.equal(completed.items[0].id, completeId);
    denied(await owner.client.rpc("list_goals", { p_cursor: firstActive.next_cursor, p_limit: 20, p_status: "completed" }), "PT400", "goal_cursor_filter_mismatch");
  });

  await record("invalid_cursor_limit_and_status_are_rejected", async () => {
    denied(await owner.client.rpc("list_goals", { p_cursor: "%%%", p_limit: 20, p_status: null }), "PT400", "invalid_cursor");
    denied(await owner.client.rpc("list_goals", { p_cursor: null, p_limit: 51, p_status: null }), "PT400", "invalid_page_size");
    denied(await owner.client.rpc("list_goals", { p_cursor: null, p_limit: 20, p_status: "deleted" }), "PT400", "invalid_goal_status");
  });

  await record("outsider_list_is_empty_and_table_select_is_denied", async () => {
    const page = rpcData(await outsider.client.rpc("list_goals", { p_cursor: null, p_limit: 50, p_status: null }));
    assert.deepEqual(page, { items: [], next_cursor: null });
    denied(await outsider.client.from("goals").select("id").limit(1), "42501");
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
      fixtureDataPreserved = snapshot() === beforeSnapshot && sessionCount() === beforeSessionCount;
      if (!fixtureDataPreserved) cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
}

const passed = !failed && !cleanupFailed && cases.length === 5;
const report = {
  verified_at: new Date().toISOString(),
  scope: "w08_b1_goal_list_rpc_filter_bound_keyset_pagination_and_owner_scope",
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
fs.writeFileSync(path.join(projectRoot, "tmp/local-goal-list-rpc-tests.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;
