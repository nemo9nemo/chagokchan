import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, sql } from "./local-database-tools.mjs";

const cases = [];
const clients = [];
const probes = [];
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const sessions = () => sql("select id from auth.sessions order by id;\n").trim();
function snapshot() {
  const tables = sql("select tablename from pg_tables where schemaname='public' order by tablename;\n").trim().split("\n");
  assert.equal(tables.length, 18);
  const hash = crypto.createHash("sha256");
  for (const table of tables) {
    assert.match(table, /^[a-z_]+$/);
    hash.update(table + "\0" + sql(`select coalesce(jsonb_agg(row_value order by row_value::text),'[]'::jsonb) from (select to_jsonb(t) row_value from public.${table} t) rows;\n`));
  }
  return hash.digest("hex");
}
let before;
let beforeSessions;
let success = false;
let preserved = false;
try {
  const status = assertLocalDatabase();
  before = snapshot(); beforeSessions = sessions();
  const manifest = JSON.parse(fs.readFileSync("private-data/local-fixtures.json", "utf8"));
  assert.equal(manifest.api_origin, status.API_URL);
  const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  for (const actor of ["A","B","C"]) {
    const credential = manifest.actors[actor];
    const client = createClient(status.API_URL, key, options);
    clients.push(client);
    const login = await client.auth.signInWithPassword({ email: credential.email, password: credential.password });
    assert.equal(login.error, null);
    assert.equal(login.data.user.id, credential.id);
    const tokens = login.data.session;
    probes.push({ client, token: tokens.access_token, userId: credential.id });
    const [legacy, overview] = await Promise.all([client.rpc("list_goals", { p_limit: 50 }), client.rpc("list_goal_overviews", { p_limit: 50 })]);
    assert.equal(legacy.error, null); assert.equal(overview.error, null);
    assert.deepEqual(overview.data.items.map(item => item.goal), legacy.data.items);
    assert.equal(overview.data.next_cursor, legacy.data.next_cursor);
    const details = await Promise.all(legacy.data.items.map(item => client.rpc("get_goal", { p_goal_id: item.id })));
    for (const detail of details) assert.equal(detail.error, null);
    assert.deepEqual(overview.data.items, details.map(item => item.data));
    cases.push({ name: actor + "_issued_session_exact_owner_projection", status: "passed" });
  }
  const a = probes[0];
  const denied = await a.client.from("goals").select("id").limit(1);
  assert.equal(denied.error?.code, "42501");
  cases.push({ name: "direct_table_reads_stay_denied", status: "passed" });
  const replayClient = createClient(status.API_URL, key, { ...options, global: { headers: { Authorization: "Bearer " + a.token } } });
  assert.equal((await a.client.auth.signOut({ scope: "local" })).error, null);
  const replay = await replayClient.rpc("list_goal_overviews");
  assert.equal(replay.error?.code, "PT401");
  cases.push({ name: "revoked_issued_session_replay_denied", status: "passed" });
  success = true;
} catch {
  process.stderr.write("Local overview test failed; raw credentials and responses withheld.\n");
} finally {
  for (const client of clients) {
    try { assert.equal((await client.auth.signOut({ scope: "local" })).error, null); } catch { success = false; }
  }
  if (before) {
    preserved = snapshot() === before && sessions() === beforeSessions;
    if (preserved) cases.push({ name: "all_product_rows_and_preexisting_sessions_preserved", status: "passed" });
  }
}
const report = { checked_at: new Date().toISOString(), status: success && preserved ? "passed" : "failed", cases, executed: cases.length,
  existing_product_data_and_sessions_preserved: preserved, real_local_auth_sessions_issued: probes.length, real_google_otp_tests_executed: 0, service_role_used: false };
fs.writeFileSync("tmp/w26-issued-session-overviews.json", JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report) + "\n");
if (report.status !== "passed") process.exitCode = 1;
