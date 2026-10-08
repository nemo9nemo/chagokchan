import assert from "node:assert/strict";
import test from "node:test";
import { createCsrfToken, CSRF_COOKIE_NAME } from "../src/server/api-security.mjs";
import {
  acceptConnectionRequestResponse,
  createBlockResponse,
  createConnectionInviteResponse,
  createConnectionRequestResponse,
  disconnectResponse,
  listConnectionsResponse,
  listConnectionInvitesResponse,
  listConnectionRequestsResponse,
  listBlocksResponse,
  previewConnectionInviteResponse,
  revokeBlockResponse,
  validateIdempotencyKey,
  validateInviteSecret,
} from "../src/server/connection-api.mjs";

const origin = "http://127.0.0.1:3000";
const secret = Buffer.alloc(32, 19);
const userId = "11111111-1111-4111-8111-111111111111";
const resourceId = "22222222-2222-4222-8222-222222222222";
const requestKey = "33333333-3333-4333-8333-333333333333";
const profile = { user_id: userId, nickname: "차곡이", avatar_key: "grape" };

function mutationRequest(path, body = {}, { idempotencyKey, requestOrigin = origin, includeCsrf = true } = {}) {
  const csrf = createCsrfToken(secret);
  const headers = { Origin: requestOrigin, "Content-Type": "application/json" };
  if (includeCsrf) {
    headers["X-CSRF-Token"] = csrf;
    headers.Cookie = `${CSRF_COOKIE_NAME}=${csrf}`;
  }
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return new Request(`${origin}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

const opts = { expectedOrigin: origin, secret };

test("invite secret accepts a link token or normalizes a grouped code", () => {
  assert.deepEqual(validateInviteSecret({ link_token: "A".repeat(32) }), { link_token: "A".repeat(32) });
  assert.deepEqual(validateInviteSecret({ code: "ab-cd-ef-gh-jk-mn" }), { code: "ABCDEFGHJKMN" });
  assert.throws(() => validateInviteSecret({ link_token: "A".repeat(32), code: "0".repeat(12) }), { status: 400 });
  assert.throws(() => validateInviteSecret({ code: "OOOOOOOOOOOO" }), { status: 400 });
  assert.throws(() => validateIdempotencyKey("not-a-uuid"), { status: 400 });
});

test("connection lists call their authenticated RPC with bounded keyset arguments", async () => {
  const calls = [];
  const pages = {
    list_connections: [{ id: resourceId, status: "active", generation: 2, other_user: profile }],
    list_connection_invites: [{ id: resourceId, created_at: "2026-10-08T00:00:00Z", expires_at: "2026-10-09T00:00:00Z", redeemed_at: null, revoked_at: null }],
    list_connection_requests: [{ id: resourceId, direction: "incoming", other_user: profile, status: "pending", created_at: "2026-10-08T00:00:00Z", expires_at: "2026-10-10T00:00:00Z" }],
    list_blocks: [{ id: resourceId, blocked_user: profile, created_at: "2026-10-08T00:00:00Z" }],
  };
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { items: pages[name], next_cursor: null }, error: null }; } };
  const urls = [
    [listConnectionsResponse, "list_connections", "/api/v1/connections?limit=12&cursor=abc_DEF"],
    [listConnectionInvitesResponse, "list_connection_invites", "/api/v1/connection-invites"],
    [listConnectionRequestsResponse, "list_connection_requests", "/api/v1/connection-requests?direction=incoming"],
    [listBlocksResponse, "list_blocks", "/api/v1/blocks"],
  ];
  for (const [handler, rpc, path] of urls) {
    const response = await handler(new URL(path, origin), client);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/i);
    assert.equal((await response.json()).items.length, 1);
    assert.equal(calls.at(-1).name, rpc);
  }
  assert.deepEqual(calls[0].args, { p_cursor: "abc_DEF", p_limit: 12 });
  assert.deepEqual(calls[2].args, { p_cursor: null, p_limit: 20, p_direction: "incoming" });
});

test("list queries reject unknown, duplicate, malformed, and oversized parameters before RPC", async () => {
  let called = false;
  const client = { rpc: async () => { called = true; return { data: null, error: null }; } };
  for (const query of ["limit=1&limit=2", "limit=51", "cursor=bad%20cursor", "actor_id=x", "direction=sideways", "direction=both"]) {
    const response = await listConnectionRequestsResponse(new URL(`/api/v1/connection-requests?${query}`, origin), client);
    assert.equal(response.status, 400);
  }
  assert.equal(called, false);
});

test("one-time invite response is allowlisted and returned only by create", async () => {
  const client = { rpc: async (name, args) => {
    assert.equal(name, "create_connection_invite");
    assert.equal(args, undefined);
    return { data: { id: resourceId, link_path: `/connect#invite=${"A".repeat(32)}`, code: "0123456789AB", expires_at: "2026-10-09T00:00:00Z" }, error: null };
  } };
  const response = await createConnectionInviteResponse(mutationRequest("/api/v1/connection-invites"), client, opts);
  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(await response.json()).sort(), ["code", "expires_at", "id", "link_path"]);
});

test("invite preview checks CSRF before RPC and forwards only a normalized secret", async () => {
  let args;
  let called = false;
  const client = { rpc: async (name, value) => {
    called = true;
    assert.equal(name, "preview_connection_invite");
    args = value;
    return { data: { inviter_nickname: "초대한이", expires_at: "2026-10-09T00:00:00Z" }, error: null };
  } };
  const denied = await previewConnectionInviteResponse(mutationRequest("/api/v1/connection-invites/preview", { code: "0123456789ab" }, { includeCsrf: false }), client, opts);
  assert.equal(denied.status, 403);
  assert.equal(called, false);
  const response = await previewConnectionInviteResponse(mutationRequest("/api/v1/connection-invites/preview", { code: "01-23-45-67-89-ab" }), client, opts);
  assert.equal(response.status, 200);
  assert.deepEqual(args, { p_secret: { code: "0123456789AB" } });
});

test("connection request needs CSRF, a UUID idempotency key, and the private invite secret", async () => {
  let args;
  const client = { rpc: async (name, value) => {
    assert.equal(name, "create_connection_request");
    args = value;
    return { data: { id: resourceId, replayed: false }, error: null };
  } };
  const missingKey = await createConnectionRequestResponse(mutationRequest("/api/v1/connection-requests", { link_token: "L".repeat(32) }), client, opts);
  assert.equal(missingKey.status, 400);
  const response = await createConnectionRequestResponse(mutationRequest("/api/v1/connection-requests", { link_token: "L".repeat(32) }, { idempotencyKey: requestKey }), client, opts);
  assert.equal(response.status, 201);
  assert.deepEqual(args, { p_request_key: requestKey, p_secret: { link_token: "L".repeat(32) } });
});

test("relationship mutations pass only path and allowlisted body values to business RPCs", async () => {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    const id = Object.values(args ?? {}).find((value) => typeof value === "string" && value === resourceId) ?? userId;
    return { data: { id, replayed: false }, error: null };
  } };
  const accepted = await acceptConnectionRequestResponse(resourceId, mutationRequest("/accept"), client, opts);
  assert.equal(accepted.status, 200);
  assert.deepEqual(calls[0], { name: "accept_connection_request", args: { p_request_id: resourceId } });

  const disconnected = await disconnectResponse(resourceId, mutationRequest("/disconnect", {}), client, opts);
  assert.equal(disconnected.status, 200);
  assert.deepEqual(calls[1], { name: "disconnect", args: { p_connection_id: resourceId } });

  const blocked = await createBlockResponse(mutationRequest("/blocks", { user_id: userId }), client, opts);
  assert.equal(blocked.status, 200);
  assert.deepEqual(calls[2], { name: "create_block", args: { p_user_id: userId } });
  const invalid = await createBlockResponse(mutationRequest("/blocks", { user_id: userId, actor_id: resourceId }), client, opts);
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 3);
});

test("mutation state errors are mapped to bounded no-store responses", async () => {
  const client = { rpc: async () => ({ data: null, error: { code: "PT404", message: "private_database_detail" } }) };
  const response = await revokeBlockResponse(resourceId, mutationRequest("/blocks/id"), client, opts);
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.error.code, "OBJECT_NOT_AVAILABLE");
  assert.doesNotMatch(JSON.stringify(payload), /private_database_detail/);
});
