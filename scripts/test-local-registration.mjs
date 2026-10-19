import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, sql } from "./local-database-tools.mjs";
import policy from "../policies/app-policy.json" with { type: "json" };

const cases = [];
const probes = [];
const runId = crypto.randomUUID();
const faultName = `w12b_profile_fault_${runId.slice(0, 8)}`;
let phase = "local_setup";
let failed = false;
let cleanup = true;
let faultInstalled = false;
let before;
let sessionsBefore;
let admin;
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

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
const count = (table, column, id) => Number(sql(`select count(*) from public.${table} where ${column}=:'actor'::uuid;\n`, { actor: id }));
const ok = result => { assert.equal(result.error, null); return result.data; };
const denied = (result, code) => { assert.equal(result.data, null); assert.equal(result.error?.code, code); };
const bootstrap = (probe, confirm = true, version = policy.policy_version) => probe.client.rpc("bootstrap_account", { p_adult_confirmed: confirm, p_registration_policy_version: version });
async function record(name, work) { phase = name; await work(); cases.push({ name, status: "passed" }); }
function removeFault() {
  if (!faultInstalled) return;
  sql(`drop trigger if exists ${faultName} on public.profiles;\ndrop function if exists private.${faultName}();\n`);
  faultInstalled = false;
}

try {
  const status = assertLocalDatabase();
  before = snapshot();
  sessionsBefore = Number(sql("select count(*) from auth.sessions;\n"));
  const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  admin = createClient(status.API_URL, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, options);
  for (const label of ["owner", "rollback", "marker", "deleting"]) {
    const credentials = { email: `${label}-${crypto.randomUUID()}@registration.chagokchan.invalid`, password: crypto.randomBytes(32).toString("base64url") };
    const result = await admin.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { local_registration_run: runId } });
    assert.equal(result.error, null);
    const probe = { id: result.data.user.id, client: createClient(status.API_URL, publicKey, options), tokens: null };
    probes.push(probe);
    assert.match(probe.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const issued = await probe.client.auth.signInWithPassword(credentials);
    assert.equal(issued.error, null); assert.equal(issued.data.user.id, probe.id);
    probe.tokens = issued.data.session;
  }
  const [owner, rollback, marker, deleting] = probes;
  // PostgREST schema reload is asynchronous. Only a missing signature is retried.
  let ready;
  const deadline = Date.now() + 10000;
  do {
    ready = await owner.client.rpc("get_auth_context");
    if (ready.error?.code !== "PGRST202") break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  assert.equal(ready.error, null);

  await record("auth_before_registration_has_no_product_permission", async () => {
    assert.deepEqual(ok(await owner.client.rpc("get_auth_context")), { user_id: owner.id, account_state: "signup_required", next: "/signup" });
    denied(await owner.client.rpc("get_me"), "PT403");
    denied(await owner.client.rpc("create_goal", { p_request_key: crypto.randomUUID(), p_title: "가입 전 거절" }), "PT403");
    assert.equal(count("app_users", "id", owner.id), 0);
  });
  await record("explicit_confirmation_and_current_policy_required_for_new_account", async () => {
    denied(await bootstrap(owner, false), "PT400");
    denied(await bootstrap(owner, null), "PT400");
    denied(await bootstrap(owner, true, "0.1.0"), "PT409");
    denied(await bootstrap(owner, true, "invalid"), "PT400");
    assert.equal(count("app_users", "id", owner.id), 0); assert.equal(count("profiles", "user_id", owner.id), 0);
  });
  await record("profile_failure_rolls_back_the_entire_registration", async () => {
    sql(`begin;\ncreate function private.${faultName}() returns trigger language plpgsql set search_path=pg_catalog as $$ begin if new.user_id='${rollback.id}'::uuid then raise exception using errcode='P9999',message='registration_probe_rollback'; end if; return new; end $$;\ncreate trigger ${faultName} before insert on public.profiles for each row execute function private.${faultName}();\ncommit;\n`);
    faultInstalled = true;
    denied(await bootstrap(rollback), "P9999");
    assert.equal(count("app_users", "id", rollback.id), 0); assert.equal(count("profiles", "user_id", rollback.id), 0);
    removeFault();
  });
  await record("retry_after_rollback_creates_one_account_and_neutral_profile", async () => {
    const result = ok(await bootstrap(rollback));
    assert.equal(result.user_id, rollback.id); assert.equal(result.profile.nickname, policy.profile.default_nickname); assert.equal(result.profile.avatar_key, policy.profile.default_avatar_key);
    assert.equal(count("app_users", "id", rollback.id), 1); assert.equal(count("profiles", "user_id", rollback.id), 1);
  });
  let original;
  await record("concurrent_registration_creates_one_account_with_one_confirmation", async () => {
    const results = await Promise.all([bootstrap(owner), bootstrap(owner)]);
    original = ok(results[0]); assert.deepEqual(ok(results[1]), original);
    assert.equal(count("app_users", "id", owner.id), 1); assert.equal(count("profiles", "user_id", owner.id), 1);
    assert.equal(original.registration_policy_version, policy.policy_version); assert.ok(Number.isFinite(Date.parse(original.adult_confirmed_at)));
  });
  await record("active_retry_preserves_first_confirmation_even_with_older_version", async () => {
    assert.deepEqual(ok(await bootstrap(owner, true, "0.1.0")), original);
    assert.deepEqual(ok(await owner.client.rpc("get_me")), original);
    assert.deepEqual(ok(await owner.client.rpc("get_auth_context")), { user_id: owner.id, account_state: "active", next: "/" });
  });
  await record("pending_failed_and_completed_cleanup_markers_prevent_registration", async () => {
    sql("insert into public.account_deletion_requests(subject_auth_user_id) values(:'actor'::uuid);\n", { actor: marker.id });
    for (const state of ["pending", "failed", "completed"]) {
      if (state === "failed") sql("update public.account_deletion_requests set status='failed' where subject_auth_user_id=:'actor'::uuid;\n", { actor: marker.id });
      if (state === "completed") sql("update public.account_deletion_requests set status='completed',started_at=clock_timestamp(),completed_at=clock_timestamp() where subject_auth_user_id=:'actor'::uuid;\n", { actor: marker.id });
      assert.deepEqual(ok(await marker.client.rpc("get_auth_context")), { user_id: marker.id, account_state: "deleting", next: "/account/deletion" });
      denied(await bootstrap(marker), "PT403"); assert.equal(count("app_users", "id", marker.id), 0);
    }
  });
  await record("deleting_account_cannot_be_reactivated_by_registration", async () => {
    ok(await bootstrap(deleting));
    sql("update public.app_users set account_status='deleting',deactivated_at=clock_timestamp() where id=:'actor'::uuid;\n", { actor: deleting.id });
    assert.equal(ok(await deleting.client.rpc("get_auth_context")).account_state, "deleting");
    denied(await bootstrap(deleting), "PT403"); denied(await deleting.client.rpc("get_me"), "PT403");
  });
  await record("authenticated_clients_still_cannot_insert_product_tables_directly", async () => {
    denied(await owner.client.from("app_users").insert({ id: marker.id, adult_confirmed_at: new Date().toISOString(), registration_policy_version: "0.2.0" }), "42501");
    denied(await owner.client.from("profiles").insert({ user_id: marker.id }), "42501");
    assert.equal(count("app_users", "id", marker.id), 0);
  });
  await record("revoked_unexpired_session_cannot_read_auth_state_or_retry_registration", async () => {
    const bearer = createClient(status.API_URL, publicKey, { ...options, global: { headers: { Authorization: `Bearer ${rollback.tokens.access_token}` } } });
    assert.equal((await rollback.client.auth.signOut({ scope: "local" })).error, null);
    denied(await bearer.rpc("get_auth_context"), "PT401");
    denied(await bearer.rpc("bootstrap_account", { p_adult_confirmed: true, p_registration_policy_version: "0.2.0" }), "PT401");
  });
} catch {
  failed = true; cases.push({ name: phase, status: "failed" });
} finally {
  try { removeFault(); } catch { cleanup = false; }
  if (admin) {
    try {
      // Also recover a createUser that committed before a local transport failure.
      const owned = sql("select id::text from auth.users where raw_app_meta_data->>'local_registration_run'=:'run';\n", { run: runId }).trim().split("\n").filter(Boolean);
      for (const id of owned) {
        sql("delete from public.account_deletion_requests where subject_auth_user_id=:'actor'::uuid;\ndelete from public.profiles where user_id=:'actor'::uuid;\ndelete from public.app_users where id=:'actor'::uuid;\n", { actor: id });
        const result = await admin.auth.admin.deleteUser(id); assert.equal(result.error, null);
      }
      assert.equal(Number(sql("select (select count(*) from auth.users where raw_app_meta_data->>'local_registration_run'=:'run') + (select count(*) from pg_trigger where tgname=:'fault') + (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=:'fault');\n", { run: runId, fault: faultName })), 0);
    } catch { cleanup = false; }
  }
  if (before) {
    try { assert.equal(snapshot(), before); assert.equal(Number(sql("select count(*) from auth.sessions;\n")), sessionsBefore); } catch { cleanup = false; }
  }
}
const passed = !failed && cleanup && cases.length === 10;
const report = { checked_at: new Date().toISOString(), work_item: "W12-B", status: passed ? "passed" : "failed",
  executed: cases.length, passed: cases.filter(c => c.status === "passed").length, cases,
  existing_product_data_and_sessions_preserved: before ? cleanup : null, synthetic_users_sessions_and_fault_trigger_removed: cleanup,
  auth_sessions_fabricated: false, service_role_used_for_application_rpcs: false,
  service_role_used_only_for_local_probe_admin: true, real_google_otp_tests_executed: 0,
  full_signup_cleanup_worker_races_executed: false, public_deployment_performed: false };
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/local-registration-tests.json", JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;
