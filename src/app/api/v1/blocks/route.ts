import "server-only";
import { createBlockResponse, listBlocksResponse } from "@/server/connection-api.mjs";
import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAppSession((client) => listBlocksResponse(new URL(request.url), client));
}

export async function POST(request: Request) {
  return withAppSession((client) => createBlockResponse(request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin }));
}
