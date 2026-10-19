import "server-only";
import { listSentPraisesResponse } from "@/server/news-api.mjs";
import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAppSession((client) => listSentPraisesResponse(new URL(request.url), client));
}
