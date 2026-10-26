import "server-only";
import { logoutResponse } from "@/server/logout-api.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return logoutResponse(request);
}
