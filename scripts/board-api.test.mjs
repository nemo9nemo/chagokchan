import assert from "node:assert/strict";
import test from "node:test";
import { getBoardResponse, grantBoardMemberResponse, listBoardMembersResponse, listMySharedBoardsResponse, projectBoardView, revokeBoardMemberResponse, validateBoardMembersQuery } from "../src/server/board-api.mjs";
import { createCsrfToken } from "../src/server/api-security.mjs";

const boardId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const secret = Buffer.alloc(32, 9);

function request(path, method, body) {
  const token = createCsrfToken(secret);
  return new Request(`https://chagokchan.test${path}`, {
    method, headers: { Origin: "https://chagokchan.test", "Content-Type": "application/json", Cookie: `chagokchan_csrf=${token}`, "X-CSRF-Token": token }, body: JSON.stringify(body),
  });
}

const ownerBoard = {
  viewer_role: "owner", id: boardId, goal_id: goalId, kind: "personal", revision: 1, next_target_count: 20,
  shared_title: null, shared_description: null, current_bunch: null,
};

test("board view keeps owner and contributor projections separate", () => {
  assert.deepEqual(projectBoardView(ownerBoard), ownerBoard);
  const contributor = {
    viewer_role: "contributor", id: boardId, kind: "shared", shared_title: "나눔", shared_description: null,
    owner: { user_id: userId, nickname: "주인", avatar_key: "grape" }, goal_state: "active", current_bunch: null, can_praise: true,
  };
  assert.deepEqual(projectBoardView(contributor), contributor);
  assert.throws(() => projectBoardView({ ...contributor, goal_id: goalId }));
  assert.throws(() => projectBoardView({ ...ownerBoard, owner: contributor.owner }));
});

test("get board calls the role-scoped RPC and rejects response fields outside the allowlist", async () => {
  const response = await getBoardResponse(boardId, { rpc: async (name, input) => {
    assert.equal(name, "get_board");
    assert.deepEqual(input, { p_board_id: boardId });
    return { data: ownerBoard, error: null };
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), ownerBoard);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const invalid = await getBoardResponse("bad", { rpc: async () => { throw new Error("must not call"); } });
  assert.equal(invalid.status, 400);
  const leaked = await getBoardResponse(boardId, { rpc: async () => ({ data: { ...ownerBoard, private_description: "secret" }, error: null }) });
  assert.equal(leaked.status, 503);
});

test("member query allows only a bounded cursor and limit", () => {
  assert.deepEqual(validateBoardMembersQuery(new URL("https://chagokchan.test/api")), { p_cursor: null, p_limit: 20 });
  assert.deepEqual(validateBoardMembersQuery(new URL("https://chagokchan.test/api?cursor=YWJj&limit=50")), { p_cursor: "YWJj", p_limit: 50 });
  for (const query of ["?limit=0", "?limit=51", "?limit=1&limit=2", "?cursor=bad%20cursor", "?actor_id=" + userId]) {
    assert.throws(() => validateBoardMembersQuery(new URL("https://chagokchan.test/api" + query)), { status: 400 });
  }
});

test("member listing projects minimal profiles and safely rejects excess fields", async () => {
  const member = { user: { user_id: userId, nickname: "지인", avatar_key: "leaf" }, role: "contributor", status: "active", connection_generation: 1 };
  const client = { rpc: async (name, input) => {
    assert.equal(name, "list_board_members");
    assert.deepEqual(input, { p_board_id: boardId, p_cursor: null, p_limit: 20 });
    return { data: { items: [member], next_cursor: null }, error: null };
  } };
  const response = await listBoardMembersResponse(boardId, new URL("https://chagokchan.test/api"), client);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, [member]);
  const leaked = await listBoardMembersResponse(boardId, new URL("https://chagokchan.test/api"), {
    rpc: async () => ({ data: { items: [{ ...member, email: "private" }], next_cursor: null }, error: null }),
  });
  assert.equal(leaked.status, 503);
});

test("my shared board listing uses the live-grant RPC and contributor allowlist", async () => {
  const board = {
    viewer_role: "contributor", id: boardId, kind: "shared", shared_title: "함께 나눔", shared_description: null,
    owner: { user_id: userId, nickname: "주인", avatar_key: "grape" }, goal_state: "active", current_bunch: null, can_praise: true,
  };
  const client = { rpc: async (name, input) => {
    assert.equal(name, "list_my_shared_boards");
    assert.deepEqual(input, { p_cursor: null, p_limit: 20 });
    return { data: { items: [board], next_cursor: null }, error: null };
  } };
  const response = await listMySharedBoardsResponse(new URL("https://chagokchan.test/api"), client);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [board], next_cursor: null });
  const leaked = await listMySharedBoardsResponse(new URL("https://chagokchan.test/api"), {
    rpc: async () => ({ data: { items: [{ ...board, goal_id: goalId }], next_cursor: null }, error: null }),
  });
  assert.equal(leaked.status, 503);
});

test("grant and revoke require CSRF and map only fixed member RPC inputs", async () => {
  const calls = [];
  const client = { rpc: async (name, input) => {
    calls.push(name);
    assert.deepEqual(input, { p_board_id: boardId, p_user_id: userId });
    return { data: { id: boardId, replayed: false }, error: null };
  } };
  const blocked = await grantBoardMemberResponse(boardId, userId, new Request("https://chagokchan.test", { method: "PUT" }), client, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(blocked.status, 403);
  assert.deepEqual(calls, []);
  const grant = await grantBoardMemberResponse(boardId, userId, request("/members/" + userId, "PUT", { role: "contributor" }), client, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(grant.status, 200);
  const revoke = await revokeBoardMemberResponse(boardId, userId, request("/members/" + userId, "DELETE", {}), client, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(revoke.status, 200);
  assert.deepEqual(calls, ["grant_board_member", "revoke_board_member"]);
});

test("grant and revoke reject caller-selected role, actor, and nonempty revoke body", async () => {
  const client = { rpc: async () => { throw new Error("invalid inputs must not invoke an RPC"); } };
  const wrongRole = await grantBoardMemberResponse(boardId, userId, request("/members", "PUT", { role: "owner" }), client, { expectedOrigin: "https://chagokchan.test", secret });
  const callerActor = await grantBoardMemberResponse(boardId, userId, request("/members", "PUT", { actor_user_id: userId }), client, { expectedOrigin: "https://chagokchan.test", secret });
  const nonemptyRevoke = await revokeBoardMemberResponse(boardId, userId, request("/members", "DELETE", { reason: "no" }), client, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(wrongRole.status, 400);
  assert.equal(callerActor.status, 400);
  assert.equal(nonemptyRevoke.status, 400);
});
