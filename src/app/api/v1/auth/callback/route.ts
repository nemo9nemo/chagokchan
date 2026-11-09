import "server-only";
import { googleCallbackResponse } from "@/server/web-auth-api.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return googleCallbackResponse(request); }
