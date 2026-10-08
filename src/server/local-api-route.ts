import "server-only";
import { randomUUID } from "node:crypto";
import { getLocalSessionClient } from "@/server/local-user-session.mjs";

type SessionClient = NonNullable<Awaited<ReturnType<typeof getLocalSessionClient>>>;

function errorResponse(status: 401 | 503, code: "AUTH_REQUIRED" | "DEPENDENCY_UNAVAILABLE", requestId: string) {
  const message = status === 401 ? "현재 세션이 필요합니다." : "요청을 처리할 수 없습니다.";
  return Response.json({ error: { code, message, request_id: requestId } }, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", "X-Request-ID": requestId },
  });
}

export async function withLocalSession(handler: (client: SessionClient) => Promise<Response>) {
  const requestId = randomUUID();
  let client: Awaited<ReturnType<typeof getLocalSessionClient>>;
  try {
    client = await getLocalSessionClient();
  } catch {
    return errorResponse(503, "DEPENDENCY_UNAVAILABLE", requestId);
  }
  if (!client) return errorResponse(401, "AUTH_REQUIRED", requestId);
  try {
    return await handler(client);
  } catch {
    return errorResponse(503, "DEPENDENCY_UNAVAILABLE", requestId);
  }
}
