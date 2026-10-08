import "server-only";
import { revokeConnectionInviteResponse } from "@/server/connection-api.mjs";
import { withLocalSession } from "@/server/local-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ invite_id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  return withLocalSession(async (client) => {
    const { invite_id } = await params;
    return revokeConnectionInviteResponse(invite_id, request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}
