import "server-only";
import { randomUUID } from "node:crypto";
import { getAppSessionClient } from "@/server/app-session";
import { SessionAccountError } from "@/server/deployed-session.mjs";

type SessionClient = NonNullable<Awaited<ReturnType<typeof getAppSessionClient>>>;

export function authRequiredResponse(requestId = randomUUID()) {
  return Response.json({ error: { code: "AUTH_REQUIRED", message: "현재 세션이 필요합니다.", request_id: requestId } }, {
    status: 401, headers: { "Cache-Control": "no-store", Pragma: "no-cache", "X-Request-ID": requestId },
  });
}

export function sessionFailureResponse(error: unknown, requestId: string) {
  const signup = error instanceof SessionAccountError && error.accountState === "signup_required";
  const unavailable = error instanceof SessionAccountError;
  const status = signup || unavailable ? 403 : 503;
  const code = signup ? "REGISTRATION_REQUIRED" : unavailable ? "ACTION_FORBIDDEN" : "DEPENDENCY_UNAVAILABLE";
  const message = signup ? "계정 등록을 완료해야 합니다." : unavailable ? "요청을 수행할 수 없습니다." : "요청을 처리할 수 없습니다.";
  return Response.json({ error: { code, message, request_id: requestId } }, {
    status, headers: { "Cache-Control": "no-store", Pragma: "no-cache", "X-Request-ID": requestId },
  });
}

export async function withAppSession(handler: (client: SessionClient) => Promise<Response>) {
  const requestId = randomUUID();
  try {
    const client = await getAppSessionClient();
    if (!client) return authRequiredResponse(requestId);
    return await handler(client);
  } catch (error) {
    return sessionFailureResponse(error, requestId);
  }
}
