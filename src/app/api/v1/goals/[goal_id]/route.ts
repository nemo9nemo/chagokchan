import "server-only";
import { randomUUID } from "node:crypto";
import { getGoalResponse, transitionGoalResponse, updateGoalResponse } from "@/server/goal-api.mjs";
import { getLocalSessionClient } from "@/server/local-user-session.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ goal_id: string }> };

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

export async function GET(_request: Request, { params }: Context) {
  let client: Awaited<ReturnType<typeof getLocalSessionClient>> = null;
  try { client = await getLocalSessionClient(); } catch { return dependencyUnavailable(randomUUID()); }
  if (!client) return authRequired(randomUUID());
  const { goal_id } = await params;
  return getGoalResponse(goal_id, client);
}

export async function PATCH(request: Request, { params }: Context) {
  let client: Awaited<ReturnType<typeof getLocalSessionClient>> = null;
  try { client = await getLocalSessionClient(); } catch { return dependencyUnavailable(randomUUID()); }
  if (!client) return authRequired(randomUUID());
  const { goal_id } = await params;
  return updateGoalResponse(goal_id, request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
}

export async function DELETE(request: Request, { params }: Context) {
  let client: Awaited<ReturnType<typeof getLocalSessionClient>> = null;
  try { client = await getLocalSessionClient(); } catch { return dependencyUnavailable(randomUUID()); }
  if (!client) return authRequired(randomUUID());
  const { goal_id } = await params;
  return transitionGoalResponse(goal_id, "delete", request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
}
