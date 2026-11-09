import "server-only";
import { reauthStateResponse } from "@/server/account-deletion-api.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ flow_id: string }> }) {
  return reauthStateResponse(request, (await params).flow_id);
}
