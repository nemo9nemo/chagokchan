import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, sql } from "./local-database-tools.mjs";
import { resolveDeployedSession, sealSession, SESSION_COOKIE_NAME } from "../src/server/deployed-session.mjs";

const cases = [];
const probes = [];
const issuers = [];
let before;
let sessionCount;
let failure = false;
let cleanup = true;
let phase = "local_setup";
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const env = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production",
  APP_BASE_URL: "https://session-test.example.invalid", SUPABASE_URL: "https://database.example.invalid",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_transport_only", CSRF_SIGNING_SECRET: "test-only-csrf-material-at-least-32-bytes",
  AUTH_SESSION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64url") };

function snapshot() {
  const tables = sql("select tablename from pg_tables where schemaname='public' and tablename <> 'spatial_ref_sys' order by tablename;\n").trim().split("\n").filter(Boolean);
  assert.equal(tables.length, 18);
  const hash = crypto.createHash("sha256");
  for (const table of tables) {
    assert.match(table, /^[a-z_]+$/);
    hash.update(table + "\0" + sql(`select coalesce(jsonb_agg(row_value order by row_value::text),'[]'::jsonb) from (select to_jsonb(t) row_value from public.${table} t) rows;\n`));
  }
  return hash.digest("hex");
}

async function record(name, work) { phase = name; await work(); cases.push({ name, status: "passed" }); }

try {
  const status = assertLocalDatabase();
  before = snapshot();
  sessionCount = Number(sql("select count(*) from auth.sessions;\n"));
  const manifest = JSON.parse(fs.readFileSync("private-data/local-fixtures.json", "utf8"));
  assert.equal(manifest.api_origin, status.API_URL);
  const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  // Only this local test injects a loopback transport. Runtime environment
  // validation still rejects a local URL in deployed mode; no bypass is added.
  const clientFactory = (_url, _key, config) => createClient(status.API_URL, key, config);
  for (const label of ["A", "B"]) {
    const actor = manifest.actors[label];
    const issuer = createClient(status.API_URL, key, options);
    issuers.push(issuer);
    const result = await issuer.auth.signInWithPassword({ email: actor.email, password: actor.password });
    assert.equal(result.error, null);
    const tokens = result.data.session;
    const sessionId = JSON.parse(Buffer.from(tokens.access_token.split(".")[1], "base64url").toString("utf8")).session_id;
    assert.match(sessionId, /^[0-9a-f-]{36}$/);
    probes.push({ issuer, tokens, sessionId, id: actor.id, cookie: `${SESSION_COOKIE_NAME}=${sealSession(tokens, env)}` });
    assert.equal(result.data.user.id, actor.id);
  }
  const resolve = cookie => resolveDeployedSession(cookie, { env, clientFactory });
  const [a, b] = probes;
  await record("issued_auth_a_b_stay_isolated_under_concurrent_requests", async () => {
    const [ra, rb] = await Promise.all([resolve(a.cookie), resolve(b.cookie)]);
    assert.equal(ra.userId, a.id); assert.equal(rb.userId, b.id);
    assert.notEqual(ra.client, rb.client);
    assert.equal(ra.me.profile.user_id, a.id); assert.equal(rb.me.profile.user_id, b.id);
  });
  await record("business_rpc_uses_each_verified_bearer_and_existing_rls", async () => {
    for (const probe of probes) {
      const context = await resolve(probe.cookie);
      const result = await context.client.rpc("get_me");
      assert.equal(result.error, null); assert.equal(result.data.user_id, probe.id);
      const goals = await context.client.rpc("list_goals", { p_cursor: null, p_limit: 20, p_status: null });
      assert.equal(goals.error, null);
    }
  });
  await record("encrypted_cookie_does_not_make_a_forged_jwt_trusted", async () => {
    const parts = a.tokens.access_token.split(".");
    parts[2] = "invalidsignature";
    const cookie = `${SESSION_COOKIE_NAME}=${sealSession({ ...a.tokens, access_token: parts.join(".") }, env)}`;
    assert.equal(await resolve(cookie), null);
  });
  await record("database_session_max_age_rejects_an_unexpired_auth_token", async () => {
    sql("update auth.sessions set created_at=clock_timestamp()-interval '31 days' where id=:'session'::uuid;\n", { session: b.sessionId });
    assert.equal(await resolve(b.cookie), null);
  });
  await record("current_session_logout_rejects_the_previous_unexpired_cookie", async () => {
    const result = await a.issuer.auth.signOut({ scope: "local" });
    assert.equal(result.error, null);
    assert.equal(await resolve(a.cookie), null);
  });
} catch {
  failure = true;
  cases.push({ name: phase, status: "failed" });
} finally {
  // Delete only the new Auth session IDs issued above, never fixture users or
  // another session belonging to those users. Product tables are read-only.
  for (const issuer of issuers) {
    try { await issuer.auth.signOut({ scope: "local" }); } catch { cleanup = false; }
  }
  for (const probe of probes) {
    try {
      sql("delete from auth.refresh_tokens where session_id=:'session'::uuid;\ndelete from auth.sessions where id=:'session'::uuid;\n", { session: probe.sessionId });
    } catch { cleanup = false; }
  }
  if (before) {
    try {
      assert.equal(snapshot(), before);
      assert.equal(Number(sql("select count(*) from auth.sessions;\n")), sessionCount);
    } catch { cleanup = false; }
  }
}
const passed = !failure && cleanup && cases.length === 5;
const report = { checked_at: new Date().toISOString(), work_item: "W12-A", status: passed ? "passed" : "failed",
  executed: cases.length, passed: cases.filter(c => c.status === "passed").length, cases,
  existing_product_data_and_sessions_preserved: before ? cleanup : null, new_auth_sessions_removed: cleanup,
  real_local_auth_sessions_issued: probes.length, real_google_otp_tests_executed: 0,
  service_role_used: false, public_environment_deployed: false };
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/local-deployed-session-tests.json", JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;
