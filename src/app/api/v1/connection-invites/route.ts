import "server-only";
import { createConnectionInviteResponse, listConnectionInvitesResponse } from "@/server/connection-api.mjs";
import { withAppSession } from "@/server/session-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAppSession((client) => listConnectionInvitesResponse(new URL(request.url), client));
}

export async function POST(request: Request) {
  return withAppSession((client) => createConnectionInviteResponse(request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin }));
}
