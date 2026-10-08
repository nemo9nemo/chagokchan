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
let status;
let admin;

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

async function createProbe(adminClient) {
  const credentials = {
    email: `praise-result-${crypto.randomUUID()}@chagokchan.invalid`,
    password: crypto.randomBytes(32).toString("base64url"),
  };
  const created = await adminClient.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { local_praise_result_probe: true } });
  if (created.error || !created.data.user) throw new Error("Synthetic personal-praise probe setup failed.");
  const probe = { id: created.data.user.id, credentials, client: null };
  probes.push(probe);
  const policy = JSON.parse(fs.readFileSync(path.join(projectRoot, "policies/app-policy.json"), "utf8"));
  sql("insert into public.app_users(id, adult_confirmed_at, registration_policy_version) values (:'actor'::uuid, clock_timestamp(), :'policy');\ninsert into public.profiles(user_id) values (:'actor'::uuid);\n", {
    actor: probe.id, policy: policy.policy_version,
  });
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options);
  clients.push(client);
  probe.client = client;
  const session = await client.auth.signInWithPassword(credentials);
  if (session.error || !session.data.session) throw new Error("Synthetic personal-praise probe session could not be issued.");
  return probe;
}

function rpcData(result) {
  assert.equal(result.error, null, result.error?.message ?? "Personal-praise result RPC failed");
  return result.data;
}

async function record(name, work) {
  phase = name;
  await work();
  cases.push({ name, status: "passed" });
}

let actor;
let goalId;
let boardId;

try {
  status = assertLocalDatabase();
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!serviceKey) throw new Error("Local setup key unavailable.");
  admin = createClient(status.API_URL, serviceKey, options);
  beforeSnapshot = snapshot();
  beforeSessionCount = sessionCount();
  actor = await createProbe(admin);

  await record("personal_praise_result_returns_its_exact_bunch", async () => {
    const created = rpcData(await actor.client.rpc("create_goal", {
      p_request_key: crypto.randomUUID(), p_title: "칭찬 결과 회차 probe", p_personal_target_count: 1,
    }));
    goalId = created.id;
    boardId = sql("select id from public.boards where goal_id=:'goal'::uuid and owner_user_id=:'actor'::uuid and kind='personal';\n", {
      goal: goalId, actor: actor.id,
    }).trim();
    assert.match(boardId, /^[0-9a-f-]{36}$/i);
    const key = crypto.randomUUID();
    const request = { p_request_key: key, p_board_id: boardId, p_message: "기록 회차 확인", p_occurred_on: null };
    const first = rpcData(await actor.client.rpc("create_personal_praise", request));
    assert.deepEqual(Object.keys(first).sort(), ["bunch_id", "id", "replayed"]);
    assert.match(first.id, /^[0-9a-f-]{36}$/i);
    assert.match(first.bunch_id, /^[0-9a-f-]{36}$/i);
    assert.equal(first.replayed, false);
    assert.equal(sql("select bunch_id from public.praises where id=:'praise'::uuid and board_id=:'board'::uuid and actor_user_id=:'actor'::uuid;\n", {
      praise: first.id, board: boardId, actor: actor.id,
    }).trim(), first.bunch_id);
  });

  await record("same_idempotency_key_replays_same_id_and_cycle_without_extra_count", async () => {
    const request = { p_request_key: crypto.randomUUID(), p_board_id: boardId, p_message: "재시도 기록", p_occurred_on: null };
    const first = rpcData(await actor.client.rpc("create_personal_praise", request));
    const replay = rpcData(await actor.client.rpc("create_personal_praise", request));
    assert.equal(replay.id, first.id);
    assert.equal(replay.bunch_id, first.bunch_id);
    assert.equal(replay.replayed, true);
    assert.equal(sql("select count(*) from public.praises where board_id=:'board'::uuid and source='self';\n", { board: boardId }).trim(), "2");
    assert.equal(sql("select valid_count from public.bunches where id=:'bunch'::uuid;\n", { bunch: first.bunch_id }).trim(), "1");
  });

  await record("result_lookup_is_scoped_to_the_created_personal_row", async () => {
    const invalid = await actor.client.rpc("create_personal_praise", {
      p_request_key: crypto.randomUUID(), p_board_id: crypto.randomUUID(), p_message: null, p_occurred_on: null,
    });
    assert.equal(invalid.data, null);
    assert.equal(invalid.error?.code, "PT404");
    assert.equal(invalid.error?.message, "board_not_found");
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

const passed = !failed && !cleanupFailed && cases.length === 3;
const report = {
  verified_at: new Date().toISOString(),
  scope: "w08_c_personal_praise_result_cycle_idempotency_and_row_scope",
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
fs.writeFileSync(path.join(projectRoot, "tmp/local-personal-praise-result-tests.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;
