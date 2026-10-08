import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, projectRoot, sql } from "./local-database-tools.mjs";
import { assertFixtureIdentity, validateFixtureManifest } from "./local-fixture-manifest.mjs";

// Developer-only local integration test. Ordinary RPCs use issued user sessions.
// The admin client creates/removes one synthetic probe and never performs an app RPC.
const cases = [];
const clients = [];
let phase = "local_environment";
let failure = false;
let cleanupFailure = false;
let probeCleanupFailure = false;
let admin;
let probeId;
let restoreC;
let beforeSnapshot;
let beforeSessions;
let manifest;
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }) },
};
const record = (name, check) => {
  phase = name;
  check();
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
function fixtureSessionCount() {
  return Number(sql("select count(*) from auth.sessions s join auth.users u on u.id=s.user_id where u.raw_app_meta_data->>'fixture_project'='chagokchan' and u.raw_app_meta_data->>'local_fixture'='true';\n").trim());
}
async function signIn(entry, actor, status) {
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options);
  clients.push(client);
  const result = await client.auth.signInWithPassword({ email: entry.email, password: entry.password });
  if (result.error || !result.data.session || !result.data.user) throw new Error("Synthetic session could not be issued.");
  if (actor) assertFixtureIdentity(result.data.user, actor, entry);
  return { client, token: result.data.session.access_token };
}
try {
  const status = assertLocalDatabase();
  const manifestPath = path.join(projectRoot, "private-data/local-fixtures.json");
  if (fs.lstatSync(manifestPath).isSymbolicLink()) throw new Error("Invalid fixture manifest.");
  manifest = validateFixtureManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  if (!manifest.data_seeded_at) throw new Error("Run explicit local fixture setup first.");
  beforeSnapshot = snapshot();
  beforeSessions = fixtureSessionCount();
  const actorClients = {};
  const actorTokens = {};
  const contract = JSON.parse(fs.readFileSync(path.join(projectRoot, "contracts/openapi.json"), "utf8"));
  const policy = JSON.parse(fs.readFileSync(path.join(projectRoot, "policies/app-policy.json"), "utf8"));
  for (const actor of ["A", "B", "C"]) {
    phase = "issue_local_session_" + actor;
    const issued = await signIn(manifest.actors[actor], actor, status);
    actorClients[actor] = issued.client;
    actorTokens[actor] = issued.token;
    const me = await issued.client.rpc("get_me");
    record(actor + "_own_account_projection", () => {
      assert.equal(me.error, null);
      assert.deepEqual(Object.keys(me.data).sort(), contract.components.schemas.Me.required.slice().sort());
      assert.deepEqual(Object.keys(me.data.profile).sort(), contract.components.schemas.MinimalProfile.required.slice().sort());
      assert.equal(me.data.user_id, manifest.actors[actor].id);
      assert.equal(me.data.profile.user_id, manifest.actors[actor].id);
      assert.equal(me.data.account_status, "active");
      assert.equal(me.data.registration_policy_version, policy.policy_version);
      assert.ok(Number.isFinite(Date.parse(me.data.adult_confirmed_at)));
      assert.ok(policy.profile.avatar_keys.includes(me.data.profile.avatar_key));
      assert.ok(Array.from(me.data.profile.nickname).length <= contract.components.schemas.MinimalProfile.properties.nickname.maxLength);
    });
    for (const table of ["app_users", "profiles", "goals", "praises"]) {
      phase = actor + "_direct_" + table + "_read";
      const result = await issued.client.from(table).select("*").limit(1);
      record(phase, () => denied(result, "42501"));
    }
    phase = actor + "_direct_account_write";
    const write = await issued.client.from("app_users").update({ timezone: "UTC" }).eq("id", manifest.actors[actor].id).select();
    record(phase, () => denied(write, "42501"));
    phase = actor + "_cannot_supply_another_actor";
    const spoof = await issued.client.rpc("get_me", { user_id: manifest.actors[actor === "A" ? "B" : "A"].id });
    record(phase, () => denied(spoof, "PGRST202"));
  }
  phase = "internal_schema_not_exposed";
  const internal = await actorClients.A.schema("private").rpc("require_actor");
  record(phase, () => denied(internal, "PGRST106"));
  phase = "managed_auth_schema_not_exposed";
  const managedAuth = await actorClients.A.schema("auth").from("sessions").select("id").limit(1);
  record(phase, () => denied(managedAuth, "PGRST106"));
  phase = "anonymous_rpc_denied";
  const anonymous = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options);
  const anonymousMe = await anonymous.rpc("get_me");
  record(phase, () => denied(anonymousMe, "42501"));

  phase = "logout_removes_current_session";
  const logout = await actorClients.A.auth.signOut({ scope: "local" });
  assert.equal(logout.error, null);
  // Replay the still-signed issued token in memory; never fabricate or persist a JWT.
  const replayResponse = await fetch(status.API_URL + "/rest/v1/rpc/get_me", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { apikey: status.PUBLISHABLE_KEY ?? status.ANON_KEY, Authorization: "Bearer " + actorTokens.A, "Content-Type": "application/json" },
    body: "{}",
  });
  const replay = await replayResponse.json();
  record("logged_out_unexpired_token_denied", () => {
    assert.equal(replayResponse.status, 401);
    assert.equal(replay.code, "PT401");
    assert.equal(replay.message, "unauthenticated");
  });

  phase = "synthetic_unregistered_account_setup";
  const key = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!key) throw new Error("Local setup key unavailable.");
  admin = createClient(status.API_URL, key, options);
  const probe = { email: "rpc-" + crypto.randomUUID() + "@probe.chagokchan.invalid", password: crypto.randomBytes(32).toString("base64url") };
  const created = await admin.auth.admin.createUser({ ...probe, email_confirm: true, app_metadata: { fixture_project: "chagokchan", local_rpc_probe: true } });
  if (created.error || !created.data.user) throw new Error("Synthetic probe setup failed.");
  probeId = created.data.user.id;
  const probeClient = (await signIn(probe, null, status)).client;
  phase = "authenticated_without_app_account";
  const unregistered = await probeClient.rpc("get_me");
  record(phase, () => denied(unregistered, "PT403", "signup_required"));

  phase = "synthetic_deleting_account_setup";
  const marker = sql("update public.app_users set account_status='deleting',deactivated_at=clock_timestamp() where id=:'actor'::uuid and account_status='active' and deactivated_at is null and not exists(select 1 from public.account_deletion_requests where subject_auth_user_id=:'actor'::uuid and status in ('pending','running','failed')) returning deactivated_at;\n", { actor: manifest.actors.C.id }).trim();
  if (!marker || !Number.isFinite(Date.parse(marker))) throw new Error("Synthetic state setup failed.");
  restoreC = marker;
  phase = "deleting_account_denied_with_live_session";
  const deleting = await actorClients.C.rpc("get_me");
  record(phase, () => denied(deleting, "PT403", "account_unavailable"));
} catch {
  failure = true;
  cases.push({ name: phase, status: "failed" });
} finally {
  if (restoreC) {
    try {
      const restored = sql("update public.app_users set account_status='active',deactivated_at=null where id=:'actor'::uuid and account_status='deleting' and deactivated_at=:'marker'::timestamptz and not exists(select 1 from public.account_deletion_requests where subject_auth_user_id=:'actor'::uuid and status in ('pending','running','failed')) returning id;\n", { actor: manifest.actors.C.id, marker: restoreC }).trim();
      if (restored !== manifest.actors.C.id) cleanupFailure = true;
    } catch { cleanupFailure = true; }
  }
  for (const client of clients) {
    try { if ((await client.auth.signOut({ scope: "local" })).error) cleanupFailure = true; } catch { cleanupFailure = true; }
  }
  if (probeId) {
    try {
      if ((await admin.auth.admin.deleteUser(probeId)).error) probeCleanupFailure = true;
      const remaining = sql("select count(*) from auth.sessions where user_id=:'actor'::uuid;\n", { actor: probeId }).trim();
      if (remaining !== "0") probeCleanupFailure = true;
    } catch { probeCleanupFailure = true; }
    if (probeCleanupFailure) cleanupFailure = true;
  }
  if (beforeSnapshot) {
    try {
      if (snapshot() !== beforeSnapshot || fixtureSessionCount() !== beforeSessions) cleanupFailure = true;
    } catch { cleanupFailure = true; }
  }
}
const passed = !failure && !cleanupFailure && cases.length === 27;
const report = {
  verified_at: new Date().toISOString(), scope: "local_issued_session_self_account_and_access_boundary_only",
  status: passed ? "passed" : "failed", executed: cases.length, passed: cases.filter(entry => entry.status === "passed").length,
  cases, cleanup_passed: !cleanupFailure, synthetic_probe_cleanup_passed: !probeCleanupFailure, app_fixture_data_preserved: !!beforeSnapshot && !cleanupFailure,
  human_login_tests_executed: 0, provider_login_tests_executed: 0, tokens_fabricated: false, credentials_logged: false,
  service_role_used_for_app_rpc: false, business_write_or_concurrency_tests_executed: 0,
};
fs.mkdirSync(path.join(projectRoot, "tmp"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "tmp/local-rpc-tests.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;
