import "server-only";
import { randomUUID } from "node:crypto";
import { createCsrfToken, csrfCookieHeader, csrfSessionBinding, getCsrfSigningSecret } from "@/server/api-security.mjs";
import { validateEnvironment } from "../../../../../../scripts/runtime-environment.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = randomUUID();
  try {
    validateEnvironment(process.env, { command: process.env.NODE_ENV === "development" ? "dev" : "start", bindingHost: process.env.CHAGOKCHAN_BIND_HOST });
    const secret = getCsrfSigningSecret();
    const binding = process.env.APP_AUTH_MODE === "supabase_session" ? csrfSessionBinding(request) : null;
    const csrfToken = createCsrfToken(secret, Date.now(), binding);
    const secure = new URL(process.env.APP_BASE_URL ?? "http://localhost").protocol === "https:";
    return Response.json({ csrf_token: csrfToken }, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "Set-Cookie": csrfCookieHeader(csrfToken, { secure }),
        "X-Request-ID": requestId,
      },
    });
  } catch {
    return Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "요청을 처리할 수 없습니다.", request_id: requestId } }, {
      status: 503,
      headers: { "Cache-Control": "no-store", Pragma: "no-cache", "X-Request-ID": requestId },
    });
  }
}
