import assert from "node:assert/strict";
import test from "node:test";
import { cancelPraiseResponse, createPraiseResponse, editSelfPraiseResponse, listBoardPraisesResponse, peerPraiseStateResponse, validateBoardPraisesQuery, validateCancelPraiseInput, validateCreatePraiseInput, validateEditSelfPraiseInput, validatePeerPraiseStateInput } from "../src/server/praise-api.mjs";
import { createCsrfToken } from "../src/server/api-security.mjs";

const boardId = "11111111-1111-4111-8111-111111111111";
const bunchId = "22222222-2222-4222-8222-222222222222";
const praiseId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const secret = Buffer.alloc(32, 7);
const now = "2026-10-08T09:00:00.000Z";

function mutationRequest(path, body, extraHeaders = {}) {
  const token = createCsrfToken(secret);
  return new Request(`https://chagokchan.test${path}`, {
    method: "POST",
    headers: {
      Origin: "https://chagokchan.test",
      "Content-Type": "application/json",
      Cookie: `chagokchan_csrf=${token}`,
      "X-CSRF-Token": token,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

test("create praise input maps only the board, idempotency key, message, and date", () => {
  assert.deepEqual(validateCreatePraiseInput({ message: "기록", occurred_on: "2026-10-07" }, praiseId, boardId), {
    p_request_key: praiseId, p_board_id: boardId, p_message: "기록", p_occurred_on: "2026-10-07",
  });
  assert.deepEqual(validateCreatePraiseInput({}, praiseId, boardId), {
    p_request_key: praiseId, p_board_id: boardId, p_message: null, p_occurred_on: null,
  });
});

test("create praise rejects client identity, invalid dates, overlong messages, and invalid keys", () => {
  assert.throws(() => validateCreatePraiseInput({ actor_user_id: actorId }, praiseId, boardId), { status: 400 });
  assert.throws(() => validateCreatePraiseInput({ occurred_on: "2026-02-30" }, praiseId, boardId), { status: 400 });
  assert.throws(() => validateCreatePraiseInput({ message: "a".repeat(1001) }, praiseId, boardId), { status: 400 });
  assert.throws(() => validateCreatePraiseInput({}, "not-a-key", boardId), { status: 400 });
  assert.throws(() => validateCreatePraiseInput({}, praiseId, "not-a-board"), { status: 400 });
});

test("create praise checks CSRF before invoking the full result RPC and returns its exact projection", async () => {
  let called = false;
  const client = { rpc: async (name, input) => {
    called = true;
    if (name === "get_board") {
      assert.deepEqual(input, { p_board_id: boardId });
      return { data: { viewer_role: "owner", id: boardId, goal_id: actorId, kind: "personal", revision: 1, next_target_count: 20,
        shared_title: null, shared_description: null, current_bunch: null }, error: null };
    }
    assert.equal(name, "create_personal_praise");
    assert.deepEqual(input, { p_request_key: praiseId, p_board_id: boardId, p_message: null, p_occurred_on: null });
    return { data: { id: praiseId, bunch_id: bunchId, replayed: false }, error: null };
  } };
  const blocked = await createPraiseResponse(boardId, new Request("https://chagokchan.test", { method: "POST" }), client, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(blocked.status, 403);
  assert.equal(called, false);
  const request = mutationRequest("/boards/" + boardId + "/praises", {}, { "Idempotency-Key": praiseId });
  const response = await createPraiseResponse(boardId, request, client, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: praiseId, bunch_id: bunchId, replayed: false });
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
});

test("shared praise create checks the current contributor role and sends only peer input", async () => {
  const calls = [];
  const client = { rpc: async (name, input) => {
    calls.push([name, input]);
    if (name === "get_board") return { data: {
      viewer_role: "contributor", id: boardId, kind: "shared", shared_title: "응원판", shared_description: null,
      owner: { user_id: actorId, nickname: "주인", avatar_key: "grape" }, goal_state: "active", current_bunch: null, can_praise: true,
    }, error: null };
    assert.equal(name, "create_peer_praise");
    return { data: { id: praiseId, bunch_id: bunchId, replayed: false }, error: null };
  } };
  const response = await createPraiseResponse(boardId, mutationRequest("/boards/" + boardId + "/praises", { message: "응원" }, { "Idempotency-Key": praiseId }), client, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(response.status, 201);
  assert.deepEqual(calls, [
    ["get_board", { p_board_id: boardId }],
    ["create_peer_praise", { p_request_key: praiseId, p_board_id: boardId, p_message: "응원" }],
  ]);
  assert.deepEqual(await response.json(), { id: praiseId, bunch_id: bunchId, replayed: false });
});

test("shared praise rejects occurred_on and owners cannot write to their shared board", async () => {
  let writes = 0;
  const contributor = { rpc: async (name) => {
    if (name === "get_board") return { data: { viewer_role: "contributor", id: boardId, kind: "shared", shared_title: "응원판", shared_description: null,
      owner: { user_id: actorId, nickname: "주인", avatar_key: "grape" }, goal_state: "active", current_bunch: null, can_praise: true }, error: null };
    writes++;
    return { data: { id: praiseId, bunch_id: bunchId, replayed: false }, error: null };
  } };
  const invalid = await createPraiseResponse(boardId, mutationRequest("/praises", { occurred_on: "2026-10-08" }, { "Idempotency-Key": praiseId }), contributor, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(invalid.status, 400);
  assert.equal(writes, 0);
  const owner = { rpc: async () => ({ data: {
    viewer_role: "owner", id: boardId, goal_id: actorId, kind: "shared", revision: 1, next_target_count: 20,
    shared_title: "응원판", shared_description: null, current_bunch: null,
  }, error: null }) };
  const denied = await createPraiseResponse(boardId, mutationRequest("/praises", {}, { "Idempotency-Key": praiseId }), owner, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(denied.status, 403);
});

test("self praise edit requires a nonempty allowlisted patch and preserves explicit null", () => {
  assert.deepEqual(validateEditSelfPraiseInput({ message: null, occurred_on: "2026-10-08" }, praiseId), {
    p_praise_id: praiseId, p_patch: { message: null, occurred_on: "2026-10-08" },
  });
  assert.throws(() => validateEditSelfPraiseInput({}, praiseId), { status: 400 });
  assert.throws(() => validateEditSelfPraiseInput({ source: "peer" }, praiseId), { status: 400 });
  assert.throws(() => validateEditSelfPraiseInput({ occurred_on: "yesterday" }, praiseId), { status: 400 });
});

test("self praise edit maps only the fixed owner RPC and safely maps a missing record", async () => {
  const client = { rpc: async (name, input) => {
    assert.equal(name, "edit_self_praise");
    assert.deepEqual(input, { p_praise_id: praiseId, p_patch: { message: null } });
    return { data: null, error: { code: "PT404", message: "praise_not_found" } };
  } };
  const response = await editSelfPraiseResponse(praiseId, mutationRequest("/praises/" + praiseId, { message: null }), client, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "OBJECT_NOT_AVAILABLE");
});

test("cancel praise accepts an empty object only", () => {
  assert.deepEqual(validateCancelPraiseInput({}, praiseId), { p_praise_id: praiseId });
  assert.throws(() => validateCancelPraiseInput({ message: "extra" }, praiseId), { status: 400 });
  assert.throws(() => validateCancelPraiseInput({ unexpected: true }, praiseId), { status: 400 });
});

test("cancel praise checks CSRF first and returns no current count", async () => {
  let called = false;
  const client = { rpc: async (name, input) => {
    called = true;
    assert.equal(name, "cancel_praise");
    assert.deepEqual(input, { p_praise_id: praiseId });
    return { data: { id: praiseId, replayed: false }, error: null };
  } };
  const blocked = await cancelPraiseResponse(praiseId, new Request("https://chagokchan.test", { method: "POST" }), client, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(blocked.status, 403);
  assert.equal(called, false);
  const response = await cancelPraiseResponse(praiseId, mutationRequest("/praises/" + praiseId + "/cancel", {}), client, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: praiseId, replayed: false });
});

test("peer praise state validates an empty body, checks CSRF, and calls only the selected RPC", async () => {
  assert.deepEqual(validatePeerPraiseStateInput({}, praiseId, "hide"), { p_praise_id: praiseId });
  assert.throws(() => validatePeerPraiseStateInput({ actor_user_id: actorId }, praiseId, "hide"), { status: 400 });
  assert.throws(() => validatePeerPraiseStateInput({}, "bad", "hide"), { status: 400 });
  assert.throws(() => validatePeerPraiseStateInput({}, praiseId, "cancel"), { status: 400 });
  let called = false;
  const client = { rpc: async (name, input) => {
    called = true;
    assert.equal(name, "exclude_peer_praise");
    assert.deepEqual(input, { p_praise_id: praiseId });
    return { data: { id: praiseId, replayed: true }, error: null };
  } };
  const blocked = await peerPraiseStateResponse(praiseId, "exclude", new Request("https://chagokchan.test", { method: "POST" }), client, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(blocked.status, 403);
  assert.equal(called, false);
  const response = await peerPraiseStateResponse(praiseId, "exclude", mutationRequest("/praises/" + praiseId + "/exclude", {}), client, { expectedOrigin: "https://chagokchan.test", secret });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: praiseId, replayed: true });
});

test("board praise query validates page size, cursor, bunch ID, and hidden-owner flag", () => {
  assert.deepEqual(validateBoardPraisesQuery(new URL("https://chagokchan.test/api")), {
    p_bunch_id: null, p_cursor: null, p_limit: 20, p_include_hidden: false,
  });
  assert.deepEqual(validateBoardPraisesQuery(new URL(`https://chagokchan.test/api?bunch_id=${bunchId}&limit=50&include_hidden=true&cursor=YWJj`)), {
    p_bunch_id: bunchId, p_cursor: "YWJj", p_limit: 50, p_include_hidden: true,
  });
  for (const query of ["?limit=0", "?limit=51", "?limit=1&limit=2", "?cursor=bad%20cursor", "?bunch_id=bad", "?include_hidden=yes", "?actor_id=" + actorId]) {
    assert.throws(() => validateBoardPraisesQuery(new URL("https://chagokchan.test/api" + query)), { status: 400 });
  }
});

test("board praise owner projection keeps only owner fields", async () => {
  const row = {
    viewer_role: "owner", id: praiseId, bunch_id: bunchId, source: "self",
    actor: { user_id: actorId, nickname: "나", avatar_key: "grape" }, actor_label: "나",
    message: "기록", occurred_on: "2026-10-08", recorded_at: now,
    cancelled_at: null, hidden_at: null, excluded_at: null, author_erased_at: null,
  };
  const response = await listBoardPraisesResponse(boardId, new URL("https://chagokchan.test/api"), {
    rpc: async (name, input) => {
      assert.equal(name, "list_board_praises");
      assert.deepEqual(input, { p_board_id: boardId, p_bunch_id: null, p_cursor: null, p_limit: 20, p_include_hidden: false });
      return { data: { items: [row], next_cursor: null }, error: null };
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items[0].actor_label, "나");
  assert.equal("email" in body.items[0], false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("board praise contributor projection excludes owner profile and moderation fields", async () => {
  const row = {
    viewer_role: "contributor", id: praiseId, bunch_id: bunchId, source: "peer",
    message: "고마워", recorded_at: now, cancelled_at: null,
  };
  const response = await listBoardPraisesResponse(boardId, new URL("https://chagokchan.test/api"), {
    rpc: async () => ({ data: { items: [row], next_cursor: null }, error: null }),
  });
  const body = await response.json();
  assert.deepEqual(body.items[0], row);
  const leaked = await listBoardPraisesResponse(boardId, new URL("https://chagokchan.test/api"), {
    rpc: async () => ({ data: { items: [{ ...row, hidden_at: null }], next_cursor: null }, error: null }),
  });
  assert.equal(leaked.status, 503);
});
