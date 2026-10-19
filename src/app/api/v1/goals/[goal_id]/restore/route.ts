import "server-only";

import { transitionGoalResponse } from "@/server/goal-api.mjs";

import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ goal_id: string }> };

export async function POST(request: Request, { params }: Context) {
  return withAppSession(async (client) => {
    const { goal_id } = await params;
    return transitionGoalResponse(goal_id, "restore", request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}
