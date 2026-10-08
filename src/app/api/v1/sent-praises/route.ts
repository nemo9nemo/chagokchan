import "server-only";
import { listSentPraisesResponse } from "@/server/news-api.mjs";
import { withLocalSession } from "@/server/local-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withLocalSession((client) => listSentPraisesResponse(new URL(request.url), client));
}
