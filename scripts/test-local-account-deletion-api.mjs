import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, sql } from "./local-database-tools.mjs";
import { createCsrfToken, csrfSessionBinding } from "../src/server/api-security.mjs";
import { SESSION_COOKIE_NAME, sealSession, sessionTokenClaims, resolveDeployedSession, SessionAccountError } from "../src/server/deployed-session.mjs";
import { REAUTH_COOKIE_NAME, DELETION_RECEIPT_COOKIE_NAME, openReauthFlow, openDeletionReceipt } from "../src/server/auth-flow-cookie.mjs";
import { reauthVerifierConfiguration } from "../src/server/reauth-proof.mjs";
import { reauthStartResponse, reauthCallbackResponse, reauthStateResponse, accountDeletionResponse } from "../src/server/account-deletion-api.mjs";

const runId = crypto.randomUUID(), cases = [], sdk = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const env = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production", APP_BASE_URL: "https://deletion-local.example.invalid", SUPABASE_URL: "https://database.example.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_transport_only", CSRF_SIGNING_SECRET: crypto.randomBytes(32).toString("base64url"), AUTH_SESSION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64url") };
const keyConfig = reauthVerifierConfiguration(env);
let admin, before, oldSessions, oldUsers, oldKeys, installed = false, preserved = false, failed, phase = "setup", usersCreated = 0, sessionsIssued = 0;
function snapshot() {
  const tables = sql("select tablename from pg_tables where schemaname='public' order by tablename;\n").trim().split("\n");
  assert.equal(tables.length, 18); const hash = crypto.createHash("sha256");
  for (const table of tables) { assert.match(table, /^[a-z_]+$/); hash.update(table + "\0" + sql(`select coalesce(jsonb_agg(row_value order by row_value::text),'[]'::jsonb) from (select to_jsonb(t) row_value from public.${table} t) rows;\n`)); }
  return hash.digest("hex");
}
const sessions = () => sql("select id from auth.sessions order by id;\n").trim();
const keysDigest = () => sql("select encode(sha256(convert_to(coalesce(string_agg(key_id || enabled::text || encode(key_bytes,'hex'),',' order by key_id),''),'UTF8')),'hex') from private.reauth_proof_keys;\n").trim();
async function record(name, work) { phase = name; await work(); cases.push({ name, status: "passed" }); }
function post(path, cookie, body, key = crypto.randomUUID()) {
  const csrf = createCsrfToken(env.CSRF_SIGNING_SECRET, Date.now(), csrfSessionBinding(new Request(env.APP_BASE_URL, { headers: { cookie } })));
  return new Request(env.APP_BASE_URL + path, { method: "POST", headers: { origin: env.APP_BASE_URL, "content-type": "application/json", cookie: `${cookie}; chagokchan_csrf=${csrf}`, "x-csrf-token": csrf, "idempotency-key": key }, body: JSON.stringify(body) });
}
const combine = response => response.headers.getSetCookie().filter(x => x.startsWith(SESSION_COOKIE_NAME) || x.startsWith(REAUTH_COOKIE_NAME)).map(x => x.split(";")[0]).join("; ");
const callback = cookie => new Request(env.APP_BASE_URL + "/api/v1/auth/reauth/callback?code=synthetic-provider-code", { headers: { cookie } });
try {
  const status = assertLocalDatabase(); before = snapshot(); oldSessions = sessions(); oldUsers = Number(sql("select count(*) from auth.users;\n")); oldKeys = keysDigest();
  const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  admin = createClient(status.API_URL, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, sdk);
  const identities = [];
  for (const label of ["one", "two"]) {
    const credentials = { email: `${label}-${runId}@deletion-web.chagokchan.invalid`, password: crypto.randomBytes(32).toString("base64url") };
    const result = await admin.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { local_deletion_web_run: runId } }); assert.equal(result.error, null); usersCreated++; identities.push({ ...credentials, id: result.data.user.id });
  }
  const signIn = async identity => {
    const result = await createClient(status.API_URL, key, sdk).auth.signInWithPassword({ email: identity.email, password: identity.password }); assert.equal(result.error, null); sessionsIssued++;
    const tokens = result.data.session;
    return { tokens, cookie: `${SESSION_COOKIE_NAME}=${sealSession(tokens, env)}`, claims: sessionTokenClaims(tokens.access_token), client: createClient(status.API_URL, key, { ...sdk, global: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }) };
  };
  const a1 = await signIn(identities[0]), a2 = await signIn(identities[0]), b1 = await signIn(identities[1]);
  for (const user of [a1, b1]) assert.equal((await user.client.rpc("bootstrap_account", { p_adult_confirmed: true, p_registration_policy_version: "0.2.0" })).error, null);
  sql("insert into private.reauth_proof_keys(key_id,key_bytes) values (:'kid',decode(:'key_material','hex'));\n", { kid: keyConfig.keyId, key_material: keyConfig.keyBytes.toString("hex") }); installed = true;
  const clientFactory = (_url, _key, options) => createClient(status.API_URL, key, options);
  let exchanged;
  const fetcher = async (url, init) => {
    if (url.endsWith("grant_type=pkce")) { assert.ok(exchanged); return Response.json(exchanged.tokens); }
    assert.ok(url.endsWith("grant_type=refresh_token"));
    return fetch(url.replace(env.SUPABASE_URL, status.API_URL), { ...init, headers: { ...init.headers, apikey: key } });
  };
  const deps = { env, clientFactory, fetcher };
  const start = async cookie => {
    const response = await reauthStartResponse(post("/api/v1/auth/reauth/start", cookie, { provider: "google", scope: "account.delete" }), deps);
    assert.equal(response.status, 200); return { cookie: combine(response), data: await response.json() };
  };
  let pending;
  await record("start_refreshes_real_auth_and_binds_current_live_session", async () => {
    pending = await start(a1.cookie); const flow = openReauthFlow(pending.cookie, env);
    assert.equal(flow.user_id, identities[0].id); assert.equal(flow.session_id, a1.claims.sessionId); assert.equal((await resolveDeployedSession(pending.cookie, deps)).userId, identities[0].id);
  });
  await record("wrong_google_uuid_preserves_original_and_other_devices", async () => {
    exchanged = await signIn(identities[1]); const response = await reauthCallbackResponse(callback(pending.cookie), deps);
    assert.match(response.headers.get("location"), /account_mismatch$/); assert.equal(response.headers.getSetCookie().some(x => x.startsWith(SESSION_COOKIE_NAME)), false);
    assert.equal((await resolveDeployedSession(pending.cookie, deps)).userId, identities[0].id);
    assert.equal((await exchanged.client.rpc("get_auth_context")).error?.code, "PT401"); assert.equal((await b1.client.rpc("get_me")).error, null); assert.equal((await a2.client.rpc("get_me")).error, null);
  });
  let acceptedCookie, flowId;
  await record("same_uuid_new_session_issues_real_db_grant_and_ends_previous_session", async () => {
    pending = await start(pending.cookie); exchanged = await signIn(identities[0]);
    const response = await reauthCallbackResponse(callback(pending.cookie), deps); flowId = pending.data.flow_id;
    assert.equal(response.headers.get("location"), `${env.APP_BASE_URL}/account/deletion?flow=${flowId}`); acceptedCookie = combine(response);
    assert.equal((await a1.client.rpc("get_auth_context")).error?.code, "PT401"); assert.equal((await resolveDeployedSession(acceptedCookie, deps)).userId, identities[0].id);
    assert.equal(Number(sql("select count(*) from public.reauth_grants where id=:'grant'::uuid and user_id=:'actor'::uuid and session_id=:'sid'::uuid and consumed_at is null;\n", { grant: flowId, actor: identities[0].id, sid: exchanged.claims.sessionId })), 1);
  });
  await record("state_lookup_requires_current_session_bound_flow", async () => {
    const request = new Request(env.APP_BASE_URL + "/state", { headers: { cookie: acceptedCookie } });
    const response = await reauthStateResponse(request, flowId, deps); assert.equal(response.status, 200); assert.equal((await response.json()).status, "verified");
    const wrongCookie = a2.cookie + "; " + acceptedCookie.split("; ").find(x => x.startsWith(REAUTH_COOKIE_NAME));
    assert.equal((await reauthStateResponse(new Request(env.APP_BASE_URL + "/state", { headers: { cookie: wrongCookie } }), flowId, deps)).status, 403);
  });
  await record("deletion_refuses_false_confirmation_without_consuming_grant", async () => {
    const response = await accountDeletionResponse(post("/api/v1/account/deletion-requests", acceptedCookie, { confirm: false, reauth_grant_id: flowId }), deps); assert.equal(response.status, 400);
    assert.equal((await resolveDeployedSession(acceptedCookie, deps)).userId, identities[0].id);
  });
  let requestId;
  await record("real_deletion_rpc_consumes_once_and_blocks_all_product_sessions", async () => {
    const response = await accountDeletionResponse(post("/api/v1/account/deletion-requests", acceptedCookie, { confirm: true, reauth_grant_id: flowId }), deps);
    assert.equal(response.status, 202); const data = await response.json(); requestId = data.id; assert.equal(data.access_revoked, true); assert.equal(data.status, "pending");
    const receipt = response.headers.getSetCookie().find(x => x.startsWith(DELETION_RECEIPT_COOKIE_NAME) && !x.includes("Max-Age=0")).split(";")[0]; assert.equal(openDeletionReceipt(receipt, env), requestId);
    assert.equal(await resolveDeployedSession(acceptedCookie, deps), null); assert.equal((await a2.client.rpc("get_auth_context")).error?.code, "PT401"); assert.equal((await b1.client.rpc("get_me")).error, null);
    assert.equal(Number(sql("select count(*) from public.account_deletion_requests where id=:'request'::uuid and subject_auth_user_id=:'actor'::uuid and checkpoint='access_revoked';\n", { request: requestId, actor: identities[0].id })), 1);
  });
  await record("deleting_account_new_login_does_not_reopen_product_access", async () => {
    const signed = await signIn(identities[0]); const context = await signed.client.rpc("get_auth_context"); assert.equal(context.error, null); assert.equal(context.data.account_state, "deleting");
    await assert.rejects(resolveDeployedSession(signed.cookie, deps), error => error instanceof SessionAccountError);
    assert.equal((await b1.client.rpc("get_me")).error, null);
  });
} catch { failed = phase; }
finally {
  try {
    if (installed) sql("delete from private.reauth_proof_keys where key_id=:'kid';\n", { kid: keyConfig.keyId });
    if (admin) {
      const ids = sql("select id from auth.users where raw_app_meta_data->>'local_deletion_web_run'=:'run' order by id;\n", { run: runId }).trim().split("\n").filter(Boolean);
      for (const id of ids) {
        assert.match(id, /^[0-9a-f-]{36}$/); assert.equal((await admin.auth.admin.getUserById(id)).data.user.app_metadata.local_deletion_web_run, runId);
        sql("delete from public.account_deletion_requests where subject_auth_user_id=:'actor'::uuid;\ndelete from public.reauth_grants where user_id=:'actor'::uuid;\ndelete from public.profiles where user_id=:'actor'::uuid;\ndelete from public.app_users where id=:'actor'::uuid;\n", { actor: id });
        assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
      }
    }
    if (before) { preserved = snapshot() === before && sessions() === oldSessions && Number(sql("select count(*) from auth.users;\n")) === oldUsers && keysDigest() === oldKeys; assert.ok(preserved); cases.push({ name: "existing_product_auth_and_key_configuration_preserved", status: "passed" }); }
  } catch { failed ??= "cleanup"; }
}
const report = { checked_at: new Date().toISOString(), status: !failed && preserved ? "passed" : "failed", failed_phase: failed ?? null, executed: cases.length, cases, synthetic_local_users: usersCreated, real_local_sessions_issued: sessionsIssued, google_exchange: "stubbed_real_local_tokens_only", real_google_tests_executed: 0, physical_erasure_executed: false, existing_product_auth_and_key_configuration_preserved: preserved, privileged_client_used_only_for_setup_cleanup: true, application_requests_use_user_jwt: true };
fs.writeFileSync("tmp/w12-d2-deletion-local.json", JSON.stringify(report, null, 2) + "\n"); process.stdout.write(JSON.stringify(report) + "\n"); if (report.status !== "passed") process.exitCode = 1;
