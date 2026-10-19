import assert from "node:assert/strict";
import test from "node:test";
import { createCsrfToken } from "../src/server/api-security.mjs";
import { authContextResponse, bootstrapAccountResponse, validateBootstrapInput } from "../src/server/registration-api.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const origin = "https://app.example.invalid";
const secret = "test-only-signing-key-with-at-least-32-bytes";
const opts = { expectedOrigin: origin, secret, env: { APP_AUTH_MODE: "local_fixture" } };
const input = { adult_confirmed: true, registration_policy_version: "0.2.0" };
const me = { user_id: id, profile: { user_id: id, nickname: "새로운 사용자", avatar_key: "star" }, timezone: "Asia/Seoul",
  account_status: "active", adult_confirmed_at: "2026-10-19T00:00:00Z", registration_policy_version: "0.2.0" };
function request(body = input, csrf = true) {
  const token = createCsrfToken(secret);
  return new Request(`${origin}/api/v1/me/bootstrap`, { method: "POST", headers: { origin, "content-type": "application/json",
    ...(csrf ? { "x-csrf-token": token, cookie: `chagokchan_csrf=${token}` } : {}) }, body: JSON.stringify(body) });
}

test("bootstrap maps only explicit adult confirmation and policy version, never a caller's identity or timestamps", () => {
  assert.deepEqual(validateBootstrapInput(input), { p_adult_confirmed: true, p_registration_policy_version: "0.2.0" });
  for (const body of [null, [], {}, { ...input, adult_confirmed: false }, { ...input, adult_confirmed: "true" },
    { ...input, user_id: other }, { ...input, adult_confirmed_at: "2000-01-01" }, { ...input, birth_date: "2000-01-01" },
    { ...input, nickname: "override" }, { ...input, registration_policy_version: "" }, { ...input, registration_policy_version: "x".repeat(41) }]) {
    assert.throws(() => validateBootstrapInput(body), error => error.status === 400);
  }
});

test("invalid confirmation and missing CSRF never invoke the registration RPC", async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: me, error: null }; } };
  assert.equal((await bootstrapAccountResponse(request(input, false), client, id, opts)).status, 403);
  assert.equal((await bootstrapAccountResponse(request({ ...input, adult_confirmed: false }), client, id, opts)).status, 400);
  assert.equal(calls, 0);
});

test("bootstrap uses the verified UUID only for projection checks and forwards the exact two RPC parameters", async () => {
  const client = { rpc: async (name, args) => {
    assert.equal(name, "bootstrap_account");
    assert.deepEqual(args, { p_adult_confirmed: true, p_registration_policy_version: "0.2.0" });
    return { data: me, error: null };
  } };
  const response = await bootstrapAccountResponse(request(), client, id, opts);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), me);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
});

test("an old well-formed version reaches the atomic RPC so active-account retries can preserve original confirmation", async () => {
  const body = { ...input, registration_policy_version: "0.1.0" };
  const client = { rpc: async (_name, args) => { assert.equal(args.p_registration_policy_version, "0.1.0"); return { data: me, error: null }; } };
  assert.equal((await bootstrapAccountResponse(request(body), client, id, opts)).status, 200);
});

test("a new account's stale policy maps to a bounded 409 without raw provider/DB details", async () => {
  const client = { rpc: async () => ({ data: null, error: { code: "PT409", message: "policy_version_changed", details: "private-detail" } }) };
  const response = await bootstrapAccountResponse(request(), client, id, opts);
  assert.equal(response.status, 409);
  const body = await response.json(); assert.equal(body.error.code, "POLICY_VERSION_CHANGED");
  assert.ok(!JSON.stringify(body).includes("private-detail"));
});

test("expired sessions, unavailable accounts and unexpected faults return bounded no-store failures", async () => {
  for (const [code, status] of [["PT401", 401], ["PT403", 403], ["PT400", 400], ["PT503", 503]]) {
    const client = { rpc: async () => ({ data: null, error: { code, message: "private-detail" } }) };
    const response = await bootstrapAccountResponse(request(), client, id, opts);
    assert.equal(response.status, status); assert.match(response.headers.get("cache-control"), /no-store/);
    assert.ok(!(await response.text()).includes("private-detail"));
  }
});

test("bootstrap rejects another UUID and extra response fields instead of returning sensitive data", async () => {
  for (const data of [{ ...me, user_id: other }, { ...me, email: "private@example.invalid" }]) {
    const response = await bootstrapAccountResponse(request(), { rpc: async () => ({ data, error: null }) }, id, opts);
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("private@example.invalid"));
  }
});

test("auth context discloses only the verified user's state and a fixed same-app destination", async () => {
  for (const [state, next] of [["active", "/"], ["signup_required", "/signup"], ["deleting", "/account/deletion"]]) {
    const data = { user_id: id, account_state: state, next };
    const client = { rpc: async name => { assert.equal(name, "get_auth_context"); return { data, error: null }; } };
    const response = await authContextResponse(client, id);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), data);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});

test("auth context refuses extra fields, a different UUID and an arbitrary return URL", async () => {
  const context = { user_id: id, account_state: "active", next: "/" };
  for (const data of [{ ...context, user_id: other }, { ...context, next: "https://evil.example.invalid" },
    { ...context, email: "private@example.invalid" }, { ...context, account_state: "unknown" }]) {
    assert.equal((await authContextResponse({ rpc: async () => ({ data, error: null }) }, id)).status, 503);
  }
});

test("registration transport failures never escape as raw errors or successful state", async () => {
  const client = { rpc: async () => { throw new Error("private transport detail"); } };
  for (const response of [await bootstrapAccountResponse(request(), client, id, opts), await authContextResponse(client, id)]) {
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("private transport detail"));
  }
});
