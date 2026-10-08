import "server-only";
import { listBoardMembersResponse } from "@/server/board-api.mjs";
import { withLocalSession } from "@/server/local-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ board_id: string }> };

export async function GET(request: Request, { params }: Context) {
  return withLocalSession(async (client) => {
    const { board_id } = await params;
    return listBoardMembersResponse(board_id, new URL(request.url), client);
  });
}
