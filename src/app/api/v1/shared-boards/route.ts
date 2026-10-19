import "server-only";
import { listMySharedBoardsResponse } from "@/server/board-api.mjs";
import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAppSession((client) => listMySharedBoardsResponse(new URL(request.url), client));
}
