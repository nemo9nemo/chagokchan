import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, sql } from "./local-database-tools.mjs";
import { createCsrfToken, csrfSessionBinding } from "../src/server/api-security.mjs";
import { openSession, resolveDeployedSession, sealSession, SESSION_COOKIE_NAME, SessionAccountError, sessionCookieValue } from "../src/server/deployed-session.mjs";
import { googleStartResponse, googleCallbackResponse, refreshResponse } from "../src/server/web-auth-api.mjs";
import { bootstrapAccountResponse } from "../src/server/registration-api.mjs";
import { logoutResponse } from "../src/server/logout-api.mjs";

const runId = crypto.randomUUID();
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const env = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production", APP_BASE_URL: "https://web-auth-local.example.invalid", SUPABASE_URL: "https://database.example.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_transport_only", CSRF_SIGNING_SECRET: crypto.randomBytes(32).toString("base64url"), AUTH_SESSION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64url") };
const cases = [];
let admin, before, priorSessions, priorUsers, failed;
let phase = "local_setup";
let preserved = false;
let createdUsers = 0;
let issuedSessions = 0;
function snapshot() {
  const tables = sql("select tablename from pg_tables where schemaname='public' order by tablename;\n").trim().split("\n");
  assert.equal(tables.length, 18); const hash = crypto.createHash("sha256");
  for (const table of tables) { assert.match(table, /^[a-z_]+$/); hash.update(table + "\0" + sql(`select coalesce(jsonb_agg(row_value order by row_value::text),'[]'::jsonb) from (select to_jsonb(t) row_value from public.${table} t) rows;\n`)); }
  return hash.digest("hex");
}
const sessions = () => sql("select id from auth.sessions order by id;\n").trim();
async function record(name, work) { phase = name; await work(); cases.push({ name, status: "passed" }); }
function request(path, cookie = "", body = {}) {
  const binding = csrfSessionBinding(new Request(env.APP_BASE_URL, { headers: { cookie } }));
  const csrf = createCsrfToken(env.CSRF_SIGNING_SECRET, Date.now(), binding);
  return new Request(env.APP_BASE_URL + path, { method: "POST", headers: { origin: env.APP_BASE_URL, "content-type": "application/json", cookie: `${cookie}; chagokchan_csrf=${csrf}`, "x-csrf-token": csrf }, body: JSON.stringify(body) });
}
try {
  const status = assertLocalDatabase(); before = snapshot(); priorSessions = sessions(); priorUsers = Number(sql("select count(*) from auth.users;\n"));
  const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  admin = createClient(status.API_URL, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, options);
  const identities = [];
  for (const label of ["one", "two"]) {
    const credentials = { email: `${label}-${runId}@web-auth.chagokchan.invalid`, password: crypto.randomBytes(32).toString("base64url") };
    const result = await admin.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { local_web_auth_run: runId } });
    assert.equal(result.error, null); createdUsers++; identities.push({ ...credentials, id: result.data.user.id });
  }
  const signIn = async identity => { const client = createClient(status.API_URL, key, options); const result = await client.auth.signInWithPassword({ email: identity.email, password: identity.password }); assert.equal(result.error, null); issuedSessions++; return { client, tokens: result.data.session }; };
  const a1 = await signIn(identities[0]), a2 = await signIn(identities[0]), b1 = await signIn(identities[1]);
  const clientFactory = (_url, _key, config) => createClient(status.API_URL, key, config);
  const fetcher = (url, init) => { assert.ok(url.startsWith(env.SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token")); return fetch(url.replace(env.SUPABASE_URL, status.API_URL), { ...init, headers: { ...init.headers, apikey: key } }); };
  const deps = { env, clientFactory, fetcher };
  let cookie;
  await record("callback_checks_real_issued_auth_and_signup_context_before_cookie", async () => {
    const start = await googleStartResponse(request("/api/v1/auth/google/start"), { env });
    assert.equal(start.status, 200); const flowCookie = start.headers.getSetCookie()[0].split(";")[0];
    // Only the external Google/PKCE exchange is stubbed; getUser and current
    // session RPCs use the actual local Auth service and database.
    const callback = await googleCallbackResponse(new Request(env.APP_BASE_URL + "/api/v1/auth/callback?code=test-local-issued-session", { headers: { cookie: flowCookie } }), { env, clientFactory, fetcher: async () => Response.json(a1.tokens) });
    assert.equal(callback.status, 303); assert.equal(callback.headers.get("location"), env.APP_BASE_URL + "/signup");
    cookie = callback.headers.getSetCookie().find(value => value.startsWith(`${SESSION_COOKIE_NAME}=`)).split(";")[0];
    await assert.rejects(resolveDeployedSession(cookie, deps), error => error instanceof SessionAccountError && error.accountState === "signup_required");
  });
  await record("explicit_confirmation_bootstraps_then_product_session_resolves", async () => {
    const client = createClient(status.API_URL, key, { ...options, global: { headers: { Authorization: `Bearer ${a1.tokens.access_token}` } } });
    const invoke = body => bootstrapAccountResponse(request("/api/v1/me/bootstrap", cookie, body), client, identities[0].id, { env, expectedOrigin: env.APP_BASE_URL, secret: env.CSRF_SIGNING_SECRET });
    assert.equal((await invoke({ adult_confirmed: false, registration_policy_version: "0.2.0" })).status, 400);
    const response = await invoke({ adult_confirmed: true, registration_policy_version: "0.2.0" }); assert.equal(response.status, 200);
    assert.equal((await resolveDeployedSession(cookie, deps)).userId, identities[0].id);
  });
  await record("real_refresh_keeps_user_session_and_absolute_cookie_lifetime", async () => {
    const previous = openSession(sessionCookieValue(cookie), env);
    const response = await refreshResponse(request("/api/v1/auth/refresh", cookie), deps); assert.equal(response.status, 200);
    cookie = response.headers.getSetCookie()[0].split(";")[0];
    const rotated = openSession(sessionCookieValue(cookie), env); assert.equal(rotated.issued_at, previous.issued_at); assert.equal(rotated.expires_at, previous.expires_at);
    assert.equal((await resolveDeployedSession(cookie, deps)).userId, identities[0].id);
  });
  await record("concurrent_refresh_results_remain_usable_for_the_same_session", async () => {
    const results = await Promise.all([refreshResponse(request("/api/v1/auth/refresh", cookie), deps), refreshResponse(request("/api/v1/auth/refresh", cookie), deps)]);
    for (const response of results) {
      assert.equal(response.status, 200); const header = response.headers.getSetCookie()[0].split(";")[0];
      assert.equal((await resolveDeployedSession(header, deps)).userId, identities[0].id);
    }
    cookie = results[1].headers.getSetCookie()[0].split(";")[0];
  });
  const revokedCookie = cookie;
  await record("logout_revokes_rotated_session_and_preserves_other_devices_and_user", async () => {
    const response = await logoutResponse(request("/api/v1/auth/logout", cookie, { scope: "current" }), deps); assert.equal(response.status, 200);
    assert.equal(await resolveDeployedSession(revokedCookie, deps), null);
    assert.equal((await a2.client.rpc("get_auth_context")).error, null); assert.equal((await b1.client.rpc("get_auth_context")).error, null);
  });
  await record("refresh_after_logout_cannot_restore_product_access", async () => {
    const response = await refreshResponse(request("/api/v1/auth/refresh", revokedCookie), deps); assert.equal(response.status, 401); assert.equal(response.headers.getSetCookie().length, 0);
  });
  await record("concurrent_logout_and_refresh_never_restore_the_ended_session", async () => {
    const racingCookie = `${SESSION_COOKIE_NAME}=${sealSession(a2.tokens, env)}`;
    const [refresh, logout] = await Promise.all([refreshResponse(request("/api/v1/auth/refresh", racingCookie), deps), logoutResponse(request("/api/v1/auth/logout", racingCookie, { scope: "current" }), deps)]);
    assert.equal(logout.status, 200); assert.ok([200, 401].includes(refresh.status));
    const lastCookie = refresh.ok ? refresh.headers.getSetCookie()[0].split(";")[0] : racingCookie;
    assert.equal(await resolveDeployedSession(lastCookie, deps), null);
    assert.equal((await a2.client.rpc("get_auth_context")).error?.code, "PT401");
    assert.equal((await b1.client.rpc("get_auth_context")).error, null);
  });
} catch { failed = phase; }
finally {
  try {
    if (admin) {
      const ids = sql("select id from auth.users where raw_app_meta_data->>'local_web_auth_run'=:'run' order by id;\n", { run: runId }).trim().split("\n").filter(Boolean);
      for (const id of ids) {
        assert.match(id, /^[0-9a-f-]{36}$/);
        const identity = await admin.auth.admin.getUserById(id); assert.equal(identity.data.user.app_metadata.local_web_auth_run, runId);
        sql("delete from public.profiles where user_id=:'actor'::uuid;\ndelete from public.app_users where id=:'actor'::uuid;\n", { actor: id });
        assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
      }
    }
    if (before) { preserved = snapshot() === before && sessions() === priorSessions && Number(sql("select count(*) from auth.users;\n")) === priorUsers; assert.ok(preserved); cases.push({ name: "existing_product_rows_users_and_sessions_preserved", status: "passed" }); }
  } catch { failed ??= "cleanup"; }
}
const report = { checked_at: new Date().toISOString(), status: !failed && preserved ? "passed" : "failed", failed_phase: failed ?? null, executed: cases.length, cases, synthetic_local_auth_users: createdUsers, real_local_sessions_issued: issuedSessions, google_pkce_exchange: "stubbed_local_issued_tokens_only", real_google_tests_executed: 0, real_local_auth_refresh_and_database_rpc: cases.some(item => item.name === "real_refresh_keeps_user_session_and_absolute_cookie_lifetime"), existing_product_data_auth_users_and_sessions_preserved: preserved, local_admin_used_only_for_setup_cleanup: true, service_role_used_for_application_requests: false };
fs.writeFileSync("tmp/w12-c2-web-auth-local.json", JSON.stringify(report, null, 2) + "\n"); process.stdout.write(JSON.stringify(report) + "\n");
if (report.status !== "passed") process.exitCode = 1;
