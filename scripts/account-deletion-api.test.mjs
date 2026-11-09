import assert from "node:assert/strict";
import test from "node:test";
import { createCsrfToken, csrfSessionBinding } from "../src/server/api-security.mjs";
import { REAUTH_COOKIE_NAME, DELETION_RECEIPT_COOKIE_NAME, openReauthFlow, openDeletionReceipt, sealReauthFlow, sealDeletionReceipt } from "../src/server/auth-flow-cookie.mjs";
import { SESSION_COOKIE_NAME, sealSession, sessionCookieValue, openSession, sessionTokenClaims } from "../src/server/deployed-session.mjs";
import { reauthStartResponse, reauthCallbackResponse, reauthStateResponse, accountDeletionResponse } from "../src/server/account-deletion-api.mjs";

const now = Date.now(), seconds = Math.floor(now / 1000);
const uid = "11111111-1111-4111-8111-111111111111", sid = "22222222-2222-4222-8222-222222222222", fresh = "33333333-3333-4333-8333-333333333333", other = "44444444-4444-4444-8444-444444444444", flowId = "55555555-5555-4555-8555-555555555555", requestId = "66666666-6666-4666-8666-666666666666";
const env = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production", APP_BASE_URL: "https://deletion.example.invalid", SUPABASE_URL: "https://database.example.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only", CSRF_SIGNING_SECRET: "test-only-csrf-material-at-least-32-bytes", AUTH_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 77).toString("base64url") };
const tokens = (user = uid, session = sid) => ({ access_token: `header.${Buffer.from(JSON.stringify({ sub: user, session_id: session, role: "authenticated", exp: seconds + 900 })).toString("base64url")}.signature`, refresh_token: "test-only-refresh-1234" });
const authCookie = (user = uid, session = sid) => `${SESSION_COOKIE_NAME}=${sealSession(tokens(user, session), env, now)}`;
const pending = () => `${REAUTH_COOKIE_NAME}=${sealReauthFlow({ flow_id: flowId, user_id: uid, session_id: sid, phase: "pending", verifier: "a".repeat(43) }, env, now)}`;
const verified = (session = fresh, time = now) => `${REAUTH_COOKIE_NAME}=${sealReauthFlow({ flow_id: flowId, user_id: uid, session_id: session, phase: "verified", grant_id: flowId, expires_at: Math.floor(time / 1000) + 600 }, env, time)}`;
function request(path, cookie = "", body, changes = {}) {
  if (body === undefined) return new Request(env.APP_BASE_URL + path, { headers: { cookie, ...changes } });
  const csrf = createCsrfToken(env.CSRF_SIGNING_SECRET, Date.now(), csrfSessionBinding(new Request(env.APP_BASE_URL, { headers: { cookie } })));
  return new Request(env.APP_BASE_URL + path, { method: "POST", headers: { origin: env.APP_BASE_URL, "content-type": "application/json", cookie: `${cookie}; chagokchan_csrf=${csrf}`, "x-csrf-token": csrf, ...changes }, body: JSON.stringify(body) });
}
function fixture({ user = uid, newSid = fresh, state = "active", grantError, deletionError, signoutError, unavailableAuth = false, revokeDuringExchange = false, extraDeletion = {} } = {}) {
  const calls = [], revoked = new Set();
  return { calls, revoked, options: { env, now,
    fetcher: async (url, init) => {
      calls.push({ exchange: url, body: JSON.parse(init.body) });
      if (url.endsWith("grant_type=refresh_token")) return Response.json(tokens());
      if (revokeDuringExchange) revoked.add(sid);
      return Response.json({ ...tokens(user, newSid), provider_token: "private-provider-token" });
    },
    clientFactory: (_url, key, config) => {
      assert.equal(key, env.SUPABASE_PUBLISHABLE_KEY); assert.equal(config.auth.persistSession, false);
      const token = config.global.headers.Authorization.slice(7), claims = sessionTokenClaims(token);
      return { auth: { getUser: async () => ({ data: { user: { id: claims.userId, is_anonymous: false } }, error: unavailableAuth ? { status: 503 } : null }), admin: { signOut: async (_token, scope) => { calls.push({ logout: claims.sessionId, scope }); if (signoutError) return { error: { status: 503 } }; revoked.add(claims.sessionId); return { error: null }; } } },
        rpc: async (name, args) => {
          calls.push({ rpc: name, args, sid: claims.sessionId });
          if (name === "get_auth_context") return { error: revoked.has(claims.sessionId) ? { code: "PT401" } : null, data: { user_id: claims.userId, account_state: state, next: { active: "/", signup_required: "/signup", deleting: "/account/deletion" }[state] } };
          if (name === "issue_reauth_grant") return { error: grantError, data: { grant_id: flowId, expires_at: new Date((seconds + 600) * 1000).toISOString() } };
          if (name === "request_account_deletion") return { error: deletionError, data: { id: requestId, status: "pending", access_revoked: true, ...extraDeletion } };
          throw new Error("Unexpected RPC");
        } };
    } } };
}
const callback = cookie => request("/api/v1/auth/reauth/callback?code=one-use-code", cookie);
const deletion = (cookie = `${authCookie(uid, fresh)}; ${verified()}`, body = { confirm: true, reauth_grant_id: flowId }, extra = {}) => request("/api/v1/account/deletion-requests", cookie, body, { "idempotency-key": requestId, ...extra });

test("reauth start rotates current session and binds a protected PKCE flow to it", async () => {
  const { options, calls } = fixture();
  const response = await reauthStartResponse(request("/api/v1/auth/reauth/start", authCookie(), { provider: "google", scope: "account.delete" }), options);
  assert.equal(response.status, 200); const data = await response.json(), url = new URL(data.authorization_url);
  assert.equal(url.searchParams.get("redirect_to"), env.APP_BASE_URL + "/api/v1/auth/reauth/callback"); assert.equal(url.searchParams.get("prompt"), "select_account");
  const flow = openReauthFlow(response.headers.getSetCookie().find(x => x.startsWith(REAUTH_COOKIE_NAME)).split(";")[0], env, now);
  assert.equal(flow.user_id, uid); assert.equal(flow.session_id, sid); assert.equal(flow.phase, "pending"); assert.equal(flow.flow_id, data.flow_id);
  assert.ok(!JSON.stringify(data).includes(flow.verifier)); assert.equal(calls.filter(x => x.exchange).length, 1);
});
test("reauth start rejects OTP, scope escalation, missing session and CSRF", async () => {
  const { options } = fixture();
  for (const body of [{ provider: "email_otp", scope: "account.delete" }, { provider: "google", scope: "admin" }, { provider: "google", scope: "account.delete", user_id: uid }]) assert.equal((await reauthStartResponse(request("/start", authCookie(), body), options)).status, 400);
  assert.equal((await reauthStartResponse(request("/start", "", { provider: "google", scope: "account.delete" }), options)).status, 401);
  assert.equal((await reauthStartResponse(request("/start", authCookie(), { provider: "google", scope: "account.delete" }, { origin: "https://wrong.invalid" }), options)).status, 403);
});
test("same account callback issues proof only for fresh session and revokes previous session", async () => {
  const { options, calls, revoked } = fixture(); const response = await reauthCallbackResponse(callback(`${authCookie()}; ${pending()}`), options);
  assert.equal(response.status, 303); assert.equal(response.headers.get("location"), `${env.APP_BASE_URL}/account/deletion?flow=${flowId}`);
  const cookie = response.headers.getSetCookie().find(x => x.startsWith(SESSION_COOKIE_NAME)).split(";")[0];
  assert.equal(sessionTokenClaims(openSession(sessionCookieValue(cookie), env, now).access_token).sessionId, fresh);
  const proof = calls.find(x => x.rpc === "issue_reauth_grant"); assert.equal(proof.sid, fresh);
  const payload = JSON.parse(Buffer.from(proof.args.p_payload, "base64url").toString()); assert.equal(payload.scope, "account.delete"); assert.equal(payload.sub, uid); assert.equal(payload.sid, fresh);
  assert.ok(revoked.has(sid)); assert.ok(!revoked.has(fresh)); assert.ok(!JSON.stringify([...response.headers]).includes("private-provider-token"));
});
test("other Google account is rejected without replacing or revoking original app session", async () => {
  const { options, calls, revoked } = fixture({ user: other }); const response = await reauthCallbackResponse(callback(`${authCookie()}; ${pending()}`), options);
  assert.match(response.headers.get("location"), /reauth_error=account_mismatch$/);
  assert.equal(response.headers.getSetCookie().some(x => x.startsWith(SESSION_COOKIE_NAME)), false);
  assert.equal(calls.some(x => x.rpc === "issue_reauth_grant"), false); assert.ok(!revoked.has(sid)); assert.ok(revoked.has(fresh));
});
test("reusing the original session is rejected and never signs it out", async () => {
  const { options, calls } = fixture({ newSid: sid }); const response = await reauthCallbackResponse(callback(`${authCookie()}; ${pending()}`), options);
  assert.match(response.headers.get("location"), /reauth_error=retry$/); assert.equal(calls.some(x => x.logout || x.rpc === "issue_reauth_grant"), false);
});
test("missing, expired, duplicate flow or changed original session prevents exchange", async () => {
  for (const cookie of [authCookie(), `${authCookie(uid, fresh)}; ${pending()}`, `${authCookie()}; ${pending()}; ${pending()}`]) {
    const { options, calls } = fixture(); await reauthCallbackResponse(callback(cookie), options); assert.equal(calls.some(x => x.exchange), false);
  }
  const { options, calls } = fixture(); await reauthCallbackResponse(callback(`${authCookie()}; ${pending()}`), { ...options, now: now + 600000 }); assert.equal(calls.some(x => x.exchange), false);
});
test("logout during provider exchange prevents proof issuance and cleans new session", async () => {
  const { options, calls, revoked } = fixture({ revokeDuringExchange: true }); const response = await reauthCallbackResponse(callback(`${authCookie()}; ${pending()}`), options);
  assert.equal(response.headers.getSetCookie().some(x => x.startsWith(SESSION_COOKIE_NAME)), false); assert.equal(calls.some(x => x.rpc === "issue_reauth_grant"), false); assert.ok(revoked.has(fresh));
});
test("unconfigured verifier or failed previous-session revocation fails closed", async () => {
  for (const config of [{ grantError: { code: "PT503" } }, { signoutError: true }]) {
    const { options } = fixture(config); const response = await reauthCallbackResponse(callback(`${authCookie()}; ${pending()}`), options);
    assert.match(response.headers.get("location"), /reauth_error=unavailable$/); assert.equal(response.headers.getSetCookie().some(x => x.startsWith(SESSION_COOKIE_NAME)), false);
  }
});
test("reauth result exposes only flow state to the bound verified session", async () => {
  const { options } = fixture(); const cookie = `${authCookie(uid, fresh)}; ${verified()}`;
  const response = await reauthStateResponse(request("/state", cookie), flowId, options);
  assert.equal(response.status, 200); assert.deepEqual(Object.keys(await response.json()).sort(), ["expires_at", "flow_id", "grant_id", "status"]);
  assert.equal((await reauthStateResponse(request("/state", `${authCookie()}; ${verified()}`), flowId, options)).status, 403);
  assert.equal((await reauthStateResponse(request("/state", cookie), other, options)).status, 403);
});
test("deletion requires explicit confirmation, UUID idempotency key and bound grant", async () => {
  const { options, calls } = fixture();
  for (const req of [deletion(undefined, { confirm: false, reauth_grant_id: flowId }), deletion(undefined, undefined, { "idempotency-key": "bad" }), deletion(undefined, { confirm: true, reauth_grant_id: flowId, user_id: uid })]) assert.equal((await accountDeletionResponse(req, options)).status, 400);
  for (const cookie of [authCookie(uid, fresh), `${authCookie()}; ${verified()}`, `${authCookie(other, fresh)}; ${verified()}`]) assert.equal((await accountDeletionResponse(deletion(cookie), options)).status, 403);
  assert.equal(calls.some(x => x.rpc === "request_account_deletion"), false);
});
test("accepted deletion revokes global Auth, clears all auth flows and seals minimal receipt", async () => {
  const { options, calls } = fixture(); const response = await accountDeletionResponse(deletion(), options);
  assert.equal(response.status, 202); assert.deepEqual(await response.json(), { id: requestId, status: "pending", access_revoked: true });
  assert.equal(calls.find(x => x.logout).scope, "global"); assert.equal(response.headers.getSetCookie().filter(x => x.includes("Max-Age=0")).length, 6);
  const receipt = response.headers.getSetCookie().find(x => x.startsWith(DELETION_RECEIPT_COOKIE_NAME) && !x.includes("Max-Age=0")).split(";")[0];
  assert.equal(openDeletionReceipt(receipt, env, now), requestId); assert.ok(!receipt.includes(requestId)); assert.match(response.headers.get("cache-control"), /no-store/);
});
test("committed deletion remains accepted during Auth outage, and replay status is allowed", async () => {
  const { options } = fixture({ signoutError: true, state: "deleting", extraDeletion: { status: "running" } });
  assert.equal((await accountDeletionResponse(deletion(), options)).status, 202);
});
test("RPC failure or expanded response cannot claim acceptance or clear current cookie", async () => {
  for (const config of [{ deletionError: { code: "PT403" } }, { deletionError: { code: "PT409" } }, { extraDeletion: { email: "private" } }, { unavailableAuth: true }]) {
    const { options, calls } = fixture(config); const response = await accountDeletionResponse(deletion(), options);
    assert.notEqual(response.status, 202); assert.equal(response.headers.getSetCookie().length, 0); assert.equal(calls.some(x => x.logout), false); assert.ok(!(await response.text()).includes("private"));
  }
});
test("receipt and reauth cookies reject tampering, duplicate, expiry, wrong origin and purpose", () => {
  const receipt = `${DELETION_RECEIPT_COOKIE_NAME}=${sealDeletionReceipt(requestId, env, now)}`;
  assert.equal(openDeletionReceipt(`${receipt}; ${receipt}`, env, now), null); assert.equal(openDeletionReceipt(receipt, env, now + 600000), null);
  assert.equal(openDeletionReceipt(receipt, { ...env, APP_BASE_URL: "https://other.invalid" }, now), null);
  assert.equal(openDeletionReceipt(receipt.replace(DELETION_RECEIPT_COOKIE_NAME, REAUTH_COOKIE_NAME), env, now), null);
  const value = receipt.split("=")[1], bytes = Buffer.from(value, "base64url"); bytes[30] ^= 1; assert.equal(openDeletionReceipt(`${DELETION_RECEIPT_COOKIE_NAME}=${bytes.toString("base64url")}`, env, now), null);
  assert.equal(openReauthFlow(`${verified()}; ${verified()}`, env, now), null);
});
