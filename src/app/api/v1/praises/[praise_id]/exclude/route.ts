import "server-only";
import { peerPraiseStateResponse } from "@/server/praise-api.mjs";
import { withLocalSession } from "@/server/local-api-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ praise_id: string }> };

export async function POST(request: Request, { params }: Context) {
  return withLocalSession(async (client) => {
    const { praise_id } = await params;
    return peerPraiseStateResponse(praise_id, "exclude", request, client, { expectedOrigin: new URL(process.env.APP_BASE_URL ?? "http://localhost").origin });
  });
}
