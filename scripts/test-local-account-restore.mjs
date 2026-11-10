import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, sql } from "./local-database-tools.mjs";
import { LocalRestoreDatabase } from "./local-restore-database.mjs";
import { createReauthProof, reauthVerifierConfiguration } from "../src/server/reauth-proof.mjs";
import { sessionTokenClaims } from "../src/server/deployed-session.mjs";
import { processAccountDeletion } from "../src/operations/account-deletion-worker.mjs";
import { LocalEncryptedDeletionLedger } from "../src/operations/local-encrypted-ledger.mjs";
import { encryptBackupArchive, decryptBackupArchive } from "../src/operations/encrypted-backup.mjs";

const runId = crypto.randomUUID(), cases = [], users = [], requestIds = [], timings = {};
const sdk = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }) } };
const env = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production", APP_BASE_URL: "https://restore-test.example.invalid", SUPABASE_URL: "https://database.example.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_transport_only", AUTH_SESSION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64url"), CSRF_SIGNING_SECRET: crypto.randomBytes(32).toString("base64url") };
const verifier = reauthVerifierConfiguration(env), directory = path.resolve(".cache", `restore-ledger-${runId}`), ledgerKey = crypto.randomBytes(32);
const ledger = new LocalEncryptedDeletionLedger({ directory, key: ledgerKey, source: "isolated-local-restore" });
const backupPath = path.resolve(".cache", `restore-backup-${runId}.enc`), backupOptions = { key: crypto.randomBytes(32), source: "isolated-local-source", createdAt: new Date().toISOString() };
let admin, restore, before, originalUsers, originalSessions, originalGate, originalRoles, installed = false, failed, phase = "setup", preserved = false, targetDropped = false, archive, backupBytes = 0, actualAuthRemoved = false;
const checked = result => { if (result.error || !result.data) throw new Error("Synthetic RPC failed."); return result.data; };
async function record(name, action) { phase = name; await action(); cases.push({ name, status: "passed" }); }
function sourceSnapshot() {
  const tables = sql("select schemaname||'.'||tablename from pg_tables where schemaname in ('public','private') order by schemaname,tablename;\n").trim().split(/\r?\n/);
  assert.ok(tables.length >= 20); assert.ok(tables.every(value => /^[a-z_]+\.[a-z_]+$/.test(value)));
  const statement = tables.map(table => `select '${table}' relation,coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)::text rows from (select to_jsonb(t) value from ${table} t) items`).join(" union all ");
  return crypto.createHash("sha256").update(sql(statement + " order by relation;\n")).digest("hex");
}
const usersState = () => sql("select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from auth.users;\n").trim();
const sessionsState = () => sql("select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from auth.sessions;\n").trim();
const rolesState = () => sql("select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) order by rolname)::text,''),'UTF8')),'hex') from pg_roles r;\n").trim();
function restoredSubjectCounts(subject) {
  return JSON.parse(restore.query("select jsonb_build_object('auth',(select count(*) from auth.users where id=:'actor'::uuid),'session',(select count(*) from auth.sessions where user_id=:'actor'::uuid),'app',(select count(*) from public.app_users where id=:'actor'::uuid),'profile',(select count(*) from public.profiles where user_id=:'actor'::uuid),'goal',(select count(*) from public.goals where owner_user_id=:'actor'::uuid),'praise',(select count(*) from public.praises where actor_user_id=:'actor'::uuid or recipient_user_id=:'actor'::uuid),'grants',(select count(*) from public.board_members where user_id=:'actor'::uuid or granted_by_user_id=:'actor'::uuid));\n", { actor: subject }));
}
async function requestDeletion(user) {
  const proof = checked(await user.client.rpc("issue_reauth_grant", createReauthProof({ userId: user.id, sessionId: user.claims.sessionId, flowId: crypto.randomUUID() }, env)));
  const result = checked(await user.client.rpc("request_account_deletion", { p_request_key: crypto.randomUUID(), p_reauth_grant_id: proof.grant_id, p_confirm: true })); requestIds.push(result.id); return result.id;
}
try {
  const status = assertLocalDatabase(); before = sourceSnapshot(); originalUsers = usersState(); originalSessions = sessionsState(); originalGate = sql("select independent_ledger_enabled from private.deletion_worker_config where singleton;\n").trim(); originalRoles = rolesState();
  admin = createClient(status.API_URL, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, sdk); restore = new LocalRestoreDatabase();
  for (const label of ["deleted", "control"]) {
    const credentials = { email: `${label}-${runId}@restore.chagokchan.invalid`, password: crypto.randomBytes(32).toString("base64url") };
    const created = checked(await admin.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { isolated_restore_probe: runId } }));
    const user = { id: created.user.id }; users.push(user);
    const login = checked(await createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, sdk).auth.signInWithPassword(credentials));
    user.claims = sessionTokenClaims(login.session.access_token); user.client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, { ...sdk, global: { ...sdk.global, headers: { Authorization: `Bearer ${login.session.access_token}` } } });
    checked(await user.client.rpc("bootstrap_account", { p_adult_confirmed: true, p_registration_policy_version: "0.2.0" }));
    const goal = checked(await user.client.rpc("create_goal", { p_request_key: crypto.randomUUID(), p_title: `restore-${label}-${runId}`, p_personal_target_count: 2 })); user.goalId = goal.id;
    const board = sql("select id from public.boards where goal_id=:'goal'::uuid and kind='personal';\n", { goal: goal.id }).trim();
    const day = sql("select (clock_timestamp() at time zone timezone)::date from public.app_users where id=:'actor'::uuid;\n", { actor: user.id }).trim();
    checked(await user.client.rpc("create_praise", { p_request_key: crypto.randomUUID(), p_board_id: board, p_message: `synthetic-private-${label}-${runId}`, p_occurred_on: day }));
  }
  sql("insert into private.reauth_proof_keys(key_id,key_bytes) values(:'kid',decode(:'key','hex'));\n", { kid: verifier.keyId, key: verifier.keyBytes.toString("hex") }); installed = true;
  await record("full_local_schema_auth_and_product_snapshot_encrypted_before_erasure", async () => {
    const start = performance.now(); archive = restore.dumpSource(); backupBytes = archive.length;
    const sealed = encryptBackupArchive(archive, backupOptions), handle = await fs.open(backupPath, "wx", 0o600);
    try { await handle.writeFile(sealed); await handle.sync(); } finally { await handle.close(); }
    assert.ok(decryptBackupArchive(await fs.readFile(backupPath), backupOptions).equals(archive)); timings.backup_ms = Math.round(performance.now() - start);
  });
  await record("wrong_backup_key_context_or_tampering_refuses_restore", async () => {
    const sealed = await fs.readFile(backupPath);
    for (const options of [{ ...backupOptions, key: crypto.randomBytes(32) }, { ...backupOptions, source: "other-source" }, { ...backupOptions, createdAt: new Date(Date.parse(backupOptions.createdAt) + 1).toISOString() }]) assert.throws(() => decryptBackupArchive(sealed, options));
    const altered = Buffer.from(sealed); altered[altered.length - 1] ^= 1; assert.throws(() => decryptBackupArchive(altered, backupOptions));
  });
  let requestId, marker;
  await record("real_source_account_auth_and_owned_content_erased_after_snapshot", async () => {
    requestId = await requestDeletion(users[0]); sql("update private.deletion_worker_config set independent_ledger_enabled=true where singleton;\n");
    await processAccountDeletion({ client: admin, authAdmin: admin.auth.admin, ledger, requestId }); assert.equal((await admin.auth.admin.getUserById(users[0].id)).error?.status, 404); actualAuthRemoved = true;
    assert.equal(Number(sql("select count(*) from public.goals where id=:'goal'::uuid;\n", { goal: users[0].goalId })), 0); marker = await ledger.readForRestore(requestId); assert.ok(marker.completed_at);
    assert.equal(Date.parse(marker.retain_until) - Date.parse(marker.completed_at), 37 * 86400000); assert.equal((await users[1].client.rpc("get_me")).error, null);
  });
  await record("restore_old_snapshot_to_unexposed_disposable_database_only", async () => {
    const start = performance.now(); await restore.create(); restore.restore(decryptBackupArchive(await fs.readFile(backupPath), backupOptions)); timings.restore_ms = Math.round(performance.now() - start);
    const a = restoredSubjectCounts(users[0].id); assert.equal(a.auth, 1); assert.equal(a.app, 1); assert.equal(a.profile, 1); assert.equal(a.goal, 1); assert.equal(a.praise, 1); assert.ok(a.session >= 1);
    assert.equal(Number(restore.query("select count(*) from supabase_migrations.schema_migrations;\n")), 56);
    assert.equal(Number(restore.query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity;\n")), 18);
  });
  await record("latest_independent_marker_reapplied_before_any_public_connection", async () => {
    const start = performance.now(), bBefore = restoredSubjectCounts(users[1].id);
    // Restore administration is isolated from the running Auth API. Rebuild the
    // deleted request from the independent marker, then use existing erasure RPC.
    // Direct Auth row removal below is ONLY in this disposable restore DB; it is
    // not a production Auth Admin integration test or a hosted restore runbook.
    assert.equal(marker.request_id, requestId); assert.equal(marker.subject_id, users[0].id); assert.equal(marker.kind, "account");
    restore.query("begin;\nupdate public.app_users set account_status='deleting',deactivated_at=clock_timestamp() where id=:'actor'::uuid;\ninsert into public.account_deletion_requests(id,user_id,subject_auth_user_id,status,checkpoint,requested_at) values(:'request'::uuid,:'actor'::uuid,:'actor'::uuid,'pending','access_revoked',:'requested'::timestamptz);\nupdate private.deletion_worker_config set independent_ledger_enabled=true where singleton;\nset local role service_role;\nselect set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\nselect public.process_account_deletion(:'request'::uuid,:'request'::uuid);\nreset role;\ndelete from auth.users where id=:'actor'::uuid;\nset local role service_role;\nselect public.complete_account_deletion(:'request'::uuid);\ncommit;\n", { actor: marker.subject_id, request: marker.request_id, requested: marker.requested_at });
    const a = restoredSubjectCounts(users[0].id); assert.ok(Object.values(a).every(value => value === 0)); assert.deepEqual(restoredSubjectCounts(users[1].id), bBefore); timings.marker_reapply_ms = Math.round(performance.now() - start);
  });
  await record("restored_revoked_session_denied_and_control_goal_praise_preserved", async () => {
    const claims = JSON.stringify({ role: "authenticated", sub: users[0].id, session_id: users[0].claims.sessionId, exp: Math.floor(Date.now() / 1000) + 60 });
    // Administrative SQL supplies restored session metadata to the DB guard.
    // No JWT is minted or sent to any Auth/API endpoint for this assertion.
    const denial = restore.query("begin;\nset local role authenticated;\nselect set_config('request.jwt.claims',:'claims',true) is not null;\ndo $$ begin perform public.get_me(); raise exception 'expected_denial'; exception when sqlstate 'PT401' then null; end $$;\nrollback;\n", { claims }); assert.ok(denial.includes("t"));
    const b = restoredSubjectCounts(users[1].id); assert.equal(b.auth, 1); assert.equal(b.app, 1); assert.equal(b.goal, 1); assert.equal(b.praise, 1);
  });
} catch { failed = phase; }
finally {
  try {
    if (restore) { restore.drop(); targetDropped = true; }
    if (installed) sql("delete from private.reauth_proof_keys where key_id=:'kid';\n", { kid: verifier.keyId });
    if (originalGate) sql("update private.deletion_worker_config set independent_ledger_enabled=:'enabled'::boolean where singleton;\n", { enabled: originalGate });
    if (admin) for (const user of users) {
      const found = await admin.auth.admin.getUserById(user.id); if (!found.error) assert.equal(found.data.user.app_metadata.isolated_restore_probe, runId); else assert.equal(found.error.status, 404);
      sql("delete from public.account_deletion_requests where subject_auth_user_id=:'actor'::uuid;\ndelete from public.notifications where recipient_user_id=:'actor'::uuid or actor_user_id=:'actor'::uuid;\ndelete from public.praises where actor_user_id=:'actor'::uuid or recipient_user_id=:'actor'::uuid;\nupdate public.boards set current_bunch_id=null where owner_user_id=:'actor'::uuid;\ndelete from public.bunches where board_id in (select id from public.boards where owner_user_id=:'actor'::uuid);\ndelete from public.board_members where user_id=:'actor'::uuid or board_id in (select id from public.boards where owner_user_id=:'actor'::uuid);\ndelete from public.shared_board_profiles where board_id in (select id from public.boards where owner_user_id=:'actor'::uuid);\ndelete from public.boards where owner_user_id=:'actor'::uuid;\ndelete from public.goals where owner_user_id=:'actor'::uuid;\ndelete from public.audit_events where actor_user_id=:'actor'::uuid;\ndelete from public.rate_usage where actor_user_id=:'actor'::uuid;\ndelete from public.request_receipts where actor_user_id=:'actor'::uuid;\ndelete from public.reauth_grants where user_id=:'actor'::uuid;\ndelete from public.profiles where user_id=:'actor'::uuid;\ndelete from public.app_users where id=:'actor'::uuid;\n", { actor: user.id });
      if (!found.error) assert.equal((await admin.auth.admin.deleteUser(user.id)).error, null);
    }
    for (const request of requestIds) await fs.unlink(path.join(directory, `${request}.json`)).catch(error => { if (error.code !== "ENOENT") throw error; });
    await fs.rmdir(directory).catch(error => { if (error.code !== "ENOENT") throw error; }); await fs.unlink(backupPath).catch(error => { if (error.code !== "ENOENT") throw error; });
    archive?.fill(0); backupOptions.key.fill(0); ledgerKey.fill(0);
    if (before) { preserved = before === sourceSnapshot() && originalUsers === usersState() && originalSessions === sessionsState() && originalRoles === rolesState(); assert.ok(preserved); cases.push({ name: "disposable_database_and_files_removed_existing_source_auth_keys_roles_gate_preserved", status: "passed" }); }
  } catch { failed ??= "cleanup"; }
}
const report = { checked_at: new Date().toISOString(), status: !failed && preserved && targetDropped ? "passed" : "failed", failed_phase: failed ?? null, executed: cases.length, cases, timings_ms: timings, full_local_pg_dump_pg_restore_executed: cases.some(item => item.name === "restore_old_snapshot_to_unexposed_disposable_database_only"), pg_dump_version: "17.11", backup_bytes: backupBytes, actual_source_auth_removed_by_worker: actualAuthRemoved, independent_latest_account_marker_reapplied: cases.some(item => item.name === "latest_independent_marker_reapplied_before_any_public_connection"), synthetic_users: users.length, original_source_preserved: preserved, disposable_target_dropped: targetDropped, archive_data_or_secret_logged: false, network_exposed_restore: false, mail_sent_from_restore: false, hosted_backup_schedule_configured: false, hosted_restore_acceptance_executed: false, goal_only_purge_or_praise_cancel_restore_executed: false, real_google_tests_executed: 0, production_data_used: false };
await fs.writeFile("tmp/w14-c2a-local-restore.json", JSON.stringify(report, null, 2) + "\n"); process.stdout.write(JSON.stringify(report) + "\n"); if (report.status !== "passed") process.exitCode = 1;
