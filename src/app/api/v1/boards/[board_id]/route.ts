import "server-only";

import { getBoardResponse } from "@/server/board-api.mjs";

import { updateBoardResponse } from "@/server/goal-api.mjs";

import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ board_id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  return withAppSession(async (client) => {
    const { board_id } = await params;
    return updateBoardResponse(board_id, request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}

export async function GET(_request: Request, { params }: Context) {
  return withAppSession(async (client) => {
    const { board_id } = await params;
    return getBoardResponse(board_id, client);
  });
}
