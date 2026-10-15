import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { assertLocalDatabase, projectRoot, sql } from "./local-database-tools.mjs";
import { validateFixtureManifest } from "./local-fixture-manifest.mjs";

// Run against an isolated disposable local database. A uses the real server-issued
// Auth session; only the uniquely keyed synthetic goal and its side effects are removed.
const checks = [];
const goalKey = crypto.randomUUID();
const praiseKey = crypto.randomUUID();
let app;
let appError;
let actorId;
let beforeSnapshot;
let beforeRates;
let lastRates;
const rateDeltas = new Map();
let rateTrackingSafe = true;
let cleanupPassed = false;
let fixturePreserved = false;
let phase = "local_environment";
let failure = null;

function snapshot() {
  const tables = sql("select tablename from pg_tables where schemaname='public' and tablename <> 'spatial_ref_sys' order by tablename;\n")
    .trim().split("\n").map((value) => value.trim()).filter(Boolean);
  assert.equal(tables.length, 18);
  const hash = crypto.createHash("sha256");
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected app table.");
    hash.update(table + "\0" + sql("select coalesce(jsonb_agg(row_value order by row_value::text),'[]'::jsonb) from (select to_jsonb(t) row_value from public." + table + " t) rows;\n"));
  }
  return hash.digest("hex");
}

function rates() {
  return sql("select coalesce(jsonb_agg(to_jsonb(r) order by r.scope_key,r.window_start),'[]'::jsonb) from public.rate_usage r where actor_user_id=:'actor'::uuid;\n", { actor: actorId }).trim();
}

function rateChanges(before, after, expectedScopes) {
  const previous = new Map(JSON.parse(before).map((row) => [row.id, row]));
  const changes = [];
  for (const row of JSON.parse(after)) {
    const prior = previous.get(row.id);
    previous.delete(row.id);
    if (prior && JSON.stringify(prior) === JSON.stringify(row)) continue;
    assert.equal(row.used_count - (prior?.used_count ?? 0), 1, "unexpected quota increment");
    if (prior) assert.deepEqual(row, { ...prior, used_count: row.used_count, updated_at: row.updated_at });
    changes.push({ id: row.id, scope_key: row.scope_key, window_start: row.window_start, used_count: 1 });
  }
  assert.equal(previous.size, 0, "quota rows disappeared during the check");
  assert.deepEqual(changes.map((row) => row.scope_key).sort(), [...expectedScopes].sort(), "concurrent local A quota activity");
  return changes;
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function record(name, work) {
  phase = name;
  await work();
  checks.push(name);
}

try {
  assertLocalDatabase();
  const manifestFile = path.join(projectRoot, "private-data/local-fixtures.json");
  const details = fs.lstatSync(manifestFile);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error("Local fixture manifest is unavailable.");
  const manifest = validateFixtureManifest(JSON.parse(fs.readFileSync(manifestFile, "utf8")));
  actorId = manifest.actors.A.id;
  assert.ok(actorId && manifest.data_seeded_at, "A must be seeded");
  beforeSnapshot = snapshot();
  beforeRates = rates();
  lastRates = beforeRates;
  const origin = `http://127.0.0.1:${await reservePort()}`;
  app = spawn(process.execPath, [path.join(projectRoot, "scripts/app.mjs"), "dev"], {
    cwd: projectRoot,
    env: { ...process.env, APP_BASE_URL: origin, LOCAL_DEV_ACTOR: "A", CHAGOKCHAN_BIND_HOST: "127.0.0.1" },
    stdio: "ignore", windowsHide: true,
  });
  app.on("error", (error) => { appError = error.code ?? "SPAWN_FAILED"; });
  const response = (route, init) => fetch(origin + "/api/v1" + route, {
    ...init, signal: AbortSignal.timeout(10000), redirect: "error",
  });
  phase = "local_app_ready";
  let ready = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (appError || app.exitCode !== null) throw new Error("Local app unavailable.");
    try {
      const me = await response("/me");
      if (me.status === 200) {
        assert.equal((await me.json()).user_id, actorId);
        ready = true;
        break;
      }
    } catch { /* Await the loopback app startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  assert.equal(ready, true, "local A API must become ready");
  checks.push("real_local_A_session");
  const csrf = await response("/auth/csrf");
  assert.equal(csrf.status, 200);
  const token = (await csrf.json()).csrf_token;
  const headers = { Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": token, Cookie: `chagokchan_csrf=${token}` };
  const mutate = async (route, method, body, key, expectedScopes = []) => {
    // A lost reply or an unexpected delta cannot establish which request consumed quota.
    rateTrackingSafe = false;
    assert.equal(rates(), lastRates, "concurrent local A activity before the request");
    const result = await response(route, { method, headers: { ...headers, ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
    const resultBody = await result.clone().json();
    if (expectedScopes.length) {
      assert.equal(result.ok, true, "quota attribution requires a successful response");
      assert.equal(resultBody.replayed, false, "only a confirmed new mutation consumes quota");
    }
    const currentRates = rates();
    const changes = rateChanges(lastRates, currentRates, expectedScopes);
    for (const change of changes) {
      const prior = rateDeltas.get(change.id);
      rateDeltas.set(change.id, { ...change, used_count: (prior?.used_count ?? 0) + 1 });
    }
    lastRates = currentRates;
    rateTrackingSafe = true;
    return result;
  };
  let boardId;
  let praise;
  await record("synthetic_goal_created", async () => {
    const created = await mutate("/goals", "POST", { title: "W20-A 태그 합성 검사", personal_target_count: 1 }, goalKey);
    assert.equal(created.status, 201);
    const goalId = (await created.json()).id;
    const detail = await response(`/goals/${goalId}`);
    assert.equal(detail.status, 200);
    boardId = sql("select b.id from public.boards b join public.request_receipts r on r.result_id=b.goal_id where r.actor_user_id=:'actor'::uuid and r.operation='createGoal' and r.request_key=:'key'::uuid and b.kind='personal';\n", { actor: actorId, key: goalKey }).trim();
    assert.match(boardId, /^[0-9a-f-]{36}$/i);
  });
  await record("tag_create_and_owner_list", async () => {
    const created = await mutate(`/boards/${boardId}/praises`, "POST", { tag: "consistency" }, praiseKey, ["praise_write_minute", "praise_write_day"]);
    assert.equal(created.status, 201);
    praise = await created.json();
    assert.equal(praise.replayed, false);
    const page = await response(`/boards/${boardId}/praises`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("cache-control") ?? "", /no-store/i);
    const row = (await page.json()).items.find((item) => item.id === praise.id);
    assert.equal(row?.viewer_role, "owner");
    assert.equal(row.tag, "consistency");
  });
  await record("same_tag_replay_without_double_count", async () => {
    const retry = await mutate(`/boards/${boardId}/praises`, "POST", { tag: "consistency" }, praiseKey);
    assert.equal(retry.status, 201);
    assert.deepEqual(await retry.json(), { ...praise, replayed: true });
  });
  await record("different_tag_idempotency_conflict", async () => {
    const conflict = await mutate(`/boards/${boardId}/praises`, "POST", { tag: "care" }, praiseKey);
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, "IDEMPOTENCY_CONFLICT");
  });
  const currentRow = async () => {
    const page = await response(`/boards/${boardId}/praises`);
    assert.equal(page.status, 200);
    return (await page.json()).items.find((item) => item.id === praise.id);
  };
  await record("tag_change_and_patch_replay", async () => {
    for (const replayed of [false, true]) {
      const edited = await mutate(`/praises/${praise.id}`, "PATCH", { tag: "growth" }, null, replayed ? [] : ["praise_state_change_minute"]);
      assert.equal(edited.status, 200);
      assert.equal((await edited.json()).replayed, replayed);
    }
    assert.equal((await currentRow()).tag, "growth");
  });
  await record("explicit_null_removes_tag", async () => {
    const edited = await mutate(`/praises/${praise.id}`, "PATCH", { tag: null }, null, ["praise_state_change_minute"]);
    assert.equal(edited.status, 200);
    assert.equal((await currentRow()).tag, null);
  });
  await record("tag_does_not_change_count_completion_or_notices", async () => {
    const edited = await mutate(`/praises/${praise.id}`, "PATCH", { tag: "rest" }, null, ["praise_state_change_minute"]);
    assert.equal(edited.status, 200);
    const board = await response(`/boards/${boardId}`);
    assert.equal(board.status, 200);
    const cycle = (await board.json()).current_bunch;
    assert.equal(cycle.valid_count, 1);
    assert.equal(cycle.progress_state, "complete");
    assert.equal(sql("select count(*) from public.notifications where recipient_user_id=:'actor'::uuid and bunch_id=:'bunch'::uuid and type='bunch_completed';\n", { actor: actorId, bunch: praise.bunch_id }).trim(), "1");
  });
  await record("cancel_clears_tag", async () => {
    const cancelled = await mutate(`/praises/${praise.id}/cancel`, "POST", {}, null, ["praise_state_change_minute"]);
    assert.equal(cancelled.status, 200);
    const row = await currentRow();
    assert.ok(row.cancelled_at);
    assert.equal(row.tag, null);
    assert.equal(row.message, null);
    assert.equal(row.occurred_on, null);
  });
} catch (error) {
  // Never serialize AssertionError objects, request headers, credentials or SQL output.
  failure = { phase, code: appError ?? error.code ?? "CHECK_FAILED" };
  if (phase === "local_environment" && /^Local database command failed \([A-Z0-9]+\)\.$/.test(error.message)) {
    failure.first_error_line = error.message;
  }
} finally {
  if (app?.pid && app.exitCode === null) {
    app.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => app.once("close", resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (app.exitCode === null && process.platform === "win32") {
      const killer = spawn("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      await new Promise((resolve) => { killer.once("close", resolve); killer.once("error", resolve); });
    } else if (app.exitCode === null) app.kill("SIGKILL");
  }
  if (beforeSnapshot && beforeRates) {
    try {
      assert.equal(rateTrackingSafe, true, "unattributed quota changes prevent safe cleanup");
      sql(`begin;
        -- Hold the writer lock from the comparison through compensation, including new windows.
        lock table public.rate_usage in share row exclusive mode;
        create temporary table w20_tag_rate_guard on commit drop as
          select :'actor'::uuid as actor, :'last_rates'::jsonb as expected;
        do $$ begin
          if (select coalesce(jsonb_agg(to_jsonb(r) order by r.scope_key,r.window_start),'[]'::jsonb)
              from public.rate_usage r where r.actor_user_id=(select actor from w20_tag_rate_guard))
              is distinct from (select expected from w20_tag_rate_guard) then
            raise exception 'Concurrent local A quota activity prevents safe cleanup';
          end if;
        end $$;
        create temporary table w20_tag_rate_baseline on commit drop as
          select * from jsonb_populate_recordset(null::public.rate_usage,:'rates'::jsonb);
        create temporary table w20_tag_rate_deltas on commit drop as
          select * from jsonb_to_recordset(:'deltas'::jsonb)
            as d(id uuid, scope_key text, window_start timestamptz, used_count integer);
        create temporary table w20_tag_goals on commit drop as
          select result_id as id from public.request_receipts where actor_user_id=:'actor'::uuid
          and operation='createGoal' and request_key=:'goal_key'::uuid;
        delete from public.notifications where praise_id in (select id from public.praises where board_id in
          (select id from public.boards where goal_id in (select id from w20_tag_goals))) or bunch_id in
          (select id from public.bunches where board_id in (select id from public.boards where goal_id in (select id from w20_tag_goals)));
        delete from public.praises where board_id in (select id from public.boards where goal_id in (select id from w20_tag_goals));
        update public.boards set current_bunch_id=null where goal_id in (select id from w20_tag_goals);
        delete from public.bunches where board_id in (select id from public.boards where goal_id in (select id from w20_tag_goals));
        delete from public.shared_board_profiles where board_id in (select id from public.boards where goal_id in (select id from w20_tag_goals));
        delete from public.boards where goal_id in (select id from w20_tag_goals);
        delete from public.goals where id in (select id from w20_tag_goals) and owner_user_id=:'actor'::uuid;
        delete from public.request_receipts where actor_user_id=:'actor'::uuid and request_key in (:'goal_key'::uuid,:'praise_key'::uuid);
        delete from public.rate_usage r using w20_tag_rate_deltas d
          where r.actor_user_id=:'actor'::uuid and r.id=d.id and r.scope_key=d.scope_key
          and r.window_start=d.window_start and r.used_count=d.used_count
          and not exists (select 1 from w20_tag_rate_baseline b where b.id=r.id);
        update public.rate_usage r set used_count=r.used_count-d.used_count, updated_at=b.updated_at
          from w20_tag_rate_deltas d, w20_tag_rate_baseline b
          where r.actor_user_id=:'actor'::uuid and r.id=d.id and r.id=b.id
          and r.scope_key=d.scope_key and r.window_start=d.window_start;
        commit;\n`, { actor: actorId, goal_key: goalKey, praise_key: praiseKey, rates: beforeRates,
        last_rates: lastRates, deltas: JSON.stringify([...rateDeltas.values()]) });
      fixturePreserved = snapshot() === beforeSnapshot;
      cleanupPassed = fixturePreserved;
    } catch {
      cleanupPassed = false;
      failure ??= { phase: "cleanup", code: "UNSAFE_OR_FAILED_CLEANUP" };
    }
  }
}

const passed = !failure && cleanupPassed && fixturePreserved && checks.length === 9;
process.stdout.write(JSON.stringify({
  status: passed ? "passed" : "failed", actor: "A", checks, failure,
  cleanup_passed: cleanupPassed, existing_product_fixture_snapshot_preserved: fixturePreserved,
  credentials_printed: false, service_role_used_for_application_requests: false,
  real_provider_login_verified: false,
}) + "\n");
if (!passed) process.exitCode = 1;
