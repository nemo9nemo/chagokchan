import "server-only";
import { listNotificationsResponse } from "@/server/news-api.mjs";
import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAppSession((client) => listNotificationsResponse(new URL(request.url), client));
}
