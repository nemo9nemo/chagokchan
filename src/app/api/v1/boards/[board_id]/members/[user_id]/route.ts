import "server-only";
import { grantBoardMemberResponse, revokeBoardMemberResponse } from "@/server/board-api.mjs";
import { withLocalSession } from "@/server/local-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ board_id: string; user_id: string }> };

export async function PUT(request: Request, { params }: Context) {
  return withLocalSession(async (client) => {
    const { board_id, user_id } = await params;
    return grantBoardMemberResponse(board_id, user_id, request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withLocalSession(async (client) => {
    const { board_id, user_id } = await params;
    return revokeBoardMemberResponse(board_id, user_id, request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}
