import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ApiRequestError, getCsrfSigningSecret, validateMutationRequest } from "./api-security.mjs";
import { DELETION_RECEIPT_COOKIE_NAME, FLOW_COOKIE_NAME, INVITE_COOKIE_NAME, REAUTH_COOKIE_NAME, FLOW_TTL, openReauthFlow, sealDeletionReceipt, sealReauthFlow, temporaryCookieHeader } from "./auth-flow-cookie.mjs";
import { SESSION_COOKIE_NAME, expiredSessionCookieHeader, openSession, resolveVerifiedAuthSession, sealSession, sessionConfiguration, sessionCookieHeader, sessionCookieValue, sessionTokenClaims } from "./deployed-session.mjs";
import { authContextResponse } from "./registration-api.mjs";
import { createReauthProof } from "./reauth-proof.mjs";
import { expiredCsrfCookie, refreshedSession, tokenExchange } from "./web-auth-api.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const required = () => new ApiRequestError(401, "AUTH_REQUIRED", "현재 계정을 다시 확인해 주세요.");
const forbidden = () => new ApiRequestError(403, "ACTION_FORBIDDEN", "같은 계정으로 Google 재인증을 다시 진행해 주세요.");
const unavailable = () => new ApiRequestError(503, "DEPENDENCY_UNAVAILABLE", "처리 결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
const invalid = () => new ApiRequestError(400, "INVALID_INPUT", "요청 내용을 다시 확인해 주세요.");
function headers() { return new Headers({ "Cache-Control": "private, no-store", Pragma: "no-cache", "Referrer-Policy": "no-referrer", "X-Request-ID": randomUUID() }); }
function failure(error) {
  const safe = error instanceof ApiRequestError ? error : unavailable(); const values = headers();
  return Response.json({ error: { code: safe.code, message: safe.message, request_id: values.get("X-Request-ID") } }, { status: safe.status, headers: values });
}
function rpcFailure(error) {
  if (!error) return;
  if (["PT401", "PGRST301", "PGRST303"].includes(error.code)) throw required();
  if (error.code === "PT400") throw invalid();
  if (error.code === "PT403") throw forbidden();
  if (error.code === "PT409") throw new ApiRequestError(409, "STATE_CONFLICT", "이전 요청 결과를 확인한 뒤 다시 시도해 주세요.");
  throw unavailable();
}
async function identity(header, options, active = true) {
  const verified = await resolveVerifiedAuthSession(header, options); if (!verified) throw required();
  const result = await authContextResponse(verified.client, verified.userId);
  if (result.status === 401) throw required(); if (!result.ok) throw unavailable();
  const context = await result.json(); if (active && context.account_state !== "active") throw forbidden();
  const session = openSession(sessionCookieValue(header), options.env, options.now);
  return { ...verified, context, session, claims: sessionTokenClaims(session.access_token) };
}
async function mutation(request, env) {
  const config = sessionConfiguration(env);
  const body = await validateMutationRequest(request, { expectedOrigin: config.baseUrl, secret: getCsrfSigningSecret(env), env });
  return { body, config };
}
const clears = () => [expiredSessionCookieHeader(), expiredCsrfCookie(), ...[FLOW_COOKIE_NAME, INVITE_COOKIE_NAME, REAUTH_COOKIE_NAME, DELETION_RECEIPT_COOKIE_NAME].map(name => temporaryCookieHeader(name, "", 0))];
function redirect(config, suffix, cookies) {
  const values = headers(); values.set("Location", `${config.baseUrl}/account/deletion${suffix}`);
  for (const cookie of cookies) values.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers: values });
}

export async function reauthStartResponse(request, { env = process.env, now = Date.now(), fetcher = fetch, clientFactory } = {}) {
  try {
    const { body, config } = await mutation(request, env);
    if (Object.keys(body).sort().join("|") !== "provider|scope" || body.provider !== "google" || body.scope !== "account.delete") throw invalid();
    const previous = openSession(sessionCookieValue(request.headers.get("cookie")), env, now);
    if (!previous || previous.expires_at - Math.floor(now / 1000) < FLOW_TTL) throw required();
    const refreshed = await refreshedSession(request.headers.get("cookie"), { env, now, fetcher, clientFactory });
    if (refreshed.context.account_state !== "active") throw forbidden();
    const claims = sessionTokenClaims(refreshed.tokens.access_token);
    const flowId = randomUUID(), verifier = randomBytes(32).toString("base64url");
    const flow = sealReauthFlow({ flow_id: flowId, user_id: claims.userId, session_id: claims.sessionId, phase: "pending", verifier }, env, now);
    const url = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
    url.search = new URLSearchParams({ provider: "google", redirect_to: `${config.baseUrl}/api/v1/auth/reauth/callback`, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "s256", prompt: "select_account" }).toString();
    const values = headers();
    for (const cookie of [sessionCookieHeader(refreshed.sealed, refreshed.remaining), expiredCsrfCookie(), temporaryCookieHeader(REAUTH_COOKIE_NAME, flow)]) values.append("Set-Cookie", cookie);
    return Response.json({ provider: "google", flow_id: flowId, authorization_url: url.href, expires_at: new Date(now + FLOW_TTL * 1000).toISOString() }, { headers: values });
  } catch (error) { return failure(error); }
}

export async function reauthCallbackResponse(request, { env = process.env, now = Date.now(), fetcher = fetch, clientFactory } = {}) {
  let config; try { config = sessionConfiguration(env); } catch (error) { return failure(error); }
  const clear = temporaryCookieHeader(REAUTH_COOKIE_NAME, "", 0);
  let auxiliary = null, originalSessionId = null, accepted = false, mismatch = false;
  try {
    const cookie = request.headers.get("cookie"), flow = openReauthFlow(cookie, env, now), url = new URL(request.url);
    if (flow?.phase !== "pending" || url.searchParams.getAll("code").length !== 1 || url.searchParams.has("error") || !/^[A-Za-z0-9_-]{1,2048}$/.test(url.searchParams.get("code") ?? "")) throw forbidden();
    const options = { env, now, clientFactory };
    const original = await identity(cookie, options);
    originalSessionId = original.claims.sessionId;
    if (original.userId !== flow.user_id || original.claims.sessionId !== flow.session_id) throw forbidden();
    const tokens = await tokenExchange("pkce", { auth_code: url.searchParams.get("code"), code_verifier: flow.verifier }, env, fetcher);
    const sealed = sealSession(tokens, env, now);
    auxiliary = await identity(`${SESSION_COOKIE_NAME}=${sealed}`, options, false);
    if (auxiliary.userId !== original.userId) { mismatch = true; throw forbidden(); }
    if (auxiliary.context.account_state !== "active" || auxiliary.claims.sessionId === original.claims.sessionId) throw forbidden();
    // A logout/account transition during the provider round-trip invalidates it.
    await identity(cookie, options);
    const proof = createReauthProof({ userId: auxiliary.userId, sessionId: auxiliary.claims.sessionId, flowId: flow.flow_id }, env, now);
    const result = await auxiliary.client.rpc("issue_reauth_grant", proof); rpcFailure(result.error);
    const data = result.data, expiry = Date.parse(data?.expires_at);
    if (!data || Object.keys(data).sort().join("|") !== "expires_at|grant_id" || data.grant_id !== flow.flow_id || !Number.isFinite(expiry) || expiry <= now || expiry > now + FLOW_TTL * 1000) throw unavailable();
    const ended = await original.client.auth.admin.signOut(original.session.access_token, "local");
    if (ended.error) {
      const context = await authContextResponse(original.client, original.userId);
      if (context.status !== 401) throw unavailable();
    }
    await identity(`${SESSION_COOKIE_NAME}=${sealed}`, options);
    const verifiedFlow = sealReauthFlow({ flow_id: flow.flow_id, user_id: auxiliary.userId, session_id: auxiliary.claims.sessionId, phase: "verified", grant_id: data.grant_id, expires_at: Math.floor(expiry / 1000) }, env, now);
    accepted = true;
    return redirect(config, `?flow=${flow.flow_id}`, [sessionCookieHeader(sealed), expiredCsrfCookie(), temporaryCookieHeader(REAUTH_COOKIE_NAME, verifiedFlow), ...[FLOW_COOKIE_NAME, INVITE_COOKIE_NAME, DELETION_RECEIPT_COOKIE_NAME].map(name => temporaryCookieHeader(name, "", 0))]);
  } catch (error) {
    return redirect(config, `?reauth_error=${mismatch ? "account_mismatch" : error instanceof ApiRequestError && error.status === 503 ? "unavailable" : "retry"}`, [clear]);
  } finally {
    // End only the session created by this failed exchange, never another
    // account's other devices. The original app cookie remains untouched.
    if (auxiliary && !accepted && auxiliary.claims.sessionId !== originalSessionId) {
      try { await auxiliary.client.auth.admin.signOut(auxiliary.session.access_token, "local"); } catch { /* DB guards still reject an unusable session. */ }
    }
  }
}

export async function reauthStateResponse(request, flowId, { env = process.env, now = Date.now(), clientFactory } = {}) {
  try {
    if (!UUID.test(flowId)) throw invalid();
    const cookie = request.headers.get("cookie"), current = await identity(cookie, { env, now, clientFactory });
    const flow = openReauthFlow(cookie, env, now);
    if (!flow || flow.flow_id !== flowId || flow.user_id !== current.userId || flow.session_id !== current.claims.sessionId) throw forbidden();
    const expiry = flow.phase === "verified" ? flow.expires_at : flow.issued_at + FLOW_TTL;
    const status = expiry <= Math.floor(now / 1000) ? "expired" : flow.phase;
    return Response.json({ flow_id: flow.flow_id, status, grant_id: status === "verified" ? flow.grant_id : null, expires_at: new Date(expiry * 1000).toISOString() }, { headers: headers() });
  } catch (error) { return failure(error); }
}

export async function accountDeletionResponse(request, { env = process.env, now = Date.now(), clientFactory } = {}) {
  try {
    const { body } = await mutation(request, env), requestKey = request.headers.get("idempotency-key");
    if (Object.keys(body).sort().join("|") !== "confirm|reauth_grant_id" || body.confirm !== true || !UUID.test(body.reauth_grant_id) || !UUID.test(requestKey ?? "")) throw invalid();
    const cookie = request.headers.get("cookie"), current = await identity(cookie, { env, now, clientFactory }, false), flow = openReauthFlow(cookie, env, now);
    if (flow?.phase !== "verified" || flow.grant_id !== body.reauth_grant_id || flow.user_id !== current.userId || flow.session_id !== current.claims.sessionId || flow.expires_at <= Math.floor(now / 1000)) throw forbidden();
    const result = await current.client.rpc("request_account_deletion", { p_request_key: requestKey, p_reauth_grant_id: body.reauth_grant_id, p_confirm: true }); rpcFailure(result.error);
    const data = result.data;
    if (!data || Object.keys(data).sort().join("|") !== "access_revoked|id|status" || !UUID.test(data.id) || !["pending", "running", "completed", "failed"].includes(data.status) || data.access_revoked !== true) throw unavailable();
    // The committed app-account transition blocks every product RPC already.
    // Auth outage cannot turn this accepted deletion back into a failure.
    try { await current.client.auth.admin.signOut(current.session.access_token, "global"); } catch { /* Operational deletion worker must retry Auth revocation. */ }
    const values = headers(); for (const cookie of clears()) values.append("Set-Cookie", cookie);
    values.append("Set-Cookie", temporaryCookieHeader(DELETION_RECEIPT_COOKIE_NAME, sealDeletionReceipt(data.id, env, now)));
    return Response.json({ id: data.id, status: data.status, access_revoked: true }, { status: 202, headers: values });
  } catch (error) { return failure(error); }
}
