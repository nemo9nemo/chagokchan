import "server-only";
import { listConnectionsResponse } from "@/server/connection-api.mjs";
import { withLocalSession } from "@/server/local-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withLocalSession((client) => listConnectionsResponse(new URL(request.url), client));
}
