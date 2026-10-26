import { randomUUID } from "node:crypto";
import { ApiRequestError, CSRF_COOKIE_NAME, getCsrfSigningSecret, validateMutationRequest } from "./api-security.mjs";
import { expiredSessionCookieHeader, openSession, resolveVerifiedAuthSession, sessionCookieValue } from "./deployed-session.mjs";

function json(body, status, requestId, clear = false) {
  const headers = new Headers({ "Cache-Control": "no-store", Pragma: "no-cache", "X-Request-ID": requestId });
  if (clear) {
    headers.append("Set-Cookie", expiredSessionCookieHeader());
    headers.append("Set-Cookie", `${CSRF_COOKIE_NAME}=; Path=/api/v1; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
  }
  return Response.json(body, { status, headers });
}
const required = () => new ApiRequestError(401, "AUTH_REQUIRED", "현재 인증 세션을 확인한 뒤 다시 시도해 주세요.");
const unavailable = () => new ApiRequestError(503, "DEPENDENCY_UNAVAILABLE", "로그아웃 결과를 확인하지 못했어요. 다시 시도해 주세요.");

function validContext(data, userId) {
  const next = { active: "/", signup_required: "/signup", deleting: "/account/deletion" };
  return data && Object.keys(data).sort().join("|") === "account_state|next|user_id" && data.user_id === userId &&
    Object.hasOwn(next, data.account_state) && next[data.account_state] === data.next;
}

export async function logoutResponse(request, { env = process.env, clientFactory, now = Date.now() } = {}) {
  const requestId = randomUUID();
  try {
    const body = await validateMutationRequest(request, { expectedOrigin: new URL(env.APP_BASE_URL).origin, secret: getCsrfSigningSecret(env), env });
    if (Object.keys(body).some(key => key !== "scope") || (body.scope !== undefined && !["current", "all"].includes(body.scope))) {
      throw new ApiRequestError(400, "INVALID_INPUT", "로그아웃 범위를 확인해 주세요.");
    }
    if (env.APP_AUTH_MODE === "local_fixture") {
      throw new ApiRequestError(409, "ACTION_FORBIDDEN", "개발용 가상 세션에서는 로그아웃을 사용하지 않아요.");
    }
    const scope = body.scope ?? "current";
    const cookie = request.headers.get("cookie");
    const session = openSession(sessionCookieValue(cookie), env, now);
    if (!session) {
      if (scope === "all") throw required();
      return json({ ok: true }, 200, requestId, true);
    }
    const verified = await resolveVerifiedAuthSession(cookie, { env, clientFactory, now });
    // An expired access token may still have a live refresh token. Keep the
    // cookie and return 401 until the future refresh flow can verify/revoke it.
    if (!verified) throw required();
    const context = await verified.client.rpc("get_auth_context");
    const ended = context.error?.code === "PT401";
    if (context.error && !ended) throw unavailable();
    if (ended && scope === "all") throw required();
    if (!ended && !validContext(context.data, verified.userId)) throw unavailable();
    // The pinned SDK's ordinary signOut uses this same method with the user's
    // JWT. No service/admin key or privileged app-table request is used here.
    const result = await verified.client.auth.admin.signOut(session.access_token, scope === "all" ? "global" : "local");
    if (result.error) {
      if (scope !== "current" || ![401, 404].includes(result.error.status)) throw unavailable();
      const current = ended ? context : await verified.client.rpc("get_auth_context");
      if (current.error?.code !== "PT401") throw unavailable();
    }
    return json({ ok: true }, 200, requestId, true);
  } catch (error) {
    const safe = error instanceof ApiRequestError ? error : unavailable();
    return json({ error: { code: safe.code, message: safe.message, request_id: requestId } }, safe.status, requestId);
  }
}
