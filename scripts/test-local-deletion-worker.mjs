import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, sql } from "./local-database-tools.mjs";
import { createReauthProof, reauthVerifierConfiguration } from "../src/server/reauth-proof.mjs";
import { sessionTokenClaims } from "../src/server/deployed-session.mjs";
import { processAccountDeletion, runAccountDeletionBatch } from "../src/operations/account-deletion-worker.mjs";
import { LocalEncryptedDeletionLedger } from "../src/operations/local-encrypted-ledger.mjs";

const runId = crypto.randomUUID(), cases = [], sdk = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const env = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production", APP_BASE_URL: "https://worker-test.example.invalid", SUPABASE_URL: "https://database.example.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_transport_only", CSRF_SIGNING_SECRET: crypto.randomBytes(32).toString("base64url"), AUTH_SESSION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64url") };
const keyConfig = reauthVerifierConfiguration(env), ledgerDirectory = path.resolve(".cache", `worker-ledger-${runId}`), ledgerKey = crypto.randomBytes(32);
const ledger = new LocalEncryptedDeletionLedger({ directory: ledgerDirectory, key: ledgerKey, source: "isolated-local-worker" });
let admin, before, oldUsers, oldSessions, oldKeys, oldGate, requestId, subjectId, installed = false, failed, phase = "setup", preserved = false, workerAuthRemoved = false;
const created = [];
const sessions = () => sql("select id from auth.sessions order by id;\n").trim();
const keyDigest = () => sql("select encode(sha256(convert_to(coalesce(string_agg(key_id || enabled::text || encode(key_bytes,'hex'),',' order by key_id),''),'UTF8')),'hex') from private.reauth_proof_keys;\n").trim();
function snapshot() {
  const tables = sql("select tablename from pg_tables where schemaname='public' order by tablename;\n").trim().split("\n"); assert.equal(tables.length, 18);
  const hash = crypto.createHash("sha256");
  for (const table of [...tables.map(name => `public.${name}`), "private.deletion_ledger_completion_acks", "private.deletion_work_leases"]) { assert.match(table, /^[a-z_.]+$/); hash.update(table + "\0" + sql(`select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from (select to_jsonb(t) value from ${table} t) rows;\n`)); }
  return hash.digest("hex");
}
async function record(name, action) { phase = name; await action(); cases.push({ name, status: "passed" }); }
const recordIntent = value => ledger.recordIntent(value);
try {
  const status = assertLocalDatabase(); before = snapshot(); oldUsers = Number(sql("select count(*) from auth.users;\n")); oldSessions = sessions(); oldKeys = keyDigest(); oldGate = sql("select independent_ledger_enabled from private.deletion_worker_config where singleton;\n").trim(); assert.ok(["t", "f"].includes(oldGate));
  const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY; admin = createClient(status.API_URL, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, sdk);
  for (const label of ["delete", "control"]) {
    const credentials = { email: `${label}-${runId}@worker.chagokchan.invalid`, password: crypto.randomBytes(32).toString("base64url") };
    const user = await admin.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { local_worker_probe: runId } }); assert.equal(user.error, null); created.push({ ...credentials, id: user.data.user.id });
  }
  subjectId = created[0].id;
  const login = async user => { const signed = await createClient(status.API_URL, key, sdk).auth.signInWithPassword(user); assert.equal(signed.error, null); const token = signed.data.session.access_token; return { claims: sessionTokenClaims(token), client: createClient(status.API_URL, key, { ...sdk, global: { headers: { Authorization: `Bearer ${token}` } } }) }; };
  const a = await login(created[0]), b = await login(created[1]);
  for (const user of [a, b]) assert.equal((await user.client.rpc("bootstrap_account", { p_adult_confirmed: true, p_registration_policy_version: "0.2.0" })).error, null);
  sql("insert into private.reauth_proof_keys(key_id,key_bytes) values(:'kid',decode(:'material','hex'));\n", { kid: keyConfig.keyId, material: keyConfig.keyBytes.toString("hex") }); installed = true;
  const issued = await a.client.rpc("issue_reauth_grant", createReauthProof({ userId: subjectId, sessionId: a.claims.sessionId, flowId: crypto.randomUUID() }, env)); assert.equal(issued.error, null);
  const requested = await a.client.rpc("request_account_deletion", { p_request_key: crypto.randomUUID(), p_reauth_grant_id: issued.data.grant_id, p_confirm: true }); assert.equal(requested.error, null); requestId = requested.data.id;
  const deps = { client: admin, authAdmin: admin.auth.admin, ledger, requestId };
  await record("ordinary_users_cannot_dispatch_read_or_acknowledge_operations", async () => {
    for (const [name, args] of [["list_account_deletion_work", { p_limit: 1 }], ["get_account_deletion_work", { p_request_id: requestId }], ["ack_account_deletion_ledger", { p_request_id: requestId, p_ledger_reference: requestId }]]) { const result = await b.client.rpc(name, args); assert.equal(result.error?.code, "42501"); }
  });
  await record("disabled_erasure_gate_keeps_user_and_data_even_with_durable_local_intent", async () => {
    sql("update private.deletion_worker_config set independent_ledger_enabled=false where singleton;\n");
    await assert.rejects(processAccountDeletion(deps)); assert.equal((await admin.auth.admin.getUserById(subjectId)).error, null);
    assert.equal(Number(sql("select count(*) from public.app_users where id=:'actor'::uuid;\n", { actor: subjectId })), 1); assert.equal((await ledger.readForRestore(requestId)).retain_until, null);
  });
  sql("update private.deletion_worker_config set independent_ledger_enabled=true where singleton;\n");
  await record("auth_outage_retains_checkpoint_and_unexpired_independent_marker", async () => {
    await assert.rejects(processAccountDeletion({ ...deps, authAdmin: { deleteUser: async () => ({ error: { status: 503 } }), getUserById: value => admin.auth.admin.getUserById(value) } }), error => error.code === "auth_user_delete_failed");
    const work = await admin.rpc("get_account_deletion_work", { p_request_id: requestId }); assert.equal(work.data.checkpoint, "app_data_erased"); assert.equal(work.data.status, "failed");
    assert.equal((await admin.auth.admin.getUserById(subjectId)).error, null); assert.equal((await ledger.readForRestore(requestId)).retain_until, null); assert.equal((await b.client.rpc("get_me")).error, null);
  });
  await record("real_auth_removal_completes_db_but_failed_ledger_finalization_stays_queued", async () => {
    await assert.rejects(processAccountDeletion({ ...deps, ledger: { recordIntent, finalize: async () => { throw new Error("Synthetic unavailable ledger"); } } }), error => error.code === "deletion_ledger_write_failed");
    assert.equal((await admin.auth.admin.getUserById(subjectId)).error?.status, 404); workerAuthRemoved = true;
    const work = await admin.rpc("get_account_deletion_work", { p_request_id: requestId }); assert.equal(work.data.status, "completed"); assert.equal(work.data.ledger_acknowledged, false); assert.equal((await ledger.readForRestore(requestId)).retain_until, null);
    assert.equal((await a.client.rpc("get_auth_context")).error?.code, "PT401"); assert.equal((await b.client.rpc("get_me")).error, null);
  });
  await record("leases_prevent_duplicate_dispatch_and_expire_for_retry", async () => {
    const first = await admin.rpc("list_account_deletion_work", { p_limit: 1 }), second = await admin.rpc("list_account_deletion_work", { p_limit: 1 }); assert.equal(first.error, null); assert.deepEqual(first.data.items, [{ request_id: requestId }]); assert.deepEqual(second.data.items, []);
    sql("update private.deletion_work_leases set lease_until=clock_timestamp()-interval '1 second' where request_id=:'request'::uuid;\n", { request: requestId });
  });
  await record("completed_job_finalizes_and_acknowledges_without_another_auth_delete", async () => {
    const summary = await runAccountDeletionBatch({ ...deps, authAdmin: { deleteUser: async () => { throw new Error("Must not repeat Auth removal"); } }, limit: 1 }); assert.deepEqual(summary, { selected: 1, completed: 1, failed: 0 });
    const work = await admin.rpc("get_account_deletion_work", { p_request_id: requestId }); assert.equal(work.data.ledger_acknowledged, true); const entry = await ledger.readForRestore(requestId);
    assert.equal(Date.parse(entry.retain_until) - Date.parse(work.data.completed_at), 37 * 86400000); assert.deepEqual((await admin.rpc("list_account_deletion_work", { p_limit: 1 })).data.items, []);
  });
  await record("independent_encrypted_marker_survives_db_acknowledgement_replay", async () => {
    sql("delete from private.deletion_ledger_completion_acks where request_id=:'request'::uuid;\n", { request: requestId });
    const restarted = new LocalEncryptedDeletionLedger({ directory: ledgerDirectory, key: ledgerKey, source: "isolated-local-worker" }); assert.equal((await restarted.readForRestore(requestId)).subject_id, subjectId);
    const result = await processAccountDeletion({ ...deps, ledger: restarted, authAdmin: { deleteUser: async () => { throw new Error("Must not repeat Auth removal"); } } }); assert.equal(result.completed, true);
    const file = await fs.readFile(path.join(ledgerDirectory, `${requestId}.json`), "utf8"); assert.ok(!file.includes(subjectId)); assert.equal((await b.client.rpc("get_me")).error, null);
  });
} catch { failed = phase; }
finally {
  try {
    if (installed) sql("delete from private.reauth_proof_keys where key_id=:'kid';\n", { kid: keyConfig.keyId });
    if (oldGate) sql("update private.deletion_worker_config set independent_ledger_enabled=:'enabled'::boolean where singleton;\n", { enabled: oldGate });
    if (admin) for (const user of created) {
      const identity = await admin.auth.admin.getUserById(user.id);
      if (!identity.error) assert.equal(identity.data.user.app_metadata.local_worker_probe, runId); else assert.equal(identity.error.status, 404);
      sql("delete from public.account_deletion_requests where subject_auth_user_id=:'actor'::uuid;\ndelete from public.reauth_grants where user_id=:'actor'::uuid;\ndelete from public.profiles where user_id=:'actor'::uuid;\ndelete from public.app_users where id=:'actor'::uuid;\n", { actor: user.id });
      if (!identity.error) assert.equal((await admin.auth.admin.deleteUser(user.id)).error, null);
    }
    if (requestId) await fs.unlink(path.join(ledgerDirectory, `${requestId}.json`)).catch(error => { if (error.code !== "ENOENT") throw error; });
    await fs.rmdir(ledgerDirectory).catch(error => { if (error.code !== "ENOENT") throw error; });
    if (before) { preserved = snapshot() === before && sessions() === oldSessions && Number(sql("select count(*) from auth.users;\n")) === oldUsers && keyDigest() === oldKeys && sql("select independent_ledger_enabled from private.deletion_worker_config where singleton;\n").trim() === oldGate; assert.ok(preserved); cases.push({ name: "existing_data_auth_worker_state_keys_and_gate_preserved", status: "passed" }); }
  } catch { failed ??= "cleanup"; }
}
const report = { checked_at: new Date().toISOString(), status: !failed && preserved ? "passed" : "failed", failed_phase: failed ?? null, executed: cases.length, cases, synthetic_users: created.length, actual_local_auth_user_removed_by_worker: workerAuthRemoved, independent_ledger: "encrypted_local_files_outside_DB_only", full_database_backup_restore_executed: false, hosted_ledger_or_scheduler_configured: false, real_google_tests_executed: 0, privileged_client_scope: ["synthetic_setup_cleanup", "dedicated_deletion_worker_and_Auth_Admin"], service_role_in_ordinary_web: false, existing_data_keys_gate_auth_and_bookkeeping_preserved: preserved };
await fs.writeFile("tmp/w14-c1-worker-local.json", JSON.stringify(report, null, 2) + "\n"); process.stdout.write(JSON.stringify(report) + "\n"); if (report.status !== "passed") process.exitCode = 1;
