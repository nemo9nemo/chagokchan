import "server-only";

import { cancelPraiseResponse } from "@/server/praise-api.mjs";

import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ praise_id: string }> };

export async function POST(request: Request, { params }: Context) {
  return withAppSession(async (client) => {
    const { praise_id } = await params;
    return cancelPraiseResponse(praise_id, request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}
