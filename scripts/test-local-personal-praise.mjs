import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, projectRoot, sql } from "./local-database-tools.mjs";

// Local integration only: authenticated clients call product RPCs; admin/SQL are probe setup and teardown.
const cases = [];
const clients = [];
const probes = [];
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }) },
};
let status;
let admin;
let phase = "local_environment";
let failed = false;
let failureDetail = null;
let cleanupFailed = false;
let fixturePreserved = false;
let beforeSnapshot;
let beforeSessionCount;
let faultTriggerInstalled = false;
let notificationProbeInstalled = false;
const record = async (name, work) => {
  phase = name;
  await work();
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
function authSessionCount() {
  return Number(sql("select count(*) from auth.sessions;\n").trim());
}
async function createProbe(label, policyVersion) {
  const credentials = {
    email: label + "-" + crypto.randomUUID() + "@personal-praise.chagokchan.invalid",
    password: crypto.randomBytes(32).toString("base64url"),
  };
  const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true, app_metadata: { local_personal_praise_probe: true } });
  if (created.error || !created.data.user) throw new Error("Synthetic probe setup failed.");
  const probe = { id: created.data.user.id, credentials, client: null };
  probes.push(probe);
  sql("insert into public.app_users(id, adult_confirmed_at, registration_policy_version) values (:'actor'::uuid, clock_timestamp(), :'policy');\ninsert into public.profiles(user_id) values (:'actor'::uuid);\n", {
    actor: probe.id, policy: policyVersion,
  });
  const client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options);
  clients.push(client);
  probe.client = client;
  const signedIn = await client.auth.signInWithPassword(credentials);
  if (signedIn.error || !signedIn.data.session) throw new Error("Synthetic probe session could not be issued.");
  return probe;
}
function mutation(result) {
  assert.equal(result.error, null, result.error?.message ?? "RPC failed");
  assert.equal(typeof result.data.id, "string");
  assert.equal(typeof result.data.replayed, "boolean");
  return result.data;
}
function personalBoardId(goalId, actorId) {
  const id = sql("select id from public.boards where goal_id=:'goal'::uuid and owner_user_id=:'actor'::uuid and kind='personal';\n", { goal: goalId, actor: actorId }).trim();
  if (!id) throw new Error("Personal board fixture was not created.");
  return id;
}
async function createGoal(owner, title, targetCount) {
  const result = mutation(await owner.client.rpc("create_goal", {
    p_request_key: crypto.randomUUID(), p_title: title, p_personal_target_count: targetCount,
  }));
  if (result.replayed) throw new Error("Unexpected goal replay.");
  return { id: result.id, boardId: personalBoardId(result.id, owner.id) };
}
function todayFor(actorId) {
  return sql("select (clock_timestamp() at time zone timezone)::date from public.app_users where id=:'actor'::uuid;\n", { actor: actorId }).trim();
}
function plusDays(date, delta) {
  const value = new Date(date + "T12:00:00.000Z");
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}
function countFor(query, values) {
  return sql(query, values).trim();
}
function seedCurrentRate(actorId, scope, count) {
  if (scope === "praise_write_minute") {
    sql("with b as (select date_trunc('minute',clock_timestamp() at time zone 'UTC') at time zone 'UTC' s) insert into public.rate_usage(actor_user_id,scope_key,window_start,window_end,used_count) select :'actor'::uuid,:'scope',s,s+interval '1 minute',:'count'::integer from b on conflict(actor_user_id,scope_key,window_start) do update set used_count=excluded.used_count,window_end=excluded.window_end,updated_at=clock_timestamp();\n", { actor: actorId, scope, count: String(count) });
  } else {
    sql("with b as (select date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC' s) insert into public.rate_usage(actor_user_id,scope_key,window_start,window_end,used_count) select :'actor'::uuid,:'scope',s,s+interval '1 day',:'count'::integer from b on conflict(actor_user_id,scope_key,window_start) do update set used_count=excluded.used_count,window_end=excluded.window_end,updated_at=clock_timestamp();\n", { actor: actorId, scope, count: String(count) });
  }
}

try {
  status = assertLocalDatabase();
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!serviceKey) throw new Error("Local setup key unavailable.");
  admin = createClient(status.API_URL, serviceKey, options);
  const policy = JSON.parse(fs.readFileSync(path.join(projectRoot, "policies/app-policy.json"), "utf8"));
  beforeSnapshot = snapshot();
  beforeSessionCount = authSessionCount();
  const owner = await createProbe("owner", policy.policy_version);
  const outsider = await createProbe("outsider", policy.policy_version);
  const day = todayFor(owner.id);

  const basic = await createGoal(owner, "개인 회차 기록", 2);
  let firstPraiseId;
  const firstKey = crypto.randomUUID();
  const firstInput = {
    p_request_key: firstKey, p_board_id: basic.boardId, p_message: "첫 메모\r\n정리", p_occurred_on: day,
  };
  await record("personal_praise_creates_first_bunch_atomically", async () => {
    const created = mutation(await owner.client.rpc("create_praise", firstInput));
    firstPraiseId = created.id;
    assert.equal(created.replayed, false);
    assert.equal(countFor("select count(*) from public.praises where id=:'praise'::uuid and actor_user_id=:'actor'::uuid and recipient_user_id=:'actor'::uuid and source='self' and message=E'첫 메모\\n정리' and occurred_on=:'day'::date;\n", { praise: firstPraiseId, actor: owner.id, day }), "1");
    assert.equal(countFor("select string_agg(cycle_no||':'||target_count||':'||valid_count||':'||progress_state, ',') from public.bunches where board_id=:'board'::uuid;\n", { board: basic.boardId }), "1:2:1:incomplete");
    assert.equal(countFor("select count(*) from public.boards where id=:'board'::uuid and current_bunch_id=(select id from public.bunches where board_id=:'board'::uuid and cycle_no=1);\n", { board: basic.boardId }), "1");
  });
  await record("completion_notification_rls_matches_completion_insert_and_rolls_back", async () => {
    const bunchId = countFor("select id::text from public.bunches where board_id=:'board'::uuid and cycle_no=1;\n", { board: basic.boardId });
    sql("grant create on schema public to chagokchan_rpc;\ncreate function public.w06b2_notification_policy_probe(p_bunch uuid) returns text language plpgsql security definer set search_path=pg_catalog as $$ declare actor uuid; begin actor:=private.require_actor(); begin insert into public.notifications(recipient_user_id,actor_user_id,type,dedupe_key,bunch_id) values(actor,actor,'bunch_completed','bunch-completed:'||p_bunch::text,p_bunch) on conflict(recipient_user_id,dedupe_key) do nothing; raise exception using errcode='P9999',message='probe_rollback'; exception when sqlstate 'P9999' then return 'accepted'; when others then return sqlstate||':'||sqlerrm; end; end $$;\nalter function public.w06b2_notification_policy_probe(uuid) owner to chagokchan_rpc;\nrevoke create on schema public from chagokchan_rpc;\nrevoke all on function public.w06b2_notification_policy_probe(uuid) from public,anon,authenticated,service_role;\ngrant execute on function public.w06b2_notification_policy_probe(uuid) to authenticated;\nnotify pgrst,'reload schema';\n");
    notificationProbeInstalled = true;
    const probe = await owner.client.rpc("w06b2_notification_policy_probe", { p_bunch: bunchId });
    assert.equal(probe.error, null, probe.error?.message ?? "Policy probe failed");
    assert.equal(probe.data, "accepted");
    assert.equal(countFor("select count(*) from public.notifications where recipient_user_id=:'actor'::uuid and dedupe_key='bunch-completed:'||:'bunch';\n", { actor: owner.id, bunch: bunchId }), "0");
  });
  await record("praise_idempotency_replay_and_input_conflict", async () => {
    const retry = mutation(await owner.client.rpc("create_praise", firstInput));
    assert.equal(retry.id, firstPraiseId);
    assert.equal(retry.replayed, true);
    denied(await owner.client.rpc("create_praise", { ...firstInput, p_message: "다른 입력" }), "PT409", "idempotency_conflict");
    assert.equal(countFor("select count(*) from public.praises where board_id=:'board'::uuid;\n", { board: basic.boardId }), "1");
  });
  await record("self_message_date_edit_keeps_aggregate_and_enforces_date_range", async () => {
    const olderAllowed = plusDays(day, -365);
    assert.equal(mutation(await owner.client.rpc("edit_self_praise", {
      p_praise_id: firstPraiseId, p_patch: { message: "수정 메모", occurred_on: olderAllowed },
    })).replayed, false);
    assert.equal(countFor("select count(*) from public.praises where id=:'praise'::uuid and message='수정 메모' and occurred_on=:'day'::date;\n", { praise: firstPraiseId, day: olderAllowed }), "1");
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid and valid_count=1;\n", { board: basic.boardId }), "1");
    denied(await owner.client.rpc("edit_self_praise", { p_praise_id: firstPraiseId, p_patch: { occurred_on: plusDays(day, -366) } }), "PT400", "occurred_on_out_of_range");
    denied(await outsider.client.rpc("edit_self_praise", { p_praise_id: firstPraiseId, p_patch: { message: "타인 수정" } }), "PT404", "praise_not_found");
  });
  await record("author_cancel_erases_body_and_decrements_once", async () => {
    denied(await outsider.client.rpc("cancel_praise", { p_praise_id: firstPraiseId }), "PT404", "praise_not_found");
    assert.equal(mutation(await owner.client.rpc("cancel_praise", { p_praise_id: firstPraiseId })).replayed, false);
    assert.equal(countFor("select count(*) from public.praises where id=:'praise'::uuid and cancelled_at is not null and message is null and occurred_on is null;\n", { praise: firstPraiseId }), "1");
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid and valid_count=0 and progress_state='incomplete' and completed_at is null;\n", { board: basic.boardId }), "1");
    assert.equal(mutation(await owner.client.rpc("cancel_praise", { p_praise_id: firstPraiseId })).replayed, true);
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid and valid_count=0;\n", { board: basic.boardId }), "1");
  });
  await record("authenticated_direct_praise_read_remains_denied", async () => {
    denied(await owner.client.from("praises").select("id").limit(1), "42501");
  });

  const raceGoal = await createGoal(owner, "회차 경계 경합", 2);
  let raceFirstId;
  await record("two_distinct_praises_at_last_unit_serialize_cycle_boundary", async () => {
    raceFirstId = mutation(await owner.client.rpc("create_praise", {
      p_request_key: crypto.randomUUID(), p_board_id: raceGoal.boardId, p_message: "첫 칭찬",
    })).id;
    const requests = await Promise.all([0, 1].map((index) => owner.client.rpc("create_praise", {
      p_request_key: crypto.randomUUID(), p_board_id: raceGoal.boardId, p_message: "경합 칭찬 " + index,
    })));
    for (const result of requests) assert.equal(result.error, null, JSON.stringify({ code: result.error?.code, message: result.error?.message, details: result.error?.details, hint: result.error?.hint }));
    assert.equal(new Set(requests.map((result) => result.data.id)).size, 2);
    assert.equal(countFor("select string_agg(cycle_no||':'||target_count||':'||valid_count||':'||progress_state, ',' order by cycle_no) from public.bunches where board_id=:'board'::uuid;\n", { board: raceGoal.boardId }), "1:2:2:complete,2:2:1:incomplete");
    assert.equal(countFor("select count(*) from public.notifications n join public.bunches b on b.id=n.bunch_id where b.board_id=:'board'::uuid and n.type='bunch_completed';\n", { board: raceGoal.boardId }), "1");
  });
  await record("historical_cancel_does_not_move_current_pointer", async () => {
    const currentBefore = countFor("select current_bunch_id::text from public.boards where id=:'board'::uuid;\n", { board: raceGoal.boardId });
    assert.equal(mutation(await owner.client.rpc("cancel_praise", { p_praise_id: raceFirstId })).replayed, false);
    assert.equal(countFor("select current_bunch_id::text from public.boards where id=:'board'::uuid;\n", { board: raceGoal.boardId }), currentBefore);
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid and cycle_no=1 and valid_count=1 and progress_state='incomplete';\n", { board: raceGoal.boardId }), "1");
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid and cycle_no=2 and valid_count=1 and progress_state='incomplete';\n", { board: raceGoal.boardId }), "1");
    assert.equal(countFor("select count(*) from public.notifications n join public.bunches b on b.id=n.bunch_id where b.board_id=:'board'::uuid and n.type='bunch_completed';\n", { board: raceGoal.boardId }), "1");
  });
  await record("next_target_configuration_applies_to_new_bunch_only", async () => {
    const next = await createGoal(owner, "다음 회차 목표", 2);
    mutation(await owner.client.rpc("create_praise", { p_request_key: crypto.randomUUID(), p_board_id: next.boardId }));
    assert.equal(mutation(await owner.client.rpc("update_board", { p_board_id: next.boardId, p_patch: { expected_revision: 1, next_target_count: 3 } })).replayed, false);
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid and cycle_no=1 and target_count=2 and valid_count=1;\n", { board: next.boardId }), "1");
    denied(await owner.client.rpc("update_board", { p_board_id: next.boardId, p_patch: { expected_revision: 1, next_target_count: 4 } }), "PT409", "revision_conflict");
    denied(await owner.client.rpc("update_board", { p_board_id: next.boardId, p_patch: { expected_revision: 2, next_target_count: 0 } }), "PT400", "invalid_target_count");
    mutation(await owner.client.rpc("create_praise", { p_request_key: crypto.randomUUID(), p_board_id: next.boardId }));
    mutation(await owner.client.rpc("create_praise", { p_request_key: crypto.randomUUID(), p_board_id: next.boardId }));
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid and cycle_no=1 and target_count=2 and progress_state='complete';\n", { board: next.boardId }), "1");
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid and cycle_no=2 and target_count=3 and valid_count=1;\n", { board: next.boardId }), "1");
  });
  await record("completed_goal_rejects_new_praise_until_resume", async () => {
    const completed = await createGoal(owner, "완료 목표 부여 차단", 2);
    mutation(await owner.client.rpc("complete_goal", { p_goal_id: completed.id, p_expected_revision: 1 }));
    denied(await owner.client.rpc("create_praise", { p_request_key: crypto.randomUUID(), p_board_id: completed.boardId }), "PT409", "goal_not_active");
    assert.equal(countFor("select count(*) from public.praises where board_id=:'board'::uuid;\n", { board: completed.boardId }), "0");
    mutation(await owner.client.rpc("resume_goal", { p_goal_id: completed.id, p_expected_revision: 2 }));
    mutation(await owner.client.rpc("create_praise", { p_request_key: crypto.randomUUID(), p_board_id: completed.boardId }));
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid and cycle_no=1 and valid_count=1;\n", { board: completed.boardId }), "1");
  });
  await record("minute_and_utc_day_quotas_deny_without_partial_result", async () => {
    const rateGoal = await createGoal(owner, "작성 제한 검사", 20);
    seedCurrentRate(owner.id, "praise_write_minute", 19);
    seedCurrentRate(owner.id, "praise_write_day", 0);
    const first = { p_request_key: crypto.randomUUID(), p_board_id: rateGoal.boardId };
    const saved = mutation(await owner.client.rpc("create_praise", first));
    assert.equal(saved.replayed, false);
    denied(await owner.client.rpc("create_praise", { p_request_key: crypto.randomUUID(), p_board_id: rateGoal.boardId }), "PT429", "rate_limited");
    assert.equal(mutation(await owner.client.rpc("create_praise", first)).replayed, true);
    seedCurrentRate(owner.id, "praise_write_minute", 0);
    seedCurrentRate(owner.id, "praise_write_day", 299);
    const dayFirst = { p_request_key: crypto.randomUUID(), p_board_id: rateGoal.boardId };
    mutation(await owner.client.rpc("create_praise", dayFirst));
    const dayKey = crypto.randomUUID();
    denied(await owner.client.rpc("create_praise", { p_request_key: dayKey, p_board_id: rateGoal.boardId }), "PT429", "rate_limited");
    assert.equal(countFor("select count(*) from public.request_receipts where actor_user_id=:'actor'::uuid and operation='createPraise' and request_key=:'key'::uuid;\n", { actor: owner.id, key: dayKey }), "0");
    assert.equal(countFor("select count(*) from public.praises where board_id=:'board'::uuid;\n", { board: rateGoal.boardId }), "2");
  });
  await record("completion_failure_rolls_back_praise_cycle_receipt_and_quota", async () => {
    seedCurrentRate(owner.id, "praise_write_minute", 0);
    seedCurrentRate(owner.id, "praise_write_day", 0);
    const faultGoal = await createGoal(owner, "완성 원자성 실패 주입", 1);
    const faultKey = crypto.randomUUID();
    sql("create function public.w06b2_test_fail_bunch_completion() returns trigger language plpgsql set search_path=pg_catalog as $$ begin if new.progress_state='complete' and old.progress_state is distinct from 'complete' then raise exception using errcode='P0001',message='test_fault'; end if; return new; end $$;\ncreate trigger w06b2_test_fail_bunch_completion before update of valid_count,progress_state on public.bunches for each row execute function public.w06b2_test_fail_bunch_completion();\n");
    faultTriggerInstalled = true;
    denied(await owner.client.rpc("create_praise", { p_request_key: faultKey, p_board_id: faultGoal.boardId }), "P0001", "test_fault");
    assert.equal(countFor("select count(*) from public.praises where board_id=:'board'::uuid;\n", { board: faultGoal.boardId }), "0");
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid;\n", { board: faultGoal.boardId }), "0");
    assert.equal(countFor("select count(*) from public.request_receipts where actor_user_id=:'actor'::uuid and operation='createPraise' and request_key=:'key'::uuid;\n", { actor: owner.id, key: faultKey }), "0");
    assert.equal(countFor("select coalesce(sum(used_count),0) from public.rate_usage where actor_user_id=:'actor'::uuid and scope_key in ('praise_write_minute','praise_write_day');\n", { actor: owner.id }), "0");
    sql("drop trigger w06b2_test_fail_bunch_completion on public.bunches;\ndrop function public.w06b2_test_fail_bunch_completion();\n");
    faultTriggerInstalled = false;
    const retry = mutation(await owner.client.rpc("create_praise", { p_request_key: faultKey, p_board_id: faultGoal.boardId }));
    assert.equal(retry.replayed, false);
    assert.equal(countFor("select count(*) from public.praises where board_id=:'board'::uuid and cancelled_at is null;\n", { board: faultGoal.boardId }), "1");
    assert.equal(countFor("select count(*) from public.notifications n join public.bunches b on b.id=n.bunch_id where b.board_id=:'board'::uuid and n.type='bunch_completed';\n", { board: faultGoal.boardId }), "1");
    assert.equal(countFor("select coalesce(sum(used_count),0) from public.rate_usage where actor_user_id=:'actor'::uuid and scope_key in ('praise_write_minute','praise_write_day');\n", { actor: owner.id }), "2");
  });
} catch (error) {
  failed = true;
  failureDetail = String(error?.message ?? error).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uuid]").slice(0, 240);
  cases.push({ name: phase, status: "failed" });
} finally {
  if (faultTriggerInstalled) {
    try {
      sql("drop trigger if exists w06b2_test_fail_bunch_completion on public.bunches;\ndrop function if exists public.w06b2_test_fail_bunch_completion();\n");
    } catch { cleanupFailed = true; }
  }
  if (notificationProbeInstalled) {
    try { sql("drop function if exists public.w06b2_notification_policy_probe(uuid);\nnotify pgrst,'reload schema';\n"); }
    catch { cleanupFailed = true; }
  }
  for (const client of clients) {
    try { if ((await client.auth.signOut({ scope: "local" })).error) cleanupFailed = true; }
    catch { cleanupFailed = true; }
  }
  for (const probe of probes) {
    try {
      sql("delete from public.notifications where recipient_user_id=:'actor'::uuid or actor_user_id=:'actor'::uuid;\ndelete from public.praises where actor_user_id=:'actor'::uuid or recipient_user_id=:'actor'::uuid;\nupdate public.boards set current_bunch_id=null where owner_user_id=:'actor'::uuid;\ndelete from public.bunches where board_id in (select id from public.boards where owner_user_id=:'actor'::uuid);\ndelete from public.shared_board_profiles where board_id in (select id from public.boards where owner_user_id=:'actor'::uuid);\ndelete from public.request_receipts where actor_user_id=:'actor'::uuid;\ndelete from public.boards where owner_user_id=:'actor'::uuid;\ndelete from public.goals where owner_user_id=:'actor'::uuid;\ndelete from public.rate_usage where actor_user_id=:'actor'::uuid;\ndelete from public.profiles where user_id=:'actor'::uuid;\ndelete from public.app_users where id=:'actor'::uuid;\n", { actor: probe.id });
      const removed = await admin.auth.admin.deleteUser(probe.id);
      if (removed.error || sql("select count(*) from auth.sessions where user_id=:'actor'::uuid;\n", { actor: probe.id }).trim() !== "0") cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
  if (beforeSnapshot) {
    try {
      fixturePreserved = snapshot() === beforeSnapshot && authSessionCount() === beforeSessionCount;
      if (!fixturePreserved) cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
}

const passed = !failed && !cleanupFailed && cases.length === 12;
const report = {
  verified_at: new Date().toISOString(), scope: "w06_b2_personal_praise_cycle_and_rate_transactions_with_issued_auth_sessions",
  status: passed ? "passed" : "failed", executed: cases.length,
  passed: cases.filter((entry) => entry.status === "passed").length, cases,
  failure_detail: failureDetail, cleanup_passed: !cleanupFailed, existing_fixture_data_preserved: fixturePreserved,
  synthetic_probe_accounts_and_sessions_removed: !cleanupFailed, sessions_fabricated: false,
  service_role_used_for_app_rpc: false, provider_login_tests_executed: 0,
};
fs.mkdirSync(path.join(projectRoot, "tmp"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "tmp/local-personal-praise-tests.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;
