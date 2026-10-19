import "server-only";

import { createGoalResponse, listGoalsResponse } from "@/server/goal-api.mjs";

import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withAppSession(async (client) => {
    return createGoalResponse(request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}

export async function GET(request: Request) {
  return withAppSession(async (client) => {
    return listGoalsResponse(new URL(request.url), client);
  });
}
