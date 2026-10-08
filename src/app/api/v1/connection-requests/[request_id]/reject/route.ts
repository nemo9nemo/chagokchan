import "server-only";
import { rejectConnectionRequestResponse } from "@/server/connection-api.mjs";
import { withLocalSession } from "@/server/local-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ request_id: string }> };

export async function POST(request: Request, { params }: Context) {
  return withLocalSession(async (client) => {
    const { request_id } = await params;
    return rejectConnectionRequestResponse(request_id, request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}
