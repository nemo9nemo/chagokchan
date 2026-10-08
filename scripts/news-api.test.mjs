import assert from "node:assert/strict";
import test from "node:test";
import { createCsrfToken, CSRF_COOKIE_NAME } from "../src/server/api-security.mjs";
import { listNotificationsResponse, listSentPraisesResponse, markNotificationReadResponse } from "../src/server/news-api.mjs";

const origin = "http://127.0.0.1:3000";
const secret = Buffer.alloc(32, 31);
const notificationId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";
const opts = { expectedOrigin: origin, secret };

function mutationRequest(body = { read: true }, { includeCsrf = true } = {}) {
  const csrf = createCsrfToken(secret);
  const headers = { Origin: origin, "Content-Type": "application/json" };
  if (includeCsrf) {
    headers["X-CSRF-Token"] = csrf;
    headers.Cookie = `${CSRF_COOKIE_NAME}=${csrf}`;
  }
  return new Request(`${origin}/api/v1/notifications/${notificationId}`, { method: "PATCH", headers, body: JSON.stringify(body) });
}

test("notification page uses a bounded RPC page and returns only the minimal target projection", async () => {
  let call;
  const client = { rpc: async (name, args) => {
    call = { name, args };
    return { data: { items: [{ id: notificationId, type: "praise_received", created_at: "2026-10-08T10:00:00Z", read_at: null, target: { kind: "praise", id: targetId } }], next_cursor: "cursor_01" }, error: null };
  } };
  const response = await listNotificationsResponse(new URL("/api/v1/notifications?limit=7&cursor=cursor_01", origin), client);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/i);
  assert.deepEqual(call, { name: "list_notifications", args: { p_cursor: "cursor_01", p_limit: 7 } });
  const body = await response.json();
  assert.deepEqual(Object.keys(body.items[0]).sort(), ["created_at", "id", "read_at", "target", "type"]);
  assert.deepEqual(body.items[0].target, { kind: "praise", id: targetId });
  assert.equal(body.next_cursor, "cursor_01");
});

test("news page queries reject unknown, duplicate, malformed, and excessive values before RPC", async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: { items: [], next_cursor: null }, error: null }; } };
  for (const query of ["actor_id=other", "limit=1&limit=2", "limit=51", "limit=0", "cursor=bad%20cursor"]) {
    assert.equal((await listNotificationsResponse(new URL(`/api/v1/notifications?${query}`, origin), client)).status, 400);
    assert.equal((await listSentPraisesResponse(new URL(`/api/v1/sent-praises?${query}`, origin), client)).status, 400);
  }
  assert.equal(calls, 0);
});

test("notification response rejects unexpected or invalid target data", async () => {
  const client = { rpc: async () => ({ data: { items: [{
    id: notificationId, type: "praise_received", created_at: "2026-10-08T10:00:00Z", read_at: null,
    target: { kind: "praise", id: targetId }, message: "private body must not be present",
  }], next_cursor: null }, error: null }) };
  const response = await listNotificationsResponse(new URL("/api/v1/notifications", origin), client);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private body/);
});

test("sent praise page returns only the author's peer entry and cancellation fields", async () => {
  const client = { rpc: async (name, args) => {
    assert.equal(name, "list_sent_praises");
    assert.deepEqual(args, { p_cursor: null, p_limit: 20 });
    return { data: { items: [{
      id: notificationId, source: "peer", message: "응원해요", recorded_at: "2026-10-08T10:00:00Z",
      cancelled_at: null, can_cancel: true,
    }], next_cursor: null }, error: null };
  } };
  const response = await listSentPraisesResponse(new URL("/api/v1/sent-praises", origin), client);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.items[0]).sort(), ["can_cancel", "cancelled_at", "id", "message", "recorded_at", "source"]);
  assert.equal(body.items[0].can_cancel, true);
});

test("mark notification read checks CSRF first and accepts only read true", async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: { id: notificationId, replayed: false }, error: null }; } };
  const denied = await markNotificationReadResponse(notificationId, mutationRequest({ read: true }, { includeCsrf: false }), client, opts);
  assert.equal(denied.status, 403);
  const falseRead = await markNotificationReadResponse(notificationId, mutationRequest({ read: false }), client, opts);
  assert.equal(falseRead.status, 400);
  const extraField = await markNotificationReadResponse(notificationId, mutationRequest({ read: true, user_id: targetId }), client, opts);
  assert.equal(extraField.status, 400);
  assert.equal(calls, 0);
});

test("mark notification read maps only an idempotent RPC result", async () => {
  const client = { rpc: async (name, args) => {
    assert.equal(name, "mark_notification_read");
    assert.deepEqual(args, { p_notification_id: notificationId });
    return { data: { id: notificationId, replayed: true }, error: null };
  } };
  const response = await markNotificationReadResponse(notificationId, mutationRequest(), client, opts);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/i);
  assert.deepEqual(await response.json(), { id: notificationId, replayed: true });
});

test("mark notification read safely hides inaccessible rows and database details", async () => {
  const client = { rpc: async () => ({ data: null, error: { code: "PT404", message: "private_notification_target" } }) };
  const response = await markNotificationReadResponse(notificationId, mutationRequest(), client, opts);
  assert.equal(response.status, 404);
  const body = await response.text();
  assert.match(body, /OBJECT_NOT_AVAILABLE/);
  assert.doesNotMatch(body, /private_notification_target/);
});
