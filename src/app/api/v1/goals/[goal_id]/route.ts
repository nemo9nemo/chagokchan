import "server-only";

import { getGoalResponse, transitionGoalResponse, updateGoalResponse } from "@/server/goal-api.mjs";

import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ goal_id: string }> };

export async function GET(_request: Request, { params }: Context) {
  return withAppSession(async (client) => {
    const { goal_id } = await params;
    return getGoalResponse(goal_id, client);
  });
}

export async function PATCH(request: Request, { params }: Context) {
  return withAppSession(async (client) => {
    const { goal_id } = await params;
    return updateGoalResponse(goal_id, request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withAppSession(async (client) => {
    const { goal_id } = await params;
    return transitionGoalResponse(goal_id, "delete", request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}
