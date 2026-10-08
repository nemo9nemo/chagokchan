import assert from "node:assert/strict";
import test from "node:test";
import { createCsrfToken, CSRF_COOKIE_NAME } from "../src/server/api-security.mjs";
import {
  createGoalResponse,
  getGoalResponse,
  listBunchesResponse,
  listGoalsResponse,
  projectGoalDetail,
  transitionGoalResponse,
  updateBoardResponse,
  updateGoalResponse,
  validateCreateGoalInput,
  validateBunchesQuery,
  validateGoalActionInput,
  validateGoalsQuery,
  validateUpdateBoardInput,
  validateUpdateGoalInput,
} from "../src/server/goal-api.mjs";

const origin = "http://127.0.0.1:3000";
const secret = Buffer.alloc(32, 11);
const goalId = "11111111-1111-4111-8111-111111111111";
const boardId = "22222222-2222-4222-8222-222222222222";
const requestKey = "33333333-3333-4333-8333-333333333333";
const detail = () => ({
  goal: {
    id: goalId,
    title: "걷기",
    private_description: "퇴근 후 산책",
    status: "active",
    revision: 1,
    created_at: "2026-10-08T00:00:00Z",
    completed_at: null,
    archived_at: null,
  },
  boards: [{
    viewer_role: "owner",
    id: boardId,
    goal_id: goalId,
    kind: "personal",
    revision: 1,
    next_target_count: 20,
    shared_title: null,
    shared_description: null,
    current_bunch: null,
  }],
});

function mutationRequest(body, { requestIdempotencyKey = requestKey, requestOrigin = origin } = {}) {
  const csrf = createCsrfToken(secret);
  return new Request(`${origin}/api/v1/goals`, {
    method: "POST",
    headers: {
      Origin: requestOrigin,
      "Content-Type": "application/json",
      "Idempotency-Key": requestIdempotencyKey,
      "X-CSRF-Token": csrf,
      Cookie: `${CSRF_COOKIE_NAME}=${csrf}`,
    },
    body: JSON.stringify(body),
  });
}

function verifiedMutationRequest(url, method, body) {
  const csrf = createCsrfToken(secret);
  return new Request(url, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf, Cookie: `${CSRF_COOKIE_NAME}=${csrf}` },
    body: JSON.stringify(body),
  });
}

test("create goal input maps defaults and optional shared profile to database arguments", () => {
  assert.deepEqual(validateCreateGoalInput({ title: "걷기" }, requestKey), {
    p_request_key: requestKey,
    p_title: "걷기",
    p_private_description: null,
    p_personal_target_count: 20,
    p_shared_board: null,
  });
  const input = validateCreateGoalInput({
    title: "걷기",
    private_description: null,
    personal_target_count: 7,
    shared_board: { title: "함께 걷기", target_count: 10, description: null },
  }, requestKey);
  assert.deepEqual(input.p_shared_board, { title: "함께 걷기", target_count: 10, description: null });
});

test("create goal input rejects unknown actor fields, invalid targets, and non-UUID idempotency keys", () => {
  assert.throws(() => validateCreateGoalInput({ title: "걷기", owner_user_id: goalId }, requestKey), { status: 400, code: "INVALID_INPUT" });
  assert.throws(() => validateCreateGoalInput({ title: "걷기", personal_target_count: 101 }, requestKey), { status: 400, code: "INVALID_INPUT" });
  assert.throws(() => validateCreateGoalInput({ title: "걷기" }, "not-a-uuid"), { status: 400, code: "INVALID_INPUT" });
});

test("create goal handler checks CSRF before calling the authenticated RPC", async () => {
  let call;
  const client = { rpc: async (name, args) => { call = { name, args }; return { data: { id: goalId, replayed: false }, error: null }; } };
  const response = await createGoalResponse(mutationRequest({ title: "걷기" }), client, { expectedOrigin: origin, secret });
  assert.equal(response.status, 201);
  assert.match(response.headers.get("cache-control"), /no-store/i);
  assert.equal(call.name, "create_goal");
  assert.equal(call.args.p_request_key, requestKey);
  assert.equal("p_owner_user_id" in call.args, false);
  assert.deepEqual(await response.json(), { id: goalId, replayed: false });
});

test("create goal handler rejects a foreign origin without reaching the database", async () => {
  let rpcCalled = false;
  const client = { rpc: async () => { rpcCalled = true; return { data: null, error: null }; } };
  const response = await createGoalResponse(mutationRequest({ title: "걷기" }, { requestOrigin: "https://attacker.example" }), client, { expectedOrigin: origin, secret });
  assert.equal(response.status, 403);
  assert.equal(rpcCalled, false);
});

test("goal detail projection accepts only the documented owner fields", () => {
  assert.deepEqual(projectGoalDetail(detail()), detail());
  assert.throws(() => projectGoalDetail({ ...detail(), owner_email: "hidden@example.invalid" }));
  assert.throws(() => projectGoalDetail({ ...detail(), goal: { ...detail().goal, owner_user_id: goalId } }));
});

test("goal detail handler calls get_goal and maps inaccessible goals to the shared 404 response", async () => {
  let args;
  const client = { rpc: async (name, value) => { args = { name, value }; return { data: detail(), error: null }; } };
  const response = await getGoalResponse(goalId, client);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/i);
  assert.equal(args.name, "get_goal");
  assert.deepEqual(args.value, { p_goal_id: goalId });

  const missing = await getGoalResponse(goalId, { rpc: async () => ({ data: null, error: { code: "PT404", message: "goal_not_found" } }) });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "OBJECT_NOT_AVAILABLE");
});

test("goal list query validates cursor, page size, and status and supplies the documented defaults", () => {
  assert.deepEqual(validateGoalsQuery(new URL(`${origin}/api/v1/goals`)), {
    p_cursor: null,
    p_limit: 20,
    p_status: null,
  });
  assert.deepEqual(validateGoalsQuery(new URL(`${origin}/api/v1/goals?cursor=eyJ4IjoxfQ&limit=50&status=archived`)), {
    p_cursor: "eyJ4IjoxfQ",
    p_limit: 50,
    p_status: "archived",
  });
  for (const query of ["limit=0", "limit=51", "limit=x", "status=deleted", "status=active&status=archived", "limit=10&limit=20"]) {
    assert.throws(() => validateGoalsQuery(new URL(`${origin}/api/v1/goals?${query}`)), { status: 400, code: "INVALID_INPUT" });
  }
});

test("goal list handler calls the owner-only RPC and returns only page contract fields", async () => {
  let call;
  const page = { items: [detail().goal], next_cursor: null };
  const client = { rpc: async (name, args) => { call = { name, args }; return { data: page, error: null }; } };
  const response = await listGoalsResponse(new URL(`${origin}/api/v1/goals?limit=5&status=active`), client);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/i);
  assert.equal(call.name, "list_goals");
  assert.deepEqual(call.args, { p_cursor: null, p_limit: 5, p_status: "active" });
  assert.deepEqual(await response.json(), page);
});

test("goal list response allowlist rejects cross-user fields and malformed cursors", async () => {
  const extraField = await listGoalsResponse(new URL(`${origin}/api/v1/goals`), {
    rpc: async () => ({ data: { items: [{ ...detail().goal, owner_user_id: goalId }], next_cursor: null }, error: null }),
  });
  assert.equal(extraField.status, 503);
  const malformed = await listGoalsResponse(new URL(`${origin}/api/v1/goals`), {
    rpc: async () => ({ data: { items: [], next_cursor: "not a cursor" }, error: null }),
  });
  assert.equal(malformed.status, 503);
});

test("update goal input preserves explicit null and requires a revision and editable field", () => {
  assert.deepEqual(validateUpdateGoalInput({ expected_revision: 3, private_description: null }), {
    p_expected_revision: 3,
    p_title: null,
    p_private_description: null,
    p_update_title: false,
    p_update_private_description: true,
  });
  assert.throws(() => validateUpdateGoalInput({ expected_revision: 3 }), { status: 400, code: "INVALID_INPUT" });
  assert.throws(() => validateUpdateGoalInput({ expected_revision: 0, title: "걷기" }), { status: 400, code: "INVALID_INPUT" });
});

test("update goal handler passes the path identity and maps stale revisions", async () => {
  let call;
  const client = { rpc: async (name, args) => { call = { name, args }; return { data: null, error: { code: "PT409", message: "revision_conflict" } }; } };
  const csrf = createCsrfToken(secret);
  const request = new Request(`${origin}/api/v1/goals/${goalId}`, {
    method: "PATCH",
    headers: { Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf, Cookie: `${CSRF_COOKIE_NAME}=${csrf}` },
    body: JSON.stringify({ expected_revision: 1, title: "새 제목" }),
  });
  const response = await updateGoalResponse(goalId, request, client, { expectedOrigin: origin, secret });
  assert.equal(call.name, "update_goal");
  assert.equal(call.args.p_goal_id, goalId);
  assert.equal(call.args.p_update_title, true);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "REVISION_CONFLICT");
});

test("goal transition input and handlers map each fixed action to its revision RPC", async () => {
  assert.deepEqual(validateGoalActionInput({ expected_revision: 2 }), { p_expected_revision: 2 });
  assert.throws(() => validateGoalActionInput({ expected_revision: 1, goal_id: goalId }), { status: 400, code: "INVALID_INPUT" });
  assert.throws(() => validateGoalActionInput({ expected_revision: 0 }), { status: 400, code: "INVALID_INPUT" });
  for (const [action, rpcName] of [["complete", "complete_goal"], ["archive", "archive_goal"], ["resume", "resume_goal"]]) {
    let call;
    const client = { rpc: async (name, args) => { call = { name, args }; return { data: { id: goalId, replayed: true }, error: null }; } };
    const response = await transitionGoalResponse(goalId, action, verifiedMutationRequest(`${origin}/api/v1/goals/${goalId}/${action}`, "POST", { expected_revision: 2 }), client, { expectedOrigin: origin, secret });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(call, { name: rpcName, args: { p_goal_id: goalId, p_expected_revision: 2 } });
    assert.deepEqual(await response.json(), { id: goalId, replayed: true });
  }
});

test("goal transition handler rejects missing CSRF and unexpected RPC response fields", async () => {
  let rpcCalled = false;
  const rejected = await transitionGoalResponse(goalId, "complete", new Request(`${origin}/api/v1/goals/${goalId}/complete`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ expected_revision: 1 }),
  }), { rpc: async () => { rpcCalled = true; return { data: null, error: null }; } }, { expectedOrigin: origin, secret });
  assert.equal(rejected.status, 403);
  assert.equal(rpcCalled, false);
  const malformed = await transitionGoalResponse(goalId, "archive", verifiedMutationRequest(`${origin}/api/v1/goals/${goalId}/archive`, "POST", { expected_revision: 1 }), {
    rpc: async () => ({ data: { id: goalId, replayed: false, status: "archived" }, error: null }),
  }, { expectedOrigin: origin, secret });
  assert.equal(malformed.status, 503);
});

test("board settings require revision and only allow target and shared display fields", () => {
  assert.deepEqual(validateUpdateBoardInput({ expected_revision: 2, next_target_count: 7, shared_title: "함께 걷기", shared_description: null }), {
    expected_revision: 2, next_target_count: 7, shared_title: "함께 걷기", shared_description: null,
  });
  for (const patch of [
    { expected_revision: 1 },
    { expected_revision: 1, next_target_count: 0 },
    { expected_revision: 1, next_target_count: 101 },
    { expected_revision: 1, shared_title: "" },
    { expected_revision: 1, owner_user_id: goalId },
    { expected_revision: 1, shared_description: 4 },
  ]) assert.throws(() => validateUpdateBoardInput(patch), { status: 400, code: "INVALID_INPUT" });
});

test("board settings handler sends a revision-scoped patch to update_board", async () => {
  let call;
  const client = { rpc: async (name, args) => { call = { name, args }; return { data: { id: boardId, replayed: false }, error: null }; } };
  const response = await updateBoardResponse(boardId, verifiedMutationRequest(`${origin}/api/v1/boards/${boardId}`, "PATCH", { expected_revision: 1, next_target_count: 8 }), client, { expectedOrigin: origin, secret });
  assert.equal(response.status, 200);
  assert.deepEqual(call, { name: "update_board", args: { p_board_id: boardId, p_patch: { expected_revision: 1, next_target_count: 8 } } });
  const invalidPath = await updateBoardResponse("bad-id", verifiedMutationRequest(`${origin}/api/v1/boards/bad-id`, "PATCH", { expected_revision: 1, next_target_count: 8 }), client, { expectedOrigin: origin, secret });
  assert.equal(invalidPath.status, 400);
});

test("bunch history query and response enforce bounded page and bunch allowlists", async () => {
  assert.deepEqual(validateBunchesQuery(new URL(`${origin}/api/v1/boards/${boardId}/bunches`)), { p_cursor: null, p_limit: 20 });
  assert.deepEqual(validateBunchesQuery(new URL(`${origin}/api/v1/boards/${boardId}/bunches?cursor=abc&limit=50`)), { p_cursor: "abc", p_limit: 50 });
  for (const query of ["limit=0", "limit=51", "limit=no", "cursor=a&cursor=b", "limit=10&limit=20"]) {
    assert.throws(() => validateBunchesQuery(new URL(`${origin}/api/v1/boards/${boardId}/bunches?${query}`)), { status: 400, code: "INVALID_INPUT" });
  }
  let call;
  const bunch = { id: goalId, cycle_no: 3, target_count: 5, valid_count: 2, progress_state: "incomplete", completed_at: null };
  const client = { rpc: async (name, args) => { call = { name, args }; return { data: { items: [bunch], next_cursor: null }, error: null }; } };
  const response = await listBunchesResponse(boardId, new URL(`${origin}/api/v1/boards/${boardId}/bunches?limit=4`), client);
  assert.equal(response.status, 200);
  assert.deepEqual(call, { name: "list_bunches", args: { p_board_id: boardId, p_cursor: null, p_limit: 4 } });
  assert.deepEqual(await response.json(), { items: [bunch], next_cursor: null });
  const badProjection = await listBunchesResponse(boardId, new URL(`${origin}/api/v1/boards/${boardId}/bunches`), {
    rpc: async () => ({ data: { items: [{ ...bunch, owner_user_id: goalId }], next_cursor: null }, error: null }),
  });
  assert.equal(badProjection.status, 503);
});
