import "server-only";
import { listConnectionsResponse } from "@/server/connection-api.mjs";
import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAppSession((client) => listConnectionsResponse(new URL(request.url), client));
}
