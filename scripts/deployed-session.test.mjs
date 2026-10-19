import assert from "node:assert/strict";
import test from "node:test";
import { expiredSessionCookieHeader, openSession, resolveDeployedSession, sealSession, SESSION_COOKIE_NAME,
  SessionAccountError, SessionDependencyError, sessionCookieHeader, sessionCookieValue, resolveVerifiedAuthSession } from "../src/server/deployed-session.mjs";
import { createCsrfToken, csrfSessionBinding, validateMutationRequest, verifyCsrfToken } from "../src/server/api-security.mjs";

const now = Date.parse("2026-10-19T12:00:00Z");
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const env = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production",
  APP_BASE_URL: "https://staging.example.invalid", SUPABASE_URL: "https://database.example.invalid",
  CSRF_SIGNING_SECRET: "test-only-csrf-material-at-least-32-bytes", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit_test_only",
  AUTH_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString("base64url") };
const token = (sub = id, extra = {}) => `header.${Buffer.from(JSON.stringify({ sub, session_id: other, role: "authenticated", exp: now / 1000 + 900, ...extra })).toString("base64url")}.signature`;
const tokens = (sub = id, extra) => ({ access_token: token(sub, extra), refresh_token: "test-only-refresh-token-123456" });
const me = (user = id) => ({ user_id: user, profile: { user_id: user, nickname: null, avatar_key: null },
  timezone: "Asia/Seoul", account_status: "active", adult_confirmed_at: "2026-10-19T00:00:00Z", registration_policy_version: "0.2.0" });
const cookie = (sub = id, extra) => `${SESSION_COOKIE_NAME}=${sealSession(tokens(sub, extra), env, now)}`;
const options = (factory) => ({ env, now, clientFactory: factory });

function factory({ user = { id, is_anonymous: false }, authError = null, rpcError = null, account = me() } = {}, calls = []) {
  return (url, key, opts) => {
    calls.push({ url, key, opts });
    return { auth: { getUser: async (access) => { calls.push({ access }); return { data: { user }, error: authError }; } },
      rpc: async (name) => { calls.push({ rpc: name }); return { data: account, error: rpcError }; } };
  };
}

test("session cookie encrypts both tokens and binds ciphertext to the deployment origin", () => {
  const sealed = sealSession(tokens(), env, now);
  assert.ok(!sealed.includes(tokens().access_token));
  assert.ok(!Buffer.from(sealed, "base64url").includes(Buffer.from(tokens().refresh_token)));
  assert.equal(openSession(sealed, env, now).access_token, tokens().access_token);
  assert.equal(openSession(sealed, { ...env, APP_BASE_URL: "https://other.example.invalid" }, now), null);
  assert.equal(openSession(sealed, { ...env, AUTH_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 18).toString("base64url") }, now), null);
});

test("tampered, malformed, oversized, expired and future-issued cookies fail closed", () => {
  const sealed = sealSession(tokens(), env, now);
  const bytes = Buffer.from(sealed, "base64url"); bytes[30] ^= 1;
  for (const value of [null, "", "x".repeat(4000), `${sealed}=`, bytes.toString("base64url")]) assert.equal(openSession(value, env, now), null);
  assert.equal(openSession(sealed, env, now + 2592000000), null);
  assert.equal(openSession(sealed, env, now - 61000), null);
});

test("cookie security flags are host-only, HttpOnly and HTTPS, including deletion", () => {
  const header = sessionCookieHeader(sealSession(tokens(), env, now));
  for (const flag of ["__Host-", "Path=/", "Secure", "HttpOnly", "SameSite=Lax"]) assert.ok(header.includes(flag));
  assert.ok(!header.includes("Domain="));
  assert.ok(expiredSessionCookieHeader().includes("Max-Age=0; Secure; HttpOnly"));
  assert.throws(() => sessionCookieHeader("injected; Domain=evil.invalid"));
});

test("ambiguous duplicate auth cookies and legacy/non-host cookies are not accepted", () => {
  assert.equal(sessionCookieValue(`${cookie()}; ${cookie()}`), null);
  assert.equal(sessionCookieValue("grape_auth=untrusted"), null);
  const header = cookie();
  assert.equal(sessionCookieValue(`unrelated=value; ${header}`), header.split("=")[1]);
});

test("deployed setup refuses fixture bypasses, local origins and missing encryption material", async () => {
  for (const change of [{ APP_AUTH_MODE: "local_fixture" }, { LOCAL_DEV_ACTOR: "A" }, { APP_BASE_URL: "http://127.0.0.1:3000" },
    { AUTH_SESSION_ENCRYPTION_KEY: "short" }, { SUPABASE_PUBLISHABLE_KEY: "" }]) {
    await assert.rejects(resolveDeployedSession(null, { env: { ...env, ...change }, now }));
  }
});

test("ordinary deployed clients reject secret/service_role keys and accept the legacy anon key shape", async () => {
  const legacy = role => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  for (const key of ["sb_secret_fake_admin_key", legacy("service_role"), "unrecognized"]) {
    await assert.rejects(resolveDeployedSession(null, { env: { ...env, SUPABASE_PUBLISHABLE_KEY: key }, now }), SessionDependencyError);
  }
  assert.equal(await resolveDeployedSession(null, { env: { ...env, SUPABASE_PUBLISHABLE_KEY: legacy("anon") }, now }), null);
});

test("no cookie, expired token, non-authenticated role or invalid session claims never call Auth", async () => {
  const calls = [];
  const deps = options(factory({}, calls));
  for (const value of [null, cookie(id, { exp: now / 1000 }), cookie(id, { role: "service_role" }), cookie(id, { session_id: null })]) {
    assert.equal(await resolveDeployedSession(value, deps), null);
  }
  assert.equal(calls.length, 0);
});

test("each request gets an isolated client and verifies Auth before the live-session/account RPC", async () => {
  const calls = [];
  const deps = options(factory({}, calls));
  const [a, b] = await Promise.all([resolveDeployedSession(cookie(), deps), resolveDeployedSession(cookie(), deps)]);
  assert.notEqual(a.client, b.client);
  assert.deepEqual(a.me, me());
  const clients = calls.filter(v => v.opts);
  assert.equal(clients.length, 2);
  for (const { opts } of clients) {
    assert.deepEqual(opts.auth, { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false });
    assert.equal(opts.global.headers.Authorization, `Bearer ${tokens().access_token}`);
  }
  assert.equal(calls.filter(v => v.rpc === "get_me").length, 2);
});

test("invalid Auth tokens, anonymous users and a different verified UUID cannot reach DB", async () => {
  for (const config of [{ authError: { status: 401 } }, { user: { id: other, is_anonymous: false } }, { user: { id, is_anonymous: true } }, { user: null }]) {
    const calls = [];
    assert.equal(await resolveDeployedSession(cookie(), options(factory(config, calls))), null);
    assert.ok(!calls.some(v => v.rpc));
  }
});

test("Auth dependency failure stays unavailable and never becomes a signed-in session", async () => {
  await assert.rejects(resolveDeployedSession(cookie(), options(factory({ authError: { status: 503 } }))), SessionDependencyError);
  await assert.rejects(resolveDeployedSession(cookie(), options(() => ({ auth: { getUser: async () => { throw new Error("private"); } } }))), SessionDependencyError);
});

test("revoked or expired DB sessions deny even an Auth-verified JWT", async () => {
  for (const code of ["PT401", "PGRST301", "PGRST303"]) assert.equal(await resolveDeployedSession(cookie(), options(factory({ rpcError: { code } }))), null);
});

test("registration-required and unavailable accounts stay outside the product APIs", async () => {
  for (const [message, state] of [["signup_required", "signup_required"], ["account_unavailable", "unavailable"]]) {
    await assert.rejects(resolveDeployedSession(cookie(), options(factory({ rpcError: { code: "PT403", message } }))), error => error instanceof SessionAccountError && error.accountState === state);
  }
});

test("registration Auth identity lookup does not grant an unregistered user access to the ordinary product resolver", async () => {
  const calls = [];
  const deps = options(factory({ rpcError: { code: "PT403", message: "signup_required" } }, calls));
  assert.equal((await resolveVerifiedAuthSession(cookie(), deps)).userId, id);
  assert.ok(!calls.some(v => v.rpc));
  await assert.rejects(resolveDeployedSession(cookie(), deps), error => error instanceof SessionAccountError && error.accountState === "signup_required");
});

test("unexpected DB failures and expanded/cross-user projections fail closed", async () => {
  for (const config of [{ rpcError: { code: "PT503" } }, { account: { ...me(), email: "private@example.invalid" } }, { account: me(other) }]) {
    await assert.rejects(resolveDeployedSession(cookie(), options(factory(config))), SessionDependencyError);
  }
});

test("deployed CSRF tokens bind to the current encrypted session and reject legacy or another session's tokens", async () => {
  const secret = env.CSRF_SIGNING_SECRET;
  const sessionA = cookie();
  const sessionB = cookie(other);
  const binding = csrfSessionBinding(new Request(env.APP_BASE_URL, { headers: { cookie: sessionA } }));
  const csrf = createCsrfToken(secret, Date.now(), binding);
  const makeRequest = (session, value = csrf) => new Request(`${env.APP_BASE_URL}/api/v1/goals`, {
    method: "POST", headers: { origin: env.APP_BASE_URL, "content-type": "application/json",
      "sec-fetch-site": "same-origin", "x-csrf-token": value, cookie: `${session}; chagokchan_csrf=${value}` }, body: "{}",
  });
  const options = { expectedOrigin: env.APP_BASE_URL, secret, env };
  assert.deepEqual(await validateMutationRequest(makeRequest(sessionA), options), {});
  await assert.rejects(validateMutationRequest(makeRequest(sessionB), options), error => error.status === 403);
  await assert.rejects(validateMutationRequest(makeRequest(sessionA, createCsrfToken(secret)), options), error => error.status === 403);
  assert.equal(verifyCsrfToken(csrf, secret), false);
});

test("sign-in, sign-out or session-cookie rotation invalidates an old deployed CSRF binding", () => {
  const bindingFor = header => csrfSessionBinding(new Request(env.APP_BASE_URL, { headers: { cookie: header } }));
  const before = bindingFor("");
  const signedIn = bindingFor(cookie());
  const rotated = bindingFor(cookie());
  assert.notEqual(before, signedIn);
  assert.notEqual(signedIn, rotated);
  const csrf = createCsrfToken(env.CSRF_SIGNING_SECRET, now, signedIn);
  assert.equal(verifyCsrfToken(csrf, env.CSRF_SIGNING_SECRET, now, signedIn), true);
  assert.equal(verifyCsrfToken(csrf, env.CSRF_SIGNING_SECRET, now, rotated), false);
});
