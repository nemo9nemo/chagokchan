import "server-only";
import { revokeBlockResponse } from "@/server/connection-api.mjs";
import { withLocalSession } from "@/server/local-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ block_id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  return withLocalSession(async (client) => {
    const { block_id } = await params;
    return revokeBlockResponse(block_id, request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}
