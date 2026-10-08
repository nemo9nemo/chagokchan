import "server-only";
import { createConnectionRequestResponse, listConnectionRequestsResponse } from "@/server/connection-api.mjs";
import { withLocalSession } from "@/server/local-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withLocalSession((client) => listConnectionRequestsResponse(new URL(request.url), client));
}

export async function POST(request: Request) {
  return withLocalSession((client) => createConnectionRequestResponse(request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin }));
}
