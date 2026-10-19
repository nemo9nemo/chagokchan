import "server-only";

import { listTrashGoalsResponse } from "@/server/goal-api.mjs";

import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAppSession(async (client) => {
    return listTrashGoalsResponse(new URL(request.url), client);
  });
}
