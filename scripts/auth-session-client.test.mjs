import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clearCsrfToken, sessionFetch, sessionMutationFetch } from "../src/client/auth-session.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; clearCsrfToken(); });
const json = (data, status = 200) => Response.json(data, { status });

test("an expired GET recovers once and retries without caching or credentials leaving same-origin", async () => {
  let refreshed = false; const calls = [];
  globalThis.fetch = async (path, init) => {
    calls.push(path); assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "same-origin");
    if (path === "/api/v1/goals") return refreshed ? json({ items: [] }) : json({}, 401);
    if (path === "/api/v1/auth/session") return json({}, 401);
    if (path === "/api/v1/auth/csrf") return json({ csrf_token: "test-only-csrf" });
    if (path === "/api/v1/auth/refresh") { refreshed = true; assert.equal(JSON.parse(init.body).user_id, undefined); return json({ account_state: "active" }); }
    throw new Error("Unexpected request");
  };
  assert.equal((await sessionFetch("/api/v1/goals")).status, 200);
  assert.deepEqual(calls, ["/api/v1/goals", "/api/v1/auth/session", "/api/v1/auth/csrf", "/api/v1/auth/refresh", "/api/v1/goals"]);
});

test("parallel expired reads share one recovery rather than consume the refresh token twice", async () => {
  let refreshed = false, refreshes = 0;
  globalThis.fetch = async path => {
    if (path === "/api/v1/auth/session") return json({}, 401);
    if (path === "/api/v1/auth/csrf") return json({ csrf_token: "test-only-csrf" });
    if (path === "/api/v1/auth/refresh") { refreshes++; refreshed = true; return json({}); }
    return json({}, refreshed ? 200 : 401);
  };
  const responses = await Promise.all([sessionFetch("/api/v1/goals"), sessionFetch("/api/v1/me")]);
  assert.deepEqual(responses.map(value => value.status), [200, 200]); assert.equal(refreshes, 1);
});

test("mutation retry keeps body and idempotency key and replaces only the rotated CSRF token", async () => {
  let refreshed = false, csrfs = 0; const writes = [];
  globalThis.fetch = async (path, init) => {
    if (path === "/api/v1/auth/session") return json({}, 401);
    if (path === "/api/v1/auth/csrf") return json({ csrf_token: `test-only-csrf-${++csrfs}` });
    if (path === "/api/v1/auth/refresh") { refreshed = true; return json({}); }
    writes.push({ body: init.body, key: init.headers.get("Idempotency-Key"), csrf: init.headers.get("X-CSRF-Token") });
    return json({}, refreshed ? 200 : 401);
  };
  const init = { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "test-only-same-key" }, body: '{"title":"test-only"}' };
  assert.equal((await sessionMutationFetch("/api/v1/goals", init)).status, 200);
  assert.equal(writes.length, 2); assert.equal(writes[0].body, writes[1].body); assert.equal(writes[0].key, writes[1].key);
  assert.notEqual(writes[0].csrf, writes[1].csrf);
});

test("unavailable refresh retains the original failure and never retries a product mutation", async () => {
  let writes = 0;
  globalThis.fetch = async path => {
    if (path === "/api/v1/auth/csrf") return json({ csrf_token: "test-only-csrf" });
    if (path === "/api/v1/auth/session") return json({}, 401);
    if (path === "/api/v1/auth/refresh") return json({}, 503);
    writes++; return json({}, 401);
  };
  assert.equal((await sessionMutationFetch("/api/v1/goals", { method: "POST", body: "{}" })).status, 401);
  assert.equal(writes, 1);
});

test("CSRF preparation and mutations stay sequential even without browser Web Locks", async () => {
  const events = []; let token = 0;
  globalThis.fetch = async (path, init) => {
    if (path === "/api/v1/auth/csrf") { events.push("csrf"); return json({ csrf_token: `test-only-csrf-${++token}` }); }
    events.push(init.body); return json({});
  };
  await Promise.all([sessionMutationFetch("/api/v1/goals", { method: "POST", body: "first" }), sessionMutationFetch("/api/v1/goals", { method: "POST", body: "second" })]);
  assert.deepEqual(events, ["csrf", "first", "csrf", "second"]);
});
