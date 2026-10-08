import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, projectRoot, sql } from "./local-database-tools.mjs";

const cases = [];
const probes = [];
const clients = [];
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }) },
};
let status;
let admin;
let beforeSnapshot;
let beforeSessionCount;
let phase = "local_environment";
let failureDetail = null;
let failed = false;
let cleanupFailed = false;
let fixturePreserved = false;
let faultTriggerInstalled = false;

const record = async (name, work) => {
  phase = name;
  await work();
  cases.push({ name, status: "passed" });
};
const denied = (result, code, message) => {
  assert.equal(result.data, null);
  assert.equal(result.error?.code, code, result.error?.message ?? "Expected RPC denial");
  if (message) assert.equal(result.error.message, message);
};
const ok = (result) => {
  assert.equal(result.error, null, result.error?.message ?? "RPC failed");
  assert.ok(result.data && typeof result.data === "object");
  return result.data;
};
const countFor = (query, values = {}) => sql(query, values).trim();

function snapshot() {
  const tables = sql("select tablename from pg_tables where schemaname='public' and tablename <> 'spatial_ref_sys' order by tablename;\n")
    .trim().split("\n").filter(Boolean);
  assert.equal(tables.length, 18);
  const digest = crypto.createHash("sha256");
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected app table.");
    digest.update(table + "\0" + sql("select coalesce(jsonb_agg(row_value order by row_value::text),'[]'::jsonb) from (select to_jsonb(t) row_value from public." + table + " t) rows;\n"));
  }
  return digest.digest("hex");
}

function authSessionCount() {
  return Number(sql("select count(*) from auth.sessions;\n").trim());
}

async function createProbe(label, policyVersion, signIn = true) {
  const credentials = {
    email: "probe-" + crypto.randomUUID() + "@shared-board.chagokchan.invalid",
    password: crypto.randomBytes(32).toString("base64url"),
  };
  const created = await admin.auth.admin.createUser({
    ...credentials,
    email_confirm: true,
    app_metadata: { local_shared_board_probe: true },
  });
  if (created.error || !created.data.user) throw new Error("Synthetic probe setup failed.");
  const probe = { id: created.data.user.id, credentials, client: null };
  probes.push(probe);
  sql("insert into public.app_users(id,adult_confirmed_at,registration_policy_version) values (:'actor'::uuid,clock_timestamp(),:'policy');\ninsert into public.profiles(user_id,nickname) values (:'actor'::uuid,:'nickname');\n", {
    actor: probe.id, policy: policyVersion, nickname: label,
  });
  if (signIn) {
    const client = createClient(status.API_URL, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options);
    clients.push(client);
    probe.client = client;
    const signedIn = await client.auth.signInWithPassword(credentials);
    if (signedIn.error || !signedIn.data.session) throw new Error("Synthetic probe session could not be issued.");
  }
  return probe;
}

async function connect(owner, contributor) {
  const invite = ok(await owner.client.rpc("create_connection_invite"));
  const token = invite.link_path.slice("/connect#invite=".length);
  const request = ok(await contributor.client.rpc("create_connection_request", {
    p_request_key: crypto.randomUUID(), p_secret: { link_token: token },
  }));
  ok(await owner.client.rpc("accept_connection_request", { p_request_id: request.id }));
  const row = JSON.parse(countFor("select to_jsonb(c) from public.connections c where c.user_low_id=least(:'left'::uuid,:'right'::uuid) and c.user_high_id=greatest(:'left'::uuid,:'right'::uuid);\n", {
    left: owner.id, right: contributor.id,
  }));
  return { id: row.id, generation: row.generation, status: row.status };
}

async function createSharedGoal(owner, title, targetCount) {
  const created = ok(await owner.client.rpc("create_goal", {
    p_request_key: crypto.randomUUID(), p_title: title + " 비공개 목표",
    p_private_description: title + " 개인 설명 비공개", p_personal_target_count: 1,
    p_shared_board: { title: title + " 공유판", description: "공유용 설명", target_count: targetCount },
  }));
  const boardId = countFor("select id::text from public.boards where goal_id=:'goal'::uuid and kind='shared';\n", { goal: created.id });
  const personalBoardId = countFor("select id::text from public.boards where goal_id=:'goal'::uuid and kind='personal';\n", { goal: created.id });
  return { goalId: created.id, boardId, personalBoardId };
}

function seedRate(actorId, scope, count, window = "minute") {
  const interval = window === "day" ? "day" : "minute";
  const length = interval === "day" ? "1 day" : "1 minute";
  sql("with b as (select date_trunc('" + interval + "',clock_timestamp() at time zone 'UTC') at time zone 'UTC' s) " +
    "insert into public.rate_usage(actor_user_id,scope_key,window_start,window_end,used_count) " +
    "select :'actor'::uuid,:'scope',s,s+interval '" + length + "',:'count'::integer from b " +
    "on conflict(actor_user_id,scope_key,window_start) do update set used_count=excluded.used_count,window_end=excluded.window_end,updated_at=clock_timestamp();\n", {
    actor: actorId, scope, count: String(count),
  });
}

function connectionFor(left, right) {
  return JSON.parse(countFor("select to_jsonb(c) from public.connections c where c.user_low_id=least(:'left'::uuid,:'right'::uuid) and c.user_high_id=greatest(:'left'::uuid,:'right'::uuid);\n", {
    left: left.id, right: right.id,
  }));
}

async function cleanup() {
  for (const client of clients) {
    try { if ((await client.auth.signOut({ scope: "local" })).error) cleanupFailed = true; }
    catch { cleanupFailed = true; }
  }
  if (faultTriggerInstalled) {
    try { sql("drop trigger if exists w06c2_test_fail_bunch_completion on public.bunches;\ndrop function if exists public.w06c2_test_fail_bunch_completion();\n"); }
    catch { cleanupFailed = true; }
  }
  if (!probes.length) return;
  try {
    const ids = probes.map((probe) => probe.id).filter(Boolean);
    const quoted = ids.map((id) => "'" + id + "'").join(",");
    if (quoted) {
      sql("delete from public.notifications where recipient_user_id in (" + quoted + ") or actor_user_id in (" + quoted + ");\n" +
        "delete from public.praises where actor_user_id in (" + quoted + ") or recipient_user_id in (" + quoted + ");\n" +
        "update public.boards set current_bunch_id=null where owner_user_id in (" + quoted + ");\n" +
        "delete from public.bunches where board_id in (select id from public.boards where owner_user_id in (" + quoted + "));\n" +
        "delete from public.shared_board_profiles where board_id in (select id from public.boards where owner_user_id in (" + quoted + "));\n" +
        "delete from public.board_members where user_id in (" + quoted + ") or granted_by_user_id in (" + quoted + ") or board_id in (select id from public.boards where owner_user_id in (" + quoted + "));\n" +
        "delete from public.boards where owner_user_id in (" + quoted + ");\n" +
        "delete from public.goals where owner_user_id in (" + quoted + ");\n" +
        "delete from public.connection_requests where requester_user_id in (" + quoted + ") or approver_user_id in (" + quoted + ") or connection_id in (select id from public.connections where user_low_id in (" + quoted + ") or user_high_id in (" + quoted + "));\n" +
        "delete from public.connection_invites where inviter_user_id in (" + quoted + ") or redeemed_by_user_id in (" + quoted + ");\n" +
        "delete from public.blocks where blocker_user_id in (" + quoted + ") or blocked_user_id in (" + quoted + ");\n" +
        "delete from public.connections where user_low_id in (" + quoted + ") or user_high_id in (" + quoted + ");\n" +
        "delete from public.request_receipts where actor_user_id in (" + quoted + ");\n" +
        "delete from public.rate_usage where actor_user_id in (" + quoted + ");\n" +
        "delete from public.profiles where user_id in (" + quoted + ");\n" +
        "delete from public.app_users where id in (" + quoted + ");\n");
    }
    for (let index = probes.length - 1; index >= 0; index--) {
      const removed = await admin.auth.admin.deleteUser(probes[index].id);
      if (removed.error) cleanupFailed = true;
    }
  } catch { cleanupFailed = true; }
}

try {
  status = assertLocalDatabase();
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!serviceKey) throw new Error("Local setup key unavailable.");
  admin = createClient(status.API_URL, serviceKey, options);
  const policy = JSON.parse(fs.readFileSync(path.join(projectRoot, "policies/app-policy.json"), "utf8"));
  beforeSnapshot = snapshot();
  beforeSessionCount = authSessionCount();

  const owner = await createProbe("공유판 주인", policy.policy_version);
  const contributor = await createProbe("공유판 지인 갑", policy.policy_version);
  const secondContributor = await createProbe("공유판 지인 을", policy.policy_version);
  const outsider = await createProbe("무관한 사용자", policy.policy_version);
  const firstConnection = await connect(owner, contributor);
  const secondConnection = await connect(owner, secondContributor);
  assert.equal(firstConnection.generation, 1);
  assert.equal(secondConnection.generation, 1);

  const shared = await createSharedGoal(owner, "권한 분리", 2);
  ok(await owner.client.rpc("create_praise", { p_request_key: crypto.randomUUID(), p_board_id: shared.personalBoardId }));
  let firstPraise;
  await record("owner_and_ungranted_views_have_separate_safe_projection", async () => {
    const own = ok(await owner.client.rpc("get_board", { p_board_id: shared.boardId }));
    assert.deepEqual(Object.keys(own).sort(), ["current_bunch", "goal_id", "id", "kind", "next_target_count", "revision", "shared_description", "shared_title", "viewer_role"].sort());
    assert.equal(own.viewer_role, "owner");
    assert.equal(own.shared_title, "권한 분리 공유판");
    denied(await contributor.client.rpc("get_board", { p_board_id: shared.boardId }), "PT404", "board_not_found");
    denied(await outsider.client.rpc("get_board", { p_board_id: shared.boardId }), "PT404", "board_not_found");
  });

  await record("explicit_grant_revoke_and_minimal_owner_member_list", async () => {
    assert.equal(ok(await owner.client.rpc("grant_board_member", { p_board_id: shared.boardId, p_user_id: contributor.id })).replayed, false);
    assert.equal(ok(await owner.client.rpc("grant_board_member", { p_board_id: shared.boardId, p_user_id: contributor.id })).replayed, true);
    denied(await contributor.client.rpc("grant_board_member", { p_board_id: shared.boardId, p_user_id: secondContributor.id }), "PT404", "board_not_found");
    const ownerView = ok(await contributor.client.rpc("get_board", { p_board_id: shared.boardId }));
    assert.deepEqual(Object.keys(ownerView).sort(), ["can_praise", "current_bunch", "goal_state", "id", "kind", "owner", "shared_description", "shared_title", "viewer_role"].sort());
    assert.equal(ownerView.viewer_role, "contributor");
    assert.equal(ownerView.can_praise, true);
    assert.equal(ownerView.shared_title, "권한 분리 공유판");
    assert.deepEqual(Object.keys(ownerView.owner).sort(), ["avatar_key", "nickname", "user_id"]);
    assert.ok(!("goal_id" in ownerView));
    assert.ok(!("private_description" in ownerView));
    assert.ok(!("next_target_count" in ownerView));
    const members = ok(await owner.client.rpc("list_board_members", { p_board_id: shared.boardId, p_limit: 1 }));
    assert.equal(members.items.length, 1);
    assert.equal(members.items[0].user.user_id, contributor.id);
    assert.equal(members.items[0].connection_generation, firstConnection.generation);
    assert.deepEqual(Object.keys(members.items[0].user).sort(), ["avatar_key", "nickname", "user_id"]);
    denied(await contributor.client.rpc("list_board_members", { p_board_id: shared.boardId }), "PT404", "board_not_found");
    denied(await outsider.client.from("board_members").select("user_id").limit(1), "42501");
    assert.equal(ok(await owner.client.rpc("revoke_board_member", { p_board_id: shared.boardId, p_user_id: contributor.id })).replayed, false);
    assert.equal(ok(await owner.client.rpc("revoke_board_member", { p_board_id: shared.boardId, p_user_id: contributor.id })).replayed, true);
    denied(await contributor.client.rpc("get_board", { p_board_id: shared.boardId }), "PT404", "board_not_found");
    denied(await contributor.client.rpc("grant_board_member", { p_board_id: shared.boardId, p_user_id: secondContributor.id }), "PT404", "board_not_found");
  });

  await record("shared_board_directory_lists_only_current_grants", async () => {
    ok(await owner.client.rpc("grant_board_member", { p_board_id: shared.boardId, p_user_id: contributor.id }));
    const visible = ok(await contributor.client.rpc("list_my_shared_boards", { p_limit: 1 }));
    assert.equal(visible.items.length, 1);
    assert.equal(visible.items[0].id, shared.boardId);
    assert.equal(visible.items[0].viewer_role, "contributor");
    assert.equal(visible.items[0].shared_title, "권한 분리 공유판");
    assert.ok(!("goal_id" in visible.items[0]));
    assert.ok(!("revision" in visible.items[0]));
    assert.deepEqual(Object.keys(ok(await owner.client.rpc("list_my_shared_boards"))), ["items", "next_cursor"]);
    assert.deepEqual(ok(await outsider.client.rpc("list_my_shared_boards")), { items: [], next_cursor: null });
    ok(await owner.client.rpc("revoke_board_member", { p_board_id: shared.boardId, p_user_id: contributor.id }));
    assert.deepEqual(ok(await contributor.client.rpc("list_my_shared_boards")), { items: [], next_cursor: null });
  });

  await record("peer_praise_is_atomic_idempotent_and_role_scoped", async () => {
    ok(await owner.client.rpc("grant_board_member", { p_board_id: shared.boardId, p_user_id: contributor.id }));
    const input = { p_request_key: crypto.randomUUID(), p_board_id: shared.boardId, p_message: "첫 칭찬\r\n메모" };
    firstPraise = ok(await contributor.client.rpc("create_peer_praise", input));
    assert.equal(firstPraise.replayed, false);
    assert.match(firstPraise.bunch_id, /^[0-9a-f-]{36}$/i);
    const replay = ok(await contributor.client.rpc("create_peer_praise", input));
    assert.equal(replay.id, firstPraise.id);
    assert.equal(replay.bunch_id, firstPraise.bunch_id);
    assert.equal(replay.replayed, true);
    denied(await contributor.client.rpc("create_peer_praise", { ...input, p_message: "입력 충돌" }), "PT409", "idempotency_conflict");
    denied(await owner.client.rpc("create_peer_praise", { p_request_key: crypto.randomUUID(), p_board_id: shared.boardId }), "PT403", "board_access_denied");
    denied(await outsider.client.rpc("create_peer_praise", { p_request_key: crypto.randomUUID(), p_board_id: shared.boardId }), "PT404", "board_not_found");
    phase = "peer_praise_persisted_shape";
    assert.equal(countFor("select count(*) from public.praises where id=:'praise'::uuid and board_id=:'board'::uuid and actor_user_id=:'actor'::uuid and recipient_user_id=:'owner'::uuid and source='peer' and message=E'첫 칭찬\\n메모' and occurred_on is null;\n", {
      praise: firstPraise.id, board: shared.boardId, actor: contributor.id, owner: owner.id,
    }), "1");
    phase = "personal_and_shared_counts_stay_independent";
    assert.equal(countFor("select count(*) from public.praises p where p.board_id=:'personal'::uuid and p.source='self' and p.cancelled_at is null and p.excluded_at is null;\n", { personal: shared.personalBoardId }), "1");
    phase = "shared_bunch_count_incremented";
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid and valid_count=1 and progress_state='incomplete';\n", { board: shared.boardId }), "1");
    phase = "peer_received_notification_inserted";
    assert.equal(countFor("select count(*) from public.notifications where recipient_user_id=:'owner'::uuid and actor_user_id=:'actor'::uuid and type='praise_received' and praise_id=:'praise'::uuid;\n", {
      owner: owner.id, actor: contributor.id, praise: firstPraise.id,
    }), "1");
    phase = "owner_list_praises_projection";
    const ownerPage = ok(await owner.client.rpc("list_board_praises", { p_board_id: shared.boardId, p_limit: 1 }));
    assert.equal(ownerPage.items.length, 1);
    assert.equal(ownerPage.items[0].viewer_role, "owner");
    assert.equal(ownerPage.items[0].actor.user_id, contributor.id);
    assert.equal(ownerPage.items[0].message, "첫 칭찬\n메모");
    for (const key of ["hidden_at", "excluded_at"]) assert.ok(key in ownerPage.items[0]);
    phase = "contributor_list_praises_projection";
    const contributorPage = ok(await contributor.client.rpc("list_board_praises", { p_board_id: shared.boardId, p_limit: 1 }));
    assert.equal(contributorPage.items[0].viewer_role, "contributor");
    assert.equal(contributorPage.items[0].id, firstPraise.id);
    for (const key of ["actor", "actor_label", "hidden_at", "excluded_at", "author_erased_at", "recipient_user_id"]) assert.ok(!(key in contributorPage.items[0]));
    denied(await contributor.client.rpc("list_board_praises", { p_board_id: shared.boardId, p_include_hidden: true }), "PT403", "board_access_denied");
    phase = "shared_bunch_completion";
    const second = ok(await contributor.client.rpc("create_peer_praise", { p_request_key: crypto.randomUUID(), p_board_id: shared.boardId }));
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid and valid_count=2 and progress_state='complete' and completed_at is not null;\n", { board: shared.boardId }), "1");
    assert.equal(countFor("select count(*) from public.notifications where recipient_user_id=:'owner'::uuid and type='bunch_completed' and bunch_id=:'bunch'::uuid;\n", { owner: owner.id, bunch: second.bunch_id }), "1");
    assert.equal(countFor("select count(*) from public.notifications where recipient_user_id=:'owner'::uuid and type='praise_received' and praise_id in (:'first'::uuid,:'second'::uuid);\n", { owner: owner.id, first: firstPraise.id, second: second.id }), "2");
    phase = "shared_praise_cursor_pagination";
    const firstPage = ok(await owner.client.rpc("list_board_praises", { p_board_id: shared.boardId, p_limit: 1 }));
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.next_cursor);
    const nextPage = ok(await owner.client.rpc("list_board_praises", { p_board_id: shared.boardId, p_cursor: firstPage.next_cursor, p_limit: 1 }));
    assert.equal(nextPage.items.length, 1);
    assert.notEqual(nextPage.items[0].id, firstPage.items[0].id);
  });

  await record("peer_praise_owner_moderation_is_idempotent_and_recounts_atomically", async () => {
    const hidden = ok(await owner.client.rpc("hide_peer_praise", { p_praise_id: firstPraise.id }));
    assert.equal(hidden.id, firstPraise.id);
    assert.equal(hidden.replayed, false);
    assert.equal(ok(await owner.client.rpc("hide_peer_praise", { p_praise_id: firstPraise.id })).replayed, true);
    denied(await contributor.client.rpc("hide_peer_praise", { p_praise_id: firstPraise.id }), "PT404", "praise_not_found");
    const withoutHidden = ok(await owner.client.rpc("list_board_praises", { p_board_id: shared.boardId, p_limit: 10 }));
    assert.ok(!withoutHidden.items.some((item) => item.id === firstPraise.id));
    const withHidden = ok(await owner.client.rpc("list_board_praises", { p_board_id: shared.boardId, p_limit: 10, p_include_hidden: true }));
    assert.ok(withHidden.items.find((item) => item.id === firstPraise.id).hidden_at);
    assert.equal(ok(await owner.client.rpc("unhide_peer_praise", { p_praise_id: firstPraise.id })).replayed, false);
    assert.equal(ok(await owner.client.rpc("unhide_peer_praise", { p_praise_id: firstPraise.id })).replayed, true);
    assert.ok(ok(await owner.client.rpc("list_board_praises", { p_board_id: shared.boardId, p_limit: 10 })).items.some((item) => item.id === firstPraise.id));
    assert.equal(ok(await owner.client.rpc("exclude_peer_praise", { p_praise_id: firstPraise.id })).replayed, false);
    assert.equal(ok(await owner.client.rpc("exclude_peer_praise", { p_praise_id: firstPraise.id })).replayed, true);
    assert.equal(countFor("select count(*) from public.bunches where id=:'bunch'::uuid and valid_count=1 and progress_state='incomplete' and completed_at is null;\n", { bunch: firstPraise.bunch_id }), "1");
    assert.equal(countFor("select count(*) from public.praises where id=:'praise'::uuid and excluded_at is not null and message=E'첫 칭찬\\n메모';\n", { praise: firstPraise.id }), "1");
    denied(await outsider.client.rpc("exclude_peer_praise", { p_praise_id: firstPraise.id }), "PT404", "praise_not_found");
  });

  await record("peer_rate_limits_and_completion_failure_roll_back_every_write", async () => {
    const peerScope = "peer_praise_board_day:" + shared.boardId;
    seedRate(contributor.id, peerScope, 29, "day");
    const lastAllowed = { p_request_key: crypto.randomUUID(), p_board_id: shared.boardId, p_message: "일 한도 마지막 허용" };
    ok(await contributor.client.rpc("create_peer_praise", lastAllowed));
    const deniedKey = crypto.randomUUID();
    denied(await contributor.client.rpc("create_peer_praise", { p_request_key: deniedKey, p_board_id: shared.boardId }), "PT429", "rate_limited");
    assert.equal(countFor("select count(*) from public.request_receipts where actor_user_id=:'actor'::uuid and operation='createPeerPraise' and request_key=:'key'::uuid;\n", { actor: contributor.id, key: deniedKey }), "0");
    assert.equal(countFor("select count(*) from public.praises where actor_user_id=:'actor'::uuid and board_id=:'board'::uuid and cancelled_at is null;\n", { actor: contributor.id, board: shared.boardId }), "3");
    const rollbackGoal = await createSharedGoal(owner, "공유 완성 원자성", 1);
    ok(await owner.client.rpc("grant_board_member", { p_board_id: rollbackGoal.boardId, p_user_id: contributor.id }));
    const failKey = crypto.randomUUID();
    const rateBefore = countFor("select coalesce(sum(used_count),0) from public.rate_usage where actor_user_id=:'actor'::uuid and scope_key in ('praise_write_minute','praise_write_day','peer_praise_board_day:'||:'board');\n", { actor: contributor.id, board: rollbackGoal.boardId });
    sql("create function public.w06c2_test_fail_bunch_completion() returns trigger language plpgsql set search_path=pg_catalog as $$ begin if new.progress_state='complete' and old.progress_state is distinct from 'complete' then raise exception using errcode='P0001',message='test_fault'; end if; return new; end $$;\ncreate trigger w06c2_test_fail_bunch_completion before update of valid_count,progress_state on public.bunches for each row execute function public.w06c2_test_fail_bunch_completion();\n");
    faultTriggerInstalled = true;
    denied(await contributor.client.rpc("create_peer_praise", { p_request_key: failKey, p_board_id: rollbackGoal.boardId }), "P0001", "test_fault");
    assert.equal(countFor("select count(*) from public.praises where board_id=:'board'::uuid;\n", { board: rollbackGoal.boardId }), "0");
    assert.equal(countFor("select count(*) from public.bunches where board_id=:'board'::uuid;\n", { board: rollbackGoal.boardId }), "0");
    assert.equal(countFor("select count(*) from public.request_receipts where actor_user_id=:'actor'::uuid and operation='createPeerPraise' and request_key=:'key'::uuid;\n", { actor: contributor.id, key: failKey }), "0");
    assert.equal(countFor("select count(*) from public.notifications where recipient_user_id=:'owner'::uuid and type='praise_received' and praise_id in (select id from public.praises where board_id=:'board'::uuid);\n", { owner: owner.id, board: rollbackGoal.boardId }), "0");
    assert.equal(countFor("select coalesce(sum(used_count),0) from public.rate_usage where actor_user_id=:'actor'::uuid and scope_key in ('praise_write_minute','praise_write_day','peer_praise_board_day:'||:'board');\n", { actor: contributor.id, board: rollbackGoal.boardId }), rateBefore);
    sql("drop trigger w06c2_test_fail_bunch_completion on public.bunches;\ndrop function public.w06c2_test_fail_bunch_completion();\n");
    faultTriggerInstalled = false;
    const retry = ok(await contributor.client.rpc("create_peer_praise", { p_request_key: failKey, p_board_id: rollbackGoal.boardId }));
    assert.equal(retry.replayed, false);
    assert.equal(countFor("select count(*) from public.praises where board_id=:'board'::uuid and cancelled_at is null;\n", { board: rollbackGoal.boardId }), "1");
  });

  await record("concurrent_member_grants_never_exceed_fifty", async () => {
    const capGoal = await createSharedGoal(owner, "공유 contributor 상한", 20);
    const capacityUsers = [];
    for (let index = 0; index < 49; index++) capacityUsers.push(await createProbe("상한 검사 " + (index + 1), policy.policy_version, false));
    const idList = capacityUsers.map((entry) => "'" + entry.id + "'::uuid").join(",");
    sql("with members(user_id) as (values " + idList.split(",").map((id) => "(" + id + ")").join(",") + ") " +
      "insert into public.connections(id,user_low_id,user_high_id,status,generation,created_at,connected_at) " +
      "select gen_random_uuid(),least(:'owner'::uuid,m.user_id),greatest(:'owner'::uuid,m.user_id),'active',1,clock_timestamp(),clock_timestamp() from members m;\n" +
      "insert into public.board_members(board_id,user_id,connection_id,connection_generation,role,status,granted_by_user_id) " +
      "select :'board'::uuid,m.id,c.id,c.generation,'contributor','active',:'owner'::uuid from public.app_users m " +
      "join public.connections c on c.user_low_id=least(:'owner'::uuid,m.id) and c.user_high_id=greatest(:'owner'::uuid,m.id) " +
      "where m.id in (" + idList + ");\n", { owner: owner.id, board: capGoal.boardId });
    assert.equal(countFor("select count(*) from public.board_members where board_id=:'board'::uuid and status='active';\n", { board: capGoal.boardId }), "49");
    const memberPage1 = ok(await owner.client.rpc("list_board_members", { p_board_id: capGoal.boardId, p_limit: 25 }));
    assert.equal(memberPage1.items.length, 25);
    assert.ok(memberPage1.next_cursor);
    const memberPage2 = ok(await owner.client.rpc("list_board_members", { p_board_id: capGoal.boardId, p_cursor: memberPage1.next_cursor, p_limit: 25 }));
    assert.equal(memberPage2.items.length, 24);
    assert.equal(memberPage2.next_cursor, null);
    assert.equal(new Set([...memberPage1.items, ...memberPage2.items].map((member) => member.user.user_id)).size, 49);
    const results = await Promise.all([contributor, secondContributor].map((target) => owner.client.rpc("grant_board_member", {
      p_board_id: capGoal.boardId, p_user_id: target.id,
    })));
    const successes = results.filter((result) => !result.error);
    const failures = results.filter((result) => result.error);
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].error.code, "PT409");
    assert.equal(failures[0].error.message, "board_member_limit");
    assert.equal(countFor("select count(*) from public.board_members where board_id=:'board'::uuid and status='active';\n", { board: capGoal.boardId }), "50");
  });

  await record("revoke_disconnect_block_races_and_reconnect_requires_new_grant", async () => {
    const concurrentKey = crypto.randomUUID();
    const concurrent = await Promise.all([
      owner.client.rpc("revoke_board_member", { p_board_id: shared.boardId, p_user_id: contributor.id }),
      contributor.client.rpc("create_peer_praise", { p_request_key: concurrentKey, p_board_id: shared.boardId }),
    ]);
    assert.equal(concurrent[0].error, null, concurrent[0].error?.message ?? "Revoke failed");
    if (concurrent[1].error) {
      assert.equal(concurrent[1].error.code, "PT404");
    } else {
      assert.equal(concurrent[1].data.replayed, false);
    }
    denied(await contributor.client.rpc("create_peer_praise", { p_request_key: crypto.randomUUID(), p_board_id: shared.boardId }), "PT404", "board_not_found");

    const cGrant = ok(await owner.client.rpc("grant_board_member", { p_board_id: shared.boardId, p_user_id: secondContributor.id }));
    assert.equal(cGrant.replayed, false);
    const disconnected = await Promise.all([
      owner.client.rpc("disconnect", { p_connection_id: secondConnection.id }),
      secondContributor.client.rpc("create_peer_praise", { p_request_key: crypto.randomUUID(), p_board_id: shared.boardId }),
    ]);
    assert.equal(disconnected[0].error, null, disconnected[0].error?.message ?? "Disconnect failed");
    if (disconnected[1].error) assert.equal(disconnected[1].error.code, "PT404");
    const firstClosed = connectionFor(owner, secondContributor);
    assert.equal(firstClosed.status, "inactive");
    assert.equal(countFor("select count(*) from public.board_members where board_id=:'board'::uuid and user_id=:'member'::uuid and status='revoked';\n", {
      board: shared.boardId, member: secondContributor.id,
    }), "1");
    denied(await secondContributor.client.rpc("get_board", { p_board_id: shared.boardId }), "PT404", "board_not_found");

    const newInvite = ok(await owner.client.rpc("create_connection_invite"));
    const newRequest = ok(await secondContributor.client.rpc("create_connection_request", {
      p_request_key: crypto.randomUUID(), p_secret: { link_token: newInvite.link_path.slice("/connect#invite=".length) },
    }));
    ok(await owner.client.rpc("accept_connection_request", { p_request_id: newRequest.id }));
    const reconnected = connectionFor(owner, secondContributor);
    assert.equal(reconnected.status, "active");
    assert.equal(reconnected.generation, 2);
    denied(await secondContributor.client.rpc("get_board", { p_board_id: shared.boardId }), "PT404", "board_not_found");
    ok(await owner.client.rpc("grant_board_member", { p_board_id: shared.boardId, p_user_id: secondContributor.id }));
    assert.equal(countFor("select count(*) from public.board_members where board_id=:'board'::uuid and user_id=:'member'::uuid and status='active' and connection_generation=2;\n", {
      board: shared.boardId, member: secondContributor.id,
    }), "1");
    const blockRace = await Promise.all([
      owner.client.rpc("create_block", { p_user_id: secondContributor.id }),
      secondContributor.client.rpc("create_peer_praise", { p_request_key: crypto.randomUUID(), p_board_id: shared.boardId }),
    ]);
    assert.equal(blockRace[0].error, null, blockRace[0].error?.message ?? "Block failed");
    if (blockRace[1].error) assert.equal(blockRace[1].error.code, "PT404");
    const blockedConnection = connectionFor(owner, secondContributor);
    assert.equal(blockedConnection.status, "inactive");
    denied(await secondContributor.client.rpc("get_board", { p_board_id: shared.boardId }), "PT404", "board_not_found");
    denied(await secondContributor.client.rpc("create_peer_praise", { p_request_key: crypto.randomUUID(), p_board_id: shared.boardId }), "PT404", "board_not_found");
    const blockId = countFor("select id::text from public.blocks where blocker_user_id=:'owner'::uuid and blocked_user_id=:'member'::uuid and revoked_at is null;\n", {
      owner: owner.id, member: secondContributor.id,
    });
    ok(await owner.client.rpc("revoke_block", { p_block_id: blockId }));
    assert.equal(connectionFor(owner, secondContributor).status, "inactive");
    assert.equal(countFor("select count(*) from public.board_members where board_id=:'board'::uuid and user_id=:'member'::uuid and status='revoked';\n", {
      board: shared.boardId, member: secondContributor.id,
    }), "1");
  });
} catch (error) {
  failed = true;
  failureDetail = (phase + ": " + String(error?.message ?? error)).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uuid]").slice(0, 240);
  cases.push({ name: phase, status: "failed" });
} finally {
  await cleanup();
  if (beforeSnapshot) {
    try {
      fixturePreserved = snapshot() === beforeSnapshot && authSessionCount() === beforeSessionCount;
      if (!fixturePreserved) cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
}

const passed = !failed && !cleanupFailed && cases.length === 8;
const report = {
  verified_at: new Date().toISOString(), work_item: "W09-C",
  scope: "shared_board_directory_and_w09_b_access_regression_with_issued_auth_sessions",
  status: passed ? "passed" : "failed", executed: cases.length,
  passed: cases.filter((entry) => entry.status === "passed").length, cases,
  failure_detail: failureDetail, cleanup_passed: !cleanupFailed, existing_fixture_data_preserved: fixturePreserved,
  synthetic_probe_accounts_and_sessions_removed: !cleanupFailed, sessions_fabricated: false,
  service_role_used_for_app_rpc: false, provider_login_tests_executed: 0,
};
fs.mkdirSync(path.join(projectRoot, "tmp"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "tmp/local-shared-board-tests.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!passed) process.exitCode = 1;
