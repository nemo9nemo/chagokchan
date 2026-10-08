import "server-only";
import { randomUUID } from "node:crypto";
import { createCsrfToken, csrfCookieHeader, getCsrfSigningSecret } from "@/server/api-security.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  try {
    if (process.env.APP_AUTH_MODE !== "local_fixture") throw new Error("Deployment flow binding is not available.");
    const secret = getCsrfSigningSecret();
    const csrfToken = createCsrfToken(secret);
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
