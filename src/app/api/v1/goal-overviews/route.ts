import "server-only";
import { listGoalOverviewsResponse } from "@/server/goal-api.mjs";
import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAppSession(client => listGoalOverviewsResponse(new URL(request.url), client));
}
