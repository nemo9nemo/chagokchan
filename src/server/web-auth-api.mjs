import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ApiRequestError, CSRF_COOKIE_NAME, csrfSessionBinding, getCsrfSigningSecret, validateMutationRequest } from "./api-security.mjs";
import { FLOW_COOKIE_NAME, INVITE_COOKIE_NAME, allowedNextPath, openLoginFlow, openPendingInvite, sealLoginFlow, sealPendingInvite, temporaryCookieHeader, validInviteToken } from "./auth-flow-cookie.mjs";
import { SESSION_COOKIE_NAME, openSession, resolveVerifiedAuthSession, sealRotatedSession, sealSession, sessionConfiguration, sessionCookieHeader, sessionCookieValue, sessionTokenClaims } from "./deployed-session.mjs";
import { authContextResponse } from "./registration-api.mjs";

export const expiredCsrfCookie = () => `${CSRF_COOKIE_NAME}=; Path=/api/v1; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
const unavailable = () => new ApiRequestError(503, "DEPENDENCY_UNAVAILABLE", "인증 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
const required = () => new ApiRequestError(401, "AUTH_REQUIRED", "다시 로그인해 주세요.");
export class AuthTokenRejectedError extends ApiRequestError {
  constructor() { super(401, "AUTH_REQUIRED", "다시 로그인해 주세요."); }
}

function headers() {
  return new Headers({ "Cache-Control": "private, no-store", Pragma: "no-cache", "X-Request-ID": randomUUID(), "Referrer-Policy": "no-referrer" });
}

function failure(error) {
  const safe = error instanceof ApiRequestError ? error : unavailable();
  const values = headers();
  return Response.json({ error: { code: safe.code, message: safe.message, request_id: values.get("X-Request-ID") } }, { status: safe.status, headers: values });
}

async function mutation(request, env) {
  const config = sessionConfiguration(env);
  const body = await validateMutationRequest(request, { expectedOrigin: config.baseUrl, secret: getCsrfSigningSecret(env), env });
  return { body, config };
}

export async function googleStartResponse(request, { env = process.env, now = Date.now() } = {}) {
  try {
    const { body, config } = await mutation(request, env);
    if (Object.keys(body).some(key => !["next", "invite_token"].includes(key)) ||
        (body.next !== undefined && !allowedNextPath(body.next)) ||
        (body.invite_token !== undefined && !validInviteToken(body.invite_token))) throw new ApiRequestError(400, "INVALID_INPUT", "로그인 요청을 다시 확인해 주세요.");
    if (openSession(sessionCookieValue(request.headers.get("cookie")), env, now)) throw new ApiRequestError(409, "SESSION_EXISTS", "현재 계정에서 로그아웃한 뒤 다시 로그인해 주세요.");
    const verifier = randomBytes(32).toString("base64url");
    const flow = sealLoginFlow({ verifier, binding: csrfSessionBinding(request), next: body.invite_token ? "/connect" : body.next ?? "/", invite_token: body.invite_token ?? null }, env, now);
    // This is the pinned Auth SDK's PKCE authorize protocol. Only the S256
    // challenge leaves the server; neither verifier nor tokens enter browser JS.
    const url = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
    url.search = new URLSearchParams({ provider: "google", redirect_to: `${config.baseUrl}/api/v1/auth/callback`,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "s256", prompt: "select_account" }).toString();
    const values = headers();
    values.append("Set-Cookie", temporaryCookieHeader(FLOW_COOKIE_NAME, flow));
    return Response.json({ authorization_url: url.href }, { headers: values });
  } catch (error) { return failure(error); }
}

async function tokenExchange(grant, body, env, fetcher) {
  const { supabaseUrl } = sessionConfiguration(env);
  let result;
  try {
    result = await fetcher(`${supabaseUrl}/auth/v1/token?grant_type=${grant}`, { method: "POST", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(10000), headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch { throw unavailable(); }
  if (!result.ok) {
    if ([400, 401, 403].includes(result.status)) throw new AuthTokenRejectedError();
    throw unavailable();
  }
  // Provider metadata is deliberately discarded; only the two Auth tokens
  // enter the encrypted app session after independent Auth and DB checks.
  let data;
  try { data = await result.json(); } catch { throw unavailable(); }
  return { access_token: data?.access_token, refresh_token: data?.refresh_token };
}

async function verifiedContext(sealed, options) {
  const verified = await resolveVerifiedAuthSession(`${SESSION_COOKIE_NAME}=${sealed}`, options);
  if (!verified) throw required();
  const result = await authContextResponse(verified.client, verified.userId);
  if (!result.ok) {
    if (result.status === 401) throw required();
    throw unavailable();
  }
  return result.json();
}

function callbackRedirect(path, config, cookies = []) {
  const values = headers();
  values.set("Location", `${config.baseUrl}${path}`);
  for (const cookie of cookies) values.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers: values });
}

export async function googleCallbackResponse(request, { env = process.env, now = Date.now(), fetcher = fetch, clientFactory } = {}) {
  let config;
  try { config = sessionConfiguration(env); } catch (error) { return failure(error); }
  const clearFlow = temporaryCookieHeader(FLOW_COOKIE_NAME, "", 0);
  try {
    const url = new URL(request.url);
    const flow = openLoginFlow(request.headers.get("cookie"), env, now);
    if (!flow || flow.binding !== csrfSessionBinding(request) || url.searchParams.getAll("code").length !== 1 ||
        url.searchParams.has("error") || !/^[A-Za-z0-9_-]{1,2048}$/.test(url.searchParams.get("code") ?? "")) {
      return callbackRedirect("/?auth_error=retry", config, [clearFlow]);
    }
    const tokens = await tokenExchange("pkce", { auth_code: url.searchParams.get("code"), code_verifier: flow.verifier }, env, fetcher);
    const sealed = sealSession(tokens, env, now);
    const context = await verifiedContext(sealed, { env, now, clientFactory });
    const claims = sessionTokenClaims(tokens.access_token);
    const cookies = [sessionCookieHeader(sealed), expiredCsrfCookie(), clearFlow, temporaryCookieHeader(INVITE_COOKIE_NAME, "", 0)];
    if (flow.invite_token) cookies[3] = temporaryCookieHeader(INVITE_COOKIE_NAME, sealPendingInvite(flow.invite_token, claims, env, now));
    const next = context.account_state === "active" ? flow.next : context.next;
    return callbackRedirect(next, config, cookies);
  } catch (error) {
    // A failed exchange never removes or replaces an existing app session.
    return callbackRedirect(error instanceof ApiRequestError && error.status === 503 ? "/?auth_error=unavailable" : "/?auth_error=retry", config, [clearFlow]);
  }
}

export async function refreshedSession(cookieHeader, { env = process.env, now = Date.now(), fetcher = fetch, clientFactory } = {}) {
  const previous = openSession(sessionCookieValue(cookieHeader), env, now);
  if (!previous) throw required();
  const expected = sessionTokenClaims(previous.access_token);
  if (!expected) throw required();
  const tokens = await tokenExchange("refresh_token", { refresh_token: previous.refresh_token }, env, fetcher);
  const claims = sessionTokenClaims(tokens.access_token);
  if (!claims || claims.userId !== expected.userId || claims.sessionId !== expected.sessionId || claims.expiresAt <= Math.floor(now / 1000)) throw required();
  const sealed = sealRotatedSession(tokens, previous, env, now);
  const context = await verifiedContext(sealed, { env, now, clientFactory });
  return { sealed, context, tokens, remaining: previous.expires_at - Math.floor(now / 1000) };
}

export async function refreshResponse(request, options = {}) {
  const env = options.env ?? process.env;
  try {
    const { body } = await mutation(request, env);
    if (Object.keys(body).length !== 0) throw new ApiRequestError(400, "INVALID_INPUT", "갱신 요청을 다시 확인해 주세요.");
    const refreshed = await refreshedSession(request.headers.get("cookie"), { ...options, env });
    const values = headers();
    values.append("Set-Cookie", sessionCookieHeader(refreshed.sealed, refreshed.remaining));
    values.append("Set-Cookie", expiredCsrfCookie());
    return Response.json(refreshed.context, { headers: values });
  } catch (error) { return failure(error); }
}

export async function pendingInviteResponse(request, { env = process.env, now = Date.now(), clientFactory } = {}) {
  try {
    const { body } = await mutation(request, env);
    if (Object.keys(body).length !== 0) throw new ApiRequestError(400, "INVALID_INPUT", "초대 요청을 다시 확인해 주세요.");
    const cookieHeader = request.headers.get("cookie");
    const sealed = sessionCookieValue(cookieHeader);
    const context = await verifiedContext(sealed, { env, now, clientFactory });
    if (context.account_state !== "active") throw required();
    const session = openSession(sealed, env, now);
    const invite = openPendingInvite(cookieHeader, sessionTokenClaims(session.access_token), env, now);
    const values = headers();
    values.append("Set-Cookie", temporaryCookieHeader(INVITE_COOKIE_NAME, "", 0));
    return Response.json({ invite_token: invite }, { headers: values });
  } catch (error) { return failure(error); }
}
