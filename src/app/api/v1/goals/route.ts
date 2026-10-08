import "server-only";
import { randomUUID } from "node:crypto";
import { createGoalResponse, listGoalsResponse } from "@/server/goal-api.mjs";
import { getLocalSessionClient } from "@/server/local-user-session.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authRequired(requestId: string) {
  return Response.json({ error: { code: "AUTH_REQUIRED", message: "현재 세션이 필요합니다.", request_id: requestId } }, {
    status: 401,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", "X-Request-ID": requestId },
  });
}

function dependencyUnavailable(requestId: string) {
  return Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "요청을 처리할 수 없습니다.", request_id: requestId } }, {
    status: 503,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", "X-Request-ID": requestId },
  });
}

export async function POST(request: Request) {
  let client: Awaited<ReturnType<typeof getLocalSessionClient>> = null;
  try {
    client = await getLocalSessionClient();
  } catch {
    return dependencyUnavailable(randomUUID());
  }
  if (!client) return authRequired(randomUUID());
  return createGoalResponse(request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
}

export async function GET(request: Request) {
  let client: Awaited<ReturnType<typeof getLocalSessionClient>> = null;
  try {
    client = await getLocalSessionClient();
  } catch {
    return dependencyUnavailable(randomUUID());
  }
  if (!client) return authRequired(randomUUID());
  return listGoalsResponse(new URL(request.url), client);
}
