import "server-only";
import { randomUUID } from "node:crypto";
import { createPraiseResponse, listBoardPraisesResponse } from "@/server/praise-api.mjs";
import { getLocalSessionClient } from "@/server/local-user-session.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ board_id: string }> };

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

async function sessionClient() {
  try { return await getLocalSessionClient(); } catch { return undefined; }
}

export async function GET(request: Request, { params }: Context) {
  const client = await sessionClient();
  if (client === undefined) return dependencyUnavailable(randomUUID());
  if (!client) return authRequired(randomUUID());
  const { board_id } = await params;
  return listBoardPraisesResponse(board_id, new URL(request.url), client);
}

export async function POST(request: Request, { params }: Context) {
  const client = await sessionClient();
  if (client === undefined) return dependencyUnavailable(randomUUID());
  if (!client) return authRequired(randomUUID());
  const { board_id } = await params;
  return createPraiseResponse(board_id, request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
}
