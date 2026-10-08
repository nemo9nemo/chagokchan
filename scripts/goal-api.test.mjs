import assert from "node:assert/strict";
import test from "node:test";
import { createCsrfToken, CSRF_COOKIE_NAME } from "../src/server/api-security.mjs";
import {
  createGoalResponse,
  getGoalResponse,
  projectGoalDetail,
  updateGoalResponse,
  validateCreateGoalInput,
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
