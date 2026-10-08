import "server-only";
import { listMySharedBoardsResponse } from "@/server/board-api.mjs";
import { withLocalSession } from "@/server/local-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withLocalSession((client) => listMySharedBoardsResponse(new URL(request.url), client));
}
