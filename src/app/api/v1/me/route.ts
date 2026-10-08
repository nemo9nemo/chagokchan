import "server-only";
import { randomUUID } from "node:crypto";
import { readLocalMe } from "@/server/local-user-session.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(body: unknown, status: number, requestId: string) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Request-ID": requestId,
    },
  });
}

function apiError(code: string, message: string, status: number, requestId: string) {
  return jsonResponse({ error: { code, message, request_id: requestId } }, status, requestId);
}

export async function GET() {
  const requestId = randomUUID();
  try {
    const me = await readLocalMe();
    if (!me) return apiError("AUTH_REQUIRED", "현재 세션이 필요합니다.", 401, requestId);
    return jsonResponse(me, 200, requestId);
  } catch (error) {
    const databaseCode = error && typeof error === "object" && "databaseCode" in error ? error.databaseCode : undefined;
    const databaseMessage = error && typeof error === "object" && "databaseMessage" in error ? error.databaseMessage : undefined;
    if (databaseCode === "PT401" || databaseCode === "PGRST301") {
      return apiError("AUTH_REQUIRED", "현재 세션이 필요합니다.", 401, requestId);
    }
    if (databaseCode === "PT403" && databaseMessage === "signup_required") {
      return apiError("REGISTRATION_REQUIRED", "계정 등록을 완료해야 합니다.", 403, requestId);
    }
    if (databaseCode === "PT403") return apiError("ACTION_FORBIDDEN", "요청을 수행할 수 없습니다.", 403, requestId);
    return apiError("DEPENDENCY_UNAVAILABLE", "요청을 처리할 수 없습니다.", 503, requestId);
  }
}
