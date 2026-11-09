import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, sql } from "./local-database-tools.mjs";
import { createReauthProof, reauthVerifierConfiguration } from "../src/server/reauth-proof.mjs";

const runId = crypto.randomUUID();
const env = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production", APP_BASE_URL: "https://reauth-test.example.invalid", SUPABASE_URL: "https://database.example.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_transport_only", CSRF_SIGNING_SECRET: crypto.randomBytes(32).toString("base64url"), AUTH_SESSION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64url") };
const sdkOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const cases = [];
let admin, before, oldSessions, oldUsers, oldKeys, failed;
let phase = "setup";
let installedKey = false, usersCreated = 0, sessionsIssued = 0, preserved = false;
let lastRpcCode = null;
const keyConfig = reauthVerifierConfiguration(env);
function snapshot() {
  const tables = sql("select tablename from pg_tables where schemaname='public' order by tablename;\n").trim().split("\n");
  assert.equal(tables.length, 18); const hash = crypto.createHash("sha256");
  for (const table of tables) { assert.match(table, /^[a-z_]+$/); hash.update(table + "\0" + sql(`select coalesce(jsonb_agg(row_value order by row_value::text),'[]'::jsonb) from (select to_jsonb(t) row_value from public.${table} t) rows;\n`)); }
  return hash.digest("hex");
}
const sessions = () => sql("select id from auth.sessions order by id;\n").trim();
const keysDigest = () => sql("select encode(sha256(convert_to(coalesce(string_agg(key_id || enabled::text || encode(key_bytes,'hex'),',' order by key_id),''),'UTF8')),'hex') from private.reauth_proof_keys;\n").trim();
async function record(name, work) { phase = name; await work(); cases.push({ name, status: "passed" }); }
const denied = (result, code) => { assert.equal(result.data, null); assert.equal(result.error?.code, code); };
try {
  const status = assertLocalDatabase(); before = snapshot(); oldSessions = sessions(); oldUsers = Number(sql("select count(*) from auth.users;\n")); oldKeys = keysDigest();
  const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  admin = createClient(status.API_URL, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, sdkOptions);
  const identities = [];
  for (const label of ["one", "two"]) {
    const credentials = { email: `${label}-${runId}@reauth.chagokchan.invalid`, password: crypto.randomBytes(32).toString("base64url") };
    const result = await admin.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { local_reauth_run: runId } });
    assert.equal(result.error, null); usersCreated++; identities.push({ ...credentials, id: result.data.user.id });
  }
  const signIn = async identity => {
    const signedIn = await createClient(status.API_URL, key, sdkOptions).auth.signInWithPassword({ email: identity.email, password: identity.password });
    assert.equal(signedIn.error, null); sessionsIssued++;
    const token = signedIn.data.session.access_token;
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return { client: createClient(status.API_URL, key, { ...sdkOptions, global: { headers: { Authorization: `Bearer ${token}` } } }), token,
      context: { userId: identity.id, sessionId: claims.session_id, flowId: crypto.randomUUID() } };
  };
  const a1 = await signIn(identities[0]), a2 = await signIn(identities[0]), b1 = await signIn(identities[1]);
  for (const user of [a1, b1]) assert.equal((await user.client.rpc("bootstrap_account", { p_adult_confirmed: true, p_registration_policy_version: "0.2.0" })).error, null);
  const proof = createReauthProof(a1.context, env);
  const invoke = async (user, signed = proof) => { const result = await user.client.rpc("issue_reauth_grant", signed); lastRpcCode = result.error?.code ?? null; return result; };
  await record("unconfigured_verifier_fails_closed", async () => { denied(await invoke(a1), "PT503"); });
  assert.equal(Number(sql("select count(*) from private.reauth_proof_keys where key_id=:'kid';\n", { kid: keyConfig.keyId })), 0);
  sql("insert into private.reauth_proof_keys(key_id,key_bytes) values (:'kid',decode(:'key_material','hex'));\n", { kid: keyConfig.keyId, key_material: keyConfig.keyBytes.toString("hex") }); installedKey = true;
  await record("ordinary_authenticated_user_cannot_insert_a_grant_directly", async () => {
    denied(await a1.client.from("reauth_grants").insert({ id: crypto.randomUUID(), user_id: a1.context.userId, session_id: a1.context.sessionId, scope: "account.delete", expires_at: new Date(Date.now() + 600000).toISOString() }), "42501");
  });
  await record("bad_signature_and_noncanonical_payload_cannot_issue_grants", async () => {
    const signature = Buffer.from(proof.p_signature, "base64url"); signature[0] ^= 1;
    denied(await invoke(a1, { ...proof, p_signature: signature.toString("base64url") }), "PT403");
    denied(await invoke(a1, { ...proof, p_payload: `${proof.p_payload}=` }), "PT400");
  });
  await record("even_a_signed_proof_must_match_current_uuid_and_session", async () => {
    denied(await invoke(a2), "PT403"); denied(await invoke(b1), "PT403");
  });
  await record("expired_future_and_different_origin_proofs_are_rejected", async () => {
    denied(await invoke(a1, createReauthProof(a1.context, env, Date.now() - 601000)), "PT403");
    denied(await invoke(a1, createReauthProof(a1.context, env, Date.now() + 60000)), "PT403");
    denied(await invoke(a1, createReauthProof(a1.context, { ...env, APP_BASE_URL: "https://other.example.invalid" })), "PT503");
  });
  await record("signed_wrong_scope_provider_and_expanded_claims_are_rejected", async () => {
    const original = JSON.parse(Buffer.from(proof.p_payload, "base64url").toString("utf8"));
    for (const change of [{ scope: "admin" }, { provider: "email_otp" }, { extra: "not-allowed" }]) {
      const p_payload = Buffer.from(JSON.stringify({ ...original, ...change })).toString("base64url");
      const p_signature = crypto.createHmac("sha256", keyConfig.keyBytes).update(p_payload).digest("base64url");
      denied(await invoke(a1, { p_payload, p_signature }), "PT400");
    }
  });
  await record("disabled_key_cannot_issue_a_grant", async () => {
    sql("update private.reauth_proof_keys set enabled=false where key_id=:'kid';\n", { kid: keyConfig.keyId });
    denied(await invoke(a1), "PT503");
    sql("update private.reauth_proof_keys set enabled=true where key_id=:'kid';\n", { kid: keyConfig.keyId });
  });
  let grant;
  await record("concurrent_signed_retries_return_one_session_bound_ten_minute_grant", async () => {
    const responses = await Promise.all([invoke(a1), invoke(a1)]);
    for (const response of responses) assert.equal(response.error, null);
    assert.deepEqual(responses[0].data, responses[1].data); grant = responses[0].data;
    assert.deepEqual(Object.keys(grant).sort(), ["expires_at", "grant_id"]); assert.equal(grant.grant_id, a1.context.flowId);
    assert.equal(Number(sql("select count(*) from public.reauth_grants where id=:'grant'::uuid and user_id=:'actor'::uuid and session_id=:'sid'::uuid and scope='account.delete' and expires_at<=verified_at+interval '10 minutes';\n", { grant: grant.grant_id, actor: a1.context.userId, sid: a1.context.sessionId })), 1);
  });
  await record("another_session_cannot_consume_the_grant_and_revoked_jwt_cannot_reissue_it", async () => {
    denied(await a2.client.rpc("request_account_deletion", { p_request_key: crypto.randomUUID(), p_reauth_grant_id: grant.grant_id, p_confirm: true }), "PT403");
    assert.equal((await a1.client.auth.admin.signOut(a1.token, "local")).error, null);
    denied(await invoke(a1), "PT401");
  });
  await record("a_consumed_grant_is_not_reissued", async () => {
    const signed = createReauthProof(a2.context, env); const response = await invoke(a2, signed); assert.equal(response.error, null);
    sql("update public.reauth_grants set consumed_at=clock_timestamp() where id=:'grant'::uuid and user_id=:'actor'::uuid;\n", { grant: a2.context.flowId, actor: a2.context.userId });
    denied(await invoke(a2, signed), "PT403");
  });
  await record("fresh_grant_consumes_atomically_and_revokes_product_access_without_other_user_changes", async () => {
    const context = { ...a2.context, flowId: crypto.randomUUID() };
    const issued = await invoke(a2, createReauthProof(context, env)); assert.equal(issued.error, null);
    const result = await a2.client.rpc("request_account_deletion", { p_request_key: crypto.randomUUID(), p_reauth_grant_id: issued.data.grant_id, p_confirm: true });
    assert.equal(result.error, null); assert.equal(result.data.access_revoked, true); assert.equal(result.data.status, "pending");
    denied(await a2.client.rpc("get_me"), "PT403"); denied(await invoke(a2, createReauthProof(context, env)), "PT403");
    assert.equal((await b1.client.rpc("get_me")).error, null);
  });
} catch { failed = phase; }
finally {
  try {
    if (installedKey) sql("delete from private.reauth_proof_keys where key_id=:'kid';\n", { kid: keyConfig.keyId });
    if (admin) {
      const ids = sql("select id from auth.users where raw_app_meta_data->>'local_reauth_run'=:'run' order by id;\n", { run: runId }).trim().split("\n").filter(Boolean);
      for (const id of ids) {
        assert.match(id, /^[0-9a-f-]{36}$/); const identity = await admin.auth.admin.getUserById(id); assert.equal(identity.data.user.app_metadata.local_reauth_run, runId);
        sql("delete from public.account_deletion_requests where subject_auth_user_id=:'actor'::uuid;\ndelete from public.reauth_grants where user_id=:'actor'::uuid;\ndelete from public.profiles where user_id=:'actor'::uuid;\ndelete from public.app_users where id=:'actor'::uuid;\n", { actor: id });
        assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
      }
    }
    if (before) { preserved = snapshot() === before && sessions() === oldSessions && Number(sql("select count(*) from auth.users;\n")) === oldUsers && keysDigest() === oldKeys; assert.ok(preserved); cases.push({ name: "existing_product_auth_and_key_configuration_preserved", status: "passed" }); }
  } catch { failed ??= "cleanup"; }
}
const report = { checked_at: new Date().toISOString(), status: !failed && preserved ? "passed" : "failed", failed_phase: failed ?? null, failed_rpc_code:failed?lastRpcCode:null, executed: cases.length, cases, synthetic_local_users: usersCreated, real_local_sessions_issued: sessionsIssued, signed_google_result:'synthetic_server_attestation_only', real_google_tests_executed:0, existing_product_auth_and_key_configuration_preserved:preserved, actual_keys_or_credentials_logged:false, privileged_client_used_only_for_setup_cleanup:true, application_requests_use_user_jwt:true };
fs.writeFileSync("tmp/w12-d1-reauth-proof-local.json",JSON.stringify(report,null,2)+"\n");process.stdout.write(JSON.stringify(report)+"\n");if(report.status!=="passed")process.exitCode=1;
