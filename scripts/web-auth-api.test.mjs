import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createCsrfToken, csrfSessionBinding } from "../src/server/api-security.mjs";
import { FLOW_COOKIE_NAME, INVITE_COOKIE_NAME, FLOW_TTL, openLoginFlow, openPendingInvite, sealLoginFlow, sealPendingInvite, temporaryCookieHeader } from "../src/server/auth-flow-cookie.mjs";
import { SESSION_COOKIE_NAME, openSession, sealSession, sessionCookieValue, sessionTokenClaims } from "../src/server/deployed-session.mjs";
import { googleStartResponse, googleCallbackResponse, refreshResponse, pendingInviteResponse } from "../src/server/web-auth-api.mjs";

const now = Date.now();
const id = "11111111-1111-4111-8111-111111111111";
const sid = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const env = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production", APP_BASE_URL: "https://web-auth.example.invalid", SUPABASE_URL: "https://database.example.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only", CSRF_SIGNING_SECRET: "web-test-signing-material-at-least-32-bytes", AUTH_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 55).toString("base64url") };
const jwt = (extra = {}) => `header.${Buffer.from(JSON.stringify({ sub: id, session_id: sid, role: "authenticated", exp: Math.floor(now / 1000) + 900, ...extra })).toString("base64url")}.signature`;
const tokens = extra => ({ access_token: jwt(extra), refresh_token: "test-only-refresh-token-1234" });
const authCookie = extra => `${SESSION_COOKIE_NAME}=${sealSession(tokens(extra), env, now)}`;
function request(path, body = {}, cookie = "", changes = {}) {
  const binding = csrfSessionBinding(new Request(env.APP_BASE_URL, { headers: { cookie } }));
  const csrf = createCsrfToken(env.CSRF_SIGNING_SECRET, Date.now(), binding);
  return new Request(`${env.APP_BASE_URL}/api/v1/auth/${path}`, { method: "POST", headers: { origin: env.APP_BASE_URL, "content-type": "application/json", cookie: `${cookie}; chagokchan_csrf=${csrf}`, "x-csrf-token": csrf, ...changes }, body: JSON.stringify(body) });
}
function fixture({ state = "active", user = id, rpcError, extraContext = {}, authError, exchangeStatus = 200, exchanged = tokens() } = {}) {
  const calls = [];
  return { calls, options: { env, now,
    fetcher: async (url, init) => { calls.push({ exchange: url, init }); return Response.json(exchangeStatus === 200 ? { ...exchanged, provider_token: "discarded-provider-secret" } : { error: "private-provider-error" }, { status: exchangeStatus }); },
    clientFactory: (_url, key, options) => {
      assert.equal(key, env.SUPABASE_PUBLISHABLE_KEY); assert.equal(options.auth.persistSession, false);
      return { auth: { getUser: async token => { calls.push({ verify: token }); return { data: { user: { id: user, is_anonymous: false } }, error: authError }; } },
        rpc: async name => { calls.push({ rpc: name }); return { error: rpcError, data: { user_id: id, account_state: state, next: { active: "/", signup_required: "/signup", deleting: "/account/deletion" }[state], ...extraContext } }; } };
    } } };
}
async function start(body = {}, cookie = "") {
  const response = await googleStartResponse(request("google/start", body, cookie), { env, now });
  assert.equal(response.status, 200);
  const flowCookie = response.headers.getSetCookie()[0].split(";")[0];
  return { response, cookie: flowCookie, flow: openLoginFlow(flowCookie, env, now), data: await response.json() };
}
const callback = (cookie, query = "code=code-once") => new Request(`${env.APP_BASE_URL}/api/v1/auth/callback?${query}`, { headers: { cookie } });

test("Google start emits only a fixed callback, S256 challenge and protected verifier cookie", async () => {
  const { response, cookie, flow, data } = await start({ next: "/connect", invite_token: "a".repeat(32) });
  const url = new URL(data.authorization_url);
  assert.equal(url.origin, env.SUPABASE_URL); assert.equal(url.pathname, "/auth/v1/authorize");
  assert.equal(url.searchParams.get("redirect_to"), `${env.APP_BASE_URL}/api/v1/auth/callback`);
  assert.equal(url.searchParams.get("code_challenge_method"), "s256");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(flow.verifier).digest("base64url"));
  assert.ok(!JSON.stringify(data).includes(flow.verifier)); assert.ok(!cookie.includes(flow.verifier));
  for (const flag of ["Path=/", "Secure", "HttpOnly", "SameSite=Lax"]) assert.ok(response.headers.getSetCookie()[0].includes(flag));
  assert.match(response.headers.get("cache-control"), /private, no-store/);
});

test("start rejects external/ambiguous destinations, caller tokens and malformed invite secrets", async () => {
  for (const body of [{ next: "//evil.invalid" }, { next: "/\\evil.invalid" }, { next: "/?x=1" }, { next: "/signup" }, { next: "/connect#invite=secret" }, { access_token: jwt() }, { invite_token: "x" }]) {
    const response = await googleStartResponse(request("google/start", body), { env, now });
    assert.equal(response.status, 400); assert.equal(response.headers.getSetCookie().length, 0);
  }
});

test("foreign origin, missing CSRF and an existing encrypted session cannot start a new login", async () => {
  for (const changes of [{ origin: "https://evil.invalid" }, { "x-csrf-token": "missing" }]) assert.equal((await googleStartResponse(request("google/start", {}, "", changes), { env, now })).status, 403);
  assert.equal((await googleStartResponse(request("google/start", {}, authCookie()), { env, now })).status, 409);
});

test("duplicate CSRF cookies fail closed before login cookies are issued", async () => {
  const original = request("google/start");
  original.headers.set("cookie", `${original.headers.get("cookie")}; chagokchan_csrf=ambiguous`);
  const response = await googleStartResponse(original, { env, now });
  assert.equal(response.status, 403); assert.equal(response.headers.getSetCookie().length, 0);
});

test("flow cookies reject duplicates, tampering, expiry, another origin and another purpose", async () => {
  const { cookie } = await start();
  const encoded = cookie.split("=")[1]; const bytes = Buffer.from(encoded, "base64url"); bytes[32] ^= 1;
  assert.equal(openLoginFlow(`${FLOW_COOKIE_NAME}=${bytes.toString("base64url")}`, env, now), null);
  assert.equal(openLoginFlow(`${cookie}; ${cookie}`, env, now), null);
  assert.equal(openLoginFlow(cookie, env, now + FLOW_TTL * 1000), null);
  assert.equal(openLoginFlow(cookie, { ...env, APP_BASE_URL: "https://other.example.invalid" }, now), null);
  assert.equal(openPendingInvite(`${INVITE_COOKIE_NAME}=${encoded}`, sessionTokenClaims(jwt()), env, now), null);
});

for (const [state, next] of [["active", "/connect"], ["signup_required", "/signup"], ["deleting", "/account/deletion"]]) {
  test(`callback verifies Auth and current DB state before issuing the ${state} session`, async () => {
    const { cookie, flow } = await start({ next: "/connect", invite_token: "a".repeat(32) });
    const { calls, options } = fixture({ state });
    const response = await googleCallbackResponse(callback(cookie), options);
    assert.equal(response.status, 303); assert.equal(response.headers.get("location"), env.APP_BASE_URL + next);
    assert.deepEqual(JSON.parse(calls[0].init.body), { auth_code: "code-once", code_verifier: flow.verifier });
    assert.equal(calls[0].init.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(calls[0].init.redirect, "error"); assert.equal(calls[0].init.cache, "no-store");
    assert.equal(calls[1].verify, tokens().access_token); assert.equal(calls[2].rpc, "get_auth_context");
    const cookies = response.headers.getSetCookie();
    const session = cookies.find(value => value.startsWith(`${SESSION_COOKIE_NAME}=`));
    assert.ok(openSession(sessionCookieValue(session.split(";")[0]), env, now));
    const pending = cookies.find(value => value.startsWith(`${INVITE_COOKIE_NAME}=`));
    assert.equal(openPendingInvite(pending.split(";")[0], sessionTokenClaims(jwt()), env, now), "a".repeat(32));
    assert.ok(!JSON.stringify([...response.headers]).includes("discarded-provider-secret"));
  });
}

test("late callback cannot replace a newly changed account session", async () => {
  const { cookie } = await start(); const { calls, options } = fixture();
  const response = await googleCallbackResponse(callback(`${cookie}; ${authCookie()}`), options);
  assert.equal(response.headers.get("location"), `${env.APP_BASE_URL}/?auth_error=retry`);
  assert.equal(calls.length, 0); assert.equal(response.headers.getSetCookie().some(value => value.startsWith(`${SESSION_COOKIE_NAME}=`)), false);
});

test("missing/duplicate code, cancel and expired flow never exchange a token", async () => {
  const { cookie } = await start();
  for (const query of ["", "error=access_denied&error_description=private", "code=a&code=b", "code=a&error=denied"]) {
    const { calls, options } = fixture(); const response = await googleCallbackResponse(callback(cookie, query), options);
    assert.equal(calls.length, 0); assert.equal(response.status, 303); assert.ok(!response.headers.get("location").includes("private"));
  }
  const { calls, options } = fixture(); await googleCallbackResponse(callback(cookie), { ...options, now: now + FLOW_TTL * 1000 }); assert.equal(calls.length, 0);
});

test("exchange/Auth/DB failures never issue a session or expose provider errors", async () => {
  const { cookie } = await start();
  for (const config of [{ exchangeStatus: 400 }, { exchangeStatus: 503 }, { user: other }, { authError: { status: 503 } }, { rpcError: { code: "PT401" } }, { extraContext: { email: "private" } }]) {
    const { options } = fixture(config); const response = await googleCallbackResponse(callback(cookie), options);
    assert.equal(response.status, 303); assert.equal(response.headers.getSetCookie().some(value => value.startsWith(`${SESSION_COOKIE_NAME}=`)), false);
    assert.ok(!JSON.stringify([...response.headers]).includes("private-provider-error"));
  }
});

test("a consumed provider code cannot create a second session even with a copied flow cookie", async () => {
  const { cookie } = await start(); const { options } = fixture(); let used = false;
  const fetcher = async (...args) => { if (used) return Response.json({ error: "used" }, { status: 400 }); used = true; return options.fetcher(...args); };
  const first = await googleCallbackResponse(callback(cookie), { ...options, fetcher });
  const second = await googleCallbackResponse(callback(cookie), { ...options, fetcher });
  assert.ok(first.headers.getSetCookie().some(value => value.startsWith(`${SESSION_COOKIE_NAME}=`)));
  assert.equal(second.headers.getSetCookie().some(value => value.startsWith(`${SESSION_COOKIE_NAME}=`)), false);
});

test("refresh verifies the same user/session and preserves original absolute expiry", async () => {
  const header = authCookie({ exp: Math.floor(now / 1000) - 1 });
  const old = openSession(sessionCookieValue(header), env, now);
  const { calls, options } = fixture();
  const response = await refreshResponse(request("refresh", {}, header), { ...options, now: now + 1000 });
  assert.equal(response.status, 200); assert.deepEqual(JSON.parse(calls[0].init.body), { refresh_token: old.refresh_token });
  const newCookie = response.headers.getSetCookie()[0]; const rotated = openSession(sessionCookieValue(newCookie.split(";")[0]), env, now + 1000);
  assert.equal(rotated.issued_at, old.issued_at); assert.equal(rotated.expires_at, old.expires_at);
  assert.ok(newCookie.includes("Max-Age=2591999"));
  assert.deepEqual(Object.keys(await response.json()).sort(), ["account_state", "next", "user_id"]);
});

test("refresh rejects a different UUID, different session, expired result and revoked DB session", async () => {
  for (const config of [{ exchanged: tokens({ sub: other }) }, { exchanged: tokens({ session_id: other }) }, { exchanged: tokens({ exp: Math.floor(now / 1000) - 1 }) }, { rpcError: { code: "PT401" } }]) {
    const { options } = fixture(config); const response = await refreshResponse(request("refresh", {}, authCookie()), options);
    assert.equal(response.status, 401); assert.equal(response.headers.getSetCookie().length, 0);
  }
});

test("refresh validates CSRF and encrypted session before contacting Auth", async () => {
  const { calls, options } = fixture();
  assert.equal((await refreshResponse(request("refresh", {}, "", { "x-csrf-token": "wrong" }), options)).status, 403);
  assert.equal((await refreshResponse(request("refresh"), options)).status, 401);
  assert.equal((await refreshResponse(request("refresh", { user_id: id }, authCookie()), options)).status, 400);
  assert.equal(calls.length, 0);
});

test("network failure during refresh retains the existing cookie and returns bounded 503", async () => {
  const { options } = fixture(); const response = await refreshResponse(request("refresh", {}, authCookie()), { ...options, fetcher: async () => { throw new Error("private-network-secret"); } });
  assert.equal(response.status, 503); assert.equal(response.headers.getSetCookie().length, 0); assert.ok(!(await response.text()).includes("private-network-secret"));
});

test("pending invite is restricted to the verified active user/session and cleared after read", async () => {
  const pending = sealPendingInvite("a".repeat(32), sessionTokenClaims(jwt()), env, now);
  const { options } = fixture();
  const response = await pendingInviteResponse(request("pending-invite", {}, `${authCookie()}; ${INVITE_COOKIE_NAME}=${pending}`), options);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { invite_token: "a".repeat(32) });
  assert.match(response.headers.getSetCookie()[0], /Max-Age=0/);
  assert.equal(openPendingInvite(`${INVITE_COOKIE_NAME}=${pending}`, { userId: other, sessionId: sid }, env, now), null);
  assert.equal(openPendingInvite(`${INVITE_COOKIE_NAME}=${pending}`, { userId: id, sessionId: other }, env, now), null);
  const signup = fixture({ state: "signup_required" });
  assert.equal((await pendingInviteResponse(request("pending-invite", {}, authCookie()), signup.options)).status, 401);
});

test("temporary cookies are purpose restricted and flow payloads are bounded", () => {
  assert.throws(() => temporaryCookieHeader("untrusted", ""));
  assert.throws(() => temporaryCookieHeader(FLOW_COOKIE_NAME, "bad; Domain=evil.invalid"));
  assert.throws(() => sealLoginFlow({ verifier: "x", binding: "a".repeat(43), next: "/", invite_token: null }, env, now));
});
