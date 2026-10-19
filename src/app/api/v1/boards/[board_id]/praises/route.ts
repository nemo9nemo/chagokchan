import "server-only";

import { createPraiseResponse, listBoardPraisesResponse } from "@/server/praise-api.mjs";

import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ board_id: string }> };

export async function GET(request: Request, { params }: Context) {
  return withAppSession(async (client) => {
    const { board_id } = await params;
    return listBoardPraisesResponse(board_id, new URL(request.url), client);
  });
}

export async function POST(request: Request, { params }: Context) {
  return withAppSession(async (client) => {
    const { board_id } = await params;
    return createPraiseResponse(board_id, request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}
