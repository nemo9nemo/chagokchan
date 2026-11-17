import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, databaseContainer, projectRoot, sql } from "./local-database-tools.mjs";
import { createCsrfToken } from "../src/server/api-security.mjs";
import { updateMeResponse } from "../src/server/profile-api.mjs";
import { previewConnectionInviteResponse } from "../src/server/connection-api.mjs";
import { profileDisplayCode } from "../src/shared/profile.mjs";

const cases = [], probes = [], runId = crypto.randomUUID();
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }) } };
let status, admin, before, locker, phase = "setup", failure = null, cleanup = true, preserved = false;
const ok = result => { assert.equal(result.error, null, result.error?.code); return result.data; };
const denied = (result, code) => { assert.equal(result.data, null); assert.equal(result.error?.code, code); };
async function record(name, work) { phase = name; await work(); cases.push({ name, status: "passed" }); }
function snapshot() {
  const digest = crypto.createHash("sha256");
  const tables = sql("select schemaname||'.'||tablename from pg_tables where schemaname in ('public','private') order by 1;\n").trim().split("\n").filter(Boolean);
  for (const table of [...tables, "auth.users", "auth.sessions"]) {
    assert.match(table, /^(public|private|auth)\.[a-z_]+$/);
    // Hash inside the database: never return existing user records to the test report.
    digest.update(table + sql("select md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' order by to_jsonb(t)::text),'')) from " + table + " t;\n"));
  }
  digest.update(sql("select md5(coalesce(string_agg(row_to_json(r)::text,E'\\n' order by rolname),'')) from pg_roles r;\n"));
  return digest.digest("hex");
}
async function probe() {
  const credentials = { email: "profile-" + crypto.randomUUID() + "@checks.chagokchan.invalid", password: crypto.randomBytes(32).toString("base64url") };
  const created = ok(await admin.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { isolated_profile_probe: runId } }));
  const value = { id: created.user.id, client: createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options) };
  probes.push(value);
  const signed = ok(await value.client.auth.signInWithPassword(credentials));
  value.token = signed.session.access_token;
  const policy = JSON.parse(fs.readFileSync(path.join(projectRoot, "policies/app-policy.json"), "utf8"));
  ok(await value.client.rpc("bootstrap_account", { p_adult_confirmed: true, p_registration_policy_version: policy.policy_version }));
  return value;
}
const read = async value => ok(await value.client.rpc("get_me"));
const resetQuota = value => sql("delete from public.rate_usage where actor_user_id=:'actor'::uuid and scope_key='profile_update_minute';\n", { actor: value.id });
function bearer(value) { return createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, { ...options, global: { ...options.global, headers: { Authorization: "Bearer " + value.token } } }); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function deletionLock(value) {
  locker = spawn("docker", ["exec", "-i", databaseContainer, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-v", "actor=" + value.id], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  locker.stdout.on("data", chunk => { output += chunk.toString(); });
  locker.stderr.on("data", () => {});
  locker.stdin.write("begin;\nselect pg_advisory_xact_lock(hashtextextended('account-deletion:'||:'actor',0));\nupdate public.app_users set account_status='deleting',deactivated_at=clock_timestamp() where id=:'actor'::uuid;\nselect 'PROFILE_DELETE_LOCKED';\n");
  for (let index = 0; index < 100 && !output.includes("PROFILE_DELETE_LOCKED"); index++) await pause(50);
  assert.ok(output.includes("PROFILE_DELETE_LOCKED"), "Administrative deletion fixture lock acquired");
}
async function releaseLock(commit = false) {
  if (!locker) return;
  const child = locker; locker = null;
  const closed = new Promise(resolve => child.once("close", resolve));
  child.stdin.end((commit ? "commit;" : "rollback;") + "\n\\q\n");
  assert.equal(await closed, 0, "Fixture transaction closed");
}

try {
  status = assertLocalDatabase();
  admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY ?? status.SECRET_KEY, options);
  before = snapshot();
  const a = await probe(), b = await probe(), c = await probe();
  await record("issued_session_patch_and_partial_field_preservation", async () => {
    const originalB = await read(b);
    const first = ok(await a.client.rpc("update_my_profile", { p_nickname: "  가  " }));
    assert.equal(first.profile.nickname, "가"); assert.equal(first.user_id, a.id);
    const next = ok(await a.client.rpc("update_my_profile", { p_avatar_key: "leaf" }));
    assert.equal(next.profile.nickname, "가"); assert.equal(next.profile.avatar_key, "leaf");
    assert.deepEqual(await read(b), originalB);
  });
  await record("unicode_boundary_and_invalid_values_leave_profile_unchanged", async () => {
    const emoji = "😀".repeat(20);
    assert.equal(ok(await a.client.rpc("update_my_profile", { p_nickname: emoji })).profile.nickname, emoji);
    for (const name of ["", " ", "　", "a\u0085b", "a\tb", "😀".repeat(21)]) denied(await a.client.rpc("update_my_profile", { p_nickname: name }), "PT400");
    denied(await a.client.rpc("update_my_profile", { p_avatar_key: "url" }), "PT400");
    denied(await a.client.rpc("update_my_profile"), "PT400");
    assert.equal((await read(a)).profile.nickname, emoji);
  });
  await record("bff_csrf_identity_rejection_and_real_rpc_save", async () => {
    const origin = "http://127.0.0.1:3417", secret = crypto.randomBytes(32).toString("hex"), token = createCsrfToken(secret);
    const config = { expectedOrigin: origin, secret, env: { APP_AUTH_MODE: "local_fixture" } };
    const request = (body, csrf = true) => new Request(origin + "/api/v1/me", { method: "PATCH", headers: { origin, "content-type": "application/json", ...(csrf ? { cookie: "chagokchan_csrf=" + token, "x-csrf-token": token } : {}) }, body: JSON.stringify(body) });
    assert.equal((await updateMeResponse(request({ nickname: "금지" }, false), a.client, a.id, config)).status, 403);
    assert.equal((await updateMeResponse(request({ user_id: b.id, nickname: "금지" }), a.client, a.id, config)).status, 400);
    const response = await updateMeResponse(request({ nickname: "동일 이름" }), a.client, a.id, config);
    assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(await response.json(), await read(a));
  });
  await record("duplicate_names_distinct_preview_suffix_and_direct_dml_denial", async () => {
    ok(await b.client.rpc("update_my_profile", { p_nickname: "동일 이름" }));
    const invite = ok(await a.client.rpc("create_connection_invite"));
    const preview = ok(await b.client.rpc("preview_connection_invite_with_profile", { p_secret: { code: invite.code } }));
    const legacy = ok(await b.client.rpc("preview_connection_invite", { p_secret: { code: invite.code } }));
    assert.deepEqual(Object.keys(legacy).sort(), ["expires_at", "inviter_nickname"]);
    assert.equal(preview.inviter_nickname, "동일 이름"); assert.equal(preview.inviter_display_code, profileDisplayCode(a.id));
    assert.notEqual(profileDisplayCode(a.id), profileDisplayCode(b.id));
    assert.deepEqual(Object.keys(preview).sort(), ["expires_at", "inviter_display_code", "inviter_nickname"]);
    const origin = "http://127.0.0.1:3417", secret = crypto.randomBytes(32).toString("hex"), csrf = createCsrfToken(secret);
    const request = new Request(origin + "/api/v1/connection-invites/preview", { method: "POST", headers: { origin, "content-type": "application/json", cookie: "chagokchan_csrf=" + csrf, "x-csrf-token": csrf }, body: JSON.stringify({ code: invite.code }) });
    const response = await previewConnectionInviteResponse(request, b.client, { expectedOrigin: origin, secret });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), preview);
    const anonymous = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options);
    assert.ok((await anonymous.rpc("update_my_profile", { p_nickname: "익명 수정" })).error);
    assert.ok((await a.client.from("profiles").update({ nickname: "금지" }).eq("user_id", b.id)).error);
    assert.ok((await a.client.from("profiles").update({ nickname: "금지" }).eq("user_id", a.id)).error);
    assert.ok((await a.client.rpc("update_my_profile", { p_user_id: b.id, p_nickname: "금지" })).error);
    assert.equal((await read(b)).profile.nickname, "동일 이름");
  });
  await record("concurrent_partial_changes_preserve_both_fields_and_last_commit_wins", async () => {
    resetQuota(a);
    (await Promise.all([a.client.rpc("update_my_profile", { p_nickname: "병렬 이름" }), a.client.rpc("update_my_profile", { p_avatar_key: "grape" })])).forEach(ok);
    const me = await read(a); assert.equal(me.profile.nickname, "병렬 이름"); assert.equal(me.profile.avatar_key, "grape");
    (await Promise.all([a.client.rpc("update_my_profile", { p_nickname: "병렬 갑" }), a.client.rpc("update_my_profile", { p_nickname: "병렬 을" })])).forEach(ok);
    assert.ok(["병렬 갑", "병렬 을"].includes((await read(a)).profile.nickname));
  });
  await record("per_user_quota_is_atomic_and_rejection_does_not_write", async () => {
    resetQuota(a);
    // Avoid starting the concurrent quota calls immediately before a UTC minute boundary.
    if (new Date().getUTCSeconds() >= 55) await pause(60000 - Date.now() % 60000 + 25);
    sql("with w as (select date_trunc('minute',clock_timestamp()) s) insert into public.rate_usage(actor_user_id,scope_key,window_start,window_end,used_count) select :'actor'::uuid,'profile_update_minute',s,s+interval '1 minute',9 from w;\n", { actor: a.id });
    const results = await Promise.all([a.client.rpc("update_my_profile", { p_nickname: "한도 갑" }), a.client.rpc("update_my_profile", { p_nickname: "한도 을" })]);
    assert.equal(results.filter(result => !result.error).length, 1); denied(results.find(result => result.error), "PT429");
    const last = await read(a); denied(await a.client.rpc("update_my_profile", { p_nickname: "초과" }), "PT429"); assert.deepEqual(await read(a), last);
    ok(await b.client.rpc("update_my_profile", { p_avatar_key: "leaf" }));
  });
  await record("revoked_issued_session_cannot_patch_even_with_unexpired_jwt", async () => {
    const stale = bearer(b); ok(await b.client.auth.signOut({ scope: "local" }));
    denied(await stale.rpc("update_my_profile", { p_nickname: "오래된 세션" }), "PT401");
  });
  await record("rate_limiter_storage_failure_blocks_profile_write_and_rolls_back_permissions", async () => {
    const actualClaims = JSON.parse(Buffer.from(a.token.split(".")[1], "base64url").toString("utf8"));
    const claims = JSON.stringify({ sub: actualClaims.sub, session_id: actualClaims.session_id, exp: actualClaims.exp, role: actualClaims.role });
    resetQuota(a);
    const previous = await read(a);
    // Permission changes are uncommitted and invisible to other sessions. Use only
    // metadata from the actually issued session; never mint an access token.
    const result = sql("begin;\nrevoke insert,update on public.rate_usage from chagokchan_rpc;\nset local role authenticated;\nselect set_config('request.jwt.claims', :'claims', true) is not null;\ndo $$ begin perform public.update_my_profile('제한기 실패', null); raise exception 'Expected unavailable limiter'; exception when sqlstate 'PT503' then null; end $$;\nrollback;\nselect 'limiter_rollback_verified';\n", { claims });
    assert.ok(result.includes("limiter_rollback_verified")); assert.deepEqual(await read(a), previous);
  });
  await record("profile_waits_for_deletion_lock_then_rechecks_active_account", async () => {
    await deletionLock(c);
    const pending = c.client.rpc("update_my_profile", { p_nickname: "삭제 뒤 수정" }).then(result => result);
    let waiting = false;
    for (let index = 0; index < 50 && !waiting; index++) {
      waiting = sql("select exists(select 1 from pg_stat_activity where wait_event='advisory' and query like '%update_my_profile%');\n").trim() === "t";
      if (!waiting) await pause(50);
    }
    assert.ok(waiting, "Real RPC waits for deletion fixture lock");
    await releaseLock(true); denied(await pending, "PT403");
    assert.equal(sql("select nickname='삭제 뒤 수정' from public.profiles where user_id=:'actor'::uuid;\n", { actor: c.id }).trim(), "f");
  });
} catch (error) {
  failure = { phase, code: error.code ?? error.name, message: String(error.message).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uuid]").slice(0, 180) };
} finally {
  try { await releaseLock(); } catch { cleanup = false; }
  for (const value of probes) {
    try {
      const user = ok(await admin.auth.admin.getUserById(value.id)).user;
      assert.equal(user.app_metadata.isolated_profile_probe, runId);
      await value.client.auth.signOut({ scope: "local" });
      sql("delete from public.connection_invites where inviter_user_id=:'actor'::uuid;\ndelete from public.rate_usage where actor_user_id=:'actor'::uuid;\ndelete from public.profiles where user_id=:'actor'::uuid;\ndelete from public.app_users where id=:'actor'::uuid;\n", { actor: value.id });
      ok(await admin.auth.admin.deleteUser(value.id));
    } catch { cleanup = false; }
  }
  if (before) { try { preserved = before === snapshot(); } catch { cleanup = false; } }
}
const report = { verified_at: new Date().toISOString(), status: !failure && cleanup && preserved && cases.length === 9 ? "passed" : "failed", cases, executed: cases.length, failure, cleanup_passed: cleanup, existing_data_sessions_and_roles_preserved: preserved, sessions_fabricated: false, service_role_used_for_app_rpc: false, real_google_tests_executed: 0 };
fs.writeFileSync(path.join(projectRoot, "tmp/local-profile-tests.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (report.status !== "passed") process.exitCode = 1;
